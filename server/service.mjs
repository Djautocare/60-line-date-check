import {storeAccess,roundAccess,storeAdmin} from './stores.mjs';
import {BarcodeProblem,barcodeTransaction,barcodeOwner,verifyBarcode,observeBarcode,barcodeAdmin,importCatalogue} from './barcodes.mjs';
import { validEAN13, validOutcome } from './ean.mjs';
import {validDate,nextDate} from '../shared/report-dates.mjs';
import {selectProducts,validRisk,RISK_WEIGHTS}from './selection.mjs';
import { publicMember } from './auth.mjs';
class Problem extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const now = () => new Date().toISOString();
function answer(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
function must(condition, message, status = 400) { if (!condition)
    throw new Problem(status, message); }
async function run(req, db, user) {
    must(user, 'Please sign in to continue.', 401);
    user=await db.prepare("SELECT m.*,t.number AS store_number,m.id=(SELECT value FROM settings WHERE key='owner') AS is_owner FROM members m LEFT JOIN stores t ON t.id=m.store_id WHERE m.id=?").bind(user.id).first();
    must(user,'Please sign in to continue.',401);
    const member=user;
    const requested=req.headers.get('x-store-id');
    must(user.is_owner||!requested||requested===user.store_id,'You can only access your assigned store.',403);
    const scope=user.is_owner&&requested==='all'?null:(user.is_owner&&requested?requested:user.store_id);
    const store=scope?await db.prepare('SELECT * FROM stores WHERE id=?').bind(scope).first():null;
    must(!scope||store,'Store not found.',404);
    must(member.active, 'Your account has been disabled.', 403);
    const isAdmin = member.role === 'admin';
    const admin = () => must(isAdmin, 'Administrator access is required.', 403);
    const path = new URL(req.url).pathname.replace(/^\/api\//, '');
    let body = {};
    if (req.method !== 'GET') {
        const origin = req.headers.get('origin');
        must(!origin || origin === new URL(req.url).origin, 'Request origin is not allowed.', 403);
        must(req.headers.get('sec-fetch-site') !== 'cross-site', 'Cross-site requests are not allowed.', 403);
        must(req.headers.get('content-type')?.includes('application/json'), 'Send JSON data.');
        must(Number(req.headers.get('content-length') || 0) < 500000, 'Request is too large.', 413);
        const raw = await req.text();
        must(raw.length < 500000, 'Request is too large.', 413);
        try {
            body = JSON.parse(raw);
        }
        catch {
            throw new Problem(400, 'Invalid request data.');
        }
    }
    if((req.method==='GET'&&['stores','members'].includes(path))||(req.method==='POST'&&['stores/save','store-members/search','store-members/add','store-members/remove','members','members/create','members/password'].includes(path)))return answer(await storeAdmin(db,user,scope,req.method==='GET'&&path==='members'?'members/list':path,body));
    if(!scope&&!user.is_owner){must(path==='state','This account has no assigned store. Ask a store admin to add your username.',403);return answer({member:publicMember(user),date:today(),store:null,products:[],round:null,lines:[],selection:null,sharedCheck:null,riskWeights:RISK_WEIGHTS});}
    if (req.method === 'GET' && path === 'state') {
        const products = await db.prepare('SELECT * FROM products ORDER BY section,name').all();
        const shared=scope?await db.prepare('SELECT * FROM store_daily_checks WHERE store_id=? AND date=?').bind(scope,today()).first():null;
        const round=shared?.round_id?await db.prepare('SELECT * FROM rounds WHERE id=?').bind(shared.round_id).first():null;
        const lines = round ? await db.prepare('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE l.round_id=? ORDER BY l.position').bind(round.id).all() : { results: [] };
        const selected=scope?await db.prepare('SELECT items FROM selections WHERE store_id=? AND date=?').bind(scope,today()).first():null;
        return answer({ member: publicMember(member), date: today(),store,sharedCheck:shared?{completed:!!shared.completed_at,reportDeleted:!shared.round_id&&!!shared.completed_at}:null, products: products.results.map(p=>({...p,ean:p.ean||''})), round, lines: lines.results, selection: selected ? JSON.parse(selected.items) : null, riskWeights:RISK_WEIGHTS });
    }
    if((req.method==='GET'&&path==='barcode-reviews')||(req.method==='POST'&&['products/by-plu','barcodes/lookup','barcode-reviews/resolve','barcodes/assign'].includes(path)))return answer(await barcodeAdmin(path,body,new URL(req.url).searchParams,db,user));
    if (req.method === 'GET' && path === 'reports') {
        const params = new URL(req.url).searchParams;
        const from = params.get('from') || '', to = params.get('to') || '';
        const checkedBy = params.get('checkedBy') || '';
        const rawOffset = params.get('offset') || '0';
        must(!from || validDate(from), 'Choose a valid start date.');
        must(!to || validDate(to), 'Choose a valid end date.');
        must(!from || !to || from <= to, 'The end date must be on or after the start date.');
        must(checkedBy.length <= 200, 'Invalid staff filter.');
        must(isAdmin || !checkedBy || checkedBy === user.id, 'You can only view your own reports.', 403);
        must(/^\d{1,9}$/.test(rawOffset), 'Invalid report page.');
        const offset = Number(rawOffset), limit = 100;
        const conditions=[],values=[];
        if(scope){conditions.push('r.store_id=?');values.push(scope);}
        if(!isAdmin){conditions.push("(r.mode='daily' OR r.user_id=?)");values.push(user.id);}
        if(checkedBy){conditions.push('(r.user_id=? OR r.finished_by=? OR EXISTS(SELECT 1 FROM lines x WHERE x.round_id=r.id AND x.recorded_by=?))');values.push(checkedBy,checkedBy,checkedBy);}
        if (from) { conditions.push('r.date>=?'); values.push(from); }
        if (to) { conditions.push('r.date<=?'); values.push(to); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const reports = await db.prepare(`SELECT r.*,t.number AS store_number,COALESCE(string_agg(DISTINCT checked.name,', '),m.name) AS user_name,COUNT(l.id) AS total,SUM(CASE WHEN l.status IS NOT NULL THEN 1 ELSE 0 END) AS checked,SUM(CASE WHEN l.status='out_of_date' THEN l.quantity ELSE 0 END) AS out_of_date,SUM(CASE WHEN l.status='not_stickered' THEN l.quantity ELSE 0 END) AS not_stickered,SUM(CASE WHEN l.status='rotation_issue' THEN 1 ELSE 0 END) AS rotation_issue,SUM(CASE WHEN l.status='off_sale' THEN 1 ELSE 0 END) AS off_sale FROM rounds r JOIN members m ON m.id=r.user_id JOIN stores t ON t.id=r.store_id LEFT JOIN lines l ON l.round_id=r.id LEFT JOIN members checked ON checked.id=l.recorded_by ${where} GROUP BY r.id,m.name,t.number ORDER BY r.date DESC,r.started DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();
        const count = await db.prepare(`SELECT COUNT(*) AS total FROM rounds r ${where}`).bind(...values).first();
        const checkers=await db.prepare(`SELECT DISTINCT m.id,m.name,m.username FROM members m JOIN rounds r ON (r.user_id=m.id OR r.finished_by=m.id OR EXISTS(SELECT 1 FROM lines x WHERE x.round_id=r.id AND x.recorded_by=m.id)) WHERE ${scope?'r.store_id=?':'TRUE'} ${isAdmin?'':'AND m.id=?'} ORDER BY m.name,m.username`).bind(...(scope?[scope]:[]),...(isAdmin?[]:[user.id])).all();
        return answer({reports:reports.results,total:Number(count.total),offset,limit,checkers:checkers.results});
    }
    if (req.method === 'GET' && path === 'rotation-rechecks') {
        const params = new URL(req.url).searchParams;
        const history = params.get('view') === 'history';
        const rawOffset = params.get('offset') || '0';
        must(/^\d{1,9}$/.test(rawOffset), 'Invalid recheck page.');
        const offset=Number(rawOffset),limit=100;
        const where=(history?'q.status IS NOT NULL':'q.status IS NULL AND q.due_date<=?')+(scope?' AND r.store_id=?':'');
        const values=[...(history?[]:[today()]),...(scope?[scope]:[])];
        const result=await db.prepare(`SELECT q.*,l.name,l.ean,l.plu,l.section,l.risk,r.date AS original_date,r.store,COALESCE(flagger.name,m.name) AS flagged_by,c.name AS checked_by_name FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id JOIN members m ON m.id=r.user_id LEFT JOIN members flagger ON flagger.id=l.recorded_by LEFT JOIN members c ON c.id=q.checked_by WHERE ${where} ORDER BY q.due_date ${history?'DESC':'ASC'},q.id LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();
        const count=await db.prepare(`SELECT COUNT(*) AS total FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id WHERE ${where}`).bind(...values).first();
        const upcoming=await db.prepare(`SELECT COUNT(*) AS total FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id WHERE q.status IS NULL AND q.due_date>? ${scope?'AND r.store_id=?':''}`).bind(today(),...(scope?[scope]:[])).first();
        return answer({rechecks:result.results,total:Number(count.total),upcoming:Number(upcoming.total),offset,limit,today:today()});
    }
    if(req.method==='POST'&&(path==='rotation-rechecks/verify'||path==='rotation-rechecks/save')){
        const recheck=await db.prepare('SELECT q.*,l.ean,l.product_id,l.round_id,r.store_id FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id WHERE q.id=?').bind(String(body.id)).first();
        must(recheck&&(!scope||recheck.store_id===scope),'Rotation recheck not found.',404);
        must(!recheck.status,'This rotation recheck has already been saved.',409);
        must(recheck.due_date<=today(),'This recheck is scheduled for a future date.');
        if(path==='rotation-rechecks/verify'){
            const outcome=await barcodeTransaction(db,async c=>{
                await storeAccess(c,user,recheck.store_id);
                const current=(await c.query('SELECT * FROM rotation_rechecks WHERE id=$1 FOR UPDATE',[recheck.id])).rows[0];
                must(current&&!current.status,'This recheck has already been saved.',409);
                const result=await verifyBarcode(c,{productId:recheck.product_id,snapshotEan:recheck.ean,ean:String(body.ean||''),user,method:body.method,confirmUnknown:body.confirmUnknown===true});
                if(result.verified)await c.query('UPDATE rotation_rechecks SET verified_at=$1,verified_by=$2,method=$3,scanned_ean=$4 WHERE id=$5',[now(),user.id,body.method,body.ean,recheck.id]);
                else await c.query('UPDATE rotation_rechecks SET verified_at=NULL,verified_by=NULL,method=NULL,scanned_ean=NULL WHERE id=$1',[recheck.id]);
                return result;
            });
            return answer(outcome,outcome.code==='wrong_product'?409:200);
        }
        must(['okay','rotation_issue','off_sale'].includes(body.status),'Choose Okay now, Still a rotation issue or Off sale.');
        const offSale=body.status==='off_sale';
        must(offSale||(recheck.verified_at&&recheck.verified_by===user.id),'Scan the product yourself before saving this recheck.');
        must(body.quantity===undefined||body.quantity===0,'Rotation rechecks do not take a quantity.');
        const checkedAt=now(),due=nextDate(today());
        const outcome=await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,recheck.store_id);
            await c.query('SELECT id FROM rounds WHERE id=$1 FOR UPDATE',[recheck.round_id]);
            const current=(await c.query('SELECT q.*,l.product_id,l.ean,l.plu,l.name FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id WHERE q.id=$1 FOR UPDATE OF q',[recheck.id])).rows[0];
            must(current&&!current.status,'This rotation recheck has already been saved.',409);
            must(offSale||(current.verified_at&&current.verified_by===user.id),'Scan the product yourself before saving this recheck.');
            if(!offSale){
                const scanned=current.scanned_ean||current.ean,owner=await barcodeOwner(c,scanned);
                const wrong=owner&&(current.product_id?owner.id!==current.product_id:owner.plu!==current.plu||owner.name!==current.name);
                const candidate=(await c.query('SELECT status FROM barcode_candidates WHERE ean=$1 AND product_id=$2',[scanned,current.product_id])).rows[0];
                if(wrong||(!owner&&candidate?.status==='denied')){
                    await c.query('UPDATE rotation_rechecks SET verified_at=NULL,verified_by=NULL,method=NULL,scanned_ean=NULL WHERE id=$1',[current.id]);
                    return {error:wrong?`Wrong product: ${owner.name} · PLU ${owner.plu}`:'This barcode link was denied. Scan another variant or ask an administrator.',code:wrong?'wrong_product':'review_denied',product:owner};
                }
            }
            await c.query('UPDATE rotation_rechecks SET status=$1,checked_at=$2,checked_by=$3,verified_at=CASE WHEN $4 THEN NULL ELSE verified_at END,verified_by=CASE WHEN $4 THEN NULL ELSE verified_by END,method=CASE WHEN $4 THEN NULL ELSE method END,scanned_ean=CASE WHEN $4 THEN NULL ELSE scanned_ean END WHERE id=$5',[body.status,checkedAt,user.id,offSale,current.id]);
            if(body.status!=='okay')await c.query('INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[current.origin_line_id+':recheck:'+due,current.origin_line_id,due,checkedAt]);
            return {ok:true,nextDue:body.status==='okay'?null:due};
        });
        return answer(outcome,outcome.error?409:200);
    }
    if (req.method === 'GET' && path.startsWith('report/')) {
        const id = decodeURIComponent(path.slice(7));
        const round = await db.prepare(`SELECT r.*,t.number AS store_number,COALESCE((SELECT string_agg(DISTINCT c.name,', ') FROM lines x JOIN members c ON c.id=x.recorded_by WHERE x.round_id=r.id),m.name) AS user_name FROM rounds r JOIN members m ON m.id=r.user_id JOIN stores t ON t.id=r.store_id WHERE r.id=?`).bind(id).first();
        must(roundAccess(round,user,scope),'Report not found.',404);
        const lines = await db.prepare('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE l.round_id=? ORDER BY l.position').bind(id).all();
        return answer({ round, lines: lines.results });
    }
    if(req.method==='POST'&&path==='reports/delete'){
        admin();
        const id=String(body.id||'');
        must(id.length>0&&id.length<=200,'Select a report to delete.');
        const report=await db.prepare('SELECT * FROM rounds WHERE id=?').bind(id).first();
        must(report&&(!scope||report.store_id===scope),'Report not found.',404);
        await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,report.store_id);
            const current=(await c.query('SELECT role FROM members WHERE id=$1',[user.id])).rows[0];must(current?.role==='admin','Administrator access has changed.',403);
            await c.query('SELECT id FROM rounds WHERE id=$1 FOR UPDATE',[id]);
            await c.query('DELETE FROM rotation_rechecks WHERE origin_line_id IN (SELECT id FROM lines WHERE round_id=$1)',[id]);
            await c.query('DELETE FROM lines WHERE round_id=$1',[id]);
            const deleted=await c.query('DELETE FROM rounds WHERE id=$1',[id]);must(deleted.rowCount>0,'Report not found.',404);
        });
        return answer({ok:true});
    }
    if(req.method==='POST'&&path==='products/lookup'){
        admin();must(validEAN13(String(body.ean||'')),'Scan a valid EAN-13 barcode.');
        const product=await barcodeTransaction(db,c=>barcodeOwner(c,body.ean));
        must(product,'This barcode has no approved product. Use Barcode reviews to assign it.',404);
        return answer({product});
    }
    if(req.method==='POST'&&path==='products'){admin();return answer(await importCatalogue(db,body,user));}
    if (req.method === 'POST' && path === 'products/delete') {
        admin();
        await db.prepare('DELETE FROM products WHERE id=?').bind(String(body.id)).run();
        return answer({ ok: true });
    }
    if(req.method==='POST'&&path==='rounds/start'){
        must(scope,'Choose a store before starting a check.');const practice=body.mode==='practice';if(practice)admin();
        return answer(await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,scope);
            let shared;if(!practice){
                await c.query('INSERT INTO store_daily_checks(store_id,date) VALUES($1,$2) ON CONFLICT DO NOTHING',[scope,today()]);
                shared=(await c.query('SELECT * FROM store_daily_checks WHERE store_id=$1 AND date=$2 FOR UPDATE',[scope,today()])).rows[0];
                must(!(shared.completed_at&&!shared.round_id),'This store has completed today’s check. Its report was deleted.',409);
                if(shared.round_id)return {round:(await c.query('SELECT * FROM rounds WHERE id=$1',[shared.round_id])).rows[0],lines:(await c.query('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE round_id=$1 ORDER BY position',[shared.round_id])).rows};
            }
            const catalogue=(await c.query('SELECT * FROM products')).rows;must(catalogue.length>=(practice?1:60),practice?'Add a product first.':'Add at least 60 products to start a daily check.');
            let chosen;
            if(practice)chosen=selectProducts(catalogue,Math.min(60,catalogue.length));
            else{
                const saved=(await c.query('SELECT items FROM selections WHERE store_id=$1 AND date=$2',[scope,today()])).rows[0];
                chosen=saved?JSON.parse(saved.items):selectProducts(catalogue,60);
                if(!saved)await c.query('INSERT INTO selections(store_id,date,items,created) VALUES($1,$2,$3,$4)',[scope,today(),JSON.stringify(chosen),now()]);
            }
            const id=practice?crypto.randomUUID():`store-daily:${scope}:${today()}`;
            await c.query('INSERT INTO rounds(id,user_id,date,mode,store,started,store_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,today(),practice?'practice':'daily',store.number||store.name,now(),scope]);
            for(const [index,p] of chosen.entries())await c.query('INSERT INTO lines(id,round_id,name,ean,plu,section,position,risk,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM products WHERE id=$9))',[id+':'+index,id,p.name,p.ean||'',p.plu,p.section,index+1,p.risk||'normal',p.id]);
            if(!practice)await c.query('UPDATE store_daily_checks SET round_id=$1 WHERE store_id=$2 AND date=$3',[id,scope,today()]);
            return {round:(await c.query('SELECT * FROM rounds WHERE id=$1',[id])).rows[0],lines:(await c.query('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE round_id=$1 ORDER BY position',[id])).rows};
        }));
    }
    if (req.method === 'POST' && (path === 'lines/verify' || path === 'lines/save')) {
        const line = await db.prepare('SELECT l.*,r.user_id,r.finished,r.store_id,r.mode FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=?').bind(String(body.id)).first();
        must(roundAccess(line,user,scope),'Check line not found.',404);
        must(!line.finished, 'This check has already been completed.');
        if (path === 'lines/verify') {
            const outcome=await barcodeTransaction(db,async c=>{
                const current=(await c.query('SELECT l.*,r.mode,r.user_id,r.finished,r.store_id FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=$1 FOR UPDATE OF r,l',[line.id])).rows[0];
                must(roundAccess(current,user,scope)&&!current.finished,'This check has already been completed.');
                await storeAccess(c,user,current.store_id);
                if(body.revision!==undefined&&body.revision!==current.revision)throw new BarcodeProblem(409,'Another colleague changed this line. Review the latest result and scan again.',{code:'line_changed',revision:current.revision});
                const result=await verifyBarcode(c,{productId:current.product_id,snapshotEan:current.ean,ean:String(body.ean||''),user,method:body.method,confirmUnknown:body.confirmUnknown===true,practice:current.mode==='practice'});
                if(result.verified)await c.query(`UPDATE lines SET verified_at=$1,method=$2,ean=$3,barcode_candidate_id=$4,status=NULL,saved_at=NULL,recorded_by=NULL,verified_by=$6,revision=revision+1 WHERE id=$5`,[now(),body.method,body.ean,result.candidateId,current.id,user.id]);
                else await c.query(`UPDATE lines SET verified_at=NULL,method=NULL,verified_by=NULL,revision=revision+1,barcode_candidate_id=NULL,status=CASE WHEN status='off_sale' THEN status ELSE NULL END,saved_at=CASE WHEN status='off_sale' THEN saved_at ELSE NULL END,recorded_by=CASE WHEN status='off_sale' THEN recorded_by ELSE NULL END WHERE id=$1`,[current.id]);
                result.revision=(await c.query('SELECT revision FROM lines WHERE id=$1',[current.id])).rows[0].revision;
                return result;
            });
            return answer(outcome,outcome.code==='wrong_product'?409:200);
        }
        const offSale=body.status==='off_sale';
        must(offSale||(line.verified_at&&line.verified_by===user.id),'Scan the product yourself before saving a result.');
        must(validOutcome(body.status, body.quantity), ['rotation_issue','off_sale'].includes(body.status)?'Rotation issue and Off sale are recorded without a quantity.':'Out of date and Not stickered need a whole quantity from 1 to 9,999.');
        const saved=await barcodeTransaction(db,async c=>{
            const current=(await c.query('SELECT l.*,r.user_id,r.finished,r.mode,r.store_id FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=$1 FOR UPDATE OF r,l',[line.id])).rows[0];
            must(roundAccess(current,user,scope)&&!current.finished,'This check has already been completed.');
                await storeAccess(c,user,current.store_id);
                if(body.revision!==undefined&&body.revision!==current.revision)throw new BarcodeProblem(409,'Another colleague changed this line. Review the latest result and scan again.',{code:'line_changed',revision:current.revision});
            must(offSale||(current.verified_at&&current.verified_by===user.id),'Scan the product yourself before saving a result.');
            if(!offSale){
                const match=await verifyBarcode(c,{productId:current.product_id,snapshotEan:current.ean,ean:current.ean,user,method:current.method,confirmUnknown:true,practice:current.mode==='practice'});
                if(!match.verified){await c.query('UPDATE lines SET verified_at=NULL,verified_by=NULL,recorded_by=NULL,method=NULL,status=NULL,saved_at=NULL,revision=revision+1,barcode_candidate_id=NULL WHERE id=$1',[current.id]);return {error:match.error||match.message,code:match.code||'review_denied',product:match.product};}
            }
            await c.query('UPDATE lines SET status=$1,quantity=$2,saved_at=$3,verified_at=CASE WHEN $4 THEN NULL ELSE verified_at END,method=CASE WHEN $4 THEN NULL ELSE method END,barcode_candidate_id=CASE WHEN $4 THEN NULL ELSE barcode_candidate_id END,verified_by=CASE WHEN $4 THEN NULL ELSE verified_by END,recorded_by=$6,revision=revision+1 WHERE id=$5',[body.status,body.quantity,now(),offSale,current.id,user.id]);
            return {ok:true,revision:current.revision+1};
        });
        return answer(saved,saved.error?409:200);
    }
    if (req.method === 'POST' && path === 'rounds/finish') {
        const outcome=await barcodeTransaction(db,async c=>{
            const round=(await c.query('SELECT * FROM rounds WHERE id=$1 FOR UPDATE',[String(body.id)])).rows[0];
            must(roundAccess(round,user,scope),'Check not found.',404);await storeAccess(c,user,round.store_id);
            if(round.finished)return {ok:true,learning:[]};
            const lines=(await c.query('SELECT * FROM lines WHERE round_id=$1 ORDER BY position',[round.id])).rows;
            must(lines.length>0&&lines.every(l=>l.status&&(l.status==='off_sale'||l.verified_at)),'Every line must be scanned and recorded, or marked Off sale, before finishing.');
            for(const line of lines.filter(l=>l.status!=='off_sale')){
                const owner=await barcodeOwner(c,line.ean);
                const wrong=owner&&(line.product_id?owner.id!==line.product_id:owner.plu!==line.plu||owner.name!==line.name);
                const candidate=line.barcode_candidate_id?(await c.query('SELECT status FROM barcode_candidates WHERE id=$1',[line.barcode_candidate_id])).rows[0]:null;
                if(wrong||(!owner&&candidate?.status==='denied')){
                    await c.query('UPDATE lines SET verified_at=NULL,verified_by=NULL,recorded_by=NULL,method=NULL,status=NULL,saved_at=NULL,revision=revision+1,barcode_candidate_id=NULL WHERE id=$1',[line.id]);
                    return {error:wrong?`Wrong product: ${owner.name} · PLU ${owner.plu}`:'This barcode link was denied. Scan the correct pack or ask an administrator.',code:wrong?'wrong_product':'review_denied',product:owner,lineId:line.id};
                }
            }
            const finished=new Date().toISOString();await c.query('UPDATE rounds SET finished=$1,finished_by=$3 WHERE id=$2',[finished,round.id,user.id]);
            await c.query(`INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) SELECT l.id || ':recheck:' || to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),l.id,to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),$1 FROM lines l WHERE l.round_id=$2 AND $3='daily' AND l.status='rotation_issue' ON CONFLICT DO NOTHING`,[finished,round.id,round.mode]);
            if(round.mode==='daily')await c.query('UPDATE store_daily_checks SET completed_at=$1 WHERE round_id=$2',[finished,round.id]);
            const learning=[];for(const line of lines.filter(l=>l.status!=='off_sale')){const result=await observeBarcode(c,line,round,user);if(result)learning.push(result);}
            return {ok:true,learning};
        });
        return answer(outcome,outcome.error?409:200);
    }
    throw new Problem(404, 'This action was not found.');
}
export async function handle(req, db, user) { try {
    return await run(req, db, user);
}
catch (e) {
    if(e instanceof BarcodeProblem)return answer({error:e.message,...e.details},e.status);
    if (e instanceof Problem)
        return answer({ error: e.message }, e.status);
    if (e?.code === '23505') return answer({error:'That barcode, username or store number already exists.'},400);
        console.error('DateCheck request failed', e instanceof Error ? e.message : 'Unknown failure');
    return answer({ error: 'Something went wrong. Please try again.' }, 500);
} }
