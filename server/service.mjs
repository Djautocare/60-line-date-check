import {BarcodeProblem,barcodeTransaction,barcodeOwner,verifyBarcode,observeBarcode,barcodeAdmin,importCatalogue} from './barcodes.mjs';
import { validEAN13, validOutcome } from './ean.mjs';
import {validDate,nextDate} from '../shared/report-dates.mjs';
import {selectProducts,validRisk,RISK_WEIGHTS}from './selection.mjs';
import { publicMember, hashPassword, validUsername, validPassword } from './auth.mjs';
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
    const member = user;
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
    if (req.method === 'GET' && path === 'state') {
        const products = await db.prepare('SELECT * FROM products ORDER BY section,name').all();
        const round = await db.prepare("SELECT * FROM rounds WHERE user_id=? AND date=? AND mode='daily' ORDER BY started DESC LIMIT 1").bind(user.id, today()).first();
        const lines = round ? await db.prepare('SELECT * FROM lines WHERE round_id=? ORDER BY position').bind(round.id).all() : { results: [] };
        const selected = await db.prepare('SELECT items FROM selections WHERE date=?').bind(today()).first();
        return answer({ member: publicMember(member), date: today(), products: products.results.map(p=>({...p,ean:p.ean||''})), round, lines: lines.results, selection: selected ? JSON.parse(selected.items) : null, riskWeights:RISK_WEIGHTS });
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
        const conditions = [], values = [];
        if (!isAdmin || checkedBy) { conditions.push('r.user_id=?'); values.push(isAdmin ? checkedBy : user.id); }
        if (from) { conditions.push('r.date>=?'); values.push(from); }
        if (to) { conditions.push('r.date<=?'); values.push(to); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const reports = await db.prepare(`SELECT r.*,m.name AS user_name,COUNT(l.id) AS total,SUM(CASE WHEN l.status IS NOT NULL THEN 1 ELSE 0 END) AS checked,SUM(CASE WHEN l.status='out_of_date' THEN l.quantity ELSE 0 END) AS out_of_date,SUM(CASE WHEN l.status='not_stickered' THEN l.quantity ELSE 0 END) AS not_stickered,SUM(CASE WHEN l.status='rotation_issue' THEN 1 ELSE 0 END) AS rotation_issue,SUM(CASE WHEN l.status='off_sale' THEN 1 ELSE 0 END) AS off_sale FROM rounds r JOIN members m ON m.id=r.user_id LEFT JOIN lines l ON l.round_id=r.id ${where} GROUP BY r.id,m.name ORDER BY r.date DESC,r.started DESC,r.id DESC LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();
        const count = await db.prepare(`SELECT COUNT(*) AS total FROM rounds r ${where}`).bind(...values).first();
        const checkers = await db.prepare(`SELECT DISTINCT m.id,m.name,m.username FROM members m JOIN rounds r ON r.user_id=m.id ${isAdmin ? '' : 'WHERE r.user_id=?'} ORDER BY m.name,m.username`).bind(...(isAdmin ? [] : [user.id])).all();
        return answer({reports:reports.results,total:Number(count.total),offset,limit,checkers:checkers.results});
    }
    if (req.method === 'GET' && path === 'rotation-rechecks') {
        const params = new URL(req.url).searchParams;
        const history = params.get('view') === 'history';
        const rawOffset = params.get('offset') || '0';
        must(/^\d{1,9}$/.test(rawOffset), 'Invalid recheck page.');
        const offset=Number(rawOffset),limit=100;
        const where=history?'q.status IS NOT NULL':'q.status IS NULL AND q.due_date<=?';
        const values=history?[]:[today()];
        const result=await db.prepare(`SELECT q.*,l.name,l.ean,l.plu,l.section,l.risk,r.date AS original_date,r.store,m.name AS flagged_by,c.name AS checked_by_name FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id JOIN members m ON m.id=r.user_id LEFT JOIN members c ON c.id=q.checked_by WHERE ${where} ORDER BY q.due_date ${history?'DESC':'ASC'},q.id LIMIT ? OFFSET ?`).bind(...values,limit,offset).all();
        const count=await db.prepare(`SELECT COUNT(*) AS total FROM rotation_rechecks q WHERE ${where}`).bind(...values).first();
        const upcoming=await db.prepare('SELECT COUNT(*) AS total FROM rotation_rechecks WHERE status IS NULL AND due_date>?').bind(today()).first();
        return answer({rechecks:result.results,total:Number(count.total),upcoming:Number(upcoming.total),offset,limit,today:today()});
    }
    if(req.method==='POST'&&(path==='rotation-rechecks/verify'||path==='rotation-rechecks/save')){
        const recheck=await db.prepare('SELECT q.*,l.ean,l.product_id,l.round_id FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id WHERE q.id=?').bind(String(body.id)).first();
        must(recheck,'Rotation recheck not found.',404);
        must(!recheck.status,'This rotation recheck has already been saved.',409);
        must(recheck.due_date<=today(),'This recheck is scheduled for a future date.');
        if(path==='rotation-rechecks/verify'){
            const outcome=await barcodeTransaction(db,async c=>{
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
        const round = await db.prepare('SELECT r.*,m.name AS user_name FROM rounds r JOIN members m ON m.id=r.user_id WHERE r.id=?').bind(id).first();
        must(round && (isAdmin || round.user_id === user.id), 'Report not found.', 404);
        const lines = await db.prepare('SELECT * FROM lines WHERE round_id=? ORDER BY position').bind(id).all();
        return answer({ round, lines: lines.results });
    }
    if(req.method==='POST'&&path==='reports/delete'){
        admin();
        const id=String(body.id||'');
        must(id.length>0&&id.length<=200,'Select a report to delete.');
        const report=await db.prepare('SELECT id FROM rounds WHERE id=?').bind(id).first();
        must(report,'Report not found.',404);
        const deleted=await db.batch([
            db.prepare('SELECT id FROM rounds WHERE id=? FOR UPDATE').bind(id),
            db.prepare('DELETE FROM rotation_rechecks WHERE origin_line_id IN (SELECT id FROM lines WHERE round_id=?)').bind(id),
            db.prepare('DELETE FROM lines WHERE round_id=?').bind(id),
            db.prepare('DELETE FROM rounds WHERE id=?').bind(id)
        ]);
        must(deleted[3].rowCount>0,'Report not found.',404);
        return answer({ok:true});
    }
    if (req.method === 'GET' && path === 'members') {
        admin();
        const result = await db.prepare('SELECT id,name,username,role,active,created FROM members ORDER BY created').all();
        return answer({ members: result.results });
    }
    if (req.method === 'POST' && path === 'members/create') {
        admin();
        const username = String(body.username || '').toLowerCase().trim();
        must(validUsername(username), 'Use 3–40 letters, numbers, dots, underscores or hyphens for the username.');
        must(validPassword(body.password), 'Passwords must have 12–256 characters.');
        must(['admin', 'staff'].includes(body.role), 'Choose staff or admin.');
        const name = String(body.name || '').trim();
        must(name.length > 0 && name.length <= 100, 'Enter a display name.');
        const exists = await db.prepare('SELECT id FROM members WHERE username=?').bind(username).first();
        must(!exists, 'That username is already taken.');
        await db.prepare('INSERT INTO members(id,username,name,password_hash,role,active,created) VALUES (?,?,?,?,?,1,?)').bind(crypto.randomUUID(), username, name, await hashPassword(body.password), body.role, now()).run();
        return answer({ ok: true });
    }
    if (req.method === 'POST' && path === 'members/password') {
        admin();
        must(validPassword(body.password), 'Passwords must have 12–256 characters.');
        must(body.id !== user.id, 'Use Account settings to change your own password.');
        const owner = await db.prepare("SELECT value FROM settings WHERE key='owner'").first();
        must(body.id !== owner?.value, 'The owner password must be changed in Account settings.');
        await db.batch([db.prepare('UPDATE members SET password_hash=? WHERE id=?').bind(await hashPassword(body.password), body.id), db.prepare('DELETE FROM sessions WHERE user_id=?').bind(body.id)]);
        return answer({ ok: true });
    }
    if (req.method === 'POST' && path === 'members') {
        admin();
        must(body.id !== user.id, 'You cannot change your own access.');
        const owner = await db.prepare("SELECT value FROM settings WHERE key='owner'").first();
        must(body.id !== owner?.value, 'The owner account cannot be changed.');
        must(['admin', 'staff'].includes(body.role) && [0, 1].includes(body.active), 'Invalid account settings.');
        await db.batch([db.prepare('UPDATE members SET role=?,active=? WHERE id=?').bind(body.role, body.active, body.id),...(body.active===0?[db.prepare('DELETE FROM sessions WHERE user_id=?').bind(body.id)]:[])]);
        return answer({ ok: true });
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
    if (req.method === 'POST' && path === 'rounds/start') {
        const practice = body.mode === 'practice';
        if (practice)
            admin();
        let chosen = [];
        if (practice) {
            const result = await db.prepare('SELECT * FROM products').all();
            must(result.results.length, 'Add at least one product first.');
            chosen=selectProducts(result.results,Math.min(60,result.results.length));
        }
        else {
            const previous = await db.prepare('SELECT items FROM selections WHERE date=?').bind(today()).first();
            if (!previous) {
                const catalogue=await db.prepare('SELECT * FROM products').all();
                must(catalogue.results.length>=60,'Add at least 60 products to start a daily check.');
                const items=selectProducts(catalogue.results,60);
                await db.prepare('INSERT OR IGNORE INTO selections(date,items,created) VALUES (?,?,?)').bind(today(), JSON.stringify(items), now()).run();
            }
            const selected = await db.prepare('SELECT items FROM selections WHERE date=?').bind(today()).first();
            chosen = JSON.parse(selected.items);
        }
        const id = practice ? crypto.randomUUID() : `daily:${today()}:${user.id}`;
        const store = String(body.store || '').trim();
        must(store.length <= 100, 'Store name is too long.');
        await db.batch([
            db.prepare('INSERT OR IGNORE INTO rounds(id,user_id,date,mode,store,started) VALUES (?,?,?,?,?,?)').bind(id, user.id, today(), practice ? 'practice' : 'daily', store, now()),
            ...chosen.map((p, index) => db.prepare('INSERT OR IGNORE INTO lines(id,round_id,name,ean,plu,section,position,risk,product_id) VALUES (?,?,?,?,?,?,?,?,(SELECT id FROM products WHERE id=?))').bind(`${id}:${index}`, id, p.name, p.ean||'', p.plu, p.section, index + 1,p.risk||'normal',p.id))
        ]);
        const round = await db.prepare('SELECT * FROM rounds WHERE id=?').bind(id).first();
        const lines = await db.prepare('SELECT * FROM lines WHERE round_id=? ORDER BY position').bind(id).all();
        return answer({ round, lines: lines.results });
    }
    if (req.method === 'POST' && (path === 'lines/verify' || path === 'lines/save')) {
        const line = await db.prepare('SELECT l.*,r.user_id,r.finished FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=?').bind(String(body.id)).first();
        must(line && line.user_id === user.id, 'Check line not found.', 404);
        must(!line.finished, 'This check has already been completed.');
        if (path === 'lines/verify') {
            const outcome=await barcodeTransaction(db,async c=>{
                const current=(await c.query('SELECT l.*,r.mode,r.user_id,r.finished FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=$1 FOR UPDATE OF r,l',[line.id])).rows[0];
                must(current&&current.user_id===user.id&&!current.finished,'This check has already been completed.');
                const result=await verifyBarcode(c,{productId:current.product_id,snapshotEan:current.ean,ean:String(body.ean||''),user,method:body.method,confirmUnknown:body.confirmUnknown===true,practice:current.mode==='practice'});
                if(result.verified)await c.query(`UPDATE lines SET verified_at=$1,method=$2,ean=$3,barcode_candidate_id=$4,status=CASE WHEN status='off_sale' THEN NULL ELSE status END,saved_at=CASE WHEN status='off_sale' THEN NULL ELSE saved_at END WHERE id=$5`,[now(),body.method,body.ean,result.candidateId,current.id]);
                else await c.query(`UPDATE lines SET verified_at=NULL,method=NULL,barcode_candidate_id=NULL,status=CASE WHEN status='off_sale' THEN status ELSE NULL END,saved_at=CASE WHEN status='off_sale' THEN saved_at ELSE NULL END WHERE id=$1`,[current.id]);
                return result;
            });
            return answer(outcome,outcome.code==='wrong_product'?409:200);
        }
        const offSale=body.status==='off_sale';
        must(offSale||line.verified_at, 'Verify the product barcode before saving a result.');
        must(validOutcome(body.status, body.quantity), ['rotation_issue','off_sale'].includes(body.status)?'Rotation issue and Off sale are recorded without a quantity.':'Out of date and Not stickered need a whole quantity from 1 to 9,999.');
        const saved=await barcodeTransaction(db,async c=>{
            const current=(await c.query('SELECT l.*,r.user_id,r.finished,r.mode FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=$1 FOR UPDATE OF r,l',[line.id])).rows[0];
            must(current&&current.user_id===user.id&&!current.finished,'This check has already been completed.');
            must(offSale||current.verified_at,'Verify the product barcode before saving a result.');
            if(!offSale){
                const match=await verifyBarcode(c,{productId:current.product_id,snapshotEan:current.ean,ean:current.ean,user,method:current.method,confirmUnknown:true,practice:current.mode==='practice'});
                if(!match.verified){await c.query('UPDATE lines SET verified_at=NULL,method=NULL,status=NULL,saved_at=NULL,barcode_candidate_id=NULL WHERE id=$1',[current.id]);return {error:match.error||match.message,code:match.code||'review_denied',product:match.product};}
            }
            await c.query('UPDATE lines SET status=$1,quantity=$2,saved_at=$3,verified_at=CASE WHEN $4 THEN NULL ELSE verified_at END,method=CASE WHEN $4 THEN NULL ELSE method END,barcode_candidate_id=CASE WHEN $4 THEN NULL ELSE barcode_candidate_id END WHERE id=$5',[body.status,body.quantity,now(),offSale,current.id]);
            return {ok:true};
        });
        return answer(saved,saved.error?409:200);
    }
    if (req.method === 'POST' && path === 'rounds/finish') {
        const outcome=await barcodeTransaction(db,async c=>{
            const round=(await c.query('SELECT * FROM rounds WHERE id=$1 AND user_id=$2 FOR UPDATE',[String(body.id),user.id])).rows[0];
            must(round,'Check not found.',404);
            if(round.finished)return {ok:true,learning:[]};
            const lines=(await c.query('SELECT * FROM lines WHERE round_id=$1 ORDER BY position',[round.id])).rows;
            must(lines.length>0&&lines.every(l=>l.status&&(l.status==='off_sale'||l.verified_at)),'Every line must be scanned and recorded, or marked Off sale, before finishing.');
            for(const line of lines.filter(l=>l.status!=='off_sale')){
                const owner=await barcodeOwner(c,line.ean);
                const wrong=owner&&(line.product_id?owner.id!==line.product_id:owner.plu!==line.plu||owner.name!==line.name);
                const candidate=line.barcode_candidate_id?(await c.query('SELECT status FROM barcode_candidates WHERE id=$1',[line.barcode_candidate_id])).rows[0]:null;
                if(wrong||(!owner&&candidate?.status==='denied')){
                    await c.query('UPDATE lines SET verified_at=NULL,method=NULL,status=NULL,saved_at=NULL,barcode_candidate_id=NULL WHERE id=$1',[line.id]);
                    return {error:wrong?`Wrong product: ${owner.name} · PLU ${owner.plu}`:'This barcode link was denied. Scan the correct pack or ask an administrator.',code:wrong?'wrong_product':'review_denied',product:owner,lineId:line.id};
                }
            }
            const finished=new Date().toISOString();await c.query('UPDATE rounds SET finished=$1 WHERE id=$2',[finished,round.id]);
            await c.query(`INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) SELECT l.id || ':recheck:' || to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),l.id,to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),$1 FROM lines l WHERE l.round_id=$2 AND $3='daily' AND l.status='rotation_issue' ON CONFLICT DO NOTHING`,[finished,round.id,round.mode]);
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
    if (e?.code === '23505') return answer({error:'That barcode or username already exists.'},400);
        console.error('DateCheck request failed', e instanceof Error ? e.message : 'Unknown failure');
    return answer({ error: 'Something went wrong. Please try again.' }, 500);
} }
