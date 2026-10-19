/**
 * VoidFlame Labs API — Cloudflare Worker + D1 + R2.
 * Required bindings: DB (D1), FILES (R2); vars: SITE_URL, GITHUB_CLIENT_ID.
 * Secrets: GITHUB_CLIENT_SECRET, SESSION_SECRET.
 */
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});
const err = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};
const cookie = (name, value, extra = "") => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000${extra}`;
const clearCookie = "vf_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const found = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return found ? found.slice(name.length + 1) : "";
}
async function sessionUser(request, env) {
  const token = getCookie(request, "vf_session");
  if (!token || !env.SESSION_SECRET) return null;
  const [sid, signature] = token.split(".");
  if (!sid || !signature || !safeEqual(await sign(sid, env.SESSION_SECRET), signature)) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.github_id,u.username,u.display_name,u.avatar_url,u.bio,u.role
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at > datetime('now')`).bind(sid).first();
  return row || null;
}
function requireSameOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return ["GET","HEAD","OPTIONS"].includes(request.method);
  return origin === new URL(env.SITE_URL).origin;
}
function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70);
}
async function allowRate(request, env, action, max, windowSeconds=60, identity="anonymous") {
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const key=action+":"+identity+":"+ip;
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO rate_limits(key,window_started,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN excluded.window_started-rate_limits.window_started>=? THEN 1 ELSE rate_limits.count+1 END,
    window_started=CASE WHEN excluded.window_started-rate_limits.window_started>=? THEN excluded.window_started ELSE rate_limits.window_started END`)
    .bind(key,now,windowSeconds,windowSeconds).run();
  const row=await env.DB.prepare("SELECT count FROM rate_limits WHERE key=?").bind(key).first();
  return Number(row?.count||0)<=max;
}
async function githubFetch(url, token) {
  return fetch(url, {headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}});
}
export default {
  async fetch(request, env) {
    const response = await this.handle(request, env);
    const origin = request.headers.get("Origin");
    if (origin && origin === new URL(env.SITE_URL).origin) {
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set("access-control-allow-credentials", "true");
      response.headers.set("vary", "Origin");
    }
    return response;
  },
  async handle(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:{"access-control-allow-origin":new URL(env.SITE_URL).origin,"access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS","access-control-allow-headers":"Content-Type","access-control-allow-credentials":"true","vary":"Origin"}});
    if (!url.pathname.startsWith("/api/")) return err("Not found",404);
    if (!requireSameOrigin(request, env)) return err("Origin not allowed",403);
    try {
      // GitHub OAuth: state is signed and stored in a short-lived HttpOnly cookie.
      if (url.pathname === "/api/auth/github" && request.method === "GET") {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) return err("Authentication is not configured yet",503);
        const state = id();
        const sig = await sign(state, env.SESSION_SECRET);
        const redirect = new URL("https://github.com/login/oauth/authorize");
        redirect.searchParams.set("client_id",env.GITHUB_CLIENT_ID);
        redirect.searchParams.set("redirect_uri",new URL("/api/auth/callback",env.API_URL || env.SITE_URL).toString());
        redirect.searchParams.set("scope","read:user");
        redirect.searchParams.set("state",state);
        const response = new Response(null,{status:302,headers:{location:redirect.toString()}});
        response.headers.append("Set-Cookie",cookie("vf_oauth_state",state+"."+sig).replace("Max-Age=2592000","Max-Age=600"));
        return response;
      }
      if (url.pathname === "/api/auth/callback" && request.method === "GET") {
        const given = url.searchParams.get("state") || "";
        const saved = getCookie(request,"vf_oauth_state");
        const [savedState,savedSig] = saved.split(".");
        if (!given || !savedState || !savedSig || !safeEqual(given,savedState) || !safeEqual(await sign(given,env.SESSION_SECRET),savedSig)) return err("Invalid OAuth state",400);
        const code = url.searchParams.get("code");
        if (!code) return err("GitHub authorization was cancelled",400);
        const tokenRes = await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code})});
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) return err("GitHub sign-in failed",502);
        const userRes = await githubFetch("https://api.github.com/user",tokenData.access_token);
        const gh = await userRes.json();
        if (!userRes.ok || !gh.id || !gh.login) return err("Unable to verify GitHub account",502);
        const userId = id();
        await env.DB.prepare(`INSERT INTO users(id,github_id,username,display_name,avatar_url) VALUES(?,?,?,?,?)
          ON CONFLICT(github_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=datetime('now')`)
          .bind(userId,String(gh.id),gh.login,gh.name || gh.login,gh.avatar_url || null).run();
        const user = await env.DB.prepare("SELECT id FROM users WHERE github_id=?").bind(String(gh.id)).first();
        const sid = id();
        await env.DB.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,datetime('now','+30 days'))").bind(sid,user.id).run();
        const signed = sid+"."+await sign(sid,env.SESSION_SECRET);
        const destination = new URL(env.SITE_URL);
        destination.searchParams.set("signed_in","1");
        const response = new Response(null,{status:302,headers:{location:destination.toString()}});
        response.headers.append("Set-Cookie",cookie("vf_session",signed));
        response.headers.append("Set-Cookie",clearCookie.replace("vf_session=","vf_oauth_state="));
        return response;
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const user = await sessionUser(request,env);
        const token = getCookie(request,"vf_session");
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(token.split(".")[0]).run();
        return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":clearCookie}});
      }
      if (url.pathname === "/api/me" && request.method === "GET") return json({user:await sessionUser(request,env)});
      if (url.pathname === "/api/projects" && request.method === "GET") {
        const q=(url.searchParams.get("q")||"").trim().slice(0,100);
        const category=(url.searchParams.get("category")||"").slice(0,40);
        const sort=url.searchParams.get("sort");
        const order=sort==="downloads"||sort==="popular"?"downloads DESC":sort==="updated"?"updated_at DESC":sort==="name"?"name COLLATE NOCASE ASC":"created_at DESC";
        const limit=Math.min(48,Math.max(1,Number(url.searchParams.get("limit"))||24));
        const offset=Math.max(0,Number(url.searchParams.get("offset"))||0);
        let sql="SELECT p.id,p.slug,p.name,p.summary,p.category,p.icon_url,p.source_url,p.downloads,p.followers,p.created_at,p.updated_at,u.username AS author,(SELECT json_group_array(DISTINCT j.value) FROM versions v,json_each(v.game_versions) j WHERE v.project_id=p.id) AS supported_versions,(SELECT json_group_array(DISTINCT j.value) FROM versions v,json_each(v.loaders) j WHERE v.project_id=p.id) AS loaders FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.status='approved'";
        const args=[];
        if(q){sql+=" AND (p.name LIKE ? OR p.summary LIKE ? OR p.description LIKE ? OR u.username LIKE ?)";args.push("%"+q+"%","%"+q+"%","%"+q+"%","%"+q+"%");}
        if(category && category!=="all"){sql+=" AND p.category=?";args.push(category);}
        const gameVersion=(url.searchParams.get("gameVersion")||"").slice(0,30);
        const loader=(url.searchParams.get("loader")||"").slice(0,30);
        if(gameVersion){sql+=" AND EXISTS(SELECT 1 FROM versions v,json_each(v.game_versions) gv WHERE v.project_id=p.id AND gv.value=?)";args.push(gameVersion);}
        if(loader){sql+=" AND EXISTS(SELECT 1 FROM versions v,json_each(v.loaders) ld WHERE v.project_id=p.id AND ld.value=?)";args.push(loader);}
        sql+=` ORDER BY ${order} LIMIT ? OFFSET ?`;args.push(limit,offset);
        const result=await env.DB.prepare(sql).bind(...args).all();
        return json({projects:result.results||[],limit,offset});
      }
      const projectMatch=url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
      if(projectMatch && request.method==="GET"){
        const project=await env.DB.prepare("SELECT p.*,u.username AS author,u.avatar_url AS author_avatar FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.slug=? AND p.status='approved'").bind(projectMatch[1]).first();
        if(!project)return err("Project not found",404);
        await env.DB.prepare("INSERT INTO analytics_events(id,project_id,event_type) VALUES(?,?,'view')").bind(id(),project.id).run();
        const versions=await env.DB.prepare("SELECT id,version_number,changelog,game_versions,loaders,channel,file_name,file_size,release_url,downloads,created_at FROM versions WHERE project_id=? ORDER BY created_at DESC").bind(project.id).all();
        const comments=await env.DB.prepare("SELECT c.id,c.body,c.created_at,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.status='visible' ORDER BY c.created_at DESC LIMIT 100").bind(project.id).all();
        return json({project,versions:versions.results||[],comments:comments.results||[]});
      }
      const projectSub=url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/(favorite|follow|comments|report|versions)$/);
      if(projectSub){
        const [,slug,action]=projectSub;
        const project=await env.DB.prepare("SELECT id,owner_id FROM projects WHERE slug=? AND status='approved'").bind(slug).first();
        if(!project)return err("Project not found",404);
        if(request.method==="GET" && action==="versions") return json({versions:(await env.DB.prepare("SELECT id,version_number,changelog,game_versions,loaders,channel,file_name,file_size,downloads,created_at FROM versions WHERE project_id=? ORDER BY created_at DESC").bind(project.id).all()).results||[]});
        if(request.method!=="POST")return err("Method not allowed",405);
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        const rateAction=action==="comments"?"comment":action==="report"?"report":action;
        const maxRequests=action==="comments"?8:action==="report"?5:20;
        if(!await allowRate(request,env,rateAction,maxRequests,60,user.id))return err("Rate limit exceeded. Try again shortly.",429);
        const body=await request.json().catch(()=>null);if(!body || typeof body!=="object")return err("Invalid JSON");
        if(action==="favorite" || action==="follow"){
          const table=action==="favorite"?"favorites":"follows";
          const existing=await env.DB.prepare(`SELECT 1 FROM ${table} WHERE user_id=? AND project_id=?`).bind(user.id,project.id).first();
          if(existing) await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=? AND project_id=?`).bind(user.id,project.id).run();
          else await env.DB.prepare(`INSERT INTO ${table}(user_id,project_id) VALUES(?,?)`).bind(user.id,project.id).run();
          return json({active:!existing});
        }
        if(action==="comments"){
          const text=String(body.body||"").trim();if(text.length<1||text.length>3000)return err("Comment must be 1–3000 characters");
          const commentId=id();await env.DB.prepare("INSERT INTO comments(id,user_id,project_id,body) VALUES(?,?,?,?)").bind(commentId,user.id,project.id,text).run();
          return json({ok:true,id:commentId},201);
        }
        if(action==="report"){
          const reason=String(body.reason||"").trim().slice(0,100);const details=String(body.details||"").trim().slice(0,2000);
          if(!reason)return err("Report reason is required");
          const reportId=id();await env.DB.prepare("INSERT INTO reports(id,reporter_id,project_id,reason,details) VALUES(?,?,?,?,?)").bind(reportId,user.id,project.id,reason,details).run();
          return json({ok:true,id:reportId},201);
        }
      }
      if(url.pathname==="/api/me/profile" && request.method==="PATCH"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        if(!await allowRate(request,env,"profile-update",10,3600,user.id))return err("Profile update rate limit exceeded.",429);
        const body=await request.json().catch(()=>null);if(!body||typeof body!=="object")return err("Invalid JSON");
        const displayName=String(body.display_name??user.display_name??user.username).trim().slice(0,60);
        const bio=String(body.bio??user.bio??"").trim().slice(0,300);
        if(!displayName)return err("Display name cannot be empty");
        await env.DB.prepare("UPDATE users SET display_name=?,bio=?,updated_at=datetime('now') WHERE id=?").bind(displayName,bio,user.id).run();
        return json({ok:true,display_name:displayName,bio});
      }
      if((url.pathname==="/api/me/favorites"||url.pathname==="/api/me/follows") && request.method==="GET"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        const table=url.pathname.endsWith("favorites")?"favorites":"follows";
        const rows=await env.DB.prepare(`SELECT p.id,p.slug,p.name,p.summary,p.category,p.icon_url,p.downloads,p.updated_at,u.username AS author FROM ${table} f JOIN projects p ON p.id=f.project_id JOIN users u ON u.id=p.owner_id WHERE f.user_id=? AND p.status='approved' ORDER BY f.created_at DESC LIMIT 200`).bind(user.id).all();
        return json({projects:rows.results||[]});
      }
      if(url.pathname==="/api/developer/projects" && request.method==="GET"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        const projects=await env.DB.prepare("SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.project_id=p.id) AS version_count, (SELECT COUNT(*) FROM analytics_events a WHERE a.project_id=p.id AND a.event_type='view') AS view_count, (SELECT COUNT(*) FROM analytics_events a WHERE a.project_id=p.id AND a.event_type='download') AS tracked_downloads FROM projects p WHERE p.owner_id=? ORDER BY p.updated_at DESC").bind(user.id).all();
        return json({projects:projects.results||[]});
      }
      if(url.pathname==="/api/developer/projects" && request.method==="POST"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        if(!await allowRate(request,env,"project-create",5,3600,user.id))return err("Project submission rate limit exceeded.",429);
        const body=await request.json().catch(()=>null);if(!body)return err("Invalid JSON");
        const name=String(body.name||"").trim().slice(0,80),summary=String(body.summary||"").trim().slice(0,180),description=String(body.description||"").trim().slice(0,20000),category=String(body.category||"").trim().slice(0,40);
        if(name.length<2||summary.length<10||!category)return err("Name, summary (10+ chars) and category are required");
        const slug=slugify(name)+"-"+id().slice(0,8);
        const projectId=id();
        await env.DB.prepare("INSERT INTO projects(id,slug,owner_id,name,summary,description,category,source_url,status) VALUES(?,?,?,?,?,?,?,?, 'pending')").bind(projectId,slug,user.id,name,summary,description,category,body.source_url?String(body.source_url).slice(0,500):null).run();
        return json({ok:true,id:projectId,slug,status:"pending"},201);
      }
      const uploadMatch=url.pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)\/upload$/);
      if(uploadMatch && request.method==="POST"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        if(!await allowRate(request,env,"upload",8,600,user.id))return err("Upload rate limit exceeded.",429);
        if(!env.FILES)return err("File storage is not configured",503);
        const project=await env.DB.prepare("SELECT id,owner_id FROM projects WHERE slug=?").bind(uploadMatch[1]).first();
        if(!project)return err("Project not found",404);if(project.owner_id!==user.id)return err("Forbidden",403);
        const length=Number(request.headers.get("content-length")||0);if(length>52*1024*1024)return err("Upload exceeds 50 MB limit",413);
        const form=await request.formData();const file=form.get("file");
        if(!file||typeof file.arrayBuffer!=="function"||!file.size)return err("A release file is required");
        if(file.size>50*1024*1024)return err("Upload exceeds 50 MB limit",413);
        const filename=String(file.name||"release.bin").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120);
        const ext=filename.toLowerCase().split(".").pop();
        if(!["jar","zip","mrpack","jar.disabled","7z"].includes(ext))return err("Unsupported file type. Allowed: .jar, .zip, .mrpack, .7z",415);
        const key=project.id+"/"+id()+"/"+filename;
        await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:"application/octet-stream"},customMetadata:{projectId:project.id,ownerId:user.id,originalName:filename}});
        return json({ok:true,file_key:key,file_name:filename,file_size:file.size},201);
      }
      const developerVersionMatch=url.pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)\/versions$/);
      if(developerVersionMatch && request.method==="POST"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        if(!await allowRate(request,env,"version-publish",15,60,user.id))return err("Version publishing rate limit exceeded.",429);
        const project=await env.DB.prepare("SELECT id,owner_id FROM projects WHERE slug=?").bind(developerVersionMatch[1]).first();
        if(!project)return err("Project not found",404);if(project.owner_id!==user.id)return err("Forbidden",403);
        const body=await request.json().catch(()=>null);if(!body)return err("Invalid JSON");
        const version=String(body.version_number||"").trim().slice(0,40);if(!version)return err("Version number is required");
        const fileKey=String(body.file_key||"");
        let fileName=null,fileSize=0;
        if(fileKey){
          if(!env.FILES||!fileKey.startsWith(project.id+"/")||fileKey.includes(".."))return err("Invalid uploaded file reference",400);
          const object=await env.FILES.head(fileKey);if(!object)return err("Uploaded file not found",404);
          fileName=object.customMetadata?.originalName||fileKey.split("/").pop();fileSize=object.size;
        }
        let release=null;
        if(body.release_url){try{const u=new URL(String(body.release_url));if(u.protocol!=="https:"||u.hostname!=="github.com")return err("Release URL must point to github.com");release=u.href}catch{return err("Valid GitHub release URL is required")}}
        if(!fileKey&&!release)return err("Upload a release file or provide a GitHub release URL");
        const channel=["release","beta","alpha"].includes(body.channel)?body.channel:"release";
        const gameVersions=Array.isArray(body.game_versions)?body.game_versions.filter(x=>typeof x==="string").slice(0,30):[];
        const loaders=Array.isArray(body.loaders)?body.loaders.filter(x=>typeof x==="string").slice(0,15):[];
        const versionId=id();
        await env.DB.prepare("INSERT INTO versions(id,project_id,version_number,changelog,game_versions,loaders,channel,file_key,file_name,file_size,release_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(versionId,project.id,version,String(body.changelog||"").slice(0,10000),JSON.stringify(gameVersions),JSON.stringify(loaders),channel,fileKey||null,fileName,fileSize,release).run();
        await env.DB.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").bind(project.id).run();
        return json({ok:true,id:versionId},201);
      }
      const downloadMatch=url.pathname.match(/^\/api\/versions\/([a-zA-Z0-9_-]+)\/download$/);
      if(downloadMatch && request.method==="GET"){
        if(!env.FILES)return err("File storage is not configured",503);
        const v=await env.DB.prepare("SELECT v.id,v.project_id,v.file_key,v.file_name,p.status FROM versions v JOIN projects p ON p.id=v.project_id WHERE v.id=?").bind(downloadMatch[1]).first();
        if(!v||v.status!=="approved")return err("Version not found",404);
        if(!v.file_key)return err("This version is hosted externally",404);
        const object=await env.FILES.get(v.file_key);if(!object)return err("Release file is missing",404);
        await env.DB.batch([
          env.DB.prepare("UPDATE versions SET downloads=downloads+1 WHERE id=?").bind(v.id),
          env.DB.prepare("UPDATE projects SET downloads=downloads+1 WHERE id=?").bind(v.project_id),
          env.DB.prepare("INSERT INTO analytics_events(id,project_id,event_type) VALUES(?,?,'download')").bind(id(),v.project_id)
        ]);
        const filename=String(v.file_name||"download.bin").replace(/["\\\r\n]/g,"_");
        return new Response(object.body,{headers:{"content-type":"application/octet-stream","content-length":String(object.size),"content-disposition":'attachment; filename="'+filename+'"',"cache-control":"no-store","x-content-type-options":"nosniff"}});
      }
      if(url.pathname==="/api/admin/projects" && request.method==="GET"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);if(user.role!=="admin"&&user.role!=="moderator")return err("Forbidden",403);
        const status=["pending","approved","rejected","archived"].includes(url.searchParams.get("status"))?url.searchParams.get("status"):"pending";
        const rows=await env.DB.prepare("SELECT p.*,u.username AS author FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.status=? ORDER BY p.created_at ASC LIMIT 100").bind(status).all();
        return json({projects:rows.results||[]});
      }
      const adminProjectMatch=url.pathname.match(/^\/api\/admin\/projects\/([a-zA-Z0-9_-]+)$/);
      if(adminProjectMatch && request.method==="PATCH"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);if(user.role!=="admin"&&user.role!=="moderator")return err("Forbidden",403);
        const body=await request.json().catch(()=>null);const status=body&&body.status;
        if(!["approved","rejected","archived"].includes(status))return err("Invalid project status");
        const result=await env.DB.prepare("UPDATE projects SET status=?,updated_at=datetime('now') WHERE id=?").bind(status,adminProjectMatch[1]).run();
        if(!result.meta.changes)return err("Project not found",404);
        return json({ok:true,status});
      }
      const adminReportMatch=url.pathname.match(/^\/api\/admin\/reports\/([a-zA-Z0-9_-]+)$/);
      if(adminReportMatch && request.method==="PATCH"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);if(user.role!=="admin"&&user.role!=="moderator")return err("Forbidden",403);
        const body=await request.json().catch(()=>null);const status=body&&body.status;
        if(!["reviewing","resolved","dismissed"].includes(status))return err("Invalid report status");
        const result=await env.DB.prepare("UPDATE reports SET status=? WHERE id=?").bind(status,adminReportMatch[1]).run();
        if(!result.meta.changes)return err("Report not found",404);
        return json({ok:true,status});
      }
      if(url.pathname==="/api/admin/reports" && request.method==="GET"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);if(user.role!=="admin"&&user.role!=="moderator")return err("Forbidden",403);
        const reports=await env.DB.prepare("SELECT r.*,p.name AS project_name,u.username AS reporter FROM reports r LEFT JOIN projects p ON p.id=r.project_id JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100").all();
        return json({reports:reports.results||[]});
      }
      return err("Not found",404);
    } catch (e) {
      return json({error:"Internal server error" },500);
    }
  }
};
