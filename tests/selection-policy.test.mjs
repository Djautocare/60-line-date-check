import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';
const policy={'Short life':20,'Long life':15,'Ambient produce':10,'Chilled produce':10,Bread:5};
const alternate={'Short life':10,'Long life':20,'Ambient produce':10,'Chilled produce':15,Bread:5};
async function fixture(){
 const engine=new PGlite();await engine.waitReady;const pool={query:(q,a)=>engine.query(q,a),connect:async()=>({query:(q,a)=>engine.query(q,a),release(){}}),end:()=>engine.close()};const db=await openDatabase('test',{pool});
 await db.prepare("INSERT INTO stores(id,number,name,created) VALUES('b','002','Second','2026-10-01')").run();
 for(const [id,role,store] of [['owner','admin','legacy'],['admina','admin','legacy'],['adminb','admin','b'],['staff','staff','legacy']])await db.prepare('INSERT INTO members(id,username,name,role,password_hash,created,store_id) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,role,'unused','2026-10-01',store).run();
 await db.prepare("INSERT INTO settings(key,value) VALUES('owner','owner')").run();
 const call=async(path,body,user='admina',scope)=>{const r=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(scope?{'x-store-id':scope}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db,{id:user});return {status:r.status,data:await r.json()};};
 const imported=await call('products',{items:Object.keys(policy).flatMap((section,index)=>Array.from({length:30},(_,i)=>({name:section+' '+i,plu:String(100000+index*100+i),section})))},'owner');assert.equal(imported.status,200);
 return {db,call};
}
function assertSplit(lines,counts){assert.equal(lines.length,60);for(const [area,count] of Object.entries(counts))assert.equal(lines.filter(l=>l.section===area).length,count,area);}
test('only the store admin or owner can save a store split, with validated counts',async()=>{
 const {db,call}=await fixture();try{
  assert.equal((await call('state')).data.selectionCounts,null);
  assert.equal((await call('selection-policy',{counts:policy},'staff')).status,403);
  assert.equal((await call('selection-policy',{counts:policy},'admina','b')).status,403);
  assert.equal((await call('selection-policy',{counts:policy},'owner','all')).status,400);
  assert.equal((await call('selection-policy',{storeId:'b',counts:policy})).status,409);
  for(const counts of [undefined,[],{Bread:59},{Bread:60.5},{Missing:60},{Bread:60}])assert.equal((await call('selection-policy',{counts})).status,400);
  let saved=await call('selection-policy',{storeId:'legacy',counts:policy});assert.equal(saved.status,200);assert.equal(saved.data.todayLocked,false);
  assert.deepEqual((await call('state',undefined,'staff')).data.selectionCounts,policy);
  assert.equal((await call('state',undefined,'adminb')).data.selectionCounts,null);
  assert.deepEqual((await call('state',undefined,'owner','legacy')).data.selectionCounts,policy);
  assert.equal((await call('selection-policy',{counts:alternate},'owner','b')).status,200);
  assert.deepEqual((await call('state',undefined,'adminb')).data.selectionCounts,alternate);
  assert.equal((await call('selection-policy',{counts:{Bread:1}})).status,400);
  assert.deepEqual((await call('state')).data.selectionCounts,policy);
  await db.prepare("UPDATE members SET store_id=NULL WHERE id='admina'").run();assert.equal((await call('selection-policy',{counts:policy})).status,403);
 }finally{await db.close();}
});
test('daily picks follow the split; edits and switching back to random preserve today’s saved list',async()=>{
 const {db,call}=await fixture();try{
  assert.equal((await call('selection-policy',{counts:policy})).status,200);
  const started=await call('rounds/start',{},'staff');assert.equal(started.status,200);assertSplit(started.data.lines,policy);
  const same=await call('rounds/start',{});assert.equal(same.data.round.id,started.data.round.id);
  const selection=(await call('state')).data.selection;assertSplit(selection,policy);
  const changed=await call('selection-policy',{counts:alternate});assert.equal(changed.data.todayLocked,true);
  assert.deepEqual((await call('state')).data.selection,selection);
  assert.deepEqual((await call('rounds/start',{})).data.lines.map(l=>l.product_id),started.data.lines.map(l=>l.product_id));
  // Deleting an unfinished report retains that day's selection, even after
  // products are removed and the new policy no longer fits the catalogue.
  assert.equal((await call('reports/delete',{id:started.data.round.id})).status,200);
  await db.prepare('DELETE FROM products WHERE section=?').bind('Long life').run();
  const restarted=await call('rounds/start',{},'staff');assert.equal(restarted.status,200);assertSplit(restarted.data.lines,policy);assert.deepEqual(restarted.data.lines.map(l=>l.plu),started.data.lines.map(l=>l.plu));
  assert.equal((await call('selection-policy',{counts:null})).status,200);
  assert.equal((await call('state')).data.selectionCounts,null);assert.deepEqual((await call('state')).data.selection,selection);
  // A different store has an independent setting and generates its own split.
  const bPolicy={'Short life':20,'Ambient produce':15,'Chilled produce':20,Bread:5};
  assert.equal((await call('selection-policy',{counts:bPolicy},'adminb')).status,200);
  const second=await call('rounds/start',{},'adminb');assert.equal(second.status,200);assertSplit(second.data.lines,bPolicy);
  assert.notEqual(second.data.round.id,started.data.round.id);
 }finally{await db.close();}
});
test('catalogue shortages stop a new daily list safely; practice and existing selections keep working',async()=>{
 const {db,call}=await fixture();try{
  assert.equal((await call('selection-policy',{counts:policy})).status,200);
  await db.prepare('DELETE FROM products WHERE section=? AND plu<>?').bind('Short life','100000').run();
  const failed=await call('rounds/start',{},'staff');assert.equal(failed.status,400);assert.match(failed.data.error,/Short life needs 20 products, but only 1/);
  for(const table of ['rounds','lines','selections','store_daily_checks'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
  assert.equal((await call('selection-policy',{counts:policy})).status,400);
  const practice=await call('rounds/start',{mode:'practice'});assert.equal(practice.status,200);assert.equal(practice.data.lines.length,60);assert.equal(practice.data.round.mode,'practice');
  // Clearing the quota restores the original fully random mode.
  assert.equal((await call('selection-policy',{counts:null})).status,200);
  assert.equal((await call('rounds/start',{},'staff')).status,200);
 }finally{await db.close();}
});
test('regeneration is owner-only, uses saved quotas and rejects stale checks without affecting other work',async()=>{
 const {db,call}=await fixture();try{
  await call('selection-policy',{counts:policy});
  const original=(await call('rounds/start',{},'staff')).data;
  const other=(await call('rounds/start',{},'adminb')).data;
  const practice=(await call('rounds/start',{mode:'practice'})).data;
  await call('lines/save',{id:original.lines[0].id,status:'off_sale',quantity:0,revision:0},'staff');
  const state=(await call('state')).data;
  const body={storeId:'legacy',date:state.date,roundId:original.round.id,confirm:true};
  for(const user of ['admina','adminb','staff'])assert.equal((await call('selection/regenerate',body,user)).status,403);
  assert.equal((await call('selection/regenerate',body,'owner','all')).status,400);
  assert.equal((await call('selection/regenerate',{...body,storeId:'b'},'owner','legacy')).status,409);
  assert.equal((await call('selection/regenerate',{...body,date:'2000-01-01'},'owner','legacy')).status,409);
  assert.equal((await call('selection/regenerate',{...body,confirm:false},'owner','legacy')).status,400);
  assert.equal((await call('selection/regenerate',{...body,roundId:'stale'},'owner','legacy')).status,409);
  await call('selection-policy',{counts:alternate});
  assert.equal((await call('selection/regenerate',body,'owner','legacy')).status,200);
  const replaced=(await call('state',undefined,'staff')).data;assertSplit(replaced.lines,alternate);assertSplit(replaced.selection,alternate);
  assert.notEqual(replaced.round.id,original.round.id);assert.equal(replaced.sharedCheck.roundId,replaced.round.id);assert.equal(replaced.sharedCheck.completed,false);
  assert.ok(replaced.lines.every(l=>l.status===null&&l.verified_at===null&&l.revision===0));
  assert.equal((await call('report/'+original.round.id)).status,404);
  assert.equal((await call('lines/save',{id:original.lines[0].id,status:'off_sale',quantity:0},'staff')).status,404);
  assert.equal((await call('rounds/finish',{id:original.round.id},'staff')).status,404);
  assert.equal((await call('selection/regenerate',body,'owner','legacy')).status,409);
  assert.equal((await call('rounds/start',{},'staff')).data.round.id,replaced.round.id);
  assert.equal((await call('report/'+other.round.id,undefined,'adminb')).status,200);
  assert.equal((await call('report/'+practice.round.id)).status,200);
 }finally{await db.close();}
});
test('regeneration reopens completed checks, removes their rechecks and evidence, and supports deleted reports',async()=>{
 const {db,call}=await fixture();try{
  await call('selection-policy',{counts:policy});const original=(await call('rounds/start',{},'staff')).data;
  const first=original.lines[0];
  assert.equal((await call('lines/save',{id:first.id,status:'rotation_issue',quantity:0},'staff')).status,200);
  for(const l of original.lines.slice(1))assert.equal((await call('lines/save',{id:l.id,status:'off_sale',quantity:0},'staff')).status,200);
  assert.equal((await call('rounds/finish',{id:original.round.id},'staff')).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rotation_rechecks').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
  const before=(await call('state')).data;assert.equal(before.sharedCheck.completed,true);
  const body={storeId:'legacy',date:before.date,roundId:original.round.id,confirm:true};
  assert.equal((await call('selection/regenerate',body,'owner','legacy')).status,200);
  const after=(await call('state')).data;assert.equal(after.sharedCheck.completed,false);assert.equal(after.round.finished,null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rotation_rechecks').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
  // A completed check whose report was deleted is still an explicit owner reset.
  await db.prepare('UPDATE rounds SET finished=? WHERE id=?').bind(new Date().toISOString(),after.round.id).run();
  await db.prepare('UPDATE store_daily_checks SET completed_at=? WHERE round_id=?').bind(new Date().toISOString(),after.round.id).run();
  assert.equal((await call('reports/delete',{id:after.round.id})).status,200);
  assert.equal((await call('rounds/start',{},'staff')).status,409);
  assert.equal((await call('selection/regenerate',{...body,roundId:null},'owner','legacy')).status,200);
  assert.equal((await call('rounds/start',{},'staff')).status,200);
 }finally{await db.close();}
});
test('a failed regeneration leaves today’s list and recorded results intact',async()=>{
 const {db,call}=await fixture();try{
  const state=(await call('state')).data;
  const body={storeId:'legacy',date:state.date,roundId:null,confirm:true};
  assert.equal((await call('selection/regenerate',body,'owner','legacy')).status,409);
  await call('selection-policy',{counts:policy});const original=(await call('rounds/start',{},'staff')).data;
  await call('lines/save',{id:original.lines[0].id,status:'off_sale',quantity:0},'staff');
  await db.prepare('DELETE FROM products WHERE section=? AND plu<>?').bind('Short life','100000').run();
  const failed=await call('selection/regenerate',{...body,roundId:original.round.id},'owner','legacy');assert.equal(failed.status,400);assert.match(failed.data.error,/Short life needs 20/);
  const after=(await call('state')).data;assert.equal(after.round.id,original.round.id);assert.equal(after.lines[0].status,'off_sale');assertSplit(after.selection,policy);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rounds').first()).n,1);
 }finally{await db.close();}
});
