import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {bootstrapAdmin,hashPassword} from '../server/auth.mjs';
import {createApp} from '../server/index.mjs';
const origin='http://localhost:3001',password='login-history-test-123';
async function fixture(){
 const engine=new PGlite();await engine.waitReady;const pool={query:(q,a)=>engine.query(q,a),connect:async()=>({query:(q,a)=>engine.query(q,a),release(){}}),end:()=>engine.close()};const db=await openDatabase('test',{pool});
 await bootstrapAdmin(db,{username:'original-owner',password,name:'Original owner'});
 const hash=await hashPassword(password);
 for(const [id,role,active] of [['staff','staff',1],['store-admin','admin',1],['disabled','staff',0]])await db.prepare('INSERT INTO members(id,username,name,password_hash,role,active,created) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,hash,role,active,'2026-10-01').run();
 const app=await createApp({db,origin});
 const call=async(path,body,cookie='')=>{const r=await app(new Request(origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),'test');return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=(username,custom=password)=>call('login',{username,password:custom});
 const recorded=async id=>(await db.prepare('SELECT last_login_at FROM members WHERE id=?').bind(id).first()).last_login_at;
 return {db,call,login,recorded};
}
test('only successful password logins update last login, atomically with the new session',async()=>{
 const {db,call,login,recorded}=await fixture();try{
  assert.equal(await recorded('staff'),null);
  assert.equal((await login('staff','wrong')).status,401);assert.equal(await recorded('staff'),null);
  assert.equal((await login('disabled')).status,401);assert.equal(await recorded('disabled'),null);
  const before=Date.now(),success=await login('staff');assert.equal(success.status,200);assert.ok(success.cookie);
  const timestamp=await recorded('staff');assert.ok(Date.parse(timestamp)>=before&&Date.parse(timestamp)<=Date.now());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind('staff').first()).n,1);
  assert.equal('last_login_at' in success.data.member,false);
  const older='2026-01-02T03:04:05.000Z';await db.prepare('UPDATE members SET last_login_at=? WHERE id=?').bind(older,'staff').run();
  assert.equal((await call('me',undefined,success.cookie)).status,200);
  assert.equal((await call('state',undefined,success.cookie)).status,200);
  assert.equal((await login('staff','wrong')).status,401);assert.equal(await recorded('staff'),older);
  assert.equal((await call('logout',{},success.cookie)).status,200);assert.equal(await recorded('staff'),older);
  assert.equal((await login('staff')).status,200);assert.ok(Date.parse(await recorded('staff'))>Date.parse(older));
 }finally{await db.close();}
});
test('only the protected owner can read login times; ordinary admins, staff and public profiles cannot',async()=>{
 const {db,call,login}=await fixture();try{
  const staff=await login('staff'),admin=await login('store-admin'),owner=await login('original-owner');
  const known='2026-10-19T10:15:20.000Z';await db.prepare('UPDATE members SET last_login_at=? WHERE id=?').bind(known,'staff').run();
  for(const account of [staff,admin,owner])for(const path of ['me','state']){
   const r=await call(path,undefined,account.cookie);assert.equal(r.status,200);assert.equal('last_login_at' in r.data.member,false);
  }
  assert.equal((await call('members',undefined,staff.cookie)).status,403);
  const members=await call('members',undefined,owner.cookie);assert.equal(members.status,200);assert.equal(members.data.members.find(m=>m.id==='staff').last_login_at,known);
  assert.equal(members.data.members.find(m=>m.id==='disabled').last_login_at,null);
  const limited=await call('members',undefined,admin.cookie);assert.equal(limited.status,200);assert.ok(limited.data.members.every(m=>!('last_login_at' in m)));
  const search=await call('store-members/search',{username:'staff'},owner.cookie);assert.equal(search.data.member.last_login_at,known);
  const hidden=await call('store-members/search',{username:'staff'},admin.cookie);assert.equal('last_login_at' in hidden.data.member,false);
  // Account ID protects access even if another administrator takes the admin username.
  await db.prepare("UPDATE members SET username='admin' WHERE id='store-admin'").run();
  assert.ok((await call('members',undefined,admin.cookie)).data.members.every(m=>!('last_login_at' in m)));
  // Member updates cannot forge last login timestamps.
  assert.equal((await call('members',{id:'staff',role:'staff',active:1,last_login_at:'2099-01-01T00:00:00Z'},admin.cookie)).status,200);
  assert.equal((await db.prepare("SELECT last_login_at FROM members WHERE id='staff'").first()).last_login_at,known);
 }finally{await db.close();}
});
