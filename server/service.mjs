import {storeAccess,roundAccess,storeAdmin} from './stores.mjs';
import {BarcodeProblem,barcodeTransaction,importCatalogue} from './barcodes.mjs';
import { validOutcome } from './ean.mjs';
import {validDate,nextDate} from '../shared/report-dates.mjs';
import {selectProducts,selectDailyProducts,validateAreaCounts,SelectionProblem,RISK_WEIGHTS}from './selection.mjs';
import { publicMember } from './auth.mjs';
import {orderByArea} from '../shared/area-order.mjs';
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
const visibleResults=(rows,user)=>user.role==='admin'?rows:rows.map(row=>{const result={...row};for(const field of ['saved_at','checked_at','verified_at','created'])if(field in result)result[field]=null;return result;});
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
    if(!scope&&!user.is_owner){must(path==='state','This account has no assigned store. Ask a store admin to add your username.',403);return answer({member:publicMember(user),date:today(),store:null,products:[],round:null,lines:[],selection:null,selectionCounts:null,sharedCheck:null,riskWeights:RISK_WEIGHTS});}
    if(['lines/verify','lines/no-ean','rotation-rechecks/verify','rotation-rechecks/no-ean'].includes(path))throw new Problem(410,'Scanning is no longer needed. Refresh the website and record the result directly.');
    if (req.method === 'GET' && path === 'state') {
        const products = await db.prepare('SELECT * FROM products ORDER BY section,name').all();
        const shared=scope?await db.prepare('SELECT * FROM store_daily_checks WHERE store_id=? AND date=?').bind(scope,today()).first():null;
        const round=shared?.round_id?await db.prepare('SELECT * FROM rounds WHERE id=?').bind(shared.round_id).first():null;
        const lines = round ? await db.prepare('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE l.round_id=? ORDER BY l.position').bind(round.id).all() : { results: [] };
        const policy=scope?await db.prepare('SELECT value FROM settings WHERE key=?').bind('area-counts:'+scope).first():null;
        const selected=scope?await db.prepare('SELECT items FROM selections WHERE store_id=? AND date=?').bind(scope,today()).first():null;
        return answer({ member: publicMember(member), date: today(),store,sharedCheck:shared?{roundId:shared.round_id,completed:!!shared.completed_at,reportDeleted:!shared.round_id&&!!shared.completed_at}:null, products: products.results.map(p=>({...p,ean:p.ean||''})), round, lines: visibleResults(lines.results,user), selection: selected ? JSON.parse(selected.items) : null, selectionCounts:policy?JSON.parse(policy.value):null, riskWeights:RISK_WEIGHTS });
    }
    if(req.method==='POST'&&path==='selection/regenerate'){
        must(user.is_owner,'Only the protected original owner can regenerate a daily list.',403);
        must(scope,'Choose a store before regenerating its daily list.');
        must(body.storeId===scope&&body.date===today(),'The selected store or date has changed. Refresh and try again.',409);
        must(body.confirm===true,'Confirm that today’s check and results will be replaced.');
        return answer(await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,scope);
            const owner=(await c.query("SELECT m.id FROM members m WHERE m.id=$1 AND m.active=1 AND m.role='admin' AND m.id=(SELECT value FROM settings WHERE key='owner')",[user.id])).rows[0];
            must(owner,'Only the protected original owner can regenerate a daily list.',403);
            const date=today();must(body.date===date,'The date has changed. Refresh and try again.',409);
            const shared=(await c.query('SELECT * FROM store_daily_checks WHERE store_id=$1 AND date=$2 FOR UPDATE',[scope,date])).rows[0];
            const saved=(await c.query('SELECT items FROM selections WHERE store_id=$1 AND date=$2',[scope,date])).rows[0];
            must(saved,'There is no saved list to regenerate. Start the daily check first.',409);
            must(body.roundId===(shared?.round_id||null),'Today’s check has changed. Refresh before regenerating it.',409);
            const catalogue=(await c.query('SELECT * FROM products')).rows;
            must(catalogue.length>=60,'Add at least 60 products to regenerate a daily check.');
            const policy=(await c.query('SELECT value FROM settings WHERE key=$1',['area-counts:'+scope])).rows[0];
            const chosen=selectDailyProducts(catalogue,policy?JSON.parse(policy.value):null);
            if(shared?.round_id){
                await c.query('SELECT id FROM rounds WHERE id=$1 FOR UPDATE',[shared.round_id]);
                await c.query('DELETE FROM rotation_rechecks WHERE origin_line_id IN (SELECT id FROM lines WHERE round_id=$1)',[shared.round_id]);
                await c.query('DELETE FROM barcode_observations WHERE round_id=$1',[shared.round_id]);
                await c.query('DELETE FROM lines WHERE round_id=$1',[shared.round_id]);
                await c.query('DELETE FROM rounds WHERE id=$1',[shared.round_id]);
            }
            const id=`store-daily:${scope}:${date}:${crypto.randomUUID()}`,created=now();
            await c.query('UPDATE selections SET items=$1,created=$2 WHERE store_id=$3 AND date=$4',[JSON.stringify(chosen),created,scope,date]);
            await c.query("INSERT INTO rounds(id,user_id,date,mode,store,started,store_id) VALUES($1,$2,$3,'daily',$4,$5,$6)",[id,user.id,date,store.number||store.name,created,scope]);
            for(const [index,p] of chosen.entries())await c.query('INSERT INTO lines(id,round_id,name,ean,plu,section,position,risk,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id+':'+index,id,p.name,p.ean||'',p.plu,p.section,index+1,p.risk||'normal',p.id]);
            await c.query('INSERT INTO store_daily_checks(store_id,date,round_id,completed_at) VALUES($1,$2,$3,NULL) ON CONFLICT(store_id,date) DO UPDATE SET round_id=EXCLUDED.round_id,completed_at=NULL',[scope,date,id]);
            return {ok:true};
        }));
    }
    if(req.method==='POST'&&path==='selection-policy'){
        admin();must(scope,'Choose a store before changing its daily split.');must(body.storeId===undefined||body.storeId===scope,'The selected store has changed. Refresh and try again.',409);
        return answer(await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,scope);
            const current=(await c.query('SELECT role FROM members WHERE id=$1',[user.id])).rows[0];must(current?.role==='admin','Administrator access has changed.',403);
            const catalogue=(await c.query('SELECT section FROM products')).rows;
            const counts=validateAreaCounts(body.counts,catalogue);
            await c.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',['area-counts:'+scope,JSON.stringify(counts)]);
            const locked=(await c.query('SELECT date FROM selections WHERE store_id=$1 AND date=$2',[scope,today()])).rows.length>0;
            return {ok:true,counts,todayLocked:locked};
        }));
    }
    if(['barcode-reviews','products/by-plu','barcodes/lookup','barcode-reviews/resolve','barcodes/assign','products/lookup'].includes(path))throw new Problem(410,'Barcode features have been removed. Use the product name and PLU in the catalogue.');
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
        return answer({rechecks:visibleResults(result.results,user),total:Number(count.total),upcoming:Number(upcoming.total),offset,limit,today:today()});
    }
    if(req.method==='POST'&&path==='rotation-rechecks/save'){
        const recheck=await db.prepare('SELECT q.*,l.ean,l.product_id,l.round_id,r.store_id FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id JOIN rounds r ON r.id=l.round_id WHERE q.id=?').bind(String(body.id)).first();
        must(recheck&&(!scope||recheck.store_id===scope),'Rotation recheck not found.',404);
        must(!recheck.status,'This rotation recheck has already been saved.',409);
        must(recheck.due_date<=today(),'This recheck is scheduled for a future date.');
        must(['okay','rotation_issue','off_sale'].includes(body.status),'Choose Okay now, Still a rotation issue or Off sale.');
        const offSale=body.status==='off_sale';
        must(body.quantity===undefined||body.quantity===0,'Rotation rechecks do not take a quantity.');
        const checkedAt=now(),due=nextDate(today());
        const outcome=await barcodeTransaction(db,async c=>{
            await storeAccess(c,user,recheck.store_id);
            await c.query('SELECT id FROM rounds WHERE id=$1 FOR UPDATE',[recheck.round_id]);
            const current=(await c.query('SELECT q.*,l.product_id,l.ean,l.plu,l.name FROM rotation_rechecks q JOIN lines l ON l.id=q.origin_line_id WHERE q.id=$1 FOR UPDATE OF q',[recheck.id])).rows[0];
            must(current&&!current.status,'This rotation recheck has already been saved.',409);
            await c.query("UPDATE rotation_rechecks SET status=$1,checked_at=$2,checked_by=$3,verified_at=NULL,verified_by=NULL,method=CASE WHEN $4 THEN NULL ELSE 'product_check' END,scanned_ean=NULL WHERE id=$5",[body.status,checkedAt,user.id,offSale,current.id]);
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
        return answer({ round, lines: visibleResults(lines.results,user) });
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
    if(req.method==='POST'&&path==='products'){admin();if(Object.hasOwn(body,'items'))must(user.is_owner,'Only the protected original owner can import CSV products.',403);return answer(await importCatalogue(db,body,user));}
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
                if(shared.round_id)return {round:(await c.query('SELECT * FROM rounds WHERE id=$1',[shared.round_id])).rows[0],lines:visibleResults((await c.query('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE round_id=$1 ORDER BY position',[shared.round_id])).rows,user)};
            }
            const catalogue=(await c.query('SELECT * FROM products')).rows;
            let chosen;
            if(practice){must(catalogue.length>0,'Add a product first.');chosen=orderByArea(selectProducts(catalogue,Math.min(60,catalogue.length)));}
            else{
                const saved=(await c.query('SELECT items FROM selections WHERE store_id=$1 AND date=$2',[scope,today()])).rows[0];
                if(saved)chosen=JSON.parse(saved.items);
                else{
                    must(catalogue.length>=60,'Add at least 60 products to start a daily check.');
                    const policy=(await c.query('SELECT value FROM settings WHERE key=$1',['area-counts:'+scope])).rows[0];
                    chosen=selectDailyProducts(catalogue,policy?JSON.parse(policy.value):null);
                }
                if(!saved)await c.query('INSERT INTO selections(store_id,date,items,created) VALUES($1,$2,$3,$4)',[scope,today(),JSON.stringify(chosen),now()]);
            }
            const id=practice?crypto.randomUUID():`store-daily:${scope}:${today()}`;
            await c.query('INSERT INTO rounds(id,user_id,date,mode,store,started,store_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,today(),practice?'practice':'daily',store.number||store.name,now(),scope]);
            for(const [index,p] of chosen.entries())await c.query('INSERT INTO lines(id,round_id,name,ean,plu,section,position,risk,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM products WHERE id=$9))',[id+':'+index,id,p.name,p.ean||'',p.plu,p.section,index+1,p.risk||'normal',p.id]);
            if(!practice)await c.query('UPDATE store_daily_checks SET round_id=$1 WHERE store_id=$2 AND date=$3',[id,scope,today()]);
            return {round:(await c.query('SELECT * FROM rounds WHERE id=$1',[id])).rows[0],lines:visibleResults((await c.query('SELECT l.*,m.name AS recorded_by_name FROM lines l LEFT JOIN members m ON m.id=l.recorded_by WHERE round_id=$1 ORDER BY position',[id])).rows,user)};
        }));
    }
    if (req.method === 'POST' && path==='lines/save') {
        const line = await db.prepare('SELECT l.*,r.user_id,r.finished,r.store_id,r.mode FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=?').bind(String(body.id)).first();
        must(roundAccess(line,user,scope),'Check line not found.',404);
        must(!line.finished, 'This check has already been completed.');
        const offSale=body.status==='off_sale';
        must(validOutcome(body.status, body.quantity), ['rotation_issue','off_sale'].includes(body.status)?'Rotation issue and Off sale are recorded without a quantity.':'Out of date and Not stickered need a whole quantity from 1 to 9,999.');
        const saved=await barcodeTransaction(db,async c=>{
            const current=(await c.query('SELECT l.*,r.user_id,r.finished,r.mode,r.store_id FROM lines l JOIN rounds r ON r.id=l.round_id WHERE l.id=$1 FOR UPDATE OF r,l',[line.id])).rows[0];
            must(roundAccess(current,user,scope)&&!current.finished,'This check has already been completed.');
                await storeAccess(c,user,current.store_id);
                if(body.revision!==undefined&&body.revision!==current.revision)throw new BarcodeProblem(409,'Another colleague changed this line. Review the latest result before saving again.',{code:'line_changed',revision:current.revision});
            await c.query("UPDATE lines SET status=$1,quantity=$2,saved_at=$3,verified_at=NULL,method=CASE WHEN $4 THEN NULL ELSE 'product_check' END,barcode_candidate_id=NULL,verified_by=NULL,recorded_by=$6,revision=revision+1 WHERE id=$5",[body.status,body.quantity,now(),offSale,current.id,user.id]);
            return {ok:true,revision:current.revision+1};
        });
        return answer(saved,saved.error?409:200);
    }
    if (req.method === 'POST' && path === 'rounds/finish') {
        const outcome=await barcodeTransaction(db,async c=>{
            const round=(await c.query('SELECT * FROM rounds WHERE id=$1 FOR UPDATE',[String(body.id)])).rows[0];
            must(roundAccess(round,user,scope),'Check not found.',404);await storeAccess(c,user,round.store_id);
            if(round.finished)return {ok:true};
            const lines=(await c.query('SELECT * FROM lines WHERE round_id=$1 ORDER BY position',[round.id])).rows;
            must(lines.length>0&&lines.every(l=>l.status),'Every line must have a result or be marked Off sale before finishing.');
            const finished=new Date().toISOString();await c.query('UPDATE rounds SET finished=$1,finished_by=$3 WHERE id=$2',[finished,round.id,user.id]);
            await c.query(`INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created) SELECT l.id || ':recheck:' || to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),l.id,to_char((($1::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),$1 FROM lines l WHERE l.round_id=$2 AND $3='daily' AND l.status='rotation_issue' ON CONFLICT DO NOTHING`,[finished,round.id,round.mode]);
            if(round.mode==='daily')await c.query('UPDATE store_daily_checks SET completed_at=$1 WHERE round_id=$2',[finished,round.id]);
            return {ok:true};
        });
        return answer(outcome,outcome.error?409:200);
    }
    throw new Problem(404, 'This action was not found.');
}
export async function handle(req, db, user) { try {
    return await run(req, db, user);
}
catch (e) {
    if(e instanceof SelectionProblem)return answer({error:e.message},400);
    if(e instanceof BarcodeProblem)return answer({error:e.message,...e.details},e.status);
    if (e instanceof Problem)
        return answer({ error: e.message }, e.status);
    if (e?.code === '23505') return answer({error:'That PLU, username or store number already exists.'},400);
        console.error('DateCheck request failed', e instanceof Error ? e.message : 'Unknown failure');
    return answer({ error: 'Something went wrong. Please try again.' }, 500);
} }
