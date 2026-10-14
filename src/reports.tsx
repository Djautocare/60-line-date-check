import {useEffect,useState} from 'react';
import {ArrowLeft,ChevronRight,Download,ListChecks,Loader2} from 'lucide-react';
import {reportRange} from '../shared/report-dates.mjs';
import type {Line,Round} from './types';
import ReportActions from './report-actions';

type Props={admin:boolean;today:string;request:(path:string)=>Promise<any>;onExport:(detail:{round:Round;lines:Line[]})=>void};
type Checker={id:string;name:string;username:string};
type Page={reports:Round[];total:number;offset:number;limit:number;checkers:Checker[]};
const results:Record<string,string>={okay:'Okay',out_of_date:'Out of date',not_stickered:'Not stickered',rotation_issue:'Rotation issue'};
const risks:Record<string,string>={high:'High risk',normal:'Normal',low:'Low risk'};
export default function Reports({admin,today,request,onExport}:Props){
 const [mode,setMode]=useState('all'),[date,setDate]=useState(today),[end,setEnd]=useState(today),[month,setMonth]=useState(today.slice(0,7)),[period,setPeriod]=useState('last_7'),[checker,setChecker]=useState(''),[offset,setOffset]=useState(0);
 const [page,setPage]=useState<Page|null>(null),[checkers,setCheckers]=useState<Checker[]>([]),[detail,setDetail]=useState<{round:Round;lines:Line[]}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[opening,setOpening]=useState(false),[exporting,setExporting]=useState(false);
 let range:{from?:string;to?:string}={},validation='';
 try{range=reportRange(mode,mode==='month'?month:mode==='period'?period:date,end,today);}catch(e){validation=(e as Error).message;}
 const params=new URLSearchParams({...range,...(checker?{checkedBy:checker}:{})});
 const filters=params.toString();
 const path=(start:number)=>'reports?'+filters+'&offset='+start;
 useEffect(()=>{
  if(validation){setLoading(false);setPage(null);return;}
  let active=true;setLoading(true);setError('');
  request('reports?'+filters+'&offset='+offset).then(data=>{if(active){setPage(data);setCheckers(data.checkers);if(data.total>0&&offset>=data.total)setOffset(0);}}).catch(e=>{if(active){setPage(null);setError(e.message);}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[filters,offset,validation,request]);
 function reset(){setMode('all');setChecker('');setOffset(0);setDate(today);setEnd(today);setMonth(today.slice(0,7));setPeriod('last_7');}
 async function open(id:string){setOpening(true);setError('');try{setDetail(await request('report/'+encodeURIComponent(id)));}catch(e){setError((e as Error).message);}finally{setOpening(false);}}
 async function downloadSummary(){
  setExporting(true);setError('');
  try{
   const rows:Round[]=[];let next=0;
   do{const data:Page=await request(path(next));rows.push(...data.reports);next+=data.limit;if(next>=data.total||!data.reports.length)break;}while(true);
   const headers=['Date','Check type','Checked by','Store','Status','Lines checked','Total lines','Out of date items','Not stickered items','Rotation issue lines','Started','Finished'];
   const csv=[headers,...rows.map(r=>[r.date,r.mode,r.user_name,r.store,r.finished?'Completed':'In progress',r.checked,r.total,r.out_of_date,r.not_stickered,r.rotation_issue,r.started,r.finished])].map(row=>row.map(v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
   const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`datecheck-reports-${range.from||'all'}-${range.to||'dates'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError((e as Error).message);}finally{setExporting(false);}
 }
 return <>
  <div className="page-heading"><div><p className="eyebrow dark">YOUR CHECK RECORDS</p><h1>Reports</h1><p>{admin?'Filter date checks across all staff accounts.':'Find your saved and in-progress date checks.'}</p></div>{!detail&&<button className="button secondary" disabled={loading||exporting||!!validation||!page?.total} onClick={()=>void downloadSummary()}>{exporting?<Loader2 size={16} className="spin"/>:<Download size={16}/>}Download filtered summary</button>}</div>
  {error&&<p className="error" role="alert">{error}</p>}
  {detail?<div className="panel report-detail"><div className="report-heading"><button className="button quiet" onClick={()=>setDetail(null)}><ArrowLeft size={16}/>Back to filtered reports</button><ReportActions onDownload={()=>onExport(detail)}/></div><div className="report-meta"><p className="report-print-brand">DateCheck · date check report</p><h2>{detail.round.date} · {detail.round.mode==='practice'?'Practice check':'Daily check'}</h2><p>{detail.round.user_name} · {detail.round.store||'No store entered'} · {detail.round.finished?'Completed':'In progress'}</p><p className="report-print-summary">{detail.lines.filter(l=>l.status).length} / {detail.lines.length} lines checked · Out of date: {detail.lines.filter(l=>l.status==='out_of_date').reduce((sum,l)=>sum+l.quantity,0)} items · Not stickered: {detail.lines.filter(l=>l.status==='not_stickered').reduce((sum,l)=>sum+l.quantity,0)} items · Rotation issues: {detail.lines.filter(l=>l.status==='rotation_issue').length} lines</p></div><div className="table-scroll"><table><thead><tr><th>Product / PLU</th><th>Area</th><th>Risk</th><th>Result</th><th>Quantity</th><th>Verification</th></tr></thead><tbody>{detail.lines.map(l=><tr key={l.id}><td><strong>{l.name}</strong><small>{l.plu} · {l.ean}</small></td><td>{l.section}</td><td><span className={'risk-badge '+l.risk}>{risks[l.risk||'normal']}</span></td><td><span className={'result-badge '+l.status}>{results[l.status||'']||'Pending'}</span></td><td>{l.status==='out_of_date'||l.status==='not_stickered'?l.quantity:'—'}</td><td>{l.verified_at?l.method:'Pending'}</td></tr>)}</tbody></table></div></div>:<>
   <div className="panel report-filters"><fieldset disabled={exporting}>
    <label>Time frame<select value={mode} onChange={e=>{setMode(e.target.value);setOffset(0);}}><option value="all">All dates</option><option value="date">Single date</option><option value="week">Week</option><option value="month">Month</option><option value="range">Selection of dates</option><option value="period">Time period</option></select></label>
    {(mode==='date'||mode==='week'||mode==='range')&&<label>{mode==='week'?'Date within week':mode==='range'?'From date':'Date'}<input type="date" value={date} onChange={e=>{setDate(e.target.value);setOffset(0);}}/></label>}
    {mode==='range'&&<label>To date<input type="date" min={date} value={end} onChange={e=>{setEnd(e.target.value);setOffset(0);}}/></label>}
    {mode==='month'&&<label>Month<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setOffset(0);}}/></label>}
    {mode==='period'&&<label>Time period<select value={period} onChange={e=>{setPeriod(e.target.value);setOffset(0);}}><option value="last_7">Last 7 days</option><option value="last_30">Last 30 days</option><option value="last_90">Last 90 days</option><option value="this_month">This month so far</option><option value="this_year">This year so far</option></select></label>}
    {admin&&<label>Checked by<select value={checker} onChange={e=>{setChecker(e.target.value);setOffset(0);}}><option value="">All staff</option>{checkers.map(m=><option key={m.id} value={m.id}>{m.name} (@{m.username})</option>)}</select></label>}
    <button className="button quiet" onClick={reset}>Clear filters</button>
   </fieldset><p className={validation?'error':'filter-caption'} role={validation?'alert':undefined}>{validation||(!range.from?'Showing checks from all dates.':`${range.from} to ${range.to} inclusive.${mode==='week'?' Weeks run Monday to Sunday.':''}`)}</p></div>
   <div className="panel" aria-busy={loading}>{loading?<div className="empty-state"><Loader2 className="spin" size={28}/><p>Loading reports…</p></div>:page?.reports.length?<><div className="table-scroll"><table><thead><tr><th>Date / type</th><th>Checked by</th><th>Progress</th><th>Out of date</th><th>Not stickered</th><th>Rotation issue</th><th/></tr></thead><tbody>{page.reports.map(r=><tr key={r.id}><td><strong>{r.date}</strong><small>{r.mode==='practice'?'Practice check':'Daily 60-line check'}</small></td><td>{r.user_name}<small>{r.store}</small></td><td><span className={'status-pill '+(r.finished?'complete':'')}>{r.finished?'Completed':`${r.checked}/${r.total} checked`}</span></td><td>{r.out_of_date||0}</td><td>{r.not_stickered||0}</td><td>{r.rotation_issue||0}</td><td><button className="button quiet" disabled={opening||exporting} onClick={()=>void open(r.id)}>View<ChevronRight size={16}/></button></td></tr>)}</tbody></table></div><div className="report-pagination"><span>{page.offset+1}–{Math.min(page.offset+page.reports.length,page.total)} of {page.total} reports</span><div className="button-row"><button className="button quiet" disabled={offset===0||exporting} onClick={()=>setOffset(Math.max(0,offset-page.limit))}><ArrowLeft size={16}/>Previous</button><button className="button quiet" disabled={offset+page.limit>=page.total||exporting} onClick={()=>setOffset(offset+page.limit)}>Next<ChevronRight size={16}/></button></div></div></>:<div className="empty-state"><ListChecks size={36}/><h3>{validation?'Choose your dates':error?'Reports could not be loaded':'No matching reports'}</h3><p>{validation||error||'Try another time frame or staff member.'}</p></div>}</div>
  </>}
 </>;
}
