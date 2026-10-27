import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
const path = process.env.DB_PATH || './data/clockin.sqlite';
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('manager','employee')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),started INTEGER NOT NULL,ended INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS active_shift ON shifts(user_id) WHERE ended IS NULL;`);
const safe = u => u && ({ id:u.id,name:u.name,email:u.email,role:u.role });
function hash(password) { const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(password,salt,64).toString('hex'); }
function verify(password, stored) { const [salt,key]=stored.split(':'); return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex')); }
const digest = t => createHash('sha256').update(t).digest('hex');
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
 const url=new URL(req.url,'http://localhost');
 if(!url.pathname.startsWith('/api/')){
  const files={'/':['public/index.html','text/html'],'/app.js':['public/app.js','text/javascript'],'/style.css':['public/style.css','text/css']};
  const f=files[url.pathname];if(!f)return send(404,{error:'Not found'});res.writeHead(200,{'Content-Type':f[1]});return res.end(readFileSync(new URL(f[0],import.meta.url)));
 }
 if(req.method==='POST' && req.headers.origin && req.headers.origin!==`${process.env.COOKIE_SECURE==='true'?'https':'http'}://${req.headers.host}`)return send(403,{error:'Invalid request origin'});
 let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(413,{error:'Request too large'});}try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Invalid JSON'});}}
 const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
 const user=token?db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(digest(token),Date.now()):null;
 const login=u=>{const t=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(t),u.id,Date.now()+86400000);res.setHeader('Set-Cookie',`session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);return send(200,{user:safe(u)});};
 if(req.method==='GET'&&url.pathname==='/api/me')return send(200,{user:safe(user)||null,needsSetup:!db.prepare('SELECT id FROM users LIMIT 1').get()});
 if(req.method==='POST'&&url.pathname==='/api/setup'){
  if(db.prepare('SELECT id FROM users LIMIT 1').get())return send(409,{error:'Workspace already configured'});
  if(!valid(body))return send(400,{error:'Enter a name, valid email, and password of at least 12 characters'});
  const result=db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'manager')").run(body.name.trim(),body.email.trim().toLowerCase(),hash(body.password));return login(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid));
 }
 if(req.method==='POST'&&url.pathname==='/api/login'){
  const key=req.socket.remoteAddress;const a=attempts.get(key);if(a&&a.until>Date.now()&&a.count>=10)return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
  const u=typeof body.email==='string'?db.prepare('SELECT * FROM users WHERE email=?').get(body.email.trim().toLowerCase()):null;
  if(!u||typeof body.password!=='string'||!verify(body.password,u.password)){const entry=a&&a.until>Date.now()?a:{count:0,until:Date.now()+900000};entry.count++;attempts.set(key,entry);return send(401,{error:'Email or password is incorrect'});}attempts.delete(key);return login(u);
 }
 if(!user)return send(401,{error:'Please sign in'});
 if(req.method==='POST'&&url.pathname==='/api/logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(200,{ok:true});}
 if(req.method==='POST'&&url.pathname==='/api/employees'){
  if(user.role!=='manager')return send(403,{error:'Manager access required'});if(!valid(body))return send(400,{error:'Enter a name, valid email, and password of at least 12 characters'});
  if(db.prepare('SELECT id FROM users WHERE email=?').get(body.email.trim().toLowerCase()))return send(409,{error:'Email already exists'});
  db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'employee')").run(body.name.trim(),body.email.trim().toLowerCase(),hash(body.password));return send(201,{ok:true});
 }
 if(req.method==='POST'&&url.pathname==='/api/clock-in'){
  if(db.prepare('SELECT id FROM shifts WHERE user_id=? AND ended IS NULL').get(user.id))return send(409,{error:'You are already clocked in'});
  db.prepare('INSERT INTO shifts(user_id,started) VALUES(?,?)').run(user.id,Date.now());return send(201,{ok:true});
 }
 if(req.method==='POST'&&url.pathname==='/api/clock-out'){
  const result=db.prepare('UPDATE shifts SET ended=? WHERE user_id=? AND ended IS NULL').run(Date.now(),user.id);return send(result.changes?200:409,result.changes?{ok:true}:{error:'You are not clocked in'});
 }
 if(req.method==='GET'&&url.pathname==='/api/dashboard'){
  const shifts=db.prepare('SELECT shifts.*,users.name FROM shifts JOIN users ON users.id=shifts.user_id WHERE user_id=? ORDER BY started DESC LIMIT 100').all(user.id);
  const team=user.role==='manager'?db.prepare('SELECT id,name,email,role FROM users ORDER BY name').all():[];
  const teamShifts=user.role==='manager'?db.prepare('SELECT shifts.*,users.name FROM shifts JOIN users ON users.id=shifts.user_id ORDER BY started DESC LIMIT 500').all():[];
  return send(200,{shifts,team,teamShifts});
 }
 send(404,{error:'Not found'});
 } catch(e){console.error(e);send(500,{error:'An unexpected error occurred'});}
});
function valid(b){return typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=100&&typeof b.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)&&b.email.length<=254&&typeof b.password==='string'&&b.password.length>=12&&b.password.length<=256;}
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Clockin listening on port ${server.address().port}`));
