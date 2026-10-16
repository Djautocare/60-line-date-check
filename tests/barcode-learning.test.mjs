import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';import {handle} from '../server/service.mjs';import {parseCatalogueCSV} from '../src/catalogue-csv.mjs';
const admin={id:'a',name:'Admin',username:'admin',role:'admin',active:1},staff={id:'s',name:'Staff',username:'staff',role:'staff',active:1};
const ean=n=>{const first=String(n).padStart(12,'0');return first+((10-[...first].reduce((s,d,i)=>s+Number(d)*(i%2?3:1),0)%10)%10);};
const A=ean(408860000001),B=ean(408860000002),C=ean(408860000003);
async function setup(){const engine=new PGlite();await engine.waitReady;const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};const db=await openDatabase('test',{pool});for(const u of [admin,staff])await db.prepare('INSERT INTO members(id,name,username,password_hash,role,created) VALUES(?,?,?,?,?,?)').bind(u.id,u.name,u.username,'unused',u.role,'2026-10-15').run();const call=async(path,body,user=admin)=>{const r=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),db,user);return {status:r.status,data:await r.json()};};
 const product=async(plu='001234',name='Apples',ean='')=>{const r=await call('products',{name,plu,section:'Produce',ean});assert.equal(r.status,200,JSON.stringify(r.data));return (await call('state')).data.products.find(p=>p.plu===plu);};
 const line=async(id,p,mode='daily')=>{await db.prepare('INSERT INTO rounds(id,user_id,date,mode,started) VALUES(?,?,?,?,?)').bind(id,staff.id,'2026-10-15',mode,'2026-10-15T12:00:00Z').run();await db.prepare('INSERT INTO lines(id,round_id,product_id,name,plu,ean,section,position) VALUES(?,?,?,?,?,?,?,1)').bind(id+'-line',id,p.id,p.name,p.plu,p.ean||'',p.section).run();return id+'-line';};
 return {db,call,product,line};}
test('area CSV accepts descriptions and no EAN, preserving leading-zero PLUs',()=>{
 assert.deepEqual(parseCatalogueCSV('description,plu\r\n"Apples, red",001234\r\n','Produce Chiller'),[{name:'Apples, red',plu:'001234',ean:'',section:'Produce Chiller'}]);
 assert.equal(parseCatalogueCSV('\ufeffname,plu,area,ean\nBread,000001,Bread,')[0].plu,'000001');assert.throws(()=>parseCatalogueCSV('name,plu\nX,123456'),/area/);assert.throws(()=>parseCatalogueCSV('name,plu,area\n"Bad,123456,Bread'),/quote/);
});
test('PLU imports update existing lines without erasing approved variants and fail atomically',async()=>{const {db,call,product}=await setup();try{
 const p=await product('001234','Apples',A);assert.equal((await call('barcodes/assign',{ean:B,productId:p.id})).status,200);
 assert.equal((await call('products',{items:[{name:'New description',plu:'001234',section:'Produce Chiller'}]})).status,200);
 const rows=(await call('state')).data.products;assert.equal(rows.length,1);assert.equal(rows[0].id,p.id);assert.equal(rows[0].ean,A);assert.equal(rows[0].name,'New description');assert.equal((await call('barcodes/lookup',{ean:B})).data.product.id,p.id);
 assert.equal((await call('products',{items:[{name:'Other',plu:'111111',section:'Bread',ean:C},{name:'Conflict',plu:'222222',section:'Bread',ean:A}]})).status,409);assert.equal((await call('state')).data.products.length,1);
 assert.equal((await call('products',{items:[{name:'Dup',plu:'001234',section:'X'},{name:'Dup2',plu:'001234',section:'X'}]})).status,400);
 assert.equal((await call('products',{name:'No access',plu:'111111',section:'X'},staff)).status,403);
 }finally{await db.close();}});
test('unknown EAN needs explicit confirmation and four completed daily checks, never rescans',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product();for(let i=1;i<=4;i++){
 const id=await line('daily'+i,p);let r=await call('lines/verify',{id,ean:A,method:'camera'},staff);assert.equal(r.status,200);assert.equal(r.data.needsConfirmation,true);assert.equal(r.data.observations,i-1);assert.equal((await call('lines/save',{id,status:'okay',quantity:0},staff)).status,400);
 for(let repeat=0;repeat<3;repeat++)assert.equal((await call('lines/verify',{id,ean:A,method:'camera',confirmUnknown:true},staff)).data.verified,true);
 assert.equal((await call('lines/save',{id,status:'okay',quantity:0},staff)).status,200);assert.equal((await call('barcodes/lookup',{ean:A})).data.product,null);
 assert.equal((await call('rounds/finish',{id:'daily'+i},staff)).status,200);assert.equal((await call('rounds/finish',{id:'daily'+i},staff)).status,200);
 const owner=(await call('barcodes/lookup',{ean:A})).data.product;assert.equal(owner?.id||null,i===4?p.id:null);
 }
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,4);assert.equal((await call('barcode-reviews')).data.total,0);
 }finally{await db.close();}});
test('mixed variants need admin approval; only another confirmed product produces wrong_product',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Mixed peppers',A),other=await product('002345','Bread',C);const id=await line('mixed',p);
 let r=await call('lines/verify',{id,ean:B,method:'camera'},staff);assert.equal(r.status,200);assert.equal(r.data.mixedCase,true);assert.equal(r.data.code,undefined);
 await call('lines/verify',{id,ean:B,method:'camera',confirmUnknown:true},staff);await call('lines/save',{id,status:'okay',quantity:0},staff);await call('rounds/finish',{id:'mixed'},staff);
 r=await call('barcodes/lookup',{ean:B});assert.equal(r.data.product,null);assert.equal(r.data.reviews[0].plu,p.plu);assert.equal(Number(r.data.reviews[0].observations),1);const review=r.data.reviews[0];
 assert.equal((await call('barcode-reviews/resolve',{id:review.id,decision:'confirm'},staff)).status,403);assert.equal((await call('barcode-reviews/resolve',{id:review.id,decision:'confirm'})).status,200);assert.equal((await call('barcode-reviews')).data.total,0);
 const id2=await line('check-variants',p);assert.equal((await call('lines/verify',{id:id2,ean:B,method:'camera'},staff)).data.verified,true);
 r=await call('lines/verify',{id:id2,ean:C,method:'camera',confirmUnknown:true},staff);assert.equal(r.status,409);assert.equal(r.data.code,'wrong_product');assert.equal(r.data.product.id,other.id);assert.equal(r.data.product.name,'Bread');assert.equal((await call('report/check-variants',undefined,staff)).data.lines[0].verified_at,null);assert.equal((await call('lines/save',{id:id2,status:'okay',quantity:0},staff)).status,400);
 assert.equal((await call('barcodes/assign',{ean:C,productId:p.id})).status,409);
 }finally{await db.close();}});
test('scan-to-review supports denial, PLU assignment, reference assignment and pending conflicts',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Bread',A),p2=await product('002345','Apples');const id=await line('denied',p);await call('lines/verify',{id,ean:B,method:'camera'},staff);
 const review=(await call('barcodes/lookup',{ean:B})).data.reviews[0];assert.equal((await call('barcode-reviews/resolve',{id:review.id,decision:'deny'})).status,200);
 const denied=await call('lines/verify',{id,ean:B,method:'camera',confirmUnknown:true},staff);assert.equal(denied.status,200);assert.equal(denied.data.denied,true);assert.equal(denied.data.verified,false);
 const plu=(await call('products/by-plu',{plu:'002345'})).data.products;assert.equal(plu[0].id,p2.id);assert.equal((await call('barcodes/assign',{ean:C,productId:plu[0].id})).status,200);
 assert.equal((await call('barcodes/assign',{ean:B,referenceEan:C})).status,200);assert.equal((await call('barcodes/lookup',{ean:B})).data.product.id,p2.id);
 assert.equal((await call('barcodes/assign',{ean:ean(408860000009),referenceEan:ean(408860000008)})).status,400);
 assert.equal((await call('barcode-reviews',undefined,staff)).status,403);assert.equal((await call('products/by-plu',{plu:'002345'},staff)).status,403);
 }finally{await db.close();}});
test('practice, off sale and abandoned checks do not train; rotation rechecks accept approved variants',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product();const id=await line('practice',p,'practice');await call('lines/verify',{id,ean:A,method:'camera',confirmUnknown:true},staff);await call('lines/save',{id,status:'okay',quantity:0},staff);await call('rounds/finish',{id:'practice'},staff);assert.equal((await call('barcode-reviews')).data.total,0);
 const off=await line('off',p);await call('lines/verify',{id:off,ean:A,method:'camera',confirmUnknown:true},staff);await call('lines/save',{id:off,status:'off_sale',quantity:0},staff);await call('rounds/finish',{id:'off'},staff);
 const abandoned=await line('abandoned',p);await call('lines/verify',{id:abandoned,ean:A,method:'manual',confirmUnknown:true},staff);await call('lines/save',{id:abandoned,status:'okay',quantity:0},staff);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
 await call('barcodes/assign',{ean:A,productId:p.id});await call('barcodes/assign',{ean:B,referenceEan:A});
 await db.prepare("INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) VALUES('q',?,'2000-01-01','2000-01-01')").bind(abandoned).run();assert.equal((await call('rotation-rechecks/verify',{id:'q',ean:B,method:'camera'},staff)).data.verified,true);
 assert.equal((await call('rotation-rechecks/save',{id:'q',status:'okay'},staff)).status,200);assert.equal((await db.prepare("SELECT scanned_ean FROM rotation_rechecks WHERE id='q'").first()).scanned_ean,B);
 }finally{await db.close();}});
test('900 EAN-free lines import by PLU and daily selection remains 60 distinct products',async()=>{const {db,call}=await setup();try{
 const items=Array.from({length:900},(_,i)=>({name:'Paper line '+i,plu:String(i).padStart(6,'0'),section:i<300?'Produce Chiller':i<600?'Bread':'Chiller'}));
 assert.equal((await call('products',{items})).status,200);assert.equal((await call('products',{items:items.slice(0,100)})).status,200);assert.equal((await call('state')).data.products.length,900);
 const daily=await call('rounds/start',{mode:'daily'},staff);assert.equal(daily.status,200);assert.equal(daily.data.lines.length,60);assert.equal(new Set(daily.data.lines.map(l=>l.product_id)).size,60);assert.ok(daily.data.lines.every(l=>l.ean===''));
 }finally{await db.close();}});
test('competing proposals need admin resolution and assignments cannot silently validate another product',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product(),other=await product('002345','Bread');const otherLine=await line('competing',other);await call('lines/verify',{id:otherLine,ean:A,method:'camera',confirmUnknown:true},staff);
 for(let i=0;i<4;i++){const id=await line('trial'+i,p);await call('lines/verify',{id,ean:A,method:'camera',confirmUnknown:true},staff);await call('lines/save',{id,status:'okay',quantity:0},staff);await call('rounds/finish',{id:'trial'+i},staff);}
 let lookup=(await call('barcodes/lookup',{ean:A})).data;assert.equal(lookup.product,null);assert.equal(lookup.reviews.length,2);
 const aReview=lookup.reviews.find(r=>r.product_id===p.id);await call('barcode-reviews/resolve',{id:aReview.id,decision:'confirm'});
 const saved=await call('lines/save',{id:otherLine,status:'okay',quantity:0},staff);assert.equal(saved.status,409);assert.equal(saved.data.code,'wrong_product');assert.equal((await call('barcode-reviews')).data.total,0);
 assert.equal((await call('report/competing',undefined,staff)).data.lines[0].verified_at,null);
 }finally{await db.close();}});
test('finish and rotation save revalidate an EAN assigned after a provisional scan',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product(),other=await product('002345','Bread',C);const id=await line('awaiting-finish',p);
 await call('lines/verify',{id,ean:A,method:'camera',confirmUnknown:true},staff);await call('lines/save',{id,status:'okay',quantity:0},staff);await call('barcodes/assign',{ean:A,productId:other.id});
 let r=await call('rounds/finish',{id:'awaiting-finish'},staff);assert.equal(r.status,409);assert.equal(r.data.code,'wrong_product');const report=(await call('report/awaiting-finish',undefined,staff)).data;assert.equal(report.round.finished,null);assert.equal(report.lines[0].verified_at,null);assert.equal(report.lines[0].status,null);
 const recheckLine=await line('recheck-origin',p);await db.prepare("INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) VALUES('race',?,'2000-01-01','2000-01-01')").bind(recheckLine).run();
 assert.equal((await call('rotation-rechecks/verify',{id:'race',ean:B,method:'camera',confirmUnknown:true},staff)).data.verified,true);await call('barcodes/assign',{ean:B,productId:other.id});
 r=await call('rotation-rechecks/save',{id:'race',status:'okay'},staff);assert.equal(r.status,409);assert.equal(r.data.code,'wrong_product');const q=await db.prepare("SELECT * FROM rotation_rechecks WHERE id='race'").first();assert.equal(q.status,null);assert.equal(q.verified_at,null);
 }finally{await db.close();}});
test('No EAN unlocks inspection with attribution, clears scan evidence and is excluded from barcode learning',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Loose potatoes'),other=await product('002345','Other product');const id=await line('no-ean',p);
 await call('lines/verify',{id,ean:A,method:'camera',confirmUnknown:true},staff);
 const before=(await call('report/no-ean',undefined,staff)).data.lines[0];assert.ok(before.barcode_candidate_id);
 const marked=await call('lines/no-ean',{id,revision:before.revision},staff);assert.equal(marked.status,200);assert.equal(marked.data.method,'no_ean');
 let row=(await call('report/no-ean',undefined,staff)).data.lines[0];assert.equal(row.method,'no_ean');assert.equal(row.ean,'');assert.equal(row.barcode_candidate_id,null);assert.equal(row.verified_by,staff.id);assert.ok(row.verified_at);assert.equal(row.status,null);
 assert.equal((await call('lines/no-ean',{id,revision:before.revision},staff)).status,409);
 assert.equal((await call('lines/save',{id,status:'okay',quantity:0},admin)).status,400);
 assert.equal((await call('lines/save',{id,status:'out_of_date',quantity:0},staff)).status,400);
 // A previous provisional scan does not train or interfere with the no-EAN inspection.
 await call('barcodes/assign',{ean:A,productId:other.id});
 assert.equal((await call('lines/save',{id,status:'out_of_date',quantity:2,revision:marked.data.revision},staff)).status,200);
 assert.equal((await call('rounds/finish',{id:'no-ean'},staff)).status,200);
 row=(await call('report/no-ean',undefined,staff)).data.lines[0];assert.equal(row.status,'out_of_date');assert.equal(row.quantity,2);assert.equal(row.recorded_by,staff.id);assert.equal(row.method,'no_ean');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
 assert.equal((await call('barcodes/lookup',{ean:A})).data.product.id,other.id);
 assert.equal((await call('lines/no-ean',{id},staff)).status,400);
 }finally{await db.close();}});
test('No EAN supports rotation issues and follow-ups without creating barcode candidates',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Loose potatoes');const id=await line('no-ean-rotation',p);
 assert.equal((await call('lines/no-ean',{id},staff)).status,200);
 assert.equal((await call('lines/save',{id,status:'rotation_issue',quantity:0},staff)).status,200);
 assert.equal((await call('rounds/finish',{id:'no-ean-rotation'},staff)).status,200);
 const q=await db.prepare('SELECT * FROM rotation_rechecks').first();assert.ok(q);
 assert.equal((await call('rotation-rechecks/no-ean',{id:q.id},staff)).status,400); // future recheck
 await db.prepare("UPDATE rotation_rechecks SET due_date='2000-01-01' WHERE id=?").bind(q.id).run();
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'okay'},staff)).status,400);
 assert.equal((await call('rotation-rechecks/no-ean',{id:q.id},staff)).status,200);
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'okay'},admin)).status,400);
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'okay'},staff)).status,200);
 const saved=await db.prepare('SELECT * FROM rotation_rechecks WHERE id=?').bind(q.id).first();assert.equal(saved.method,'no_ean');assert.equal(saved.scanned_ean,null);assert.equal(saved.checked_by,staff.id);assert.equal(saved.status,'okay');
 assert.equal((await call('rotation-rechecks/no-ean',{id:q.id},staff)).status,409);
 for(const table of ['barcode_observations','barcode_candidates'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
 // Off sale still skips inspection, and a later real scan replaces No EAN.
 const next=await line('switch-back',p);await call('lines/no-ean',{id:next},staff);
 assert.equal((await call('lines/verify',{id:next,ean:B,method:'manual',confirmUnknown:true},staff)).data.verified,true);
 const scanned=(await call('report/switch-back',undefined,staff)).data.lines[0];assert.equal(scanned.method,'manual');assert.ok(scanned.barcode_candidate_id);
 assert.equal((await call('lines/save',{id:next,status:'off_sale',quantity:0},staff)).status,200);
 assert.equal((await call('report/switch-back',undefined,staff)).data.lines[0].method,null);
 }finally{await db.close();}});
