import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';

test('product history preserves daily snapshots, pagination, store boundaries and timestamp permissions',async t=>{
 const engine=new PGlite();await engine.waitReady;
 const pool={query:(q,a)=>engine.query(q,a),connect:async()=>({query:(q,a)=>engine.query(q,a),release(){}}),end:()=>engine.close()};
 const db=await openDatabase('test',{pool});
 const call=async(path,user='owner',scope,body)=>{
  const r=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(scope?{'x-store-id':scope}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db,user?{id:user}:null);
  return {status:r.status,data:await r.json()};
 };
 try{
  await engine.exec(`INSERT INTO stores(id,number,name,created) VALUES('b','002','Second store','2026-10-01');
   UPDATE stores SET number='001' WHERE id='legacy';
   INSERT INTO members(id,username,name,role,password_hash,created,store_id) VALUES
    ('owner','original-owner','Owner','admin','unused','2026-10-01','legacy'),
    ('admin','admin','Store admin','admin','unused','2026-10-01','legacy'),
    ('staff','staff','Staff member','staff','unused','2026-10-01','legacy'),
    ('bob','bob','Other store staff','staff','unused','2026-10-01','b'),
    ('free','free','Unassigned','staff','unused','2026-10-01',NULL);
   INSERT INTO settings(key,value) VALUES('owner','owner');
   INSERT INTO products(id,name,plu,section) VALUES('p','New potatoes','003456','Ambient produce'),('empty','New bread','000001','Bread');
  `);
  async function line(id,date,status,{store='legacy',mode='daily',product='p',name='Old potatoes',plu='123456',finished=true,quantity=0}={}){
   await engine.query('INSERT INTO rounds(id,user_id,date,mode,store,started,finished,store_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,'staff',date,mode,store,date+'T08:00:00Z',finished?date+'T10:00:00Z':null,store]);
   await engine.query("INSERT INTO lines(id,round_id,product_id,name,plu,ean,section,position,status,quantity,saved_at,recorded_by) VALUES($1,$1,$2,$3,$4,'',$5,1,$6,$7,$8,$9)",[id,product,name,plu,'Old area',status,quantity,status?date+'T09:30:15.000Z':null,status?'staff':null]);
  }
  for(const [i,status] of ['out_of_date','not_stickered','rotation_issue','off_sale','okay',null].entries())await line('a'+i,`2026-10-${String(i+10).padStart(2,'0')}`,status,{quantity:i<2?i+2:0,finished:i!==5});
  await line('other','2026-10-17','out_of_date',{store:'b',name:'Secret store alias'});
  await line('practice','2026-10-18','out_of_date',{mode:'practice'});
  await line('archived','2026-10-09','off_sale',{product:null,plu:'003456',name:'Deleted old product'});
  await line('private-archive','2026-10-08','okay',{product:null,plu:'777777',store:'b',name:'Private archived product'});
  await engine.exec(`INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created,status,checked_at,checked_by) VALUES
   ('q1','a2','2026-10-13','2026-10-12','rotation_issue','2026-10-14T23:10:00Z','staff'),
   ('q2','a2','2026-10-16','2026-10-15','off_sale','2026-10-16T08:10:00Z','admin'),
   ('q3','a2','2099-01-01','2026-10-16',NULL,NULL,NULL);`);

  await t.test('name and PLU searches include linked historical aliases without exposing another store',async()=>{
   for(const q of ['potatoes','POTATO','003456','123456']){
    const r=await call('product-history/search?q='+q,'staff');assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.products.some(p=>p.product_id==='p'&&p.daily_count===6));
   }
   const r=await call('product-history/search?q=003456','staff');assert.equal(r.data.total,2);assert.equal(r.data.products.find(p=>p.archived).daily_count,1);
   assert.equal((await call('product-history/search?q=secret','staff')).data.total,0);
   assert.equal((await call('product-history/search?q=secret','owner','all')).data.products[0].daily_count,7);
   assert.equal((await call('product-history/search?q=private','staff')).data.total,0);
   assert.equal((await call('product-history/search?q=%25','staff')).data.total,0);
   assert.equal((await call('product-history/search?q=_','staff')).data.total,0);
   assert.equal((await call('product-history/search?q='+encodeURIComponent("' OR TRUE --"),'staff')).data.total,0);
  });
  await t.test('daily results, pending selections and follow-ups stay distinct; staff cannot read exact times',async()=>{
   const r=await call('product-history?productId=p','staff');assert.equal(r.status,200,JSON.stringify(r.data));
   assert.deepEqual(r.data.summary,{daily_count:6,first_selected:'2026-10-10',last_selected:'2026-10-15',out_of_date:1,not_stickered:1,rotation_issue:1,off_sale:1,okay:1,pending:1});
   assert.equal(r.data.total,9);assert.ok(r.data.history.every(h=>h.checked_at===null));assert.equal(r.data.product.name,'New potatoes');
   const old=r.data.history.find(h=>h.event_id==='daily:a0');assert.equal(old.name,'Old potatoes');assert.equal(old.plu,'123456');assert.equal(old.section,'Old area');assert.equal(old.quantity,2);assert.equal(old.checked_by_name,'Staff member');
   assert.equal(r.data.history.find(h=>h.event_id==='daily:a5').round_completed,false);
   const overdue=r.data.history.find(h=>h.event_id==='recheck:q1');assert.equal(overdue.event_date,'2026-10-15');assert.equal(overdue.due_date,'2026-10-13');assert.equal(overdue.selection_date,'2026-10-12');
   assert.equal(r.data.history[0].event_id,'recheck:q3');assert.equal(r.data.history.find(h=>h.event_id==='recheck:q2').status,'off_sale');
   const admin=await call('product-history?productId=p','admin');assert.equal(admin.data.history.find(h=>h.event_id==='daily:a0').checked_at,'2026-10-10T09:30:15.000Z');
   const all=await call('product-history?productId=p','owner','all');assert.equal(all.data.summary.daily_count,7);assert.equal(all.data.total,10);assert.ok(all.data.history.some(h=>h.store_number==='002'));
   assert.equal((await call('product-history?productId=p','bob')).data.total,1);
   const empty=await call('product-history?productId=empty','staff');assert.equal(empty.status,200);assert.equal(empty.data.summary.daily_count,0);assert.deepEqual(empty.data.history,[]);
   const archived=await call('product-history?plu=003456','staff');assert.equal(archived.data.product.archived,true);assert.equal(archived.data.total,1);assert.equal(archived.data.history[0].name,'Deleted old product');
   assert.equal((await call('product-history?plu=777777','staff')).status,404);
  });
  await t.test('authorization and input validation apply to both endpoints; batch import remains protected-owner only',async()=>{
   for(const path of ['product-history?productId=p','product-history/search?q=potato']){
    assert.equal((await call(path,null)).status,401);assert.equal((await call(path,'free')).status,403);
    for(const scope of ['b','all'])assert.equal((await call(path,'admin',scope)).status,403);
    assert.equal((await call(path,'staff','b')).status,403);
   }
   for(const path of ['product-history','product-history?productId=p&plu=003456','product-history?plu=123','product-history/search?q=','product-history/search?q='+('a'.repeat(161)),'product-history?productId=p&offset=-1','product-history/search?q=p&offset=1.5'])assert.equal((await call(path)).status,400,path);
   assert.equal((await call('product-history?productId=missing')).status,404);
   const body={items:[{plu:'111111',name:'Import attempt',section:'Bread'}]};assert.equal((await call('products','admin',undefined,body)).status,403);
   assert.equal((await call('products','owner',undefined,body)).status,200);
  });
  await t.test('search and history pages have stable ordering, full totals and no duplicates',async()=>{
   await engine.exec(`INSERT INTO products(id,name,plu,section) SELECT 'paged-'||i,'Paged product '||i,LPAD((900000+i)::text,6,'0'),'Bread' FROM generate_series(1,28) i;
    INSERT INTO rounds(id,user_id,date,mode,store,started,finished,store_id) VALUES('pages','staff','2026-10-19','daily','First','2026-10-19T08:00:00Z',NULL,'legacy');
    INSERT INTO lines(id,round_id,product_id,name,plu,ean,section,position,status,quantity,saved_at,recorded_by)
     SELECT 'paged-line-'||i,'pages','p','New potatoes','003456','','Ambient produce',i,'okay',0,'2026-10-19T08:01:00Z','staff' FROM generate_series(1,55) i;`);
   const first=(await call('product-history/search?q=Paged','staff')).data,second=(await call('product-history/search?q=Paged&offset=25','staff')).data;
   assert.equal(first.total,28);assert.equal(first.products.length,25);assert.equal(second.products.length,3);assert.equal(new Set([...first.products,...second.products].map(p=>p.product_id)).size,28);
   const a=(await call('product-history?productId=p','staff')).data,b=(await call('product-history?productId=p&offset=50','staff')).data;
   assert.equal(a.total,64);assert.equal(a.history.length,50);assert.equal(b.history.length,14);assert.equal(new Set([...a.history,...b.history].map(h=>h.event_id)).size,64);
   assert.deepEqual((await call('product-history?productId=p','staff')).data.history,a.history);
  });
 }finally{await db.close();}
});
