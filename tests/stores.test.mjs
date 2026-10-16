import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function fixture(){
 const engine=new PGlite();await engine.waitReady;const pool={query:(q,a)=>engine.query(q,a),connect:async()=>({query:(q,a)=>engine.query(q,a),release(){}}),end:()=>engine.close()};const db=await openDatabase('test',{pool});
 const users={};for(const [id,role,store] of [['owner','admin','legacy'],['admina','admin','legacy'],['alice','staff','legacy'],['amy','staff','legacy'],['adminb','admin','b'],['bob','staff','b'],['free','staff',null]]){
  if(id==='owner')await db.prepare("INSERT INTO stores(id,number,name,created) VALUES('b','002','Second','2026-10-01')").run();
  await db.prepare('INSERT INTO members(id,username,name,role,password_hash,created,store_id) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,role,'unused','2026-10-01',store).run();users[id]={id};
 }
 await db.prepare("INSERT INTO settings(key,value) VALUES('owner','owner')").run();
 const call=async(path,body,user='owner',scope)=>{const r=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(scope?{'x-store-id':scope}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db,users[user]);return {status:r.status,data:await r.json()};};
 const seed=()=>call('products',{items:Array.from({length:70},(_,i)=>({plu:String(100000+i),name:'Product '+i,section:i%2?'Chiller':'Bread'}))});
 return {db,call,seed};
}
test('owner is protected from every store admin and can filter/manage every store',async()=>{
 const {db,call}=await fixture();try{
  assert.equal((await call('state')).data.member.is_owner,true);
  assert.equal((await call('state',undefined,'admina')).data.member.is_owner,false);
  for(const [path,body] of [['members',{id:'owner',role:'staff',active:0}],['members/password',{id:'owner',password:'new-password-for-owner'}],['store-members/remove',{id:'owner'}],['store-members/add',{username:'owner'}]])assert.equal((await call(path,body,'admina')).status,403,path);
  const owner=await db.prepare("SELECT * FROM members WHERE id='owner'").first();assert.equal(owner.role,'admin');assert.equal(owner.active,1);assert.equal(owner.password_hash,'unused');assert.equal(owner.store_id,'legacy');
  assert.equal((await call('stores',undefined,'admina')).status,403);
  assert.equal((await call('stores/save',{number:'999'},'admina')).status,403);
  for(const scope of ['b','all'])for(const path of ['state','members','reports'])assert.equal((await call(path,undefined,'admina',scope)).status,403);
  assert.deepEqual((await call('members',undefined,'admina')).data.members.map(m=>m.id).sort(),['admina','alice','amy','owner']);
  assert.equal((await call('members',undefined,'owner','all')).data.members.length,7);
  assert.equal((await call('members',undefined,'owner','b')).data.members.length,2);
  let r=await call('stores/save',{id:'legacy',number:'001',name:'First store'});assert.equal(r.status,200);
  assert.equal((await call('state')).data.store.number,'001');
  r=await call('stores/save',{number:'003',name:'Third store'});assert.equal(r.status,200);assert.ok(r.data.id);
  assert.equal((await call('stores')).data.stores.length,3);
  assert.equal((await call('stores/save',{number:'003'})).status,400);
  assert.equal((await call('stores/save',{number:'not-a-number'})).status,400);
  assert.equal((await call('members',{id:'bob',active:0,role:'staff'},'owner','all')).status,200);
  assert.equal((await call('members',{id:'bob',active:1,role:'admin'},'owner','b')).status,200);
  assert.equal((await db.prepare("SELECT role FROM members WHERE id='bob'").first()).role,'admin');
 }finally{await db.close();}
});
test('store staff share progress and completion, keep recorder attribution and reject stale changes',async()=>{
 const {db,call,seed}=await fixture();try{
  assert.equal((await seed()).status,200);
  const first=await call('rounds/start',{mode:'daily'},'admina');assert.equal(first.status,200);const {round,lines}=first.data;
  const second=await call('rounds/start',{mode:'daily'},'amy');assert.equal(second.data.round.id,round.id);assert.deepEqual(second.data.lines,lines);
  const other=await call('rounds/start',{mode:'daily'},'bob');assert.equal(other.status,200);assert.notEqual(other.data.round.id,round.id);assert.equal(other.data.round.store_id,'b');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM selections').first()).n,2);
  const l=lines[0];
  let r=await call('lines/save',{id:l.id,status:'rotation_issue',quantity:0,revision:0},'alice');assert.equal(r.status,200);assert.equal(r.data.revision,1);
  r=await call('state',undefined,'amy');assert.equal(r.data.round.id,round.id);assert.equal(r.data.lines[0].recorded_by,'alice');assert.equal(r.data.lines[0].recorded_by_name,'alice');
  r=await call('lines/save',{id:l.id,status:'off_sale',quantity:0,revision:0},'amy');assert.equal(r.status,409);assert.equal(r.data.code,'line_changed');
  for(const x of lines.slice(1)){const r=await call('lines/save',{id:x.id,status:'off_sale',quantity:0,revision:0},'amy');assert.equal(r.status,200);}
  assert.equal((await call('rounds/finish',{id:round.id},'amy')).status,200);
  assert.equal((await call('rounds/finish',{id:round.id},'alice')).status,200);
  const state=(await call('state',undefined,'alice')).data;assert.ok(state.round.finished);assert.equal(state.sharedCheck.completed,true);
  assert.equal((await call('lines/save',{id:l.id,status:'off_sale',quantity:0},'alice')).status,400);
  assert.equal((await call('lines/verify',{id:l.id},'alice')).status,410);
  assert.equal((await call('rounds/start',{},'alice')).data.round.id,round.id);
  const report=(await call('report/'+encodeURIComponent(round.id),undefined,'amy')).data;assert.equal(report.round.finished_by,'amy');assert.equal(report.lines[0].recorded_by_name,'alice');assert.match(report.round.user_name,/alice/);assert.match(report.round.user_name,/amy/);
  assert.equal((await call('reports?checkedBy=alice',undefined,'admina')).data.total,1);
  assert.equal((await call('reports?checkedBy=amy',undefined,'admina')).data.total,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
  const recheck=await db.prepare('SELECT * FROM rotation_rechecks').first();assert.ok(recheck);
  await db.prepare('UPDATE rotation_rechecks SET due_date=? WHERE id=?').bind(date(),recheck.id).run();assert.equal((await call('rotation-rechecks',undefined,'amy')).data.rechecks[0].flagged_by,'alice');
  assert.equal((await call('reports/delete',{id:round.id},'admina')).status,200);
  const deleted=(await call('state',undefined,'amy')).data;assert.equal(deleted.round,null);assert.equal(deleted.sharedCheck.reportDeleted,true);
  assert.equal((await call('rounds/start',{},'alice')).status,409);
  assert.equal((await call('state',undefined,'bob')).data.sharedCheck.completed,false);
 }finally{await db.close();}
});
test('guessed report, line and recheck IDs cannot cross stores; the owner can access all',async()=>{
 const {db,call,seed}=await fixture();try{
  await seed();const a=(await call('rounds/start',{},'alice')).data,b=(await call('rounds/start',{},'bob')).data;
  await db.prepare("INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) VALUES('qb',?,?,?)").bind(b.lines[0].id,date(),new Date().toISOString()).run();
  assert.equal((await call('reports',undefined,'admina')).data.total,1);assert.equal((await call('reports',undefined,'bob')).data.total,1);
  assert.equal((await call('reports',undefined,'owner','all')).data.total,2);
  for(const user of ['alice','admina']){
   assert.equal((await call('report/'+encodeURIComponent(b.round.id),undefined,user)).status,404);
   assert.equal((await call('lines/verify',{id:b.lines[0].id,ean:'4088600303390',method:'camera'},user)).status,410);
   assert.equal((await call('lines/no-ean',{id:b.lines[0].id},user)).status,410);
   assert.equal((await call('lines/save',{id:b.lines[0].id,status:'off_sale',quantity:0},user)).status,404);
   assert.equal((await call('rounds/finish',{id:b.round.id},user)).status,404);
   assert.equal((await call('rotation-rechecks',undefined,user)).data.total,0);
   assert.equal((await call('rotation-rechecks/verify',{id:'qb',ean:'4088600303390',method:'camera'},user)).status,410);
   assert.equal((await call('rotation-rechecks/no-ean',{id:'qb'},user)).status,410);
   assert.equal((await call('rotation-rechecks/save',{id:'qb',status:'off_sale'},user)).status,404);
  }
  assert.equal((await call('reports/delete',{id:b.round.id},'admina')).status,404);
  assert.equal((await call('report/'+encodeURIComponent(b.round.id),undefined,'owner','all')).status,200);
  assert.equal((await call('rotation-rechecks',undefined,'owner','all')).data.total,1);
  assert.equal((await call('rotation-rechecks/no-ean',{id:'qb'},'owner','all')).status,410);
  assert.equal((await call('rotation-rechecks/save',{id:'qb',status:'off_sale'},'owner','all')).status,200);
  assert.equal((await call('reports/delete',{id:b.round.id},'owner','all')).status,200);
  assert.equal((await call('report/'+encodeURIComponent(a.round.id),undefined,'alice')).status,200);
  const practice=await call('rounds/start',{mode:'practice'},'admina');assert.equal(practice.status,200);
  assert.equal((await call('report/'+encodeURIComponent(practice.data.round.id),undefined,'alice')).status,404);
  assert.equal((await call('rounds/start',{},'owner','all')).status,400);
 }finally{await db.close();}
});
test('username membership requires explicit owner transfers, revokes sessions and preserves store history',async()=>{
 const {db,call,seed}=await fixture();try{
  await seed();const original=(await call('rounds/start',{},'alice')).data.round;
  let r=await call('store-members/search',{username:'free'},'admina');assert.equal(r.data.available,true);assert.equal(r.data.member.store_id,null);
  assert.equal((await call('store-members/search',{username:'fre'},'admina')).data.member,null);
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires) VALUES('free-session','free',9999999999999)").run();
  assert.equal((await call('store-members/add',{username:'free'},'admina')).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='free'").first()).n,0);
  assert.equal((await call('state',undefined,'free')).data.store.id,'legacy');
  r=await call('store-members/search',{username:'bob'},'admina');assert.equal(r.data.available,false);assert.equal(r.data.transfer,true);
  assert.equal((await call('store-members/add',{username:'bob',transfer:true},'admina')).status,409);
  assert.equal((await call('store-members/add',{username:'free',storeId:'b'},'admina')).status,403);
  assert.equal((await call('members',{id:'bob',role:'staff',active:0},'admina')).status,404);
  assert.equal((await call('store-members/remove',{id:'admina'},'admina')).status,400);
  assert.equal((await call('store-members/remove',{id:'alice'},'admina')).status,200);
  const empty=(await call('state',undefined,'alice')).data;assert.equal(empty.store,null);assert.deepEqual(empty.products,[]);assert.equal(empty.round,null);
  for(const [path,body] of [['reports',undefined],['rounds/start',{}],['lines/save',{id:'anything',status:'off_sale',quantity:0}]])assert.equal((await call(path,body,'alice')).status,403);
  assert.equal((await call('store-members/add',{username:'alice'},'adminb')).status,200);
  assert.equal((await call('report/'+encodeURIComponent(original.id),undefined,'alice')).status,404);
  assert.equal((await call('report/'+encodeURIComponent(original.id),undefined,'admina')).status,200);
  assert.equal((await call('store-members/add',{username:'bob'},'owner','legacy')).status,409);
  assert.equal((await call('store-members/add',{username:'bob',transfer:true},'owner','legacy')).status,200);
  assert.equal((await call('state',undefined,'bob')).data.store.id,'legacy');
  assert.equal((await call('members/create',{username:'new.staff',name:'New',password:'long-new-password-123',role:'staff',storeId:'b'},'admina')).status,403);
  assert.equal((await call('members/create',{username:'new.staff',name:'New',password:'long-new-password-123',role:'staff',storeId:'b'},'owner','all')).status,200);
  await db.prepare("UPDATE members SET store_id=NULL WHERE id='admina'").run();assert.equal((await call('members',undefined,'admina')).status,403);
 }finally{await db.close();}
});
test('per-product timestamps are available to the owner and store admin, and redacted for staff on every read route',async()=>{
 const {db,call,seed}=await fixture();try{
  await seed();const check=(await call('rounds/start',{},'alice')).data;
  assert.equal((await call('lines/save',{id:check.lines[0].id,status:'rotation_issue',quantity:0,revision:0},'alice')).status,200);
  const report='report/'+encodeURIComponent(check.round.id);
  for(const user of ['alice','amy']){
   for(const [path,body] of [['state',undefined],[report,undefined],['rounds/start',{}]]){
    const r=await call(path,body,user);assert.equal(r.status,200);const row=r.data.lines.find(l=>l.id===check.lines[0].id);assert.equal(row.saved_at,null);assert.equal(row.verified_at,null);assert.equal(row.status,'rotation_issue');assert.equal(row.recorded_by_name,'alice');
   }
  }
  const adminTime=(await call(report,undefined,'admina')).data.lines[0].saved_at;assert.ok(Number.isFinite(Date.parse(adminTime)));
  assert.equal((await call(report,undefined,'owner','legacy')).data.lines[0].saved_at,adminTime);
  assert.equal((await call(report,undefined,'owner','all')).data.lines[0].saved_at,adminTime);
  assert.equal((await call(report,undefined,'adminb')).status,404);
  // A historical camera timestamp is private too.
  await db.prepare("UPDATE lines SET verified_at='2026-10-01T08:00:00Z' WHERE id=?").bind(check.lines[0].id).run();
  assert.equal((await call(report,undefined,'alice')).data.lines[0].verified_at,null);
  assert.equal((await call(report,undefined,'admina')).data.lines[0].verified_at,'2026-10-01T08:00:00Z');
  await db.prepare("INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) VALUES('private-time',?,?,?)").bind(check.lines[0].id,date(),new Date().toISOString()).run();
  assert.equal((await call('rotation-rechecks/save',{id:'private-time',status:'okay'},'amy')).status,200);
  const staff=(await call('rotation-rechecks?view=history',undefined,'alice')).data.rechecks[0];assert.equal(staff.checked_at,null);assert.equal(staff.verified_at,null);assert.equal(staff.created,null);assert.equal(staff.status,'okay');assert.equal(staff.checked_by_name,'amy');
  for(const [user,scope] of [['admina',undefined],['owner','legacy'],['owner','all']])assert.ok((await call('rotation-rechecks?view=history',undefined,user,scope)).data.rechecks[0].checked_at);
  assert.equal((await call('rotation-rechecks?view=history',undefined,'adminb')).data.total,0);
 }finally{await db.close();}
});
test('CSV imports require the protected owner ID; store admins retain individual catalogue editing',async()=>{
 const {db,call}=await fixture();try{
  const items=[{name:'Bread',plu:'001234',section:'Bread',risk:'normal'},{name:'Apples',plu:'002345',section:'Ambient produce',risk:'high'}];
  // An administrator named admin is not the protected original owner.
  await db.prepare("UPDATE members SET username='admin' WHERE id='admina'").run();
  for(const user of ['admina','adminb','alice'])for(const rows of [items,items.slice(0,1)])assert.equal((await call('products',{items:rows},user)).status,403);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
  assert.equal((await call('products',{items},'owner','all')).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n,2);
  const bread=(await call('state',undefined,'admina')).data.products.find(p=>p.plu==='001234');
  const changed={id:bread.id,name:'Updated bread',plu:'001234',section:'Bread',risk:'high'};
  assert.equal((await call('products',changed,'admina')).status,200);
  assert.equal((await call('products',{name:'Milk',plu:'003456',section:'Long life'},'adminb')).status,200);
  assert.equal((await call('products',{items:[{...changed,name:'Blocked overwrite'}]},'admina')).status,403);
  assert.equal((await call('state',undefined,'admina')).data.products.find(p=>p.id===bread.id).name,'Updated bread');
  assert.equal((await call('products',{items:[{...changed,name:'Owner update'}]},'owner','legacy')).status,200);
  assert.equal((await call('state')).data.products.find(p=>p.id===bread.id).name,'Owner update');
 }finally{await db.close();}
});
