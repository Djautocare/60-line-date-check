import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{PGlite}from'@electric-sql/pglite';import{openDatabase}from'../server/db.mjs';
test('migration upgrades an existing catalogue and report without losing their records',async()=>{
 const engine=new PGlite();await engine.waitReady;
 try{
  await engine.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  await engine.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'2026-10-13');");
  await engine.query("INSERT INTO members(id,username,name,password_hash,role,created) VALUES('old-user','olduser','Existing staff','hash','staff','2026-10-13')");
  await engine.query("INSERT INTO products(id,name,plu,ean,section) VALUES('old-product','Existing product','123456','4088600303390','Bread chiller')");
  await engine.query("INSERT INTO rounds(id,user_id,date,started) VALUES('old-round','old-user','2026-10-13','2026-10-13')");
  await engine.query("INSERT INTO lines(id,round_id,name,plu,ean,section,position,status,quantity) VALUES('old-line','old-round','Existing product','123456','4088600303390','Bread chiller',1,'not_stickered',2)");
  const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};
  await openDatabase('test',{pool});
  const product=(await engine.query("SELECT * FROM products WHERE id='old-product'")).rows[0];assert.equal(product.risk,'normal');assert.equal(product.plu,'123456');assert.equal((await engine.query("SELECT product_id FROM product_barcodes WHERE ean='4088600303390'")).rows[0].product_id,'old-product');
  const line=(await engine.query("SELECT * FROM lines WHERE id='old-line'")).rows[0];assert.equal(line.status,'not_stickered');assert.equal(line.quantity,2);assert.equal(line.risk,'normal');assert.equal(line.product_id,'old-product');
  await engine.query("UPDATE lines SET status='rotation_issue',quantity=0 WHERE id='old-line'");
  await engine.query("UPDATE rounds SET finished='2026-10-13T23:30:00Z' WHERE id='old-round'");
  await engine.exec('DROP TABLE store_daily_checks; ALTER TABLE lines DROP COLUMN verified_by, DROP COLUMN recorded_by, DROP COLUMN revision; ALTER TABLE rounds DROP COLUMN finished_by, DROP COLUMN store_id; ALTER TABLE members DROP COLUMN store_id; ALTER TABLE selections DROP COLUMN store_id CASCADE; ALTER TABLE selections ADD PRIMARY KEY(date); DROP TABLE stores;');
  await engine.query('ALTER TABLE lines DROP COLUMN barcode_candidate_id');await engine.query('ALTER TABLE lines DROP COLUMN product_id');await engine.query('DROP TABLE barcode_observations');await engine.query('DROP TABLE barcode_candidates');await engine.query('DROP TABLE product_barcodes');await engine.query('DROP TABLE rotation_rechecks');await engine.query('DELETE FROM schema_migrations WHERE version>=3');
  await openDatabase('test',{pool});
  const recheck=(await engine.query('SELECT * FROM rotation_rechecks')).rows[0];assert.equal(recheck.origin_line_id,'old-line');assert.equal(recheck.due_date,'2026-10-15');
  await openDatabase('test',{pool});assert.equal((await engine.query('SELECT COUNT(*) AS count FROM schema_migrations')).rows[0].count,7);
  assert.equal((await engine.query('SELECT COUNT(*) AS count FROM products')).rows[0].count,1);
 }finally{await engine.close();}
});
test('store upgrade preserves the original owner and all old reports, choosing an already completed shared day',async()=>{
 const engine=new PGlite();await engine.waitReady;
 try{
  for(const file of ['schema.sql','migrations/002_risk_and_rotation.sql','migrations/003_rotation_rechecks.sql','migrations/004_off_sale.sql','migrations/005_barcode_learning.sql'])await engine.exec(readFileSync(new URL('../server/'+file,import.meta.url),'utf8'));
  await engine.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations SELECT i,'2026-10-01' FROM generate_series(1,5) i;");
  for(const [id,created] of [['original-owner','2026-10-02'],['another-admin','2026-10-01']])await engine.query("INSERT INTO members(id,username,name,password_hash,role,created) VALUES($1,$1,$1,'hash','admin',$2)",[id,created]);
  await engine.query("INSERT INTO settings(key,value) VALUES('owner','original-owner')");
  for(const [id,finished,started] of [['unfinished',null,'2026-10-13T08:00:00Z'],['completed','2026-10-13T10:00:00Z','2026-10-13T09:00:00Z']]){
   await engine.query("INSERT INTO rounds(id,user_id,date,mode,started,finished,store) VALUES($1,'another-admin','2026-10-13','daily',$2,$3,'Old location')",[id,started,finished]);
   await engine.query("INSERT INTO lines(id,round_id,name,plu,ean,section,position,status,verified_at) VALUES($1,$2,'Bread','123456','4088600303390','Bread',1,'okay','2026-10-13T09:30:00Z')",[id+'-line',id]);
  }
  await engine.query("INSERT INTO selections(date,items,created) VALUES('2026-10-13','[]','2026-10-13')");
  const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};await openDatabase('test',{pool});
  assert.equal((await engine.query("SELECT value FROM settings WHERE key='owner'")).rows[0].value,'original-owner');
  const shared=(await engine.query('SELECT * FROM store_daily_checks')).rows[0];assert.equal(shared.store_id,'legacy');assert.equal(shared.round_id,'completed');assert.ok(shared.completed_at);
  assert.equal((await engine.query('SELECT COUNT(*) AS n FROM rounds')).rows[0].n,2);assert.equal((await engine.query('SELECT COUNT(*) AS n FROM lines')).rows[0].n,2);
  const line=(await engine.query("SELECT * FROM lines WHERE id='completed-line'")).rows[0];assert.equal(line.recorded_by,'another-admin');assert.equal(line.verified_by,'another-admin');
  assert.equal((await engine.query('SELECT store_id FROM selections')).rows[0].store_id,'legacy');assert.ok((await engine.query('SELECT * FROM members')).rows.every(m=>m.store_id==='legacy'));
  await openDatabase('test',{pool});assert.equal((await engine.query('SELECT COUNT(*) AS n FROM store_daily_checks')).rows[0].n,1);
 }finally{await engine.close();}
});
