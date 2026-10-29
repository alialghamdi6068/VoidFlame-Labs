'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

test('health endpoint starts with local file storage and reports ready', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=32000+Math.floor(Math.random()*20000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/health');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok',storage:'local-files',schemaVersion:1});
  await new Promise(function(r){setTimeout(r,50);});
  const data=JSON.parse(await fs.readFile(path.join(dir,'store.json'),'utf8'));
  assert.equal(data.schemaVersion,1);
  assert.ok(Array.isArray(data.users));
});
test('unknown API paths return JSON 404', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=52000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/does-not-exist');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,404);
  assert.equal((await response.json()).error,'Not found');
});


test('unsafe API requests with a session cookie reject missing Origin headers', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=42000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/auth/logout',{method:'POST',headers:{cookie:'ali_session=invalid'}});break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'Cross-origin request rejected');
});

test('malformed percent-encoded cookies do not crash the API', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=43000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/me',{headers:{cookie:'ali_session=%E0%A4%A'}});break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{user:null});
});



test('public project API does not disclose internal owner, follower, or storage keys', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const data={schemaVersion:1,users:[{id:'owner-internal-id',github_id:'123',username:'creator',display_name:'Creator',role:'user',created_at:'2026-01-01T00:00:00.000Z'}],projects:[{id:'project-internal-id',owner_id:'owner-internal-id',name:'Sample Project',slug:'sample-project',summary:'A test project',description:'Description',category:'Plugins',status:'approved',downloads:4,created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',favorites:['private-user-1'],followers:['private-user-2']}],versions:[{id:'version-public-id',project_id:'project-internal-id',version_number:'1.0.0',changelog:'Initial',game_versions:['1.21.1'],loaders:['Paper'],dependencies:[],channel:'release',file_key:'internal-storage-key',file_name:'sample.jar',file_size:4,status:'approved',scan_status:'clean',downloads:4,created_at:'2026-01-01T00:00:00.000Z'}]};
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'store.json'),JSON.stringify(data));
  const port=45000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/projects/sample-project');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.project.author,'creator');
  assert.equal('owner_id' in result.project,false);
  assert.equal('favorites' in result.project,false);
  assert.equal('followers' in result.project,false);
  assert.equal('file_key' in result.versions[0],false);
  assert.equal('project_id' in result.versions[0],false);
});

test('project catalogue supports bounded pagination and metadata', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=46000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/api/projects?page=2&limit=200&sort=name');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.pagination.page,2);
  assert.equal(result.pagination.limit,100);
  assert.equal(result.pagination.total,0);
  assert.deepEqual(result.projects,[]);
});


test('local database files are never served by the static file handler', async function(t) {
  const dir=path.join(__dirname,'..','data-local-test-'+Date.now()+'-'+Math.floor(Math.random()*1000000));
  const port=47000+Math.floor(Math.random()*10000);
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'store.json'),JSON.stringify({private:'must-not-be-served'}));
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  let response;
  for(let i=0;i<50;i++){try{response=await fetch('http://127.0.0.1:'+port+'/'+path.basename(dir)+'/store.json');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  assert.ok(response,'server did not start');
  assert.equal(response.status,404);
  assert.equal(await response.text(),'{"error":"Not found"}');
});


test('static handler does not expose backend or private source files', async function(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ali-labs-test-'));
  const port=48000+Math.floor(Math.random()*10000);
  const child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test'},stdio:'ignore'});
  t.after(async function(){child.kill('SIGTERM');await fs.rm(dir,{recursive:true,force:true});});
  for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:'+port+'/api/health');break;}catch{await new Promise(function(r){setTimeout(r,100);});}}
  for(const file of ['/server.js','/package.json','/tests/server.test.js','/worker/src/index.js','/.git/config']) {
    const response=await fetch('http://127.0.0.1:'+port+file);
    assert.equal(response.status,404,file+' must not be publicly served');
  }
});
