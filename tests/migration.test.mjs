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
  const product=(await engine.query("SELECT * FROM products WHERE id='old-product'")).rows[0];assert.equal(product.risk,'normal');assert.equal(product.plu,'123456');
  const line=(await engine.query("SELECT * FROM lines WHERE id='old-line'")).rows[0];assert.equal(line.status,'not_stickered');assert.equal(line.quantity,2);assert.equal(line.risk,'normal');
  await engine.query("UPDATE lines SET status='rotation_issue',quantity=0 WHERE id='old-line'");
  await engine.query("UPDATE rounds SET finished='2026-10-13T23:30:00Z' WHERE id='old-round'");
  await engine.query('DROP TABLE rotation_rechecks');await engine.query('DELETE FROM schema_migrations WHERE version>=3');
  await openDatabase('test',{pool});
  const recheck=(await engine.query('SELECT * FROM rotation_rechecks')).rows[0];assert.equal(recheck.origin_line_id,'old-line');assert.equal(recheck.due_date,'2026-10-15');
  await openDatabase('test',{pool});assert.equal((await engine.query('SELECT COUNT(*) AS count FROM schema_migrations')).rows[0].count,4);
  assert.equal((await engine.query('SELECT COUNT(*) AS count FROM products')).rows[0].count,1);
 }finally{await engine.close();}
});
