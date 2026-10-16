import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';import {handle} from '../server/service.mjs';import {parseCatalogueCSV} from '../src/catalogue-csv.mjs';
const admin={id:'a',name:'Admin',username:'admin',role:'admin',active:1},staff={id:'s',name:'Staff',username:'staff',role:'staff',active:1};
const ean=n=>{const first=String(n).padStart(12,'0');return first+((10-[...first].reduce((s,d,i)=>s+Number(d)*(i%2?3:1),0)%10)%10);};
const A=ean(408860000001),B=ean(408860000002),C=ean(408860000003);
async function setup(){const engine=new PGlite();await engine.waitReady;const pool={query:(s,a)=>engine.query(s,a),connect:async()=>({query:(s,a)=>engine.query(s,a),release(){}}),end:()=>engine.close()};const db=await openDatabase('test',{pool});for(const u of [admin,staff])await db.prepare('INSERT INTO members(id,name,username,password_hash,role,created) VALUES(?,?,?,?,?,?)').bind(u.id,u.name,u.username,'unused',u.role,'2026-10-15').run();const call=async(path,body,user=admin)=>{const r=await handle(new Request('http://localhost:3001/api/'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),db,user);return {status:r.status,data:await r.json()};};
 const product=async(plu='001234',name='Apples',ean='')=>{const r=await call('products',{name,plu,section:'Produce',ean});assert.equal(r.status,200,JSON.stringify(r.data));return (await call('state')).data.products.find(p=>p.plu===plu);};
 const line=async(id,p,mode='daily')=>{await db.prepare('INSERT INTO rounds(id,user_id,date,mode,started) VALUES(?,?,?,?,?)').bind(id,staff.id,'2026-10-15',mode,'2026-10-15T12:00:00Z').run();await db.prepare('INSERT INTO lines(id,round_id,product_id,name,plu,ean,section,position) VALUES(?,?,?,?,?,?,?,1)').bind(id+'-line',id,p.id,p.name,p.plu,p.ean||'',p.section).run();return id+'-line';};
 return {db,call,product,line};}
test('catalogue imports use descriptions and six-digit PLUs, ignoring legacy EAN columns',()=>{
 assert.deepEqual(parseCatalogueCSV('description,plu\r\n"Apples, red",001234\r\n','Produce Chiller'),[{name:'Apples, red',plu:'001234',section:'Produce Chiller'}]);
 assert.deepEqual(parseCatalogueCSV('name,plu,area,ean\nPotatoes,000001,Ambient produce,not-a-barcode'),[{name:'Potatoes',plu:'000001',section:'Ambient produce'}]);
 assert.throws(()=>parseCatalogueCSV('name,plu\nX,123456'),/area/);assert.throws(()=>parseCatalogueCSV('name,plu,area\n"Bad,123456,Bread'),/quote/);
});
test('all catalogue fields save by ID, PLUs remain unique and archived barcode data is preserved',async()=>{const {db,call,product}=await setup();try{
 const p=await product('001234','Potatoes'),other=await product('002345','Bread');
 // Previously assigned EANs stay archived and do not affect editing or validation.
 await db.prepare('UPDATE products SET ean=? WHERE id=?').bind(A,p.id).run();
 await db.prepare("INSERT INTO product_barcodes(ean,product_id,confirmed_at,source) VALUES(?,?,?,'existing')").bind(A,p.id,'2026-10-01').run();
 const saved=await call('products',{id:p.id,name:'Updated potatoes 2kg',plu:'000123',section:'Ambient produce',risk:'high',ean:'invalid legacy field'});assert.equal(saved.status,200);
 let row=(await call('state')).data.products.find(x=>x.id===p.id);assert.equal(row.name,'Updated potatoes 2kg');assert.equal(row.plu,'000123');assert.equal(row.section,'Ambient produce');assert.equal(row.risk,'high');assert.equal(row.ean,A);
 assert.equal((await call('products',{id:p.id,name:'Wrong duplicate',plu:other.plu,section:'Bread',risk:'low'})).status,409);
 row=(await call('state')).data.products.find(x=>x.id===p.id);assert.equal(row.name,'Updated potatoes 2kg');assert.equal(row.plu,'000123');
 assert.equal((await call('products',{id:p.id,name:'No staff edits',plu:'000123',section:'Bread'},staff)).status,403);
 assert.equal((await call('products',{items:[{name:'Duplicate',plu:'123456',section:'Bread'},{name:'Duplicate two',plu:'123456',section:'Bread'}]})).status,400);
 assert.equal((await call('products',{name:'Invalid PLU',plu:'12345',section:'Bread'})).status,400);
 assert.equal((await call('products',{name:'Legacy extra fields',plu:'123456',section:'Bread',ean:'anything'})).status,200);
 const legacy=(await call('state')).data.products.find(x=>x.plu==='123456');assert.equal(legacy.ean,'');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM product_barcodes').first()).n,1);
 }finally{await db.close();}});
test('daily results save directly with recorder attribution, quantity checks and no barcode learning',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Loose potatoes');const id=await line('direct',p);
 assert.equal((await call('rounds/finish',{id:'direct'},staff)).status,400);
 assert.equal((await call('lines/save',{id,status:'out_of_date',quantity:0,revision:0},staff)).status,400);
 assert.equal((await call('lines/save',{id,status:'out_of_date',quantity:1.5,revision:0},staff)).status,400);
 let result=await call('lines/save',{id,status:'out_of_date',quantity:3,revision:0},staff);assert.equal(result.status,200);assert.equal(result.data.revision,1);
 let row=(await call('report/direct',undefined,staff)).data.lines[0];assert.equal(row.recorded_by,staff.id);assert.equal(row.recorded_by_name,staff.name);assert.equal(row.method,'product_check');assert.equal(row.verified_at,null);assert.equal(row.barcode_candidate_id,null);assert.equal(row.saved_at,null);assert.ok((await call('report/direct')).data.lines[0].saved_at);
 assert.equal((await call('lines/save',{id,status:'okay',quantity:0,revision:0},staff)).status,409);
 assert.equal((await call('lines/save',{id,status:'rotation_issue',quantity:1,revision:1},staff)).status,400);
 assert.equal((await call('lines/save',{id,status:'rotation_issue',quantity:0,revision:1},staff)).status,200);
 assert.equal((await call('rounds/finish',{id:'direct'},staff)).status,200);
 assert.equal((await call('rounds/finish',{id:'direct'},staff)).status,200);
 assert.equal((await call('lines/save',{id,status:'okay',quantity:0},staff)).status,400);
 for(const table of ['barcode_observations','barcode_candidates','product_barcodes'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
 const q=await db.prepare('SELECT * FROM rotation_rechecks').first();assert.ok(q);
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'okay'},staff)).status,400);
 await db.prepare("UPDATE rotation_rechecks SET due_date='2000-01-01' WHERE id=?").bind(q.id).run();
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'rotation_issue',quantity:3},staff)).status,400);
 assert.equal((await call('rotation-rechecks/save',{id:q.id,status:'okay'},staff)).status,200);
 const checked=await db.prepare('SELECT * FROM rotation_rechecks WHERE id=?').bind(q.id).first();assert.equal(checked.status,'okay');assert.equal(checked.checked_by,staff.id);assert.equal(checked.method,'product_check');assert.equal(checked.verified_at,null);
 }finally{await db.close();}});
test('old scans and barcode assignments cannot block direct saves, completion or follow-ups',async()=>{const {db,call,product,line}=await setup();try{
 const p=await product('001234','Potatoes'),other=await product('002345','Other product');const id=await line('legacy-check',p);
 await db.prepare('UPDATE products SET ean=? WHERE id=?').bind(A,other.id).run();
 await db.prepare("INSERT INTO barcode_candidates(id,ean,product_id,status,created,updated) VALUES('old-candidate',?,?,'denied','2026-10-01','2026-10-01')").bind(A,p.id).run();
 await db.prepare("UPDATE lines SET ean=?,method='camera',verified_at='2026-10-01',barcode_candidate_id='old-candidate' WHERE id=?").bind(A,id).run();
 assert.equal((await call('lines/save',{id,status:'okay',quantity:0,revision:0},staff)).status,200);
 const saved=(await call('report/legacy-check',undefined,staff)).data.lines[0];assert.equal(saved.barcode_candidate_id,null);assert.equal(saved.method,'product_check');assert.equal(saved.verified_at,null);
 assert.equal((await call('rounds/finish',{id:'legacy-check'},staff)).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM barcode_observations').first()).n,0);
 assert.equal((await db.prepare("SELECT status FROM barcode_candidates WHERE id='old-candidate'").first()).status,'denied');
 assert.equal((await db.prepare('SELECT ean FROM products WHERE id=?').bind(other.id).first()).ean,A);
 }finally{await db.close();}});
test('barcode and scan routes are retired and cannot change results or assignments',async()=>{const {db,call}=await setup();try{
 for(const [path,body] of [['barcode-reviews',undefined],['barcodes/lookup',{}],['barcodes/assign',{}],['barcode-reviews/resolve',{}],['products/lookup',{}],['lines/verify',{}],['lines/no-ean',{}],['rotation-rechecks/verify',{}],['rotation-rechecks/no-ean',{}]])assert.equal((await call(path,body)).status,410,path);
 for(const table of ['lines','barcode_candidates','product_barcodes','barcode_observations'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
 }finally{await db.close();}});
test('900 product catalogue imports by PLU and daily selection remains 60 unique products',async()=>{const {db,call}=await setup();try{
 const items=Array.from({length:900},(_,i)=>({name:'Product '+i,plu:String(i).padStart(6,'0'),section:'Area '+i%5}));assert.equal((await call('products',{items})).status,200);
 const check=await call('rounds/start',{},staff);assert.equal(check.status,200);assert.equal(check.data.lines.length,60);assert.equal(new Set(check.data.lines.map(l=>l.plu)).size,60);assert.ok(check.data.lines.every(l=>!l.ean));
 }finally{await db.close();}});
