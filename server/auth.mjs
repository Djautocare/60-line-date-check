import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(scrypt);
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function validUsername(value){return typeof value==='string'&&/^[a-z0-9._-]{3,40}$/.test(value);}
export function validPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=256;}
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,64,{N:16384,r:8,p:1});return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,stored){try{const [salt,key]=stored.split(':');const hash=await derive(password,salt,64,{N:16384,r:8,p:1});const expected=Buffer.from(key,'hex');return hash.length===expected.length&&timingSafeEqual(hash,expected);}catch{return false;}}
export async function bootstrapAdmin(db,config){
 const existing=await db.prepare("SELECT id FROM members WHERE role='admin' LIMIT 1").first();if(existing)return;
 const username=String(config.username||'').toLowerCase().trim();
 if(!validUsername(username)||!validPassword(config.password))throw new Error('Set ADMIN_USERNAME (3–40 characters) and ADMIN_PASSWORD (12–256 characters) before first startup.');
 const id=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO members(id,username,name,password_hash,role,active,created) VALUES (?,?,?,?,?,1,?)').bind(id,username,config.name||'Administrator',await hashPassword(config.password),'admin',new Date().toISOString()),db.prepare("INSERT INTO settings(key,value) VALUES ('owner',?)").bind(id)]);
}
export async function authenticate(req,db){
 const token=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('datecheck_session='))?.slice(18);
 if(!token||!/^\w{64}$/.test(token))return null;
 return db.prepare("SELECT m.*,m.id=(SELECT value FROM settings WHERE key='owner') AS is_owner,t.number AS store_number FROM sessions s JOIN members m ON m.id=s.user_id LEFT JOIN stores t ON t.id=m.store_id WHERE s.token_hash=? AND s.expires>? AND m.active=1").bind(tokenHash(token),Date.now()).first();
}
export function newToken(){return randomBytes(32).toString('hex');}
export function publicMember(m){return {id:m.id,name:m.name,username:m.username,role:m.role,active:m.active,store_id:m.store_id||null,store_number:m.store_number||null,is_owner:!!m.is_owner};}
