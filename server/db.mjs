import pg from 'pg';
import { readFileSync } from 'node:fs';
export function sqlForPostgres(sql){let query=sql.replace(/INSERT OR IGNORE INTO/g,'INSERT INTO');if(sql.includes('INSERT OR IGNORE INTO'))query+=' ON CONFLICT DO NOTHING';let i=0;return query.replace(/\?/g,()=>`$${++i}`);}
export async function openDatabase(connection,options={}){
 const pool=options.pool||new pg.Pool({...(typeof connection==='string'?{connectionString:connection}:connection),max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(6030160)");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
  const migrations=[{version:1,file:'./schema.sql'},{version:2,file:'./migrations/002_risk_and_rotation.sql'},{version:3,file:'./migrations/003_rotation_rechecks.sql'},{version:4,file:'./migrations/004_off_sale.sql'},{version:5,file:'./migrations/005_barcode_learning.sql'},{version:6,file:'./migrations/006_stores.sql'},{version:7,file:'./migrations/007_no_ean.sql'},{version:8,file:'./migrations/008_product_checks.sql'},{version:9,file:'./migrations/009_last_login.sql'},{version:10,file:'./migrations/010_product_history.sql'}];
  for(const migration of migrations){
   const applied=await client.query('SELECT version FROM schema_migrations WHERE version=$1',[migration.version]);
   if(applied.rows.length)continue;
   for(const statement of readFileSync(new URL(migration.file,import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await client.query(statement);
   await client.query('INSERT INTO schema_migrations(version,applied_at) VALUES ($1,$2)',[migration.version,new Date().toISOString()]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return {pool,async close(){await pool.end();},prepare(sql){const query=sqlForPostgres(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return (await pool.query(query,args)).rows[0]||null;},async all(){return {results:(await pool.query(query,args)).rows};},async run(){return pool.query(query,args);},async execute(client){return client.query(query,args);}};},async batch(statements){const client=await pool.connect();try{await client.query('BEGIN');const results=[];for(const s of statements)results.push(await s.execute(client));await client.query('COMMIT');return results;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
}
