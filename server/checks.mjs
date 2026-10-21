import {createHash} from 'node:crypto';

// Stores share a check within their store, without queuing behind other stores.
export async function storeTransaction(db,storeId,fn){
 if(!storeId)throw new Error('A store is required for a check transaction.');
 const c=await db.pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(6030162,hashtext($1))',[storeId]);
  const result=await fn(c);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export function liveVersion(member,store,date,sharedCheck,round,lineCount,revision){
 return createHash('sha256').update(JSON.stringify([member,store,date,sharedCheck,round,String(lineCount||0),String(revision||0)])).digest('hex');
}

// One insert replaces the previous round trip for each of the 60 lines.
export async function insertCheckLines(c,roundId,chosen){
 const ids=chosen.map(p=>p.id);
 await c.query('SELECT id FROM products WHERE id=ANY($1::text[]) ORDER BY id FOR KEY SHARE',[ids]);
 const rows=chosen.map((p,i)=>({id:roundId+':'+i,name:p.name,plu:p.plu,ean:p.ean||'',section:p.section,position:i+1,risk:p.risk||'normal',product_id:p.id}));
 await c.query(`INSERT INTO lines(id,round_id,name,ean,plu,section,position,risk,product_id)
  SELECT x.id,$1,x.name,x.ean,x.plu,x.section,x.position,x.risk,p.id
  FROM jsonb_to_recordset($2::jsonb) AS x(id text,name text,ean text,plu text,section text,position integer,risk text,product_id text)
  LEFT JOIN products p ON p.id=x.product_id`,[roundId,JSON.stringify(rows)]);
}
