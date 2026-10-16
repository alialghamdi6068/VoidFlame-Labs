(() => {
  const cfg = window.VOIDFLAME_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return;
  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let currentUser = null, currentProfile = null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = message => { const el=$("toast"); if(el){el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3000);} };
  const show = (title,html) => { $("modalTitle").textContent=title; $("modalContent").innerHTML=html; $("modalBackdrop").classList.add("open"); document.body.style.overflow="hidden"; };
  const close = () => { $("modalBackdrop").classList.remove("open"); document.body.style.overflow=""; };
  async function loadIdentity() {
    const {data:{user}} = await db.auth.getUser();
    currentUser = user || null; currentProfile = null;
    if (currentUser) {
      const {data} = await db.from("profiles").select("id,email,role,can_publish").eq("id",currentUser.id).maybeSingle();
      currentProfile = data || null;
    }
    renderTools();
  }
  function renderTools() {
    const nav=document.querySelector(".navright");
    if(!nav || !currentUser || !currentProfile) return;
    let host=$("specialistTools");
    if(!host){host=document.createElement("div");host.id="specialistTools";host.style.cssText="display:flex;gap:8px;align-items:center;flex-wrap:wrap";nav.appendChild(host);}
    host.innerHTML="";
    const role=currentProfile.role;
    if(["owner","manager"].includes(role)){
      const b=document.createElement("button");b.className="btn";b.textContent="Staff & Roles";b.onclick=roleManager;host.appendChild(b);
    }
    if(["owner","manager","security_reviewer"].includes(role)){
      const b=document.createElement("button");b.className="btn";b.textContent="Security Queue";b.onclick=securityQueue;host.appendChild(b);
    }
    if(["owner","manager","content_moderator"].includes(role)){
      const b=document.createElement("button");b.className="btn";b.textContent="Content Queue";b.onclick=contentQueue;host.appendChild(b);
    }
  }
  async function roleManager(){
    if(!["owner","manager"].includes(currentProfile?.role)) return toast("Manager permission required.");
    show("Staff & Roles",'<p class="modal-note">Users create accounts by signing in with Google or GitHub. Enter their exact account email after their first sign-in to assign a role.</p><label class="field">Account email<input id="roleEmail" type="email" placeholder="creator@example.com"></label><label class="field">Role<select id="roleValue"><option value="developer">Developer / Publisher</option><option value="security_reviewer">Security Reviewer</option><option value="content_moderator">Content Moderator</option><option value="member">Member</option><option value="suspended">Suspended</option></select></label><button class="btn btn-primary" id="saveRole" style="width:100%">Save role</button><p class="modal-note">Only the owner can appoint or remove managers. Manager role controls remain in the Manager workspace.</p><div id="roleResult"></div>');
    $("saveRole").onclick=async()=>{
      const email=$("roleEmail").value.trim(),role=$("roleValue").value;
      if(!email){toast("Enter the user's email.");return;}
      const {error}=await db.rpc("set_staff_role",{target_email:email,target_role:role});
      if(error){$("roleResult").textContent=error.message;return;}
      toast("Role updated.");await loadIdentity();roleManager();
    };
  }
  async function securityQueue(){
    if(!["owner","manager","security_reviewer"].includes(currentProfile?.role)) return toast("Security reviewer permission required.");
    show("Security Review Queue",'<p class="modal-note">Inspect files in an isolated analysis environment. This queue records a human verdict; it does not run antivirus scans itself. Never execute an untrusted plugin on your main computer.</p><div id="securityItems">Loading…</div>');
    try{
      const {data:versions,error}=await db.from("project_versions").select("id,project_id,version,file_path,file_name,file_size,security_status,created_at").eq("security_status","pending_scan").order("created_at").limit(50);
      if(error)throw error;
      const ids=[...new Set((versions||[]).map(v=>v.project_id))];
      const {data:projects,error:pe}=ids.length?await db.from("projects").select("id,name,category").in("id",ids):{data:[],error:null};
      if(pe)throw pe;
      const lookup=new Map((projects||[]).map(p=>[p.id,p]));
      $("securityItems").innerHTML=(versions||[]).map(v=>{const p=lookup.get(v.project_id)||{};return '<section style="border:1px solid #34323f;border-radius:10px;padding:12px;margin:10px 0"><strong>'+esc(p.name||"Project")+'</strong><p class="modal-note">'+esc(v.file_name)+' · '+Math.ceil(v.file_size/1024)+' KB · '+esc(v.version)+'</p><p class="modal-note">File path: '+esc(v.file_path)+'</p><label class="field">Evidence / review notes<textarea id="review-'+v.id+'" placeholder="Record analysis performed and findings"></textarea></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" data-verdict="clean" data-id="'+v.id+'">Mark clean</button><button class="btn" data-verdict="flagged" data-id="'+v.id+'">Flag suspicious</button><button class="btn" data-verdict="rejected" data-id="'+v.id+'">Reject</button></div></section>';}).join("")||'<p class="modal-note">No files are waiting for security review.</p>';
      document.querySelectorAll("[data-verdict]").forEach(b=>b.onclick=async()=>{
        const id=b.dataset.id,status=b.dataset.verdict,notes=$("review-"+b.dataset.id).value.trim();
        if(status!=="clean"&&!notes)return toast("Add notes explaining this verdict.");
        const {error}=await db.rpc("security_review_version",{target_version:id,next_security_status:status,review_notes:notes});
        if(error)return toast(error.message);
        toast("Security verdict recorded.");securityQueue();
      });
    }catch(e){$("securityItems").textContent="Could not load queue: "+e.message;}
  }
  async function contentQueue(){
    if(!["owner","manager","content_moderator"].includes(currentProfile?.role)) return toast("Content moderator permission required.");
    show("Content Review Queue",'<p class="modal-note">A project is approvable only after every release is marked clean by the security review process.</p><div id="contentItems">Loading…</div>');
    try{
      const {data:projects,error}=await db.from("projects").select("id,name,summary,category,created_at").eq("status","pending").order("created_at").limit(50);
      if(error)throw error;
      const blocks=[];
      for(const p of projects||[]){
        const {data:versions,error:ve}=await db.from("project_versions").select("version,file_name,security_status").eq("project_id",p.id);
        if(ve)throw ve;
        const clean=versions.length>0&&versions.every(v=>v.security_status==="clean");
        blocks.push('<section style="border:1px solid #34323f;border-radius:10px;padding:12px;margin:10px 0"><strong>'+esc(p.name)+'</strong><p class="modal-note">'+esc(p.category)+' · '+esc(p.summary)+'</p><p class="modal-note">Releases: '+(versions.map(v=>esc(v.version)+': '+esc(v.security_status)).join(" · ")||"No release")+'</p><button class="btn btn-primary" data-content="approved" data-id="'+p.id+'" '+(clean?"":"disabled")+'>Approve</button> <button class="btn" data-content="rejected" data-id="'+p.id+'">Reject</button></section>');
      }
      $("contentItems").innerHTML=blocks.join("")||'<p class="modal-note">No projects are waiting for content review.</p>';
      document.querySelectorAll("[data-content]").forEach(b=>b.onclick=async()=>{
        const {error}=await db.rpc("moderate_project",{target_project:b.dataset.id,next_status:b.dataset.content});
        if(error)return toast(error.message);
        toast("Project "+b.dataset.content+".");contentQueue();
      });
    }catch(e){$("contentItems").textContent="Could not load queue: "+e.message;}
  }
  db.auth.onAuthStateChange(()=>setTimeout(loadIdentity,0));
  loadIdentity();
})();
