import {barcodeTransaction,BarcodeProblem} from './barcodes.mjs';
import {hashPassword,validPassword,validUsername,publicMember} from './auth.mjs';
const must=(ok,msg,status=400)=>{if(!ok)throw new BarcodeProblem(status,msg);};
export async function storeAccess(c,user,storeId){
 const current=(await c.query("SELECT m.*,m.id=(SELECT value FROM settings WHERE key='owner') AS is_owner FROM members m WHERE id=$1",[user.id])).rows[0];
 must(current?.active&&(current.is_owner||current.store_id===storeId),'Your store access has changed. Refresh and sign in again.',403);
}
export function roundAccess(round,user,scope){return round&&(!scope||round.store_id===scope)&&(user.role==='admin'||round.mode==='daily'||round.user_id===user.id);}
export async function storeAdmin(db,user,scope,path,body){
 must(user.role==='admin','Administrator access is required.',403);
 return barcodeTransaction(db,async c=>{
  const owner=(await c.query("SELECT value FROM settings WHERE key='owner'")).rows[0]?.value;
  const isOwner=owner===user.id;
  const admin=(await c.query('SELECT * FROM members WHERE id=$1',[user.id])).rows[0];
  must(admin?.active&&admin.role==='admin','Administrator access has changed.',403);
  must(isOwner||(admin.store_id&&admin.store_id===scope),'No assigned store.',403);
  const safe=m=>({...publicMember({...m,is_owner:m.id===owner}),created:m.created});
  if(path==='stores'){
   must(isOwner,'Only the original owner can manage stores.',403);
   return {stores:(await c.query('SELECT * FROM stores ORDER BY number NULLS FIRST,name')).rows};
  }
  if(path==='stores/save'){
   must(isOwner,'Only the original owner can manage stores.',403);const number=String(body.number||'').trim(),name=String(body.name||'').trim();must(/^\d{1,10}$/.test(number),'Enter a store number using 1–10 digits.');must(name.length<=100,'Store names can be up to 100 characters.');
   const id=body.id?String(body.id):crypto.randomUUID();
   if(body.id){const exists=(await c.query('SELECT id FROM stores WHERE id=$1',[id])).rows[0];must(exists,'Store not found.',404);await c.query('UPDATE stores SET number=$1,name=$2 WHERE id=$3',[number,name||'Store '+number,id]);}
   else await c.query('INSERT INTO stores(id,number,name,created) VALUES($1,$2,$3,$4)',[id,number,name||'Store '+number,new Date().toISOString()]);
   return {ok:true,id};
  }
  if(path==='members/list')return {members:(await c.query(`SELECT * FROM members ${scope?'WHERE store_id=$1':''} ORDER BY created`,scope?[scope]:[])).rows.map(safe)};
  if(path==='store-members/search'){
   const username=String(body.username||'').trim().toLowerCase();must(validUsername(username),'Enter the exact username.');
   const m=(await c.query('SELECT * FROM members WHERE username=$1',[username])).rows[0];
   return {member:m?safe(m):null,available:!!m&&(isOwner||m.store_id===null||m.store_id===scope),transfer:!!m&&m.store_id!==null&&m.store_id!==scope};
  }
  if(path==='members/create'){
   const username=String(body.username||'').trim().toLowerCase(),name=String(body.name||'').trim();must(validUsername(username),'Use a username of 3–40 letters, numbers, dots, underscores or hyphens.');must(validPassword(body.password),'Passwords must have 12–256 characters.');must(['admin','staff'].includes(body.role),'Choose admin or staff.');must(name&&name.length<=100,'Enter a display name of up to 100 characters.');
   const storeId=body.storeId?String(body.storeId):scope;must(storeId,'Choose a store for the new account.');must(isOwner||storeId===scope,'You can only create accounts in your store.',403);must((await c.query('SELECT id FROM stores WHERE id=$1',[storeId])).rows.length,'Store not found.',404);
   await c.query('INSERT INTO members(id,name,username,password_hash,role,active,created,store_id) VALUES($1,$2,$3,$4,$5,1,$6,$7)',[crypto.randomUUID(),name,username,await hashPassword(body.password),body.role,new Date().toISOString(),storeId]);return {ok:true};
  }
  if(path==='store-members/add'){
   const username=String(body.username||'').trim().toLowerCase();const m=(await c.query('SELECT * FROM members WHERE username=$1 FOR UPDATE',[username])).rows[0];must(m,'Account not found.',404);
   const target=body.storeId?String(body.storeId):scope;must(target,'Choose a store first.');must(isOwner||target===scope,'You can only add people to your own store.',403);must((await c.query('SELECT id FROM stores WHERE id=$1',[target])).rows.length,'Store not found.',404);
   must(isOwner||m.id!==owner,'The original owner account cannot be changed.',403);
   must(m.store_id===null||m.store_id===target||(isOwner&&body.transfer===true),'This account belongs to another store. Only the owner can explicitly transfer it.',409);
   await c.query('UPDATE members SET store_id=$1 WHERE id=$2',[target,m.id]);if(m.id!==user.id)await c.query('DELETE FROM sessions WHERE user_id=$1',[m.id]);return {ok:true};
  }
  const m=(await c.query('SELECT * FROM members WHERE id=$1 FOR UPDATE',[String(body.id||'')])).rows[0];must(m&&(isOwner||m.store_id===scope),'Account not found in this store.',404);
  must(m.id!==owner,'The original owner account cannot be changed.',403);must(m.id!==user.id,'Use Account settings for your own account.');
  if(path==='store-members/remove'){await c.query('UPDATE members SET store_id=NULL WHERE id=$1',[m.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[m.id]);return {ok:true};}
  if(path==='members/password'){must(validPassword(body.password),'Passwords must have 12–256 characters.');await c.query('UPDATE members SET password_hash=$1 WHERE id=$2',[await hashPassword(body.password),m.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[m.id]);return {ok:true};}
  must(path==='members'&&['admin','staff'].includes(body.role)&&[0,1].includes(body.active),'Invalid account settings.');
  await c.query('UPDATE members SET role=$1,active=$2 WHERE id=$3',[body.role,body.active,m.id]);if(!body.active||m.role!==body.role)await c.query('DELETE FROM sessions WHERE user_id=$1',[m.id]);return {ok:true};
 });
}
