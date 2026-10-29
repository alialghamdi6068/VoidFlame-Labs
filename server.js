'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data-local'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const QUARANTINE_DIR = path.join(UPLOAD_DIR, 'quarantine');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 25 * 1024 * 1024;
const MAX_UPLOAD = 100 * 1024 * 1024;
const IS_PROD = process.env.NODE_ENV === 'production';
const DB_FILE = path.join(DATA_DIR, 'store.json');
const STATIC_EXTS = new Set(['.html','.css','.js','.json','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.txt']);

function id() { return crypto.randomUUID(); }
function tokenHash(token) { const secret=process.env.SESSION_SECRET || (!IS_PROD ? 'local-development-only-change-before-production' : ''); if(!secret)throw new Error('SESSION_SECRET is required'); return crypto.createHmac('sha256', secret).update(String(token || '')).digest('hex'); }
function json(res, status, data, headers) {
  const body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'strict-origin-when-cross-origin',
    'content-security-policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.github.com https://github.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com; upgrade-insecure-requests",'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin',
    'permissions-policy':'camera=(), microphone=(), geolocation=()'
  }, headers || {}));
  res.end(body);
}
function fail(res, status, message) { return json(res, status, {error:message}); }
function parseCookies(req) {
  const result=Object.create(null);
  for(const part of String(req.headers.cookie || '').split(';')) {
    const i=part.indexOf('='); if(i<1)continue;
    const key=part.slice(0,i).trim(); if(!/^[A-Za-z0-9_-]{1,80}$/.test(key))continue;
    try { result[key]=decodeURIComponent(part.slice(i+1).trim()); } catch { continue; }
  }
  return result;
}
function safeEqual(a,b) {
  const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70);
}
function text(v,max) { return String(v == null ? '' : v).trim().slice(0,max); }
function arrayStrings(v,maxItems,maxLen) {
  return Array.isArray(v) ? v.filter(function(x){return typeof x==='string';}).slice(0,maxItems).map(function(x){return text(x,maxLen);}) : [];
}
function emptyStore() {
  return {schemaVersion:1,users:[],sessions:[],projects:[],versions:[],comments:[],reports:[],audit:[],analytics:[],rateLimits:[],uploads:[],media:[]};
}
let store=emptyStore();
let writeQueue=Promise.resolve();
let activeUploads=0;
const MAX_CONCURRENT_UPLOADS=3;
const BACKUP_DIR=path.join(DATA_DIR,'backups');
const BACKUP_KEEP=10;
async function persist() {
  const snapshot=JSON.stringify(store,null,2);
  writeQueue=writeQueue.then(async function(){
    const tmp=DB_FILE+'.tmp-'+process.pid+'-'+crypto.randomBytes(4).toString('hex');
    await fs.writeFile(tmp,snapshot,{mode:0o600});
    await fs.rename(tmp,DB_FILE);
  });
  return writeQueue;
}
async function createBackup() {
  await fs.mkdir(BACKUP_DIR,{recursive:true,mode:0o700});
  try { await fs.access(DB_FILE); } catch { return; }
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const destination=path.join(BACKUP_DIR,'store-'+stamp+'.json');
  await fs.copyFile(DB_FILE,destination);
  await fs.chmod(destination,0o600);
  const files=(await fs.readdir(BACKUP_DIR)).filter(function(name){return /^store-.*\.json$/.test(name);}).sort().reverse();
  for(const old of files.slice(BACKUP_KEEP))await fs.unlink(path.join(BACKUP_DIR,old)).catch(function(){});
}
async function initStore() {
  await fs.mkdir(DATA_DIR,{recursive:true,mode:0o700});
  await fs.mkdir(QUARANTINE_DIR,{recursive:true,mode:0o700});
  try {
    const parsed=JSON.parse(await fs.readFile(DB_FILE,'utf8'));
    store=Object.assign(emptyStore(),parsed);
    for(const k of Object.keys(emptyStore())) if(!Array.isArray(store[k]) && k!=='schemaVersion') store[k]=[];
  } catch(e) {
    if(e.code!=='ENOENT') {
      const backup=DB_FILE+'.corrupt-'+Date.now();
      await fs.rename(DB_FILE,backup).catch(function(){});
      console.error('Store was invalid JSON; preserved damaged file at',backup);
    }
    store=emptyStore(); await persist();
  }
}
function saveAudit(actor,action,type,target,details) {
  store.audit.unshift({id:id(),actor_id:actor||null,action:action,target_type:type,target_id:target||null,details:details||{},created_at:new Date().toISOString()});
  if(store.audit.length>10000) store.audit.length=10000;
}
function userPublic(u) {
  if(!u)return null;
  return {id:u.id,github_id:u.github_id,username:u.username,display_name:u.display_name,avatar_url:u.avatar_url,bio:u.bio||'',role:u.role,created_at:u.created_at};
}
function currentUser(req) {
  const token=parseCookies(req).ali_session;
  if(!token)return null;
  const row=store.sessions.find(function(s){return safeEqual(s.token_hash,tokenHash(token)) && Date.parse(s.expires_at)>Date.now();});
  if(!row)return null;
  return store.users.find(function(u){return u.id===row.user_id;})||null;
}
function sessionCookie(token) {
  return 'ali_session='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+Math.floor(SESSION_TTL/1000)+(IS_PROD?'; Secure':'');
}
function clearSessionCookie(){return 'ali_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+(IS_PROD?'; Secure':'');}
async function body(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>MAX_BODY)throw Object.assign(new Error('Request body too large'),{status:413}); chunks.push(chunk); }
  if(!chunks.length)return {};
  const raw=Buffer.concat(chunks);
  if(!(req.headers['content-type']||'').toLowerCase().includes('application/json'))throw Object.assign(new Error('Content-Type must be application/json'),{status:415});
  let parsed; try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON body'),{status:400});}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(new Error('JSON body must be an object'),{status:400});
  return parsed;
}
function isSameOrigin(req) {
  if(['GET','HEAD','OPTIONS'].includes(req.method))return true;
  const origin=req.headers.origin;
  if(!origin)return !parseCookies(req).ali_session;
  try {
    const parsed=new URL(origin);
    const expected=process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : ((IS_PROD?'https':'http')+'://'+String(req.headers.host||''));
    return parsed.origin===expected && parsed.username==='' && parsed.password==='';
  } catch { return false; }
}
const hits=new Map();
function rateLimit(key,limit,windowMs) {
  const now=Date.now(); let old=hits.get(key);
  if(!old||now-old.start>=windowMs){
    if(hits.size>=20000){for(const [k,v] of hits)if(now-v.start>windowMs)hits.delete(k);if(hits.size>=20000)return false;}
    hits.set(key,{start:now,count:1});return true;
  }
  old.count++; return old.count<=limit;
}
function requireUser(req,res) {
  const u=currentUser(req);
  if(!u)fail(res,401,'Sign in required');
  return u;
}
function staff(u) { return u && ['admin','moderator'].includes(u.role); }
function auditAllowed(u,res) { if(!u){fail(res,401,'Sign in required');return false;} if(!staff(u)){fail(res,403,'Forbidden');return false;} return true; }
function approvedProject(p) { return p && p.status==='approved'; }
function publicProject(p) {
  const owner=store.users.find(function(u){return u.id===p.owner_id;});
  return {id:p.id,name:p.name,slug:p.slug,summary:p.summary||'',description:p.description||'',category:p.category||'Other',requirements:p.requirements||'',source_url:p.source_url||'',icon_url:p.icon_url||'',status:p.status,downloads:Number(p.downloads)||0,created_at:p.created_at,updated_at:p.updated_at,author:owner?owner.username:'unknown',favorites_count:Array.isArray(p.favorites)?p.favorites.length:0,followers_count:Array.isArray(p.followers)?p.followers.length:0};
}
function publicVersion(v) {
  return {id:v.id,version_number:v.version_number,changelog:v.changelog||'',game_versions:Array.isArray(v.game_versions)?v.game_versions:[],loaders:Array.isArray(v.loaders)?v.loaders:[],dependencies:Array.isArray(v.dependencies)?v.dependencies:[],channel:v.channel||'release',file_name:v.file_name||null,file_size:Number(v.file_size)||0,release_url:v.release_url||null,downloads:Number(v.downloads)||0,created_at:v.created_at};
}
function developerProject(p) {
  const versions=store.versions.filter(function(v){return v.project_id===p.id;});
  const tracked=versions.reduce(function(sum,v){return sum+(Number(v.downloads)||0);},0);
  return Object.assign({},p,{owner_id:undefined,favorites:undefined,followers:undefined,version_count:versions.length,view_count:store.analytics.filter(function(a){return a.project_id===p.id&&a.event_type==='view';}).length,tracked_downloads:tracked});
}
function fileNameSafe(name) { return path.basename(String(name||'download.bin')).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120)||'download.bin'; }
function signatureOK(buf,ext) {
  if(['jar','zip','mrpack'].includes(ext))return buf.length>=4 && buf[0]===0x50 && buf[1]===0x4b && [0x03,0x05,0x07].includes(buf[2]);
  if(ext==='7z')return buf.subarray(0,6).equals(Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c]));
  if(ext==='png')return buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(ext==='jpg'||ext==='jpeg')return buf[0]===255&&buf[1]===216&&buf[2]===255;
  if(ext==='webp')return buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP';
  if(ext==='mp4')return buf.length>=8&&buf.toString('ascii',4,8)==='ftyp';
  if(ext==='webm')return buf.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  return false;
}
async function upload(req,res,user,project,kind) {
  const type=req.headers['content-type']||'';
  if(!type.startsWith('multipart/form-data;'))return fail(res,400,'Expected multipart/form-data');
  const parsed=await bodyRaw(req,MAX_UPLOAD+1024*1024);
  const boundary=(type.match(/boundary=(?:"([^"]+)"|([^;]+))/)||[]).slice(1).find(Boolean);
  if(!boundary)return fail(res,400,'Missing multipart boundary');
  const parts=parseMultipart(parsed, boundary);
  const part=parts.find(function(p){return p.name==='file';});
  if(!part||!part.filename)return fail(res,400,'Select a file');
  if(part.data.length>MAX_UPLOAD)return fail(res,413,'File exceeds 100 MB limit');
  const ext=path.extname(part.filename).slice(1).toLowerCase();
  const allowed=kind==='release'?['jar','zip','mrpack','7z']:['png','jpg','jpeg','webp','mp4','webm'];
  if(!allowed.includes(ext)||!signatureOK(part.data.subarray(0,16),ext))return fail(res,400,'File type or file signature is not allowed');
  const key=id()+'-'+fileNameSafe(part.filename);
  if(kind==='media'){
    await fs.writeFile(path.join(UPLOAD_DIR,key),part.data,{flag:'wx',mode:0o600});
    const media={id:id(),key:key,project_id:project.id,owner_id:user.id,file_name:fileNameSafe(part.filename),file_size:part.data.length,content_type:ext==='png'?'image/png':(ext==='webp'?'image/webp':(ext==='mp4'?'video/mp4':(ext==='webm'?'video/webm':'image/jpeg'))),alt:text((parts.find(function(p){return p.name==='alt';})||{}).data?.toString('utf8'),250),created_at:new Date().toISOString()};
    store.media.push(media); saveAudit(user.id,'media.uploaded','media',media.id,{file_size:media.file_size}); await persist();
    return json(res,201,{ok:true,id:media.id,url:'/api/media/'+media.id});
  }
  await fs.writeFile(path.join(QUARANTINE_DIR,key),part.data,{flag:'wx',mode:0o600});
  const pending={key:key,project_id:project.id,owner_id:user.id,file_name:fileNameSafe(part.filename),file_size:part.data.length,created_at:new Date().toISOString(),scan_status:'quarantined'};
  store.uploads.push(pending); saveAudit(user.id,'upload.quarantined','upload',key,{file_size:pending.file_size});
  await persist(); return json(res,201,{ok:true,file_key:key,file_name:pending.file_name,file_size:pending.file_size,status:'pending',message:'Uploaded to quarantine; release requires review.'});
}
async function bodyRaw(req,limit) {
  const chunks=[];let size=0;
  for await(const c of req){size+=c.length;if(size>limit)throw Object.assign(new Error('Request body too large'),{status:413});chunks.push(c);}
  return Buffer.concat(chunks);
}
function parseMultipart(buf,boundary) {
  const raw=buf.toString('latin1');const marker='--'+boundary;const result=[];
  for(const segment of raw.split(marker).slice(1)){
    if(segment.startsWith('--'))continue;
    const cut=segment.indexOf('\r\n\r\n');if(cut<0)continue;
    const headers=segment.slice(0,cut);let payload=segment.slice(cut+4);
    if(payload.endsWith('\r\n'))payload=payload.slice(0,-2);
    const disp=headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i);if(!disp)continue;
    const name=(disp[1].match(/name="([^"]*)"/)||[])[1]||'';
    const filename=(disp[1].match(/filename="([^"]*)"/)||[])[1]||'';
    result.push({name,filename,data:Buffer.from(payload,'latin1')});
  }
  return result;
}
async function handle(req,res) {
  let u; let pathname;
  try { u=new URL(req.url,'http://localhost'); pathname=decodeURIComponent(u.pathname); } catch { return fail(res,400,'Invalid URL'); }
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'Content-Type'});return res.end();}
  if(pathname.startsWith('/api/')&&!isSameOrigin(req))return fail(res,403,'Cross-origin request rejected');
  const ip=req.socket.remoteAddress||'unknown';
  if(pathname.startsWith('/api/')&&!rateLimit(ip+':'+pathname,pathname.includes('upload')?8:120,60000))return fail(res,429,'Rate limit exceeded');
  if(pathname==='/api/health'&&req.method==='GET')return json(res,200,{status:'ok',storage:'local-files',schemaVersion:store.schemaVersion});
  if(pathname==='/api/auth/github'&&req.method==='GET'){
    if(!process.env.GITHUB_CLIENT_ID)return fail(res,503,'GitHub sign-in is not configured');
    if(IS_PROD&&!process.env.PUBLIC_BASE_URL)return fail(res,503,'PUBLIC_BASE_URL must be configured for production OAuth');
    let publicBase; try{publicBase=new URL(process.env.PUBLIC_BASE_URL||((IS_PROD?'https':'http')+'://'+String(req.headers.host||'')));if(!['http:','https:'].includes(publicBase.protocol)||publicBase.username||publicBase.password||publicBase.pathname!=='/'||publicBase.search||publicBase.hash||(IS_PROD&&publicBase.protocol!=='https:'))throw new Error('Invalid public base URL');}catch{return fail(res,503,'Invalid PUBLIC_BASE_URL configuration');}
    const state=crypto.randomBytes(24).toString('hex');
    res.writeHead(302,{location:'https://github.com/login/oauth/authorize?client_id='+encodeURIComponent(process.env.GITHUB_CLIENT_ID)+'&redirect_uri='+encodeURIComponent(publicBase.origin+'/api/auth/callback')+'&scope=read%3Auser&state='+state,'set-cookie':'ali_oauth_state='+state+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=600'+(IS_PROD?'; Secure':'')});return res.end();
  }
  if(pathname==='/api/auth/callback'&&req.method==='GET'){
    const q=u.searchParams;const stateCookie=parseCookies(req).ali_oauth_state;
    if(!stateCookie||!safeEqual(stateCookie,q.get('state')||''))return fail(res,400,'OAuth state validation failed');
    if(q.has('error')||!q.get('code'))return fail(res,400,'GitHub authorization was cancelled');
    if(!process.env.GITHUB_CLIENT_ID||!process.env.GITHUB_CLIENT_SECRET||!process.env.SESSION_SECRET)return fail(res,503,'GitHub OAuth and session security are not configured');
    const tokenRes=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:process.env.GITHUB_CLIENT_ID,client_secret:process.env.GITHUB_CLIENT_SECRET,code:q.get('code')}),signal:AbortSignal.timeout(8000)});
    const tokenData=await tokenRes.json();if(!tokenRes.ok||!tokenData.access_token)return fail(res,502,'GitHub sign-in failed');
    const ghRes=await fetch('https://api.github.com/user',{headers:{authorization:'Bearer '+tokenData.access_token,accept:'application/vnd.github+json','user-agent':'Ali-Labs'},signal:AbortSignal.timeout(8000)});
    const gh=await ghRes.json();if(!ghRes.ok||!gh.id||!gh.login)return fail(res,502,'Could not read GitHub account');
    let user=store.users.find(function(x){return String(x.github_id)===String(gh.id);});
    if(!user){const bootstrapId=String(process.env.ADMIN_GITHUB_ID||'');user={id:id(),github_id:String(gh.id),username:text(gh.login,39),display_name:text(gh.name||gh.login,80),avatar_url:text(gh.avatar_url,500),bio:'',role:bootstrapId && bootstrapId===String(gh.id)?'admin':'user',created_at:new Date().toISOString()};store.users.push(user);}
    else {user.username=text(gh.login,39);user.display_name=text(gh.name||gh.login,80);user.avatar_url=text(gh.avatar_url,500);}
    const token=crypto.randomBytes(32).toString('base64url');
    store.sessions=store.sessions.filter(function(s){return s.user_id!==user.id||Date.parse(s.expires_at)>Date.now();});
    store.sessions.push({id:id(),user_id:user.id,token_hash:tokenHash(token),created_at:new Date().toISOString(),expires_at:new Date(Date.now()+SESSION_TTL).toISOString(),user_agent:text(req.headers['user-agent'],250),ip_hash:crypto.createHash('sha256').update(ip).digest('hex')});
    saveAudit(user.id,'auth.login','user',user.id,{});await persist();
    res.writeHead(302,{location:'/', 'set-cookie':[sessionCookie(token),'ali_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+(IS_PROD?'; Secure':'')]});return res.end();
  }
  if(pathname==='/api/auth/logout'&&req.method==='POST'){
    const user=currentUser(req);const token=parseCookies(req).ali_session;
    store.sessions=store.sessions.filter(function(s){return s.token_hash!==tokenHash(token||'');});
    if(user)saveAudit(user.id,'auth.logout','user',user.id,{});await persist();
    res.writeHead(200,{'set-cookie':clearSessionCookie()});return json(res,200,{ok:true});
  }
  if(pathname==='/api/me'&&req.method==='GET'){const user=currentUser(req);return json(res,200,{user:userPublic(user)});}
  if(pathname==='/api/me/sessions'&&req.method==='GET'){
    const user=requireUser(req,res);if(!user)return;
    const active=store.sessions.filter(function(s){return s.user_id===user.id&&Date.parse(s.expires_at)>Date.now();}).map(function(s){return {id:s.id,created_at:s.created_at,expires_at:s.expires_at,user_agent:s.user_agent,current:s.token_hash===tokenHash(parseCookies(req).ali_session||'')};});
    return json(res,200,{sessions:active});
  }
  if(pathname==='/api/me/sessions'&&req.method==='DELETE'){
    const user=requireUser(req,res);if(!user)return;const hash=tokenHash(parseCookies(req).ali_session||'');
    store.sessions=store.sessions.filter(function(s){return s.user_id!==user.id||s.token_hash===hash;});await persist();return json(res,200,{ok:true});
  }
  if(pathname==='/api/me/export'&&req.method==='GET'){
    const user=requireUser(req,res);if(!user)return;
    return json(res,200,{user:userPublic(user),projects:store.projects.filter(function(p){return p.owner_id===user.id;}),versions:store.versions.filter(function(v){return store.projects.some(function(p){return p.id===v.project_id&&p.owner_id===user.id;});}),comments:store.comments.filter(function(c){return c.user_id===user.id;}),reports:store.reports.filter(function(r){return r.reporter_id===user.id;}),sessions:store.sessions.filter(function(s){return s.user_id===user.id;}).map(function(s){return {created_at:s.created_at,expires_at:s.expires_at};})});
  }
  if(pathname==='/api/me/profile'&&req.method==='PATCH'){
    const user=requireUser(req,res);if(!user)return;const b=await body(req);user.display_name=text(b.display_name||user.display_name,80);user.bio=text(b.bio,500);await persist();return json(res,200,{user:userPublic(user)});
  }
  if(pathname==='/api/projects'&&req.method==='GET'){
    const q=text(u.searchParams.get('q'),100).toLowerCase();const category=text(u.searchParams.get('category'),40);const gameVersion=text(u.searchParams.get('gameVersion')||u.searchParams.get('game_version'),40).toLowerCase();const loader=text(u.searchParams.get('loader'),40).toLowerCase();
    const requestedSort=text(u.searchParams.get('sort'),20);const sort=['updated','downloads','name','popular'].includes(requestedSort)?requestedSort:'updated';
    const parsedPage=Number.parseInt(u.searchParams.get('page')||'1',10);const page=Number.isFinite(parsedPage)?Math.min(100000,Math.max(1,parsedPage)):1;
    const parsedLimit=Number.parseInt(u.searchParams.get('limit')||'48',10);const limit=Number.isFinite(parsedLimit)?Math.min(100,Math.max(1,parsedLimit)):48;
    let filtered=store.projects.filter(function(p){
      if(!approvedProject(p)|| (category&&p.category!==category))return false;
      if(q&&!(p.name+' '+(p.summary||'')+' '+(p.description||'')+' '+p.category+' '+(p.requirements||'')).toLowerCase().includes(q))return false;
      if(gameVersion||loader){return store.versions.some(function(v){return v.project_id===p.id&&v.status==='approved'&&(!gameVersion||(v.game_versions||[]).some(function(x){return String(x).toLowerCase()===gameVersion;}))&&(!loader||(v.loaders||[]).some(function(x){return String(x).toLowerCase()===loader;}));});}
      return true;
    });
    filtered.sort(function(a,b){if(sort==='name')return String(a.name).localeCompare(String(b.name));if(sort==='downloads')return (Number(b.downloads)||0)-(Number(a.downloads)||0);if(sort==='popular')return (((b.favorites||[]).length+(b.followers||[]).length)-((a.favorites||[]).length+(a.followers||[]).length));return (Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0);});
    const total=filtered.length;const projects=filtered.slice((page-1)*limit,page*limit).map(publicProject);
    return json(res,200,{projects,pagination:{page,limit,total,pages:Math.ceil(total/limit),has_more:page*limit<total},sort});
  }
  let m=pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
  if(m&&req.method==='GET'){const p=store.projects.find(function(x){return x.slug===m[1]||x.id===m[1];});if(!approvedProject(p))return fail(res,404,'Project not found');return json(res,200,{project:publicProject(p),versions:store.versions.filter(function(v){return v.project_id===p.id&&v.status==='approved';}).map(publicVersion)});}
  m=pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/(favorite|follow|comments|report|versions)$/);
  if(m){
    const p=store.projects.find(function(x){return x.slug===m[1]||x.id===m[1];});if(!approvedProject(p))return fail(res,404,'Project not found');
    const user=currentUser(req);const action=m[2];
    if(action==='versions'&&req.method==='GET')return json(res,200,{versions:store.versions.filter(function(v){return v.project_id===p.id&&v.status==='approved';}).map(publicVersion)});
    if(action==='comments'&&req.method==='GET')return json(res,200,{comments:store.comments.filter(function(c){return c.project_id===p.id&&c.status==='visible';}).map(function(c){const owner=store.users.find(function(x){return x.id===c.user_id;});return {id:c.id,body:c.body,created_at:c.created_at,username:owner&&owner.username||'unknown'};})});
    if(!user)return fail(res,401,'Sign in required');
    if(action==='favorite'&&req.method==='POST'){p.favorites=p.favorites||[];const i=p.favorites.indexOf(user.id);if(i<0)p.favorites.push(user.id);else p.favorites.splice(i,1);await persist();return json(res,200,{favorited:p.favorites.includes(user.id)});}
    if(action==='follow'&&req.method==='POST'){p.followers=p.followers||[];const i=p.followers.indexOf(user.id);if(i<0)p.followers.push(user.id);else p.followers.splice(i,1);await persist();return json(res,200,{following:p.followers.includes(user.id)});}
    if(action==='comments'&&req.method==='POST'){const b=await body(req);const c={id:id(),project_id:p.id,user_id:user.id,body:text(b.body,3000),status:'visible',created_at:new Date().toISOString()};if(!c.body)return fail(res,400,'Comment cannot be empty');store.comments.push(c);await persist();return json(res,201,{comment:c});}
    if(action==='report'&&req.method==='POST'){const b=await body(req);const reason=text(b.reason,100);if(reason.length<3)return fail(res,400,'Report reason must contain at least 3 characters');const r={id:id(),project_id:p.id,reporter_id:user.id,reason,details:text(b.details,2000),status:'pending',created_at:new Date().toISOString()};store.reports.push(r);await persist();return json(res,201,{ok:true});}
  }
  if(pathname==='/api/me/favorites'&&req.method==='GET'){const user=requireUser(req,res);if(!user)return;return json(res,200,{projects:store.projects.filter(function(p){return (p.favorites||[]).includes(user.id)&&approvedProject(p);}).map(publicProject)});}
  if(pathname==='/api/me/follows'&&req.method==='GET'){const user=requireUser(req,res);if(!user)return;return json(res,200,{projects:store.projects.filter(function(p){return (p.followers||[]).includes(user.id)&&approvedProject(p);}).map(publicProject)});}
  if(pathname==='/api/developer/projects'&&req.method==='GET'){const user=requireUser(req,res);if(!user)return;return json(res,200,{projects:store.projects.filter(function(p){return p.owner_id===user.id;}).map(developerProject)});}
  if(pathname==='/api/developer/projects'&&req.method==='POST'){
    const user=requireUser(req,res);if(!user)return;const b=await body(req);const name=text(b.name,100);if(name.length<2)return fail(res,400,'Project name must be at least 2 characters');
    const source=text(b.source_url,1000);if(source){try{const su=new URL(source);if(su.protocol!=='https:'||su.hostname!=='github.com')return fail(res,400,'Source URL must point to GitHub over HTTPS');}catch{return fail(res,400,'Invalid source URL');}}const slug=slugify(name)+'-'+crypto.randomBytes(3).toString('hex');const p={id:id(),owner_id:user.id,name,slug,summary:text(b.summary,240),description:text(b.description,10000),category:['Mods','Plugins','Modpacks','Shaders','Resource Packs','Tools','Other'].includes(b.category)?b.category:'Other',requirements:text(b.requirements,5000),source_url:source,icon_url:'',status:'pending',downloads:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),favorites:[],followers:[]};store.projects.push(p);saveAudit(user.id,'project.created','project',p.id,{});await persist();return json(res,201,{project:p,slug:p.slug});
  }
  m=pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)$/);
  if(m&&req.method==='PATCH'){const user=requireUser(req,res);if(!user)return;const p=store.projects.find(function(x){return x.slug===m[1]||x.id===m[1];});if(!p)return fail(res,404,'Project not found');if(p.owner_id!==user.id&&user.role!=='admin')return fail(res,403,'Forbidden');const b=await body(req);for(const k of ['name','summary','description','icon_url','requirements'])if(b[k]!==undefined)p[k]=text(b[k],k==='description'?10000:(k==='requirements'?5000:500));if(b.source_url!==undefined){const source=text(b.source_url,1000);if(source){try{const su=new URL(source);if(su.protocol!=='https:'||su.hostname!=='github.com')return fail(res,400,'Source URL must point to GitHub over HTTPS');}catch{return fail(res,400,'Invalid source URL');}}p.source_url=source;}if(b.category)p.category=['Mods','Plugins','Modpacks','Shaders','Resource Packs','Tools','Other'].includes(b.category)?b.category:p.category;p.updated_at=new Date().toISOString();if(p.status==='approved')p.status='pending';saveAudit(user.id,'project.updated','project',p.id,{status:p.status});await persist();return json(res,200,{project:developerProject(p),slug:p.slug});}
  m=pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)\/upload$/);
  if(m&&req.method==='POST'){const user=requireUser(req,res);if(!user)return;const p=store.projects.find(function(x){return (x.slug===m[1]||x.id===m[1])&&x.owner_id===user.id;});if(!p)return fail(res,404,'Project not found');if(activeUploads>=MAX_CONCURRENT_UPLOADS)return fail(res,429,'Upload capacity is busy; retry shortly');activeUploads++;return upload(req,res,user,p,'release').finally(function(){activeUploads--;});}
  m=pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)\/media$/);
  if(m&&req.method==='POST'){const user=requireUser(req,res);if(!user)return;const p=store.projects.find(function(x){return (x.slug===m[1]||x.id===m[1])&&x.owner_id===user.id;});if(!p)return fail(res,404,'Project not found');if(activeUploads>=MAX_CONCURRENT_UPLOADS)return fail(res,429,'Upload capacity is busy; retry shortly');activeUploads++;return upload(req,res,user,p,'media').finally(function(){activeUploads--;});}
  m=pathname.match(/^\/api\/developer\/projects\/([a-zA-Z0-9_-]+)\/versions$/);
  if(m&&req.method==='POST'){const user=requireUser(req,res);if(!user)return;const p=store.projects.find(function(x){return (x.slug===m[1]||x.id===m[1])&&x.owner_id===user.id;});if(!p)return fail(res,404,'Project not found');const b=await body(req);const ver=text(b.version_number,40);if(!ver)return fail(res,400,'Version number is required');if(store.versions.some(function(v){return v.project_id===p.id&&String(v.version_number).toLowerCase()===ver.toLowerCase();}))return fail(res,409,'This version number already exists for the project');const release=text(b.release_url,1000);let pending=null;if(b.file_key){pending=store.uploads.find(function(x){return x.key===b.file_key&&x.project_id===p.id&&x.owner_id===user.id;});if(!pending)return fail(res,400,'Uploaded file reference is invalid or belongs to another project');}if(!pending&&!release)return fail(res,400,'Upload a release file or provide a GitHub release URL');if(release){try{const ru=new URL(release);if(ru.protocol!=='https:'||ru.hostname!=='github.com')return fail(res,400,'Release URL must point to github.com');}catch{return fail(res,400,'Invalid GitHub release URL');}}const v={id:id(),project_id:p.id,version_number:ver,changelog:text(b.changelog,10000),game_versions:arrayStrings(b.game_versions,30,40),loaders:arrayStrings(b.loaders,15,40),dependencies:arrayStrings(b.dependencies,30,100),channel:['release','beta','alpha'].includes(b.channel)?b.channel:'release',file_key:pending?pending.key:null,file_name:pending?pending.file_name:null,file_size:pending?pending.file_size:0,release_url:release||null,status:'pending',downloads:0,created_at:new Date().toISOString(),scan_status:pending?'quarantined':'external'};store.versions.push(v);if(pending)store.uploads=store.uploads.filter(function(x){return x.key!==pending.key;});saveAudit(user.id,'version.submitted','version',v.id,{});await persist();return json(res,201,{ok:true,id:v.id});}
  m=pathname.match(/^\/api\/media\/([a-zA-Z0-9_-]+)$/);
  if(m&&req.method==='GET'){const item=store.media.find(function(x){return x.id===m[1];});if(!item)return fail(res,404,'Media not found');const p=store.projects.find(function(x){return x.id===item.project_id&&x.status==='approved';});if(!p)return fail(res,404,'Media not found');try{const fp=path.join(UPLOAD_DIR,item.key);const st=await fs.stat(fp);res.writeHead(200,{'content-type':item.content_type,'content-length':st.size,'content-disposition':'inline; filename="'+fileNameSafe(item.file_name)+'"','x-content-type-options':'nosniff','cache-control':'public, max-age=3600','content-security-policy':"default-src 'none'; sandbox"});return fs.createReadStream(fp).pipe(res);}catch{return fail(res,404,'Media file is missing');}}
  m=pathname.match(/^\/api\/versions\/([a-zA-Z0-9_-]+)\/download$/);
  if(m&&req.method==='GET'){const v=store.versions.find(function(x){return x.id===m[1]&&x.status==='approved';});const p=v&&store.projects.find(function(x){return x.id===v.project_id&&x.status==='approved';});if(!v||!p)return fail(res,404,'Version not found');if(v.release_url)return json(res,200,{external_url:v.release_url});if(!v.file_key||v.scan_status==='quarantined')return fail(res,423,'Release is quarantined or unavailable');const fp=path.join(UPLOAD_DIR,v.file_key);try{const st=await fs.stat(fp);v.downloads=(v.downloads||0)+1;p.downloads=(p.downloads||0)+1;store.analytics.push({id:id(),project_id:p.id,event_type:'download',created_at:new Date().toISOString()});if(store.analytics.length>100000)store.analytics.splice(0,store.analytics.length-100000);await persist();res.writeHead(200,{'content-type':'application/octet-stream','content-length':st.size,'content-disposition':'attachment; filename="'+fileNameSafe(v.file_name)+'"','x-content-type-options':'nosniff','cache-control':'no-store'});return fs.createReadStream(fp).pipe(res);}catch{return fail(res,404,'Release file is missing');}}
  if(pathname==='/api/admin/projects'&&req.method==='GET'){const user=currentUser(req);if(!auditAllowed(user,res))return;const status=['pending','approved','rejected','archived'].includes(u.searchParams.get('status'))?u.searchParams.get('status'):'pending';return json(res,200,{projects:store.projects.filter(function(p){return p.status===status;}).map(function(p){const owner=store.users.find(function(x){return x.id===p.owner_id;});return Object.assign({},p,{author:owner&&owner.username});})});}
  if(pathname==='/api/admin/versions'&&req.method==='GET'){const user=currentUser(req);if(!auditAllowed(user,res))return;const status=['pending','approved','rejected'].includes(u.searchParams.get('status'))?u.searchParams.get('status'):'pending';return json(res,200,{versions:store.versions.filter(function(v){return v.status===status;}).map(function(v){const p=store.projects.find(function(x){return x.id===v.project_id;});return Object.assign({},v,{project_name:p&&p.name,project_slug:p&&p.slug,author:(store.users.find(function(x){return x.id===p?.owner_id;})||{}).username});})});}
  if(pathname==='/api/admin/reports'&&req.method==='GET'){const user=currentUser(req);if(!auditAllowed(user,res))return;return json(res,200,{reports:store.reports.slice().reverse().slice(0,100).map(function(r){const p=store.projects.find(function(x){return x.id===r.project_id;});const owner=store.users.find(function(x){return x.id===r.reporter_id;});return Object.assign({},r,{project_name:p&&p.name,reporter:owner&&owner.username});})});}
  if(pathname==='/api/admin/comments'&&req.method==='GET'){const user=currentUser(req);if(!auditAllowed(user,res))return;const status=u.searchParams.get('status')||'visible';return json(res,200,{comments:store.comments.filter(function(c){return c.status===status;}).slice(-100).reverse()});}
  if(pathname==='/api/admin/audit'&&req.method==='GET'){const user=currentUser(req);if(!user)return fail(res,401,'Sign in required');if(user.role!=='admin')return fail(res,403,'Forbidden');return json(res,200,{events:store.audit.slice(0,200).map(function(a){const owner=store.users.find(function(x){return x.id===a.actor_id;});return Object.assign({},a,{actor:owner&&owner.username});})});}
  m=pathname.match(/^\/api\/admin\/(projects|versions|reports|comments)\/([a-zA-Z0-9_-]+)$/);
  if(m&&req.method==='PATCH'){const user=currentUser(req);if(!auditAllowed(user,res))return;const b=await body(req);const type=m[1],target=m[2];const list=type==='projects'?store.projects:type==='versions'?store.versions:type==='reports'?store.reports:store.comments;const row=list.find(function(x){return x.id===target;});if(!row)return fail(res,404,'Item not found');const allowed=type==='projects'?['approved','rejected','archived']:type==='versions'?['approved','rejected']:type==='reports'?['reviewing','resolved','dismissed']:['visible','hidden'];if(!allowed.includes(b.status))return fail(res,400,'Invalid status');if(type==='versions'&&b.status==='approved'&&row.file_key){if(row.scan_status==='quarantined')return fail(res,423,'Cannot approve a quarantined file; scan and release it through a trusted scanner first');const old=path.join(QUARANTINE_DIR,row.file_key);const next=path.join(UPLOAD_DIR,row.file_key);await fs.rename(old,next).catch(function(){});}row.status=b.status;saveAudit(user.id,type.slice(0,-1)+'.'+b.status,type,target,{status:b.status});await persist();return json(res,200,{ok:true,status:row.status});}
  return fail(res,404,'Not found');
}
async function serveStatic(req,res) {
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return fail(res,400,'Invalid URL');}
  if(pathname==='/')pathname='/index.html';
  const target=path.resolve(ROOT,'.'+pathname);
  const relative=path.relative(ROOT,target);const segments=relative.split(path.sep);const privateRoots=new Set(['.git','.github','node_modules','tests','worker','supabase','scanner','data-local','backups']);
  const privateFiles=new Set(['server.js','package.json','package-lock.json','README.md','SETUP.md']);
  const dataPrefix=DATA_DIR+path.sep;
  if(!target.startsWith(ROOT+path.sep)||!STATIC_EXTS.has(path.extname(target).toLowerCase())||target===DATA_DIR||target.startsWith(dataPrefix)||segments.some(function(x){return x.startsWith('.');})||privateRoots.has(segments[0])||privateFiles.has(segments[0]))return fail(res,404,'Not found');
  try{const st=await fs.stat(target);if(!st.isFile())return fail(res,404,'Not found');const data=await fs.readFile(target);const type=path.extname(target)==='.html'?'text/html; charset=utf-8':path.extname(target)==='.js'?'text/javascript; charset=utf-8':path.extname(target)==='.css'?'text/css; charset=utf-8':path.extname(target)==='.json'?'application/json; charset=utf-8':'application/octet-stream';res.writeHead(200,{'content-type':type,'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','cache-control':path.extname(target)==='.html'?'no-cache':'public, max-age=300'});return res.end(data);}catch{return fail(res,404,'Not found');}
}
async function main() {
  if(IS_PROD&&(!process.env.SESSION_SECRET||Buffer.byteLength(process.env.SESSION_SECRET)<32))throw new Error('Production requires SESSION_SECRET with at least 32 bytes');
  if(IS_PROD&&(!process.env.PUBLIC_BASE_URL||!/^https:\/\//i.test(process.env.PUBLIC_BASE_URL)))throw new Error('Production requires HTTPS PUBLIC_BASE_URL');
  await initStore();
  const server=http.createServer(function(req,res){
    Promise.resolve().then(function(){return req.url.startsWith('/api/')?handle(req,res):serveStatic(req,res);}).catch(function(e){console.error('Request failed:',e.message);if(!res.headersSent)fail(res,e.status||500,e.status?e.message:'Internal server error');else res.destroy();});
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=1000;
  server.listen(PORT,HOST,function(){console.log('Ali Labs listening on '+HOST+':'+PORT);console.log('Persistent file storage: '+DATA_DIR);});
  const cleanup=setInterval(function(){const now=Date.now();store.sessions=store.sessions.filter(function(s){return Date.parse(s.expires_at)>now;});for(const [key,v] of hits)if(now-v.start>3600000)hits.delete(key);persist().catch(function(e){console.error('Cleanup save failed:',e.message);});},60*60*1000);
  cleanup.unref();
  const backups=setInterval(function(){createBackup().catch(function(e){console.error('Backup failed:',e.message);});},30*60*1000);
  backups.unref();
}
main().catch(function(e){console.error('Startup failed:',e);process.exit(1);});
