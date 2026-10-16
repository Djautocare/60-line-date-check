import {CHECK_AREA_ORDER} from '../shared/area-order.mjs';
import {useEffect,useMemo,useState} from 'react';
import {Save,Shuffle} from 'lucide-react';
import type {Product,Risk,Store} from './types';

type Props={products:Product[];store:Store|null;counts:Record<string,number>|null;selection:Product[]|null;owner:boolean;date:string;roundId:string|null;onRegenerated:()=>Promise<void>;request:(path:string,body?:unknown)=>Promise<any>;onChanged:()=>Promise<void>};
const preferred:readonly string[]=CHECK_AREA_ORDER;
const riskLabels:Record<Risk,string>={high:'High risk',normal:'Normal',low:'Low risk'};
export default function DailySelection({products,store,counts,selection,owner,date,roundId,onRegenerated,request,onChanged}:Props){
 const available=useMemo(()=>{const result=new Map<string,number>();for(const p of products)result.set(p.section,(result.get(p.section)||0)+1);return result;},[products]);
 // Keep saved areas visible even after catalogue renames or deletions.
 const areas=Array.from(new Set([...available.keys(),...Object.keys(counts||{}),...(selection||[]).map(p=>p.section)])).sort((a,b)=>{
  const ai=preferred.indexOf(a),bi=preferred.indexOf(b);return (ai<0?preferred.length:ai)-(bi<0?preferred.length:bi)||a.localeCompare(b);
 });
 const [mode,setMode]=useState(counts?'areas':'random'),[draft,setDraft]=useState<Record<string,string>>(()=>Object.fromEntries(Object.entries(counts||{}).map(([a,n])=>[a,String(n)])));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{setMode(counts?'areas':'random');setDraft(Object.fromEntries(Object.entries(counts||{}).map(([a,n])=>[a,String(n)])));setError('');},[counts]);
 const total=areas.reduce((sum,a)=>sum+Number(draft[a]||0),0);
 const invalid=areas.some(a=>{const n=Number(draft[a]||0);return !Number.isInteger(n)||n<0||n>Math.min(60,available.get(a)||0);});
 const valid=mode==='random'||(!invalid&&total===60);
 const unsaved=(mode==='areas')!==(counts!==null)||(mode==='areas'&&areas.some(a=>Number(draft[a]||0)!==(counts?.[a]||0)));
 const todayCounts=new Map<string,number>();for(const p of selection||[])todayCounts.set(p.section,(todayCounts.get(p.section)||0)+1);
 const storeName=store?.number?'Store '+store.number:store?.name;
 async function save(e:React.FormEvent){
  e.preventDefault();if(!store||!valid)return;setBusy(true);setError('');setNotice('');
  try{
   const result=await request('selection-policy',{storeId:store.id,counts:mode==='areas'?Object.fromEntries(areas.map(a=>[a,Number(draft[a]||0)])):null});
   await onChanged();
   setNotice(`Saved for ${storeName}. ${result.todayLocked?'Today’s list is already saved and stays the same. Your new settings apply to the next day whose list has not been generated.':'Your settings will be used when this store’s daily list is first generated.'}`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function regenerate(){
  if(!store||!selection||busy||unsaved)return;
  if(!window.confirm(`Regenerate today’s 60-line list for ${storeName}? This permanently removes today’s current check/report, recorded results and its rotation rechecks, and reopens the shared check with a fresh random selection using the saved split. Other days and stores are kept. Staff must refresh or reopen the check. This cannot be undone.`))return;
  setBusy(true);setError('');setNotice('');
  try{await request('selection/regenerate',{storeId:store.id,date,roundId,confirm:true});await onRegenerated();setNotice(`Today’s list for ${storeName} has been regenerated using the saved settings. The shared check is ready to start again. Staff should refresh or reopen it.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <>
  <div className="page-heading"><div><p className="eyebrow dark">ADMIN / DAILY SELECTION</p><h1>Daily product split</h1><p>Set how many of the 60 daily lines come from each area.</p></div></div>
  {!store?<div className="panel empty-state"><h2>Choose a store first</h2><p>Use the store filter above to manage its daily split. Each store can have its own settings.</p></div>:<form className="panel area-selection" onSubmit={e=>void save(e)}>
   <div className="panel-heading"><h3>{storeName}</h3><Shuffle size={20}/></div>
   <fieldset disabled={busy}>
    <label className="selection-mode">Selection method<select value={mode} onChange={e=>{setMode(e.target.value);setNotice('');}}><option value="random">Random across the whole catalogue</option><option value="areas">Choose a count for each area</option></select></label>
    <p>{mode==='areas'?'Enter whole numbers totalling 60. Set an area to 0 to exclude it.':'The 60 lines can come from any area. Area totals vary each day.'} High risk increases a product’s chance and Low risk reduces it{mode==='areas'?' within its own area':''}.</p>
    <div className="table-scroll"><table><thead><tr><th>Area</th><th>Catalogue products</th><th>Daily lines</th>{selection&&<th>Today’s saved lines</th>}</tr></thead><tbody>{areas.map(a=>{
     const limit=Math.min(60,available.get(a)||0),n=Number(draft[a]||0),bad=mode==='areas'&&(!Number.isInteger(n)||n<0||n>limit);
     return <tr key={a}><td><strong>{a}</strong></td><td>{available.get(a)||0}</td><td>{mode==='areas'?<><input aria-label={'Daily lines from '+a} aria-invalid={bad} type="number" min={0} max={limit} step={1} inputMode="numeric" value={draft[a]??'0'} onChange={e=>{setDraft({...draft,[a]:e.target.value});setNotice('');}}/>{bad&&<small className="error">Choose a whole number from 0 to {limit}.</small>}</>:<span>Random</span>}</td>{selection&&<td>{todayCounts.get(a)||0}</td>}</tr>;
    })}</tbody></table></div>
    <div className="area-selection-footer"><p className={mode==='areas'&&!valid?'error':''} role="status">{mode==='areas'?`Total: ${Number.isFinite(total)?total:'—'} / 60 lines`:'Total: 60 random lines'}{mode==='areas'&&!invalid&&total!==60?' — adjust the counts to reach 60.':''}</p><button className="button primary" disabled={!valid}><Save size={18}/>{busy?'Saving…':'Save daily split'}</button></div>
   </fieldset>
   {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="report-notice" role="status">{notice}</p>}
   <p className="form-footnote">{selection?'Today’s saved lines above are the actual current list. Saving new counts will not replace it.':'These settings apply when the next daily list is generated.'} Everyone in this store shares the same list and completion. Practice checks use a separate random sample.</p>
   {owner&&<div className="regenerate-selection"><h3>Owner controls</h3><p>Replace today’s saved list, clear its results and reopen the store’s check, even if it is completed. This uses your saved area counts. Products can be picked again.</p><button type="button" className="button secondary danger" disabled={busy||!selection||unsaved} onClick={()=>void regenerate()}><Shuffle size={18}/>Regenerate today’s list</button><p className="form-footnote">{unsaved?'Save your split changes first.':!selection?'Start the daily check to generate the first list.':'Only the protected original owner can do this. A confirmation is required.'}</p></div>}
  </form>}
  <div className="stats-grid risk-stats">{(['high','normal','low'] as Risk[]).map(r=><div className="stat" key={r}><span>{riskLabels[r].toUpperCase()}</span><strong>{products.filter(p=>p.risk===r).length}<small>products</small></strong><p>{r==='high'?'More likely to appear':r==='low'?'Less likely to appear':'Standard selection chance'}</p></div>)}</div>
  <div className="panel selection-policy"><div className="split-intro"><Shuffle size={24}/><div><h3>Random products within your split</h3><p>Each product can appear once in a daily list and may return on consecutive days. Risk affects which products are picked, while area counts fix how many come from each area.</p></div></div><div className="policy-details"><p><strong>Today’s list stays saved.</strong> Changes to counts, risk or the catalogue affect future selections. Existing checks and reports keep their original products.</p><p><strong>Not enough products in an area?</strong> Reduce its daily count or add products. The app will explain the shortage before generating a new list.</p></div></div>
 </>;
}
