import { validEAN13, validOutcome } from './ean.mjs';
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
        return answer({ member: publicMember(member), date: today(), products: products.results, round, lines: lines.results, selection: selected ? JSON.parse(selected.items) : null, riskWeights:RISK_WEIGHTS });
    }
    if (req.method === 'GET' && path === 'reports') {
        const reports = await db.prepare(`SELECT r.*,m.name AS user_name,COUNT(l.id) AS total,SUM(CASE WHEN l.status IS NOT NULL THEN 1 ELSE 0 END) AS checked,SUM(CASE WHEN l.status='out_of_date' THEN l.quantity ELSE 0 END) AS out_of_date,SUM(CASE WHEN l.status='not_stickered' THEN l.quantity ELSE 0 END) AS not_stickered,SUM(CASE WHEN l.status='rotation_issue' THEN 1 ELSE 0 END) AS rotation_issue FROM rounds r JOIN members m ON m.id=r.user_id LEFT JOIN lines l ON l.round_id=r.id ${isAdmin ? '' : 'WHERE r.user_id=?'} GROUP BY r.id,m.name ORDER BY r.started DESC LIMIT 100`).bind(...(isAdmin ? [] : [user.id])).all();
        return answer({ reports: reports.results });
    }
    if (req.method === 'GET' && path.startsWith('report/')) {
        const id = decodeURIComponent(path.slice(7));
        const round = await db.prepare('SELECT r.*,m.name AS user_name FROM rounds r JOIN members m ON m.id=r.user_id WHERE r.id=?').bind(id).first();
        must(round && (isAdmin || round.user_id === user.id), 'Report not found.', 404);
        const lines = await db.prepare('SELECT * FROM lines WHERE round_id=? ORDER BY position').bind(id).all();
        return answer({ round, lines: lines.results });
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
        const product=await db.prepare('SELECT * FROM products WHERE ean=?').bind(body.ean).first();
        must(product,'This barcode is not in the catalogue. Add it as a new product first.',404);
        return answer({product});
    }
    if (req.method === 'POST' && path === 'products') {
        admin();
        const items = Array.isArray(body.items) ? body.items : [body];
        must(items.length >= 1 && items.length <= 2000, 'Import between 1 and 2,000 products at a time.');
        const clean = items.map((p) => ({ id: p.id || crypto.randomUUID(), name: String(p.name || '').trim(), ean: String(p.ean || '').trim(), plu: String(p.plu || '').trim(), section: String(p.section || '').trim(),risk:p.risk===undefined?null:String(p.risk) }));
        for (const p of clean) {
            must(p.name.length > 0 && p.name.length <= 160, 'Every product needs a name of up to 160 characters.');
            must(/^\d{6}$/.test(p.plu), 'Every product needs a 6-digit PLU.');
            must(p.section.length > 0, 'Every product needs an area.');
            must(validEAN13(p.ean), `Invalid EAN-13: ${p.ean.slice(0, 30)}`);
            must(p.section.length <= 80, 'Section names can be up to 80 characters.');
            must(p.risk===null||validRisk(p.risk),'Choose High risk, Normal or Low risk.');
        }
        must(new Set(clean.map((p) => p.ean)).size === clean.length, 'Your import contains duplicate barcodes.');
        await db.batch(clean.map((p) => body.id ? db.prepare('UPDATE products SET name=?,ean=?,plu=?,section=?,risk=COALESCE(?,risk) WHERE id=?').bind(p.name, p.ean, p.plu, p.section,p.risk,p.id) : db.prepare(`INSERT INTO products(id,name,ean,plu,section,risk) VALUES (?,?,?,?,?,COALESCE(?,'normal')) ON CONFLICT(ean) DO UPDATE SET name=excluded.name,plu=excluded.plu,section=excluded.section,risk=CASE WHEN ? THEN excluded.risk ELSE products.risk END`).bind(p.id, p.name, p.ean, p.plu, p.section,p.risk,p.risk!==null)));
        return answer({ ok: true, count: clean.length });
    }
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
            ...chosen.map((p, index) => db.prepare('INSERT OR IGNORE INTO lines(id,round_id,name,ean,plu,section,position,risk) VALUES (?,?,?,?,?,?,?,?)').bind(`${id}:${index}`, id, p.name, p.ean, p.plu, p.section, index + 1,p.risk||'normal'))
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
            must(validEAN13(String(body.ean || '')), 'Enter a valid EAN-13 barcode.');
            must(body.ean === line.ean, 'Wrong product. Scan the barcode on the expected item.', 409);
            must(['camera', 'manual', 'photo'].includes(body.method), 'Invalid scan method.');
            const updates = await db.batch([db.prepare('SELECT id FROM rounds WHERE id=? FOR UPDATE').bind(line.round_id),db.prepare('UPDATE lines SET verified_at=?,method=? WHERE id=? AND EXISTS (SELECT 1 FROM rounds WHERE rounds.id=lines.round_id AND finished IS NULL)').bind(now(), body.method, line.id)]);
            must(updates[1].rowCount > 0, 'This check has already been completed.');
            return answer({ verified: true });
        }
        must(line.verified_at, 'Verify the product barcode before saving a result.');
        must(validOutcome(body.status, body.quantity), body.status==='rotation_issue'?'Rotation issue is recorded without a quantity.':'Out of date and Not stickered need a whole quantity from 1 to 9,999.');
        const updates = await db.batch([db.prepare('SELECT id FROM rounds WHERE id=? FOR UPDATE').bind(line.round_id),db.prepare('UPDATE lines SET status=?,quantity=?,saved_at=? WHERE id=? AND EXISTS (SELECT 1 FROM rounds WHERE rounds.id=lines.round_id AND finished IS NULL)').bind(body.status, body.quantity, now(), line.id)]);
        must(updates[1].rowCount > 0, 'This check has already been completed.');
        return answer({ ok: true });
    }
    if (req.method === 'POST' && path === 'rounds/finish') {
        const round = await db.prepare('SELECT * FROM rounds WHERE id=? AND user_id=?').bind(String(body.id), user.id).first();
        must(round, 'Check not found.', 404);
        const count = await db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN status IS NULL OR verified_at IS NULL THEN 1 ELSE 0 END) AS remaining FROM lines WHERE round_id=?').bind(round.id).first();
        must(count && count.total > 0 && Number(count.remaining) === 0, 'Every line must be verified and recorded before finishing.');
        await db.prepare('UPDATE rounds SET finished=COALESCE(finished,?) WHERE id=? AND NOT EXISTS (SELECT 1 FROM lines WHERE round_id=rounds.id AND (status IS NULL OR verified_at IS NULL))').bind(now(), round.id).run();
        return answer({ ok: true });
    }
    throw new Problem(404, 'This action was not found.');
}
export async function handle(req, db, user) { try {
    return await run(req, db, user);
}
catch (e) {
    if (e instanceof Problem)
        return answer({ error: e.message }, e.status);
    if (e?.code === '23505') return answer({error:'That barcode or username already exists.'},400);
        console.error('DateCheck request failed', e instanceof Error ? e.message : 'Unknown failure');
    return answer({ error: 'Something went wrong. Please try again.' }, 500);
} }
