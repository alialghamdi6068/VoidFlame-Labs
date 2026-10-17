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
const cookie = (name, value, extra = "") => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000${extra}`;
const clearCookie = "vf_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
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
  if (!origin) return true;
  return origin === new URL(env.SITE_URL).origin;
}
function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70);
}
async function githubFetch(url, token) {
  return fetch(url, {headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:{"access-control-allow-origin":env.SITE_URL,"access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS","access-control-allow-headers":"Content-Type","access-control-allow-credentials":"true","vary":"Origin"}});
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
        redirect.searchParams.set("redirect_uri",new URL("/api/auth/callback",env.SITE_URL).toString());
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
        const order=sort==="downloads"?"downloads DESC":sort==="updated"?"updated_at DESC":"created_at DESC";
        const limit=Math.min(48,Math.max(1,Number(url.searchParams.get("limit"))||24));
        const offset=Math.max(0,Number(url.searchParams.get("offset"))||0);
        let sql="SELECT p.id,p.slug,p.name,p.summary,p.category,p.icon_url,p.downloads,p.followers,p.created_at,p.updated_at,u.username AS author FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.status='approved'";
        const args=[];
        if(q){sql+=" AND (p.name LIKE ? OR p.summary LIKE ? OR p.description LIKE ?)";args.push("%"+q+"%","%"+q+"%","%"+q+"%");}
        if(category && category!=="all"){sql+=" AND p.category=?";args.push(category);}
        sql+=` ORDER BY ${order} LIMIT ? OFFSET ?`;args.push(limit,offset);
        const result=await env.DB.prepare(sql).bind(...args).all();
        return json({projects:result.results||[],limit,offset});
      }
      const projectMatch=url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
      if(projectMatch && request.method==="GET"){
        const project=await env.DB.prepare("SELECT p.*,u.username AS author,u.avatar_url AS author_avatar FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.slug=? AND p.status='approved'").bind(projectMatch[1]).first();
        if(!project)return err("Project not found",404);
        await env.DB.prepare("INSERT INTO analytics_events(id,project_id,event_type) VALUES(?,?,'view')").bind(id(),project.id).run();
        const versions=await env.DB.prepare("SELECT id,version_number,changelog,game_versions,loaders,channel,file_name,file_size,downloads,created_at FROM versions WHERE project_id=? ORDER BY created_at DESC").bind(project.id).all();
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
      if(url.pathname==="/api/developer/projects" && request.method==="GET"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        const projects=await env.DB.prepare("SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.project_id=p.id) AS version_count FROM projects p WHERE p.owner_id=? ORDER BY p.updated_at DESC").bind(user.id).all();
        return json({projects:projects.results||[]});
      }
      if(url.pathname==="/api/developer/projects" && request.method==="POST"){
        const user=await sessionUser(request,env);if(!user)return err("Sign in required",401);
        const body=await request.json().catch(()=>null);if(!body)return err("Invalid JSON");
        const name=String(body.name||"").trim().slice(0,80),summary=String(body.summary||"").trim().slice(0,180),description=String(body.description||"").trim().slice(0,20000),category=String(body.category||"").trim().slice(0,40);
        if(name.length<2||summary.length<10||!category)return err("Name, summary (10+ chars) and category are required");
        const slug=slugify(name)+"-"+id().slice(0,8);
        const projectId=id();
        await env.DB.prepare("INSERT INTO projects(id,slug,owner_id,name,summary,description,category,source_url,status) VALUES(?,?,?,?,?,?,?,?, 'pending')").bind(projectId,slug,user.id,name,summary,description,category,body.source_url?String(body.source_url).slice(0,500):null).run();
        return json({ok:true,id:projectId,slug,status:"pending"},201);
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
