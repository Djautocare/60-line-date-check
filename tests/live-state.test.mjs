import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';

test('compact refreshes skip the catalogue, detect shared changes and keep staff timestamps private',async()=>{
 const engine=new PGlite();await engine.waitReady;
 const queries=[];const query=(q,a)=>{queries.push(q);return engine.query(q,a);};
 const db=await openDatabase('test',{pool:{query,connect:async()=>({query,release(){}}),end:()=>engine.close()}});
 const call=async(path,body,user='staff',scope)=>{
  const response=await handle(new Request('http://localhost/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(scope?{'x-store-id':scope}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db,{id:user});
  return {status:response.status,data:await response.json()};
 };
 try{
  for(const [id,role] of [['owner','admin'],['staff','staff']])await db.prepare('INSERT INTO members(id,username,name,role,password_hash,created) VALUES(?,?,?,?,?,?)').bind(id,id,id,role,'unused','2026-01-01').run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('owner','owner')").run();
  await call('products',{items:Array.from({length:900},(_,i)=>({name:'Catalogue product '+i,plu:String(100000+i),section:'Bread'}))},'owner');
  const initial=(await call('state')).data;assert.equal(initial.products.length,900);
  let compact=(await call('state?view=daily')).data;assert.equal(compact.round,null);assert.ok(compact.liveVersion);assert.equal('products' in compact,false);
  queries.length=0;
  const same=await call('state?view=daily&since='+compact.liveVersion);assert.deepEqual(same.data,{unchanged:true,liveVersion:compact.liveVersion});
  assert.ok(JSON.stringify(same.data).length<120);
  assert.equal(queries.some(q=>/FROM products|SELECT l\.\*|FROM selections/i.test(q)),false);
  queries.length=0;
  const started=await call('rounds/start',{});assert.equal(started.status,200);assert.equal(started.data.lines.length,60);
  assert.equal(queries.filter(q=>q.startsWith('INSERT INTO lines')).length,1);
  compact=(await call('state?view=daily&since='+compact.liveVersion)).data;assert.equal(compact.lines.length,60);assert.equal('products' in compact,false);
  const version=compact.liveVersion,line=compact.lines[0];
  assert.equal((await call('lines/save',{id:line.id,status:'rotation_issue',quantity:0,revision:0})).status,200);
  compact=(await call('state?view=daily&since='+version)).data;
  assert.notEqual(compact.liveVersion,version);assert.equal(compact.lines[0].status,'rotation_issue');assert.equal(compact.lines[0].saved_at,null);
  assert.equal((await call('state?view=daily&since='+compact.liveVersion)).data.unchanged,true);
  const owner=(await call('state?view=daily&since='+compact.liveVersion,undefined,'owner')).data;
  assert.ok(owner.lines[0].saved_at);assert.notEqual(owner.liveVersion,compact.liveVersion);
  assert.equal((await call('state?view=daily&since='+version,undefined,'staff','other')).status,403);
  assert.equal((await call('state?view=daily&since=bad')).status,400);
  const regenerated=await call('selection/regenerate',{storeId:'legacy',date:compact.date,roundId:compact.round.id,confirm:true},'owner');assert.equal(regenerated.status,200);
  const next=(await call('state?view=daily&since='+compact.liveVersion)).data;
  assert.notEqual(next.round.id,compact.round.id);assert.notEqual(next.liveVersion,compact.liveVersion);
  await db.prepare("UPDATE members SET store_id=NULL WHERE id='staff'").run();
  const removed=(await call('state?view=daily&since='+next.liveVersion)).data;assert.equal(removed.store,null);assert.equal(removed.unchanged,undefined);
 }finally{await db.close();}
});
