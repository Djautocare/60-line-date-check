import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { handle } from './service.mjs';
import { authenticate, bootstrapAdmin, hashPassword, verifyPassword, validPassword, newToken, tokenHash, publicMember } from './auth.mjs';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const response=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
export async function createApp({db,origin,secureCookie=false}){
 const allowedOrigin=new URL(origin).origin;const failures=new Map();const dummy=await hashPassword('dummy-password-for-timing');
 const cookie=(token,age)=>`datecheck_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie?'; Secure':''}`;
 const app=async(req,ip='local')=>{
  const path=new URL(req.url).pathname;
  if(req.method!=='GET'){
   if(req.headers.get('origin')!==allowedOrigin||req.headers.get('sec-fetch-site')==='cross-site')return response({error:'Request origin is not allowed.'},403);
   if(!req.headers.get('content-type')?.includes('application/json'))return response({error:'Send JSON data.'},400);
  }
  if(path==='/api/login'&&req.method==='POST'){
   let data;try{data=await req.json();}catch{return response({error:'Invalid request.'},400);}
   const username=String(data.username||'').toLowerCase().trim();const password=typeof data.password==='string'?data.password:'';
   if(username.length>40||password.length>256)return response({error:'Username or password is incorrect.'},401);
   const key=`${ip}:${username}`;const t=Date.now();const previous=failures.get(key);
   if(previous&&previous.until>t&&previous.count>=10)return response({error:'Too many login attempts. Try again in 15 minutes.'},429,{'Retry-After':'900'});
   if(failures.size>10000){for(const [k,v] of failures)if(v.until<t)failures.delete(k);if(failures.size>10000)return response({error:'Please try again shortly.'},429);}
   const member=await db.prepare('SELECT * FROM members WHERE username=?').bind(username).first();
   const valid=await verifyPassword(password,member?.password_hash||dummy);
   if(!valid||!member?.active){const n=previous&&previous.until>t?previous.count+1:1;failures.set(key,{count:n,until:t+15*60*1000});return response({error:'Username or password is incorrect.'},401);}
   failures.delete(key);const token=newToken();await db.batch([db.prepare('DELETE FROM sessions WHERE expires<?').bind(t),db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES (?,?,?)').bind(tokenHash(token),member.id,t+8*60*60*1000)]);
   return response({member:publicMember(member)},200,{'Set-Cookie':cookie(token,8*60*60)});
  }
  const member=await authenticate(req,db);
  if(path==='/api/logout'&&req.method==='POST'){
   const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('datecheck_session='))?.slice(18);
   if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash(token)).run();return response({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(path==='/api/me')return member?response({member:publicMember(member)}):response({error:'Please sign in.'},401);
  if(path==='/api/account/password'&&req.method==='POST'){
   if(!member)return response({error:'Please sign in.'},401);
   const data=await req.json();if(!validPassword(data.password))return response({error:'Use a password with 12–256 characters.'},400);
   if(!await verifyPassword(String(data.currentPassword||''),member.password_hash))return response({error:'Current password is incorrect.'},400);
   await db.batch([db.prepare('UPDATE members SET password_hash=? WHERE id=?').bind(await hashPassword(data.password),member.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(member.id)]);return response({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  return handle(req,db,member);
 };
 return app;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
export async function startServer(){
 if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL in .env to your datecheck60 PostgreSQL database.');
 const port=Number(process.env.PORT||3001);const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;const secureCookie=process.env.COOKIE_SECURE==='true';
 if(new URL(origin).protocol==='https:'&&!secureCookie)throw new Error('Set COOKIE_SECURE=true when using an HTTPS domain.');
 const db=await openDatabase(process.env.DATABASE_URL);await bootstrapAdmin(db,{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD,name:process.env.ADMIN_NAME});
 const app=await createApp({db,origin,secureCookie});const dist=resolve(projectRoot,'dist');
 const server=createServer(async(req,res)=>{
  try{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(self), microphone=()');res.setHeader('X-Frame-Options','DENY');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')){
    let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>500000){res.writeHead(413);res.end(JSON.stringify({error:'Request is too large.'}));return;}}
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
    const request=new Request(url,{method:req.method,headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:body||'{}'})});
    const result=await app(request,req.socket.remoteAddress);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   let filename=resolve(dist,`.${decodeURIComponent(url.pathname)}`);if(filename!==dist&&!filename.startsWith(dist+sep)){res.writeHead(404);res.end();return;}
   try{if(!(await stat(filename)).isFile())filename=resolve(dist,'index.html');}catch{if(extname(url.pathname)){res.writeHead(404);res.end();return;}filename=resolve(dist,'index.html');}
   const content=await readFile(filename);res.setHeader('Content-Type',mime[extname(filename)]||'application/octet-stream');res.setHeader('Cache-Control',filename.includes(`${sep}assets${sep}`)?'public, max-age=31536000, immutable':'no-cache');res.writeHead(200);res.end(req.method==='HEAD'?undefined:content);
  }catch(e){console.error('Request failed:',e.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Something went wrong. Please try again.'}));}
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(port,process.env.HOST||'127.0.0.1',ok);});
 console.log(`DateCheck backend listening at http://localhost:${port}`);
 await mkdir(resolve(projectRoot,'runtime'),{recursive:true});await writeFile(resolve(projectRoot,'runtime/backend.pid'),String(process.pid));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();});return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer().catch(e=>{console.error('Startup failed:',e.message);process.exit(1);});
