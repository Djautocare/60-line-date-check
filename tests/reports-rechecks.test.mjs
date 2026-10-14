import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';
import {nextDate} from '../shared/report-dates.mjs';
const admin={id:'admin',name:'Admin',username:'admin',role:'admin',active:1};
const staff={id:'staff',name:'Colleague',username:'colleague',role:'staff',active:1};
async function fixture(){
 const engine=new PGlite();await engine.waitReady;
 const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};
 const db=await openDatabase('test',{pool});
 for(const m of [admin,staff])await db.prepare('INSERT INTO members(id,name,username,password_hash,role,created) VALUES(?,?,?,?,?,?)').bind(m.id,m.name,m.username,'unused',m.role,'2026-01-01').run();
 const call=async(path,body,user=admin)=>{const result=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),db,user);return {status:result.status,data:await result.json()};};
 const round=async(id,user,date,mode='daily')=>db.prepare('INSERT INTO rounds(id,user_id,date,mode,started) VALUES(?,?,?,?,?)').bind(id,user.id,date,mode,date+'T12:00:00Z').run();
 return {db,call,round};
}
test('report date and staff filters reach older pages and enforce staff ownership',async()=>{
 const {db,call,round}=await fixture();try{
  for(let i=0;i<125;i++)await round('old'+i,admin,new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
  await round('date-a',admin,'2026-10-13');await round('date-b',staff,'2026-10-13');await round('date-c',staff,'2026-10-14');
  let r=await call('reports');assert.equal(r.status,200);assert.equal(r.data.reports.length,100);assert.equal(r.data.total,128);assert.equal(r.data.checkers.length,2);
  const second=await call('reports?offset=100');assert.equal(second.data.reports.length,28);assert.ok(second.data.reports.every(s=>!r.data.reports.some(f=>s.id===f.id)));
  r=await call('reports?from=2026-10-13&to=2026-10-13');assert.equal(r.data.total,2);assert.ok(r.data.reports.every(x=>x.date==='2026-10-13'));
  r=await call('reports?from=2026-10-13&to=2026-10-14&checkedBy=staff');assert.equal(r.data.total,2);assert.ok(r.data.reports.every(x=>x.user_id==='staff'));
  r=await call('reports?from=2026-10-14&to=2026-10-14&checkedBy=admin');assert.equal(r.data.total,0);assert.equal(r.data.checkers.length,2);
  r=await call('reports',undefined,staff);assert.equal(r.data.total,2);assert.deepEqual(r.data.checkers.map(x=>x.id),['staff']);
  assert.equal((await call('reports?checkedBy=admin',undefined,staff)).status,403);
  assert.equal((await call('reports?from=2026-02-29')).status,400);
  assert.equal((await call('reports?from=2026-10-14&to=2026-10-13')).status,400);
  assert.equal((await call('reports?offset=-1')).status,400);
  assert.equal((await call('reports?checkedBy='+encodeURIComponent("' OR 1=1 --"))).data.total,0);
 }finally{await db.close();}
});
test('rotation follow-ups require a new scan, recur next day, and preserve original reports',async()=>{
 const {db,call,round}=await fixture();try{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await round('daily',admin,today);
  await db.prepare("INSERT INTO lines(id,round_id,name,ean,plu,section,position,status,quantity,verified_at,method) VALUES('flag','daily','Bread','4088600303390','123456','Bread chiller',1,'rotation_issue',0,?,'camera')").bind(new Date().toISOString()).run();
  assert.equal((await call('rounds/finish',{id:'daily'})).status,200);
  assert.equal((await call('rounds/finish',{id:'daily'})).status,200);
  let queue=await call('rotation-rechecks');assert.equal(queue.data.total,0);assert.equal(queue.data.upcoming,1);
  const scheduled=await db.prepare('SELECT * FROM rotation_rechecks').first();assert.equal(scheduled.due_date,nextDate(today));
  assert.equal((await call('rotation-rechecks/verify',{id:scheduled.id,ean:'4088600303390',method:'camera'},staff)).status,400);
  const yesterday=new Date(new Date(today+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  await db.prepare('UPDATE rotation_rechecks SET due_date=?,id=? WHERE id=?').bind(yesterday,'flag:recheck:'+yesterday,scheduled.id).run();
  scheduled.id='flag:recheck:'+yesterday;
  queue=await call('rotation-rechecks',undefined,staff);assert.equal(queue.data.total,1);assert.equal(queue.data.rechecks[0].flagged_by,'Admin');
  assert.equal((await call('rotation-rechecks/save',{id:scheduled.id,status:'okay'},staff)).status,400);
  assert.equal((await call('rotation-rechecks/verify',{id:scheduled.id,ean:'0000000000000',method:'camera'},staff)).status,409);
  assert.equal((await call('rotation-rechecks/verify',{id:scheduled.id,ean:'4088600303390',method:'camera'},staff)).status,200);
  assert.equal((await call('rotation-rechecks/save',{id:scheduled.id,status:'okay'},admin)).status,400);
  assert.equal((await call('rotation-rechecks/save',{id:scheduled.id,status:'rotation_issue',quantity:3},staff)).status,400);
  let saved=await call('rotation-rechecks/save',{id:scheduled.id,status:'rotation_issue'},staff);assert.equal(saved.status,200);assert.equal(saved.data.nextDue,nextDate(today));
  assert.equal((await call('rotation-rechecks/save',{id:scheduled.id,status:'okay'},staff)).status,409);
  let history=await call('rotation-rechecks?view=history');assert.equal(history.data.total,1);assert.equal(history.data.rechecks[0].checked_by_name,'Colleague');assert.equal(history.data.rechecks[0].status,'rotation_issue');
  assert.equal((await call('rotation-rechecks')).data.upcoming,1);
  const followup=await db.prepare('SELECT * FROM rotation_rechecks WHERE status IS NULL').first();
  await db.prepare('UPDATE rotation_rechecks SET due_date=? WHERE id=?').bind(today,followup.id).run();
  assert.equal((await call('rotation-rechecks/verify',{id:followup.id,ean:'4088600303390',method:'manual'},admin)).status,200);
  assert.equal((await call('rotation-rechecks/save',{id:followup.id,status:'okay'},admin)).status,200);
  assert.equal((await call('rotation-rechecks')).data.total,0);assert.equal((await call('rotation-rechecks')).data.upcoming,0);
  history=await call('rotation-rechecks?view=history');assert.equal(history.data.total,2);
  assert.equal((await call('report/daily')).data.lines[0].status,'rotation_issue');assert.equal(Number((await call('reports')).data.reports[0].rotation_issue),1);
  // Practice checks never create real follow-ups.
  await round('practice',admin,today,'practice');
  await db.prepare("INSERT INTO lines(id,round_id,name,ean,plu,section,position,status,quantity,verified_at) VALUES('test-flag','practice','Bread','4088600303390','123456','Bread chiller',1,'rotation_issue',0,?)").bind(new Date().toISOString()).run();
  assert.equal((await call('rounds/finish',{id:'practice'})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rotation_rechecks').first()).n,2);
  assert.equal((await call('rotation-rechecks',undefined,null)).status,401);
 }finally{await db.close();}
});
test('only admins can delete reports and all linked follow-ups are removed atomically',async()=>{
 const {db,call,round}=await fixture();try{
  await round('remove-this',staff,'2026-10-13');await round('keep-this',admin,'2026-10-13');
  await db.prepare("INSERT INTO products(id,name,ean,plu,section) VALUES('catalogue','Bread','4088600303390','123456','Bread chiller')").run();
  await db.prepare("INSERT INTO selections(date,items,created) VALUES('2026-10-13','[]','2026-10-13T12:00:00Z')").run();
  for(const [id,r] of [['remove-line','remove-this'],['keep-line','keep-this']])await db.prepare("INSERT INTO lines(id,round_id,name,ean,plu,section,position,status,quantity,verified_at) VALUES(?,?,'Bread','4088600303390','123456','Bread chiller',1,'rotation_issue',0,'2026-10-13T12:00:00Z')").bind(id,r).run();
  assert.equal((await call('rounds/finish',{id:'remove-this'},staff)).status,200);
  assert.equal((await call('rounds/finish',{id:'keep-this'})).status,200);
  await db.prepare("INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created,status,checked_at,checked_by) VALUES('old-history','remove-line','2026-10-12','2026-10-11T12:00:00Z','okay','2026-10-12T12:00:00Z','admin')").run();
  assert.equal((await call('reports/delete',{id:'remove-this'},staff)).status,403);
  assert.equal((await call('reports/delete',{id:'remove-this'},null)).status,401);
  assert.equal((await call('report/remove-this',undefined,staff)).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rotation_rechecks WHERE origin_line_id='remove-line'").first()).n,2);
  assert.equal((await call('reports/delete',{id:'unknown'})).status,404);
  assert.equal((await call('reports/delete',{id:'remove-this'})).status,200);
  assert.equal((await call('report/remove-this')).status,404);
  assert.equal((await call('reports/delete',{id:'remove-this'})).status,404);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lines WHERE round_id='remove-this'").first()).n,0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rotation_rechecks WHERE origin_line_id='remove-line'").first()).n,0);
  assert.equal((await call('report/keep-this')).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rotation_rechecks WHERE origin_line_id='keep-line'").first()).n,1);
  for(const table of ['products','selections'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM members').first()).n,2);
  // An admin can remove an unfinished check as well.
  await round('unfinished',staff,'2026-10-14');
  assert.equal((await call('reports/delete',{id:'unfinished'})).status,200);
 }finally{await db.close();}
});
