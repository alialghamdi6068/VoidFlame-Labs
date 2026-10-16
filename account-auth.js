(() => {
  const cfg=window.VOIDFLAME_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase)return;
  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const $=id=>document.getElementById(id);
  const toast=message=>{const el=$("toast");if(el){el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3000);}};
  const show=(title,html)=>{$("modalTitle").textContent=title;$("modalContent").innerHTML=html;$("modalBackdrop").classList.add("open");document.body.style.overflow="hidden";};
  const close=()=>{$("modalBackdrop").classList.remove("open");document.body.style.overflow="";};
  function openAccount(){
    show("Sign in or create an account",'<p class="modal-note">Create an account with email and password, or continue with Google/GitHub. First-time provider sign-in creates a new account automatically.</p><label class="field">Email<input id="accountEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><label class="field">Password<input id="accountPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label><div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn btn-primary" id="accountLogin" style="flex:1">Sign in</button><button class="btn" id="accountSignup" style="flex:1">Create account</button></div><button class="btn" id="accountGoogle" style="width:100%;margin-bottom:10px">Continue with Google</button><button class="btn" id="accountGithub" style="width:100%">Continue with GitHub</button>');
    $("accountSignup").onclick=async()=>{
      const email=$("accountEmail").value.trim(),password=$("accountPassword").value;
      if(!email||password.length<8){toast("Enter a valid email and a password of at least 8 characters.");return;}
      const {data,error}=await db.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
      if(error){toast(error.message);return;}
      if(data.session){close();toast("Account created. You are signed in.");}
      else toast("Account created. Check your email to confirm it, then sign in.");
    };
    $("accountLogin").onclick=async()=>{
      const email=$("accountEmail").value.trim(),password=$("accountPassword").value;
      if(!email||!password){toast("Enter your email and password.");return;}
      const {error}=await db.auth.signInWithPassword({email,password});
      if(error){toast(error.message);return;}
      close();toast("Signed in.");
    };
    [["accountGoogle","google"],["accountGithub","github"]].forEach(([id,provider])=>$(id).onclick=async()=>{
      const {error}=await db.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+location.pathname}});
      if(error)toast(error.message);
    });
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest("#signinBtn,#realSignIn");
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();openAccount();
  },true);
})();
