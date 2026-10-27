import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('manager and employee account lifecycle, shift tracking, and access boundaries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'clockin-'));const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',DB_PATH:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
 try{
 const port=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{const m=String(d).match(/port (\d+)/);if(m)resolve(m[1]);});child.on('exit',c=>reject(Error('Server exited '+c)));setTimeout(()=>reject(Error('Startup timed out')),5000).unref();});
 const base='http://127.0.0.1:'+port;
 async function request(path,body,cookie){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 assert.equal((await fetch(base)).status,200);
 assert.equal((await request('me')).data.needsSetup,true);
 const manager=await request('setup',{name:'Manager',email:'manager@example.com',password:'a-secure-password'});assert.equal(manager.status,200);assert.equal(manager.data.user.role,'manager');
 assert.equal((await request('setup',{name:'Other',email:'other@example.com',password:'a-secure-password'})).status,409);
 assert.equal((await request('employees',{name:'Employee',email:'employee@example.com',password:'employee-password'},manager.cookie)).status,201);
 assert.equal((await request('login',{email:'employee@example.com',password:'incorrect'})).status,401);
 const employee=await request('login',{email:'employee@example.com',password:'employee-password'});assert.equal(employee.status,200);
 assert.equal((await request('employees',{name:'Intruder',email:'intruder@example.com',password:'employee-password'},employee.cookie)).status,403);
 assert.equal((await request('dashboard')).status,401);
 assert.equal((await request('clock-out',{},employee.cookie)).status,409);
 assert.equal((await request('clock-in',{},employee.cookie)).status,201);
 assert.equal((await request('clock-in',{},employee.cookie)).status,409);
 let dashboard=(await request('dashboard',undefined,employee.cookie)).data;assert.equal(dashboard.shifts.length,1);assert.equal(dashboard.shifts[0].ended,null);assert.deepEqual(dashboard.team,[]);assert.deepEqual(dashboard.teamShifts,[]);
 assert.equal((await request('clock-out',{},employee.cookie)).status,200);
 dashboard=(await request('dashboard',undefined,manager.cookie)).data;assert.equal(dashboard.team.length,2);assert.equal(dashboard.teamShifts.length,1);assert.ok(dashboard.teamShifts[0].ended>=dashboard.teamShifts[0].started);assert.equal(dashboard.shifts.length,0);
 assert.equal((await request('logout',{},employee.cookie)).status,200);assert.equal((await request('dashboard',undefined,employee.cookie)).status,401);
 }finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});}
});
