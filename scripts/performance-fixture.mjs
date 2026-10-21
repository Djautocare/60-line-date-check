import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';

// Explicit test URL only: this never reads the application's .env or DATABASE_URL.
// All tables live in a new schema; cleanup drops only that exact generated schema.
export async function performanceFixture(connectionString){
 if(!connectionString)throw new Error('Set DATECHECK_TEST_DATABASE_URL to a disposable PostgreSQL database.');
 const schema='datecheck_test_'+randomUUID().replaceAll('-','');
 const control=new pg.Pool({connectionString,max:2});let pool;
 try{
  await control.query(`CREATE SCHEMA "${schema}"`);
  pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
  const db=await openDatabase('test',{pool});
  const call=async(path,body,user='owner',scope)=>{
   const response=await handle(new Request('http://localhost/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(scope?{'x-store-id':scope}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db,{id:user});
   return {status:response.status,data:await response.json()};
  };
  await db.prepare("INSERT INTO members(id,username,name,role,password_hash,created) VALUES('owner','owner','Test owner','admin','unused',?)").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('owner','owner')").run();
  return {db,call,schema,async close(){await pool.end();await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.end();}};
 }catch(e){if(pool)await pool.end();try{await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await control.end();}throw e;}
}
export async function seedPerformance(fixture,count=116){
 const {db,call}=fixture,created=new Date().toISOString();
 const products=Array.from({length:907},(_,i)=>({name:'Test product '+i,plu:String(100000+i),section:['Bread','Ambient produce','Chilled produce','Short life','Long life'][i%5]}));
 const imported=await call('products',{items:products});if(imported.status!==200)throw new Error(JSON.stringify(imported));
 const stores=Array.from({length:count},(_,i)=>({id:'test-store-'+i,number:String(1000+i),name:'Test store '+i}));
 await db.pool.query(`INSERT INTO stores(id,number,name,created) SELECT x.id,x.number,x.name,$2 FROM jsonb_to_recordset($1::jsonb) AS x(id text,number text,name text)`,[JSON.stringify(stores),created]);
 await db.pool.query(`INSERT INTO members(id,username,name,role,password_hash,created,store_id)
  SELECT 'user-'||x.id,'user-'||x.id,'Test staff '||x.number,'staff','unused',$2,x.id FROM jsonb_to_recordset($1::jsonb) AS x(id text,number text)`,[JSON.stringify(stores),created]);
 return stores.map(s=>({...s,user:'user-'+s.id}));
}
