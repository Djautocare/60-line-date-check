import {useEffect,useRef,useState} from 'react';
import Scanner from './scanner';
import {validEAN13} from './ean';
type Props={id:string;revision?:number;endpoint?:string;request:(path:string,body?:unknown)=>Promise<any>;onClose:()=>void;onVerified:(ean:string,method:string,data:any)=>void;initialEan?:string;onReset?:()=>void};
export default function BarcodeVerification({id,revision,endpoint='lines/verify',request,onClose,onVerified,initialEan,onReset}:Props){
 const [screen,setScreen]=useState(initialEan?'reading':'scan'),[ean,setEan]=useState(initialEan||''),[method,setMethod]=useState(initialEan?'manual':'camera'),[data,setData]=useState<any>(null),[message,setMessage]=useState('');
 const revisionRef=useRef(revision);
 const active=useRef(true),busy=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;if(timer.current)clearTimeout(timer.current);};},[]);
 useEffect(()=>{if(initialEan)void verify(initialEan,'manual');},[]);
 function retry(){setData(null);setMessage('');setScreen(method==='manual'?'manual':'scan');}
 async function verify(value:string,source:string,confirmUnknown=false){
  if(busy.current)return;busy.current=true;onReset?.();setEan(value);setMethod(source);setScreen('reading');setMessage('');
  try{const result=await request(endpoint,{id,ean:value,method:source,confirmUnknown,...(endpoint==='lines/verify'?{revision:revisionRef.current}:{})});if(!active.current)return;if(result.revision!==undefined)revisionRef.current=result.revision;
   if(result.verified){onVerified(value,source,result);return;}
   setData(result);setMessage(result.message||'Ask an administrator to review this barcode.');setScreen('proposal');
  }catch(error){if(!active.current)return;const e=error as any;if(e.revision!==undefined)revisionRef.current=e.revision;setMessage(e.message);
   if(e.code==='wrong_product'){setData(e.product);setScreen('wrong');timer.current=setTimeout(()=>{if(active.current){setData(null);setScreen(source==='manual'?'manual':'scan');}},3000);}
   else setScreen('error');
  }finally{busy.current=false;}
 }
 if(screen==='scan')return <Scanner onRead={(value,source)=>void verify(value,source)} onClose={onClose} onManual={()=>setScreen('manual')}/>;
 return <div className={'modal-backdrop '+(screen==='wrong'?'wrong-barcode-overlay':'')} role="dialog" aria-modal="true" aria-label="Product barcode verification"><section className="panel barcode-dialog"><button className="button quiet" onClick={onClose}>Close</button>
  {screen==='wrong'?<div role="alert"><h2>Wrong product</h2><h3>{data?.name}</h3><p>PLU <strong>{data?.plu}</strong> · {data?.section}</p><p>EAN {ean} belongs to this product.</p><p>Scanning resumes in 3 seconds.</p></div>:screen==='manual'?<><h2>Enter the pack barcode</h2><form onSubmit={e=>{e.preventDefault();void verify(ean,'manual');}}><label>EAN-13<input autoFocus inputMode="numeric" maxLength={13} value={ean} onChange={e=>setEan(e.target.value.replace(/\D/g,''))}/></label><button className="button primary" disabled={!validEAN13(ean)}>Check barcode</button></form><button className="button quiet" onClick={()=>setScreen('scan')}>Use camera</button></>:screen==='reading'?<p role="status">Checking barcode…</p>:<>
  <h2>{screen==='proposal'?'Unrecognised barcode':'Could not check barcode'}</h2><p>EAN <strong>{ean}</strong></p><p role="status">{message}</p>
  {data?.needsConfirmation&&<><h3>{data.product.name}</h3><p>PLU <strong>{data.product.plu}</strong> · {data.product.section}</p><p>Check the name and PLU on the actual pack or shelf label. {data.mixedCase?'This new variant goes to admin review.':`${data.observations} of 4 completed daily checks recorded so far.`}</p><button className="button primary" onClick={()=>void verify(ean,method,true)}>Yes, this is the selected product</button></>}
  <button className="button secondary" onClick={retry}>Scan again</button></>}
 </section></div>;
}
