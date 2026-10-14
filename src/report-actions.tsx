import {useEffect,useRef} from 'react';
import {Download,MoreHorizontal,Printer} from 'lucide-react';

export default function ReportActions({onDownload}:{onDownload:()=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  function outside(event:PointerEvent){if(menu.current&&!menu.current.contains(event.target as Node))menu.current.open=false;}
  function escape(event:KeyboardEvent){if(event.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 function choose(action:()=>void){if(menu.current)menu.current.open=false;action();}
 return <details ref={menu} className="report-actions"><summary aria-label="Report options" title="More report options"><MoreHorizontal size={22} aria-hidden="true"/></summary><div className="report-action-menu"><button onClick={()=>choose(onDownload)}><Download size={17} aria-hidden="true"/>Download CSV</button><button onClick={()=>choose(()=>window.print())}><Printer size={17} aria-hidden="true"/>Print report</button></div></details>;
}
