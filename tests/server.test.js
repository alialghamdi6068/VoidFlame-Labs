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
