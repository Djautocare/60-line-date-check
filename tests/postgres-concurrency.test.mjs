import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performanceFixture,seedPerformance} from '../scripts/performance-fixture.mjs';
import {storeTransaction} from '../server/checks.mjs';
import {storeAccess} from '../server/stores.mjs';
const url=process.env.DATECHECK_TEST_DATABASE_URL;
const timeout=(promise)=>Promise.race([promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Concurrent action timed out')),5000);t.unref();})]);

test('PostgreSQL: blocked stores do not block others; shared starts and stale saves remain atomic',{skip:!url},async()=>{
 const f=await performanceFixture(url);const {db,call}=f;let blocker;
 try{
  const stores=await seedPerformance(f,2),[a,b]=stores;
  blocker=await db.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(6030162,hashtext($1))',[a.id]);
  // Store A is blocked deliberately. B must finish while that lock is still held.
  const pending=call('rounds/start',{},a.user);
  const independent=await timeout(call('rounds/start',{},b.user));assert.equal(independent.status,200);assert.equal(independent.data.lines.length,60);
  const ready=await db.pool.query("SELECT COUNT(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted");assert.ok(Number(ready.rows[0].count)>=1);
  await blocker.query('COMMIT');blocker.release();blocker=null;
  const [first,second]=await Promise.all([pending,call('rounds/start',{},a.user)]);
  assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(first.data.round.id,second.data.round.id);
  const id=first.data.lines[0].id;
  const saves=await Promise.all(['okay','off_sale'].map(status=>call('lines/save',{id,status,quantity:0,revision:0},a.user)));
  assert.deepEqual(saves.map(s=>s.status).sort(),[200,409]);
  const record=await db.prepare('SELECT * FROM lines WHERE id=?').bind(id).first();assert.equal(record.revision,1);
  const state=(await call('state?view=daily',undefined,a.user)).data;
  await db.pool.query('UPDATE lines SET status=\'okay\',revision=revision+1 WHERE round_id=$1 AND status IS NULL',[state.round.id]);
  const finishes=await Promise.all([call('rounds/finish',{id:state.round.id},a.user),call('rounds/finish',{id:state.round.id},a.user)]);assert.deepEqual(finishes.map(x=>x.status),[200,200]);
  const completed=(await call('state?view=daily&since='+state.liveVersion,undefined,a.user)).data;assert.equal(completed.sharedCheck.completed,true);assert.ok(completed.round.finished);
  assert.equal((await call('reports/delete',{id:state.round.id},'owner',a.id)).status,200);
  const deleted=(await call('state?view=daily&since='+completed.liveVersion,undefined,a.user)).data;assert.equal(deleted.sharedCheck.reportDeleted,true);assert.equal(deleted.round,null);
 }finally{if(blocker){await blocker.query('ROLLBACK');blocker.release();}await f.close();}
});

test('PostgreSQL: membership changes wait for a running check write, then revoke access',{skip:!url},async()=>{
 const f=await performanceFixture(url);const {db,call}=f;
 let release;
 try{
  const [a]=await seedPerformance(f,1);let ready;const reached=new Promise(resolve=>{ready=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  const write=storeTransaction(db,a.id,async c=>{await storeAccess(c,{id:a.user,role:'staff'},a.id);ready();await gate;});
  await reached;
  let changed=false;const revoke=db.pool.query('UPDATE members SET store_id=NULL WHERE id=$1',[a.user]).then(()=>{changed=true;});
  // A real lock barrier, rather than an arbitrary delay, proves revocation is waiting.
  let waiting=false;for(let i=0;i<100&&!waiting;i++){
   const locks=await db.pool.query("SELECT COUNT(*) FROM pg_stat_activity WHERE query LIKE 'UPDATE members SET store_id=NULL%' AND wait_event_type='Lock'");waiting=Number(locks.rows[0].count)>0;
   if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true);assert.equal(changed,false);release();await write;await revoke;
  assert.equal((await call('rounds/start',{},a.user)).status,403);
 }finally{release?.();await f.close();}
});
