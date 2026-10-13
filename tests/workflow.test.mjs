import {test,after,before} from 'node:test';import assert from 'node:assert/strict';
import {PGlite}from'@electric-sql/pglite';import {openDatabase}from'../server/db.mjs';import{bootstrapAdmin}from'../server/auth.mjs';import{createApp}from'../server/index.mjs';import{validEAN13}from'../server/ean.mjs';
let db,app,engine;let adminCookie='',staffCookie='';const origin='http://localhost:3001';
const fullEAN=(n)=>{const first=String(n).padStart(12,'0');const sum=[...first].reduce((s,d,i)=>s+Number(d)*(i%2?3:1),0);return first+((10-sum%10)%10);};
async function call(path,body,cookie=adminCookie,requestOrigin=origin){const result=await app(new Request(origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',origin:requestOrigin})},...(body===undefined?{}:{body:JSON.stringify(body)})}),'test');return{status:result.status,data:await result.json(),cookie:result.headers.get('set-cookie')?.split(';')[0]};}
before(async()=>{engine=new PGlite();await engine.waitReady;const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};db=await openDatabase('test',{pool});await bootstrapAdmin(db,{username:'owner',password:'owner-test-password-123',name:'Owner'});app=await createApp({db,origin});});
after(async()=>{await db?.close();});
test('username login, staff access, daily selection, verification, completion and reports',async()=>{
 let r=await call('me',undefined,'');assert.equal(r.status,401);
 r=await call('login',{username:'owner',password:'wrong'},'');assert.equal(r.status,401);
 r=await call('login',{username:'owner',password:'owner-test-password-123'},'');assert.equal(r.status,200);adminCookie=r.cookie;assert.match(adminCookie,/datecheck_session=/);
 r=await call('members/create',{username:'staff1',name:'Staff One',password:'staff-test-password-123',role:'staff'});assert.equal(r.status,200);
 r=await call('login',{username:'staff1',password:'staff-test-password-123'},'');staffCookie=r.cookie;assert.equal(r.data.member.role,'staff');
 assert.equal((await call('members',undefined,staffCookie)).status,403);
 assert.equal((await call('members/create',{username:'rogue',name:'Rogue',password:'staff-test-password-123',role:'admin'},staffCookie)).status,403);
 assert.equal((await call('rounds/start',{mode:'daily'},staffCookie)).status,400);
 const products=Array.from({length:90},(_,i)=>({name:'Product '+i,ean:fullEAN(408860100000+i),plu:String(100000+i),section:i<50?'Bread chiller':'Produce chiller'}));
 assert.equal((await call('products',{items:products})).status,200);
 assert.equal((await call('products',{name:'Invalid',ean:'4088600303391',plu:'123456',section:'Bread chiller'})).status,400);
 assert.equal((await call('products',{name:'Invalid PLU',ean:'4088600303390',plu:'12345',section:'Bread chiller'})).status,400);
 assert.equal((await call('quotas',{quotas:{'Bread chiller':50,'Produce chiller':11}})).status,400);
 assert.equal((await call('quotas',{quotas:{'Bread chiller':19,'Produce chiller':41}})).status,400);
 assert.equal((await call('quotas',{quotas:{'Bread chiller':35,'Produce chiller':25}})).status,200);
 r=await call('rounds/start',{mode:'daily',store:'Test store'},staffCookie);assert.equal(r.status,200);const round=r.data.round;const lines=r.data.lines;assert.equal(lines.length,60);assert.equal(new Set(lines.map(l=>l.ean)).size,60);assert.equal(lines.filter(l=>l.section==='Bread chiller').length,35);assert.equal(lines.filter(l=>l.section==='Produce chiller').length,25);
 const other=await call('rounds/start',{mode:'daily'});assert.equal(other.status,200);assert.deepEqual(other.data.lines.map(l=>l.ean),lines.map(l=>l.ean));
 assert.equal((await call('report/'+encodeURIComponent(other.data.round.id),undefined,staffCookie)).status,404);
 assert.equal((await call('lines/save',{id:lines[0].id,status:'okay',quantity:0},staffCookie)).status,400);
 assert.equal((await call('lines/verify',{id:lines[0].id,ean:'4088600303390',method:'camera'},staffCookie)).status,409);
 assert.equal((await call('lines/verify',{id:lines[0].id,ean:lines[0].ean,method:'camera'},staffCookie,'https://evil.example')).status,403);
 assert.equal((await call('rounds/finish',{id:round.id},staffCookie)).status,400);
 assert.equal((await call('lines/verify',{id:other.data.lines[0].id,ean:other.data.lines[0].ean,method:'camera'},staffCookie)).status,404);
 for(let i=0;i<lines.length;i++){
  const l=lines[i];assert.equal((await call('lines/verify',{id:l.id,ean:l.ean,method:i?'camera':'manual'},staffCookie)).status,200);
  if(i===0){assert.equal((await call('lines/save',{id:l.id,status:'out_of_date',quantity:0},staffCookie)).status,400);assert.equal((await call('lines/save',{id:l.id,status:'out_of_date',quantity:1.5},staffCookie)).status,400);}
  assert.equal((await call('lines/save',{id:l.id,status:i===0?'out_of_date':i===1?'not_stickered':'okay',quantity:i===0?3:i===1?2:0},staffCookie)).status,200);
 }
 assert.equal((await call('rounds/finish',{id:round.id},staffCookie)).status,200);
 assert.equal((await call('lines/save',{id:lines[0].id,status:'okay',quantity:0},staffCookie)).status,400);
 r=await call('reports',undefined,staffCookie);assert.equal(r.data.reports.length,1);assert.equal(Number(r.data.reports[0].out_of_date),3);assert.equal(Number(r.data.reports[0].not_stickered),2);
 // Saved catalogue snapshots remain stable after edits and even removal.
 const catalogue=await call('state');const selected=catalogue.data.products.find(p=>p.ean===lines[0].ean);assert.equal((await call('products',{...selected,name:'Renamed later'})).status,200);
 assert.equal((await call('products/delete',{id:selected.id})).status,200);
 r=await call('rounds/start',{mode:'daily'},staffCookie);assert.equal(r.status,200);assert.equal(r.data.lines[0].name,lines[0].name);assert.equal(r.data.lines[0].ean,lines[0].ean);assert.ok(r.data.round.finished);
 // A later day gets a fresh persisted selection, respecting changed quotas.
 await db.prepare('UPDATE selections SET date=?').bind('2000-01-01').run();
 assert.equal((await call('quotas',{quotas:{'Bread chiller':30,'Produce chiller':30}})).status,200);
 r=await call('members/create',{username:'staff2',name:'Staff Two',password:'other-test-password-123',role:'staff'});assert.equal(r.status,200);
 const login2=await call('login',{username:'staff2',password:'other-test-password-123'},'');const cookie2=login2.cookie;
 r=await call('rounds/start',{mode:'daily'},cookie2);assert.equal(r.status,200);assert.equal(r.data.lines.length,60);assert.equal(r.data.lines.filter(l=>l.section==='Bread chiller').length,30);
 // Revoking access and resetting a password invalidates usable sessions.
 const member2=(await call('members')).data.members.find(m=>m.username==='staff2');
 assert.equal((await call('members',{id:member2.id,role:'staff',active:0})).status,200);assert.equal((await call('me',undefined,cookie2)).status,401);
 assert.equal((await call('members',{id:member2.id,role:'staff',active:1})).status,200);
 assert.equal((await call('members/password',{id:member2.id,password:'new-staff-password-123'})).status,200);assert.equal((await call('me',undefined,cookie2)).status,401);
 r=await call('login',{username:'staff2',password:'new-staff-password-123'},'');assert.equal(r.status,200);
 const owner=(await call('members')).data.members.find(m=>m.username==='owner');assert.equal((await call('members',{id:owner.id,role:'staff',active:0})).status,400);
 assert.equal((await call('logout',{},staffCookie)).status,200);assert.equal((await call('me',undefined,staffCookie)).status,401);
});
test('EAN-13 check digit validates the supplied Aldi example',()=>{assert.equal(validEAN13('4088600303390'),true);assert.equal(validEAN13('4088600303391'),false);assert.equal(validEAN13('408860030339'),false);});
