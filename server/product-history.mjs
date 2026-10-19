import {BarcodeProblem} from './barcodes.mjs';
const must=(ok,message,status=400)=>{if(!ok)throw new BarcodeProblem(status,message);};
const paging=params=>{const raw=params.get('offset')||'0';must(/^\d{1,9}$/.test(raw),'Invalid history page.');return Number(raw);};
export async function productHistory(db,user,scope,path,params,today){
 const offset=paging(params);
 if(path==='product-history/search'){
  const q=(params.get('q')||'').trim();must(q.length>0&&q.length<=160,'Enter a product name or PLU, up to 160 characters.');
  const limit=25,args=[scope,q];
  const cte=`WITH visible AS (
   SELECT l.*,r.date FROM lines l JOIN rounds r ON r.id=l.round_id WHERE r.mode='daily' AND ($1::text IS NULL OR r.store_id=$1)
  ), candidates AS (
   SELECT p.id AS product_id,p.plu,p.name,p.section,FALSE AS archived,
    (SELECT COUNT(*)::int FROM visible v WHERE v.product_id=p.id) AS daily_count,
    (SELECT MAX(v.date) FROM visible v WHERE v.product_id=p.id) AS last_selected
   FROM products p WHERE strpos(lower(p.name),lower($2))>0 OR strpos(p.plu,$2)>0 OR EXISTS(
    SELECT 1 FROM visible v WHERE v.product_id=p.id AND (strpos(lower(v.name),lower($2))>0 OR strpos(v.plu,$2)>0))
   UNION ALL
   SELECT NULL::text,v.plu,v.name,v.section,TRUE,
    (SELECT COUNT(*)::int FROM visible h WHERE h.product_id IS NULL AND h.plu=v.plu),
    v.date
   FROM (SELECT DISTINCT ON(plu) * FROM visible WHERE product_id IS NULL ORDER BY plu,date DESC,id DESC) v
   WHERE EXISTS(SELECT 1 FROM visible h WHERE h.product_id IS NULL AND h.plu=v.plu AND (strpos(lower(h.name),lower($2))>0 OR strpos(h.plu,$2)>0))
  )`;
  const total=Number((await db.pool.query(cte+' SELECT COUNT(*) AS n FROM candidates',args)).rows[0].n);
  const products=(await db.pool.query(cte+' SELECT * FROM candidates ORDER BY lower(name),plu,product_id NULLS LAST LIMIT $3 OFFSET $4',[...args,limit,offset])).rows;
  return {products,total,offset,limit};
 }
 const productId=params.get('productId')||'',plu=params.get('plu')||'';
 must(Boolean(productId)!==Boolean(plu),'Choose a product to view its history.');
 must(productId.length<=200&&(!plu||/^\d{6}$/.test(plu)),'Choose a valid product or six-digit PLU.');
 const args=[scope,productId||null,plu||null];
 const cte=`WITH matching AS (
  SELECT l.id AS line_id,l.name,l.plu,l.section,l.status,l.quantity,l.saved_at,r.id AS round_id,r.date AS selection_date,r.finished AS round_finished,
   r.store_id,t.number AS store_number,r.store,m.name AS checked_by_name
  FROM lines l JOIN rounds r ON r.id=l.round_id JOIN stores t ON t.id=r.store_id LEFT JOIN members m ON m.id=l.recorded_by
  WHERE r.mode='daily' AND ($1::text IS NULL OR r.store_id=$1) AND
   (($2::text IS NOT NULL AND l.product_id=$2) OR ($2::text IS NULL AND l.product_id IS NULL AND l.plu=$3))
 )`;
 let product;
 if(productId){product=(await db.pool.query('SELECT id AS product_id,plu,name,section,FALSE AS archived FROM products WHERE id=$1',[productId])).rows[0];}
 else product=(await db.pool.query(cte+' SELECT NULL::text AS product_id,plu,name,section,TRUE AS archived FROM matching ORDER BY selection_date DESC,line_id DESC LIMIT 1',args)).rows[0];
 must(product,'Product history not found. Search again to refresh the list.',404);
 const summary=(await db.pool.query(cte+` SELECT COUNT(*)::int AS daily_count,MIN(selection_date) AS first_selected,MAX(selection_date) AS last_selected,
  COUNT(*) FILTER(WHERE status='out_of_date')::int AS out_of_date,COUNT(*) FILTER(WHERE status='not_stickered')::int AS not_stickered,
  COUNT(*) FILTER(WHERE status='rotation_issue')::int AS rotation_issue,COUNT(*) FILTER(WHERE status='off_sale')::int AS off_sale,
  COUNT(*) FILTER(WHERE status='okay')::int AS okay,COUNT(*) FILTER(WHERE status IS NULL)::int AS pending FROM matching`,args)).rows[0];
 const events=cte+`,events AS (
  SELECT 'daily:'||m.line_id AS event_id,'daily'::text AS kind,m.selection_date AS event_date,m.selection_date,NULL::text AS due_date,
   m.name,m.plu,m.section,m.status,m.quantity,m.saved_at AS checked_at,m.checked_by_name,m.round_id,m.round_finished,m.store_id,m.store_number,m.store
  FROM matching m
  UNION ALL
  SELECT 'recheck:'||q.id,'recheck',COALESCE(to_char(q.checked_at::timestamptz AT TIME ZONE 'Europe/London','YYYY-MM-DD'),q.due_date),m.selection_date,q.due_date,
   m.name,m.plu,m.section,q.status,0,q.checked_at,c.name,m.round_id,m.round_finished,m.store_id,m.store_number,m.store
  FROM matching m JOIN rotation_rechecks q ON q.origin_line_id=m.line_id LEFT JOIN members c ON c.id=q.checked_by
 )`;
 const total=Number((await db.pool.query(events+' SELECT COUNT(*) AS n FROM events',args)).rows[0].n),limit=50;
 const history=(await db.pool.query(events+` SELECT event_id,kind,event_date,selection_date,due_date,name,plu,section,status,quantity,
  ${user.role==='admin'?'checked_at':'NULL::text AS checked_at'},checked_by_name,round_id,(round_finished IS NOT NULL) AS round_completed,store_id,store_number,store
  FROM events ORDER BY event_date DESC,kind,event_id LIMIT $4 OFFSET $5`,[...args,limit,offset])).rows;
 return {product,summary,history,total,offset,limit,today};
}
