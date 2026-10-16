import {validEAN13} from './ean.mjs';
export class BarcodeProblem extends Error {constructor(status,message,details={}){super(message);this.status=status;this.details=details;}}
const must=(ok,msg,status=400,details={})=>{if(!ok)throw new BarcodeProblem(status,msg,details);};
const now=()=>new Date().toISOString();
export async function barcodeTransaction(db,fn){const c=await db.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(6030161)');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const one=async(c,sql,args=[]) => (await c.query(sql,args)).rows[0]||null;
export async function barcodeOwner(c,ean){return one(c,`SELECT p.* FROM products p WHERE p.id=(SELECT product_id FROM product_barcodes WHERE ean=$1) OR p.ean=$1 ORDER BY p.id LIMIT 1`,[ean]);}
export async function approvedBarcodes(c,id){return (await c.query(`SELECT ean FROM product_barcodes WHERE product_id=$1 UNION SELECT ean FROM products WHERE id=$1 AND ean IS NOT NULL AND ean<>'' ORDER BY ean`,[id])).rows.map(r=>r.ean);}
async function approve(c,ean,productId,user,source){
 const owner=await barcodeOwner(c,ean);must(!owner||owner.id===productId,`This EAN belongs to ${owner?.name} (PLU ${owner?.plu}).`,409,{code:'wrong_product',product:owner});
 await c.query(`INSERT INTO product_barcodes(ean,product_id,confirmed_at,confirmed_by,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ean) DO NOTHING`,[ean,productId,now(),user.id,source]);
 await c.query(`UPDATE products SET ean=COALESCE(NULLIF(ean,''),$1) WHERE id=$2`,[ean,productId]);
 await c.query(`UPDATE barcode_candidates SET requires_review=1 WHERE product_id=$1 AND ean<>$2 AND status='pending'`,[productId,ean]);
 await c.query(`UPDATE barcode_candidates SET status=CASE WHEN product_id=$2 THEN 'approved' ELSE 'denied' END,updated=$3,resolved_by=$4 WHERE ean=$1 AND (status='pending' OR product_id=$2)`,[ean,productId,now(),user.id]);
}
export async function verifyBarcode(c,{productId,snapshotEan,ean,user,method,confirmUnknown,practice=false}){
 must(validEAN13(ean),'Enter a valid EAN-13 barcode.');must(['camera','photo','manual'].includes(method),'Invalid scan method.');
 const product=productId?await one(c,'SELECT * FROM products WHERE id=$1',[productId]):null;
 const owner=await barcodeOwner(c,ean);
 if(owner&&owner.id!==product?.id)return {verified:false,code:'wrong_product',error:`Wrong product: ${owner.name} · PLU ${owner.plu}`,product:{id:owner.id,name:owner.name,plu:owner.plu,section:owner.section}};
 if(owner)return {verified:true,learning:false,candidateId:null};
 if(!product){must(ean===snapshotEan,'This catalogue line was removed. Scan its original barcode or ask an administrator.',409);return {verified:true,learning:false,candidateId:null};}
 const hasApproved=(await approvedBarcodes(c,product.id)).length>0;
 let candidate=await one(c,'SELECT * FROM barcode_candidates WHERE ean=$1 AND product_id=$2',[ean,product.id]);
 if(candidate?.status==='denied')return {verified:false,denied:true,message:'This proposed link was denied. Ask an administrator to check the assignment.'};
 if(!candidate&&!practice){candidate=await one(c,`INSERT INTO barcode_candidates(id,ean,product_id,requires_review,created,updated) VALUES($1,$2,$3,$4,$5,$5) RETURNING *`,[crypto.randomUUID(),ean,product.id,hasApproved?1:0,now()]);}
 const count=candidate?Number((await one(c,'SELECT COUNT(*) AS n FROM barcode_observations WHERE candidate_id=$1',[candidate.id])).n):0;
 if(!confirmUnknown)return {verified:false,needsConfirmation:true,ean,product:{id:product.id,name:product.name,plu:product.plu,section:product.section},mixedCase:hasApproved,observations:count,message:hasApproved?'Unknown variant: confirm the pack matches this PLU. An admin will review the proposed mixed-case link.':'New barcode: confirm the pack matches this PLU before recording the dates.'};
 return {verified:true,learning:true,candidateId:candidate?.id||null,mixedCase:hasApproved,observations:count,practice};
}
export async function observeBarcode(c,line,round,user){
 if(!line.barcode_candidate_id||round.mode!=='daily'||line.method==='no_ean')return null;
 const candidate=await one(c,'SELECT * FROM barcode_candidates WHERE id=$1',[line.barcode_candidate_id]);
 if(!candidate||candidate.status!=='pending')return null;
 await c.query(`INSERT INTO barcode_observations(candidate_id,round_id,observed_by,observed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[candidate.id,round.id,line.recorded_by||user.id,now()]);
 const count=Number((await one(c,'SELECT COUNT(*) AS n FROM barcode_observations WHERE candidate_id=$1',[candidate.id])).n);
 const competing=await one(c,`SELECT id FROM barcode_candidates WHERE ean=$1 AND product_id<>$2 AND status='pending' LIMIT 1`,[candidate.ean,candidate.product_id]);
 let confirmed=false;
 if(count>=4&&!candidate.requires_review&&!competing&&!(await approvedBarcodes(c,candidate.product_id)).length&&!await barcodeOwner(c,candidate.ean)){
  await approve(c,candidate.ean,candidate.product_id,user,'four_checks');confirmed=true;
 }
 return {observations:count,confirmed};
}
export async function barcodeAdmin(path,body,params,db,user){
 must(user.role==='admin','Administrator access is required.',403);
 return barcodeTransaction(db,async c=>{
  if(path==='barcode-reviews'){
   const offset=Number(params.get('offset')||0);must(Number.isInteger(offset)&&offset>=0&&offset<1000000,'Invalid review page.');
   const rows=await c.query(`SELECT b.*,p.name,p.plu,p.section,(SELECT COUNT(*) FROM barcode_observations o WHERE o.candidate_id=b.id) AS observations FROM barcode_candidates b JOIN products p ON p.id=b.product_id WHERE b.status='pending' ORDER BY b.created,b.id LIMIT 100 OFFSET $1`,[offset]);
   return {reviews:rows.rows,total:Number((await one(c,"SELECT COUNT(*) AS n FROM barcode_candidates WHERE status='pending'")).n),offset,limit:100};
  }
  if(path==='products/by-plu'){const plu=String(body.plu||'').trim();must(/^\d{6}$/.test(plu),'Enter a 6-digit PLU.');return {products:(await c.query('SELECT * FROM products WHERE plu=$1 ORDER BY section,name',[plu])).rows};}
  if(path==='barcodes/lookup'){
   const ean=String(body.ean||'');must(validEAN13(ean),'Enter a valid EAN-13 barcode.');const product=await barcodeOwner(c,ean);
   const reviews=await c.query(`SELECT b.*,p.name,p.plu,p.section,(SELECT COUNT(*) FROM barcode_observations o WHERE o.candidate_id=b.id) AS observations FROM barcode_candidates b JOIN products p ON p.id=b.product_id WHERE b.ean=$1 AND b.status='pending' ORDER BY b.created`,[ean]);
   return {ean,product,reviews:reviews.rows,barcodes:product?await approvedBarcodes(c,product.id):[]};
  }
  if(path==='barcode-reviews/resolve'){
   must(['confirm','deny'].includes(body.decision),'Choose Confirm or Deny.');
   const candidate=await one(c,'SELECT * FROM barcode_candidates WHERE id=$1',[String(body.id||'')]);must(candidate,'Review not found.',404);must(candidate.status==='pending','This review has already been resolved.',409);
   if(body.decision==='confirm')await approve(c,candidate.ean,candidate.product_id,user,'admin_review');
   else await c.query("UPDATE barcode_candidates SET status='denied',updated=$1,resolved_by=$2 WHERE id=$3",[now(),user.id,candidate.id]);
   return {ok:true};
  }
  if(path==='barcodes/assign'){
   const ean=String(body.ean||'');must(validEAN13(ean),'Enter a valid EAN-13 barcode.');
   must(Boolean(body.productId)!==Boolean(body.referenceEan),'Choose a product or scan a confirmed reference variant.');
   let product;if(body.referenceEan){must(validEAN13(String(body.referenceEan)),'Scan a valid reference EAN.');product=await barcodeOwner(c,String(body.referenceEan));must(product,'The reference variant has no confirmed product. Use the PLU instead.');}
   else product=await one(c,'SELECT * FROM products WHERE id=$1',[String(body.productId)]);
   must(product,'Product not found.',404);await approve(c,ean,product.id,user,'admin_assignment');return {ok:true,product};
  }
 });
}
export async function importCatalogue(db,body,user){
 const items=Array.isArray(body.items)?body.items:[body];must(items.length>0&&items.length<=2000,'Import between 1 and 2,000 products.');
 const clean=items.map(p=>({id:p.id?String(p.id):null,name:String(p.name||'').trim(),plu:String(p.plu||'').trim(),section:String(p.section||p.area||'').trim(),risk:p.risk===undefined?null:String(p.risk)}));
 for(const p of clean){must(p.name.length>0&&p.name.length<=160,'Every product needs a name of up to 160 characters.');must(/^\d{6}$/.test(p.plu),'Every product needs a 6-digit PLU. Keep leading zeros.');must(p.section.length>0&&p.section.length<=80,'Every product needs an area of up to 80 characters.');must(p.risk===null||['high','normal','low'].includes(p.risk),'Choose High risk, Normal or Low risk.');}
 must(new Set(clean.map(p=>p.plu)).size===clean.length,'Your import contains duplicate PLUs. Review these rows first.');
 return barcodeTransaction(db,async c=>{
  if(Object.hasOwn(body,'items')){const owner=await one(c,"SELECT id FROM members WHERE id=$1 AND active=1 AND role='admin' AND id=(SELECT value FROM settings WHERE key='owner')",[user.id]);must(owner,'Only the protected original owner can import CSV products.',403);}
  for(const p of clean){
   let existing=p.id?await one(c,'SELECT * FROM products WHERE id=$1',[p.id]):null;
   if(p.id)must(existing,'Product not found.',404);
   if(!p.id){const matches=(await c.query('SELECT * FROM products WHERE plu=$1',[p.plu])).rows;must(matches.length<=1,`PLU ${p.plu} already has several catalogue products. Edit those individually before importing.`);existing=matches[0];}
   const id=existing?.id||crypto.randomUUID();
   const duplicate=await one(c,'SELECT id FROM products WHERE plu=$1 AND id<>$2 LIMIT 1',[p.plu,id]);must(!duplicate,`PLU ${p.plu} already belongs to another product. Edit that product or choose a different PLU.`,409);
   if(existing)await c.query('UPDATE products SET name=$1,plu=$2,section=$3,risk=COALESCE($4,risk) WHERE id=$5',[p.name,p.plu,p.section,p.risk,id]);
   else await c.query("INSERT INTO products(id,name,plu,ean,section,risk) VALUES($1,$2,$3,NULL,$4,COALESCE($5,'normal'))",[id,p.name,p.plu,p.section,p.risk]);
  }
  return {ok:true,count:clean.length};
 });
}
