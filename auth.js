(() => {
  const cfg = window.VOIDFLAME_CONFIG || {};
  const ready = cfg.supabaseUrl && cfg.supabaseAnonKey && !String(cfg.supabaseUrl).includes("YOUR_PROJECT_ID");
  const db = ready && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  let user = null, profile = null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = s => { const t=$("toast"); t.textContent=s; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000); };
  const show = (title, html) => { $("modalTitle").textContent=title; $("modalContent").innerHTML=html; $("modalBackdrop").classList.add("open"); document.body.style.overflow="hidden"; };
  const close = () => { $("modalBackdrop").classList.remove("open"); document.body.style.overflow=""; };
  function replaceClick(id, fn) { const old=$(id); if(!old)return; const next=old.cloneNode(true); old.replaceWith(next); next.addEventListener("click",fn); }
  function auth() {
    if(!db) return show("Connect Supabase",'<p class="modal-note">Backend is not configured. Run supabase/schema.sql in Supabase, copy config.example.js to config.js, and enter your project URL and public anon/publishable key.</p>');
    show("Sign in to VoidFlame Labs",'<p class="modal-note">Sign in securely using a provider. This site never asks for your Google or GitHub password.</p><button class="btn" id="oauthGoogle" style="width:100%;margin-bottom:10px">Continue with Google</button><button class="btn" id="oauthGithub" style="width:100%">Continue with GitHub</button><p class="modal-note" style="margin-top:14px">Enable both providers in Supabase Authentication settings and configure the allowed redirect URL.</p>');
    [["oauthGoogle","google"],["oauthGithub","github"]].forEach(([id,provider])=>$(id).addEventListener("click",async()=>{const {error}=await db.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+location.pathname}});if(error)toast(error.message);}));
  }
  async function refresh() {
    if(!db)return;
    const {data:{user:u}}=await db.auth.getUser(); user=u||null; profile=null;
    if(user){const {data}=await db.from("profiles").select("id,email,display_name,role,can_publish").eq("id",user.id).maybeSingle();profile=data||null;}
    const nav=document.querySelector(".navright"); let area=$("accountArea");
    if(!area){area=document.createElement("div");area.id="accountArea";area.style.cssText="display:flex;align-items:center;gap:8px";nav.insertBefore(area,$("mobileSearch"));}
    area.innerHTML="";
    if(!user){area.innerHTML='<button class="btn" id="realSignIn">Sign in</button>';$("realSignIn").onclick=auth;return;}
    if(["owner","manager"].includes(profile?.role)){area.innerHTML+='<button class="btn" id="managerBtn">Manager</button>';}
    area.innerHTML+='<button class="btn" id="userBtn">'+esc(profile?.display_name||user.email).slice(0,24)+'</button>';
    $("userBtn").onclick=()=>show("Account",'<p class="modal-note">'+esc(user.email)+'</p><p class="modal-note">Role: '+esc(profile?.role||"member")+' · '+(profile?.can_publish?"Publishing enabled":"Publishing access not granted")+'</p><button class="btn" id="logoutBtn" style="width:100%">Sign out</button>');
    $("logoutBtn")?.addEventListener("click",async()=>{await db.auth.signOut();close();await refresh();});
    $("managerBtn")?.addEventListener("click",manager);
  }
  async function publish() {
    if(!db){auth();return;}
    if(!user){auth();toast("Sign in first.");return;}
    if(!profile?.can_publish&&!["owner","manager"].includes(profile?.role)){toast("A manager must grant you publishing permission first.");return;}
    show("Publish a project",'<p class="modal-note">Submissions are reviewed before publication. Upload a .jar or .zip file up to 100 MB.</p><label class="field">Project name<input id="upName" maxlength="80"></label><label class="field">Description<input id="upSummary" maxlength="240"></label><label class="field">Type<select id="upCategory"><option>Plugins</option><option>Mods</option><option>Modpacks</option><option>Shaders</option><option>Resource Packs</option><option>Tools</option><option>Other</option></select></label><label class="field">Minecraft versions<input id="upVersions" placeholder="1.21.1, 1.21.4"></label><label class="field">Loader / platform<input id="upLoader" placeholder="Paper, Fabric, NeoForge..."></label><label class="field">Release version<input id="upVersion" placeholder="1.0.0"></label><label class="field">File<input id="upFile" type="file" accept=".jar,.zip" required></label><label class="field">Changelog<textarea id="upChangelog"></textarea></label><button class="btn btn-primary" id="uploadBtn" style="width:100%">Upload for review</button>');
    $("uploadBtn").onclick=upload;
  }
  async function upload() {
    const b=$("uploadBtn"), file=$("upFile").files[0], name=$("upName").value.trim(), summary=$("upSummary").value.trim(), version=$("upVersion").value.trim();
    if(!name||summary.length<10||!version||!file){toast("Fill in the required fields and select a file.");return;}
    if(!/\.(jar|zip)$/i.test(file.name)||file.size>104857600){toast("Only .jar/.zip files up to 100 MB are accepted.");return;}
    b.disabled=true;b.textContent="Uploading…";
    let projectId = null, uploadedPath = null, projectCreated = false;
    try {
      const versions=$("upVersions").value.split(",").map(s=>s.trim()).filter(Boolean), loader=$("upLoader").value.trim(), id=crypto.randomUUID();
      projectId = id;
      const slug=(name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"project")+"-"+id.slice(0,8);
      const {error:pe}=await db.from("projects").insert({id,slug,name,summary,description:summary,category:$("upCategory").value,game:"Minecraft",loader,supported_versions:versions,status:"pending",owner_id:user.id});
      if(pe)throw pe;
      projectCreated = true;
      const fileName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_"), path=user.id+"/"+id+"/"+fileName;
      uploadedPath = path;
      const {error:fe}=await db.storage.from("project-files").upload(path,file,{contentType:file.name.toLowerCase().endsWith(".jar")?"application/java-archive":"application/zip"});
      if(fe)throw fe;
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
      const {error:ve}=await db.from("project_versions").insert({project_id:id,version,game_versions:versions,loaders:loader?[loader]:[],file_path:path,file_name:file.name,file_size:file.size,sha256,changelog:$("upChangelog").value,created_by:user.id,status:"pending"});
      if(ve)throw ve;
      close();toast("Upload complete. Waiting for manager review.");
    } catch(e){
      if(uploadedPath) await db.storage.from("project-files").remove([uploadedPath]).catch(()=>{});
      if(projectCreated && projectId) await db.from("projects").delete().eq("id",projectId).eq("status","pending");
      toast("Upload failed: "+(e.message||"Unknown error"));
    } finally {b.disabled=false;b.textContent="Upload for review";}
  }
  async function manager() {
    if(!["owner","manager"].includes(profile?.role)){toast("Manager permission required.");return;}
    show("Manager workspace",'<p class="modal-note">Manage publishing permissions and moderate submitted projects. Only the owner can appoint managers.</p><div id="managerContent">Loading…</div>');
    try {
      const {data:users,error:ue}=await db.from("profiles").select("email,display_name,role,can_publish").order("created_at",{ascending:false}).limit(100);if(ue)throw ue;
      const {data:projects,error:pe}=await db.from("projects").select("id,name,category,summary").eq("status","pending").order("created_at").limit(50);if(pe)throw pe;
      const owner=profile.role==="owner";
      $("managerContent").innerHTML='<label class="field">Creator email<input id="permEmail" type="email" placeholder="creator@example.com"></label><div style="display:flex;gap:8px"><button class="btn btn-primary" id="grantBtn">Grant publishing</button><button class="btn" id="revokeBtn">Revoke</button></div>'+
        (owner?'<label class="field" style="margin-top:18px">Manager email<input id="managerEmail" type="email" placeholder="manager@example.com"></label><div style="display:flex;gap:8px"><button class="btn btn-primary" id="makeManager">Appoint manager</button><button class="btn" id="removeManager">Remove manager</button></div>':'')+
        '<h3 style="font-size:14px;margin-top:24px">Pending projects ('+projects.length+')</h3>'+(projects.length?projects.map(p=>'<div style="border:1px solid #34323f;border-radius:10px;padding:12px;margin:8px 0"><strong>'+esc(p.name)+'</strong><p class="modal-note">'+esc(p.category)+' · '+esc(p.summary)+'</p><button class="btn btn-primary" data-approve="'+p.id+'">Approve</button> <button class="btn" data-reject="'+p.id+'">Reject</button></div>').join(""):'<p class="modal-note">No pending submissions.</p>')+
        '<h3 style="font-size:14px;margin-top:24px">Accounts</h3>'+users.map(p=>'<p class="modal-note">'+esc(p.email)+' · '+esc(p.role)+(p.can_publish?" · can publish":"")+'</p>').join("");
      const permission=async(fn,email)=>{if(!email){toast("Enter an email.");return;}const {error}=await db.rpc(fn,{target_email:email});if(error)toast(error.message);else{toast("Permission updated.");manager();}};
      $("grantBtn").onclick=()=>permission("grant_publish_access",$("permEmail").value.trim());
      $("revokeBtn").onclick=()=>permission("revoke_publish_access",$("permEmail").value.trim());
      if(owner){$("makeManager").onclick=async()=>{const {error}=await db.rpc("set_manager_role",{target_email:$("managerEmail").value.trim(),make_manager:true});if(error)toast(error.message);else{toast("Manager appointed.");manager();}};$("removeManager").onclick=async()=>{const {error}=await db.rpc("set_manager_role",{target_email:$("managerEmail").value.trim(),make_manager:false});if(error)toast(error.message);else{toast("Manager role removed.");manager();}};}
      document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>moderate(b.dataset.approve,"approved"));
      document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>moderate(b.dataset.reject,"rejected"));
    } catch(e){$("managerContent").textContent="Could not load manager data: "+e.message;}
  }
  async function moderate(id,status){const {error}=await db.rpc("moderate_project",{target_project:id,next_status:status});if(error)toast(error.message);else{toast("Project "+status+".");manager();}}
  async function loadApprovedProjects(){
    if(!db || typeof projects==="undefined" || typeof render!=="function")return;
    const {data,error}=await db.from("projects").select("id,name,summary,category,downloads,owner_id,supported_versions").eq("status","approved").order("downloads",{ascending:false}).limit(100);
    if(error)return;
    const {data:owners}=data.length?await db.from("profiles").select("id,display_name").in("id",[...new Set(data.map(p=>p.owner_id))]):{data:[]};
    const names=new Map((owners||[]).map(p=>[p.id,p.display_name||"Community creator"]));
    for(const p of data){
      if(projects.some(item=>item.remoteId===p.id))continue;
      projects.push({id:"db-"+p.id,remoteId:p.id,name:esc(p.name),author:esc(names.get(p.owner_id)||"Community creator"),type:p.category,icon:"✦",color:"#bba7ff",bg:"linear-gradient(135deg,#30254e,#191a25)",desc:esc(p.summary),tags:(p.supported_versions||[]).slice(0,3).map(esc),downloads:Number(p.downloads)||0,stars:"—",verified:false});
    }
    render();
  }
  document.addEventListener("click",async event=>{
    const card=event.target.closest("[data-project]");if(!card)return;
    const p=projects.find(item=>item.id===card.dataset.project);if(!p?.remoteId)return;
    show(p.name,'<p class="modal-note">'+p.type+' · by '+p.author+'</p><p style="font-size:13px;line-height:1.8;color:#c0bdcb">'+p.desc+'</p><p class="modal-note">'+p.downloads+' downloads</p><div id="releaseDetails" class="modal-note">Loading latest approved release…</div><button class="btn btn-primary" id="downloadApproved" style="width:100%">Download latest release ↓</button>');
    const releaseBox=$("releaseDetails");
    const {data:latest}=await db.from("project_versions").select("version,game_versions,loaders,changelog,created_at").eq("project_id",p.remoteId).eq("status","approved").order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(releaseBox && latest){
      const compatible=[...(latest.game_versions||[]),...(latest.loaders||[])].map(esc);
      releaseBox.innerHTML='<strong style="color:#e5f6e9">Latest release '+esc(latest.version)+'</strong>'+(compatible.length?'<p>Compatibility: '+compatible.join(' · ')+'</p>':'')+(latest.changelog?'<p>Changelog: '+esc(latest.changelog).replace(/\n/g,'<br>')+'</p>':'');
    }else if(releaseBox){releaseBox.textContent="No approved release is available yet.";}
    $("downloadApproved").onclick=async()=>{
      const button=$("downloadApproved");button.disabled=true;button.textContent="Preparing download…";
      try{
        const {data:v,error:ve}=await db.from("project_versions").select("id,file_path,file_name").eq("project_id",p.remoteId).eq("status","approved").order("created_at",{ascending:false}).limit(1).maybeSingle();
        if(ve||!v){toast("No approved release is available yet.");return;}
        const {data:link,error:le}=await db.storage.from("project-files").createSignedUrl(v.file_path,60);
        if(le)throw le;
        const a=document.createElement("a");a.href=link.signedUrl;a.download=v.file_name;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
        const {error:countError}=await db.rpc("increment_downloads",{target_project:p.remoteId});
        if(!countError){p.downloads+=1;render();}
        close();
      }catch(e){toast("Download failed: "+(e.message||"Unknown error"));}
      finally{if($("downloadApproved")){$("downloadApproved").disabled=false;$("downloadApproved").textContent="Download latest release ↓";}}
    };
  });
  replaceClick("signinBtn",auth);replaceClick("publishBtn",publish);replaceClick("ctaPublish",publish);
  if(db){$("signinBtn")?.remove();db.auth.onAuthStateChange(()=>setTimeout(async()=>{await refresh();await loadApprovedProjects();},0));refresh().then(loadApprovedProjects);}
})();
