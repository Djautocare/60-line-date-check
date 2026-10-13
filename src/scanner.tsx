'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, X, Flashlight, ImagePlus } from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { validEAN13 } from './ean';
export default function Scanner({onRead,onClose}:{onRead:(ean:string,method:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null);const controls=useRef<IScannerControls|null>(null);const live=useRef(false);
 const [error,setError]=useState('');const [starting,setStarting]=useState(true);const [torch,setTorch]=useState(false);const [canTorch,setCanTorch]=useState(false);
 const onReadRef=useRef(onRead);onReadRef.current=onRead;
 useEffect(()=>{
  live.current=true;let closed=false;
  (async()=>{
   try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Open this page in Safari or Chrome using its HTTPS link to use the camera.');
    const [{BrowserMultiFormatReader},{BarcodeFormat,DecodeHintType}]=await Promise.all([import('@zxing/browser'),import('@zxing/library')]);
    if(closed)return;
    const reader=new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13]]]),{delayBetweenScanAttempts:150,delayBetweenScanSuccess:300});
    const c=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}},video.current!, (result,_error,c)=>{
     if(result&&live.current&&validEAN13(result.getText())){live.current=false;c.stop();onReadRef.current(result.getText(),'camera');}
    });
    if(closed||!live.current){c.stop();return;}controls.current=c;setCanTorch(typeof c.switchTorch==='function');setStarting(false);
   }catch(e){if(closed)return;setStarting(false);const name=e instanceof Error?e.name:'';setError(name==='NotAllowedError'?'Camera access was denied. Allow camera access in your browser settings, or enter the EAN manually.':name==='NotFoundError'?'No camera was found on this device.':e instanceof Error?e.message:'Could not open your camera. Try entering the EAN manually.');}
  })();
  return()=>{closed=true;live.current=false;controls.current?.stop();const stream=video.current?.srcObject as MediaStream|null;stream?.getTracks().forEach(t=>t.stop());};
 },[]);
 async function photo(file:File){
  const url=URL.createObjectURL(file);controls.current?.stop();live.current=false;
  try{const [{BrowserMultiFormatReader},{BarcodeFormat,DecodeHintType}]=await Promise.all([import('@zxing/browser'),import('@zxing/library')]);const reader=new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13]]]));const result=await reader.decodeFromImageUrl(url);if(!validEAN13(result.getText()))throw new Error();onReadRef.current(result.getText(),'photo');}
  catch{setError('No EAN-13 barcode found. Try a clear, well-lit photo with the whole barcode visible.');}finally{URL.revokeObjectURL(url);}
 }
 return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Scan EAN-13 barcode"><div className="scanner-modal"><div className="scanner-head"><span><Camera size={20}/> Scan product barcode</span><button className="icon-btn" aria-label="Close scanner" onClick={onClose}><X/></button></div><div className="video-wrap"><video ref={video} autoPlay muted playsInline/><div className="scan-guide"><i/><i/><i/><i/><span/></div>{starting&&<p className="camera-message">Opening rear camera…</p>}</div><div className="scanner-help"><p>Hold the full barcode inside the frame.<br/><span>Keep your phone steady and avoid reflections.</span></p>{error&&<p className="error" role="alert">{error}</p>}<div className="button-row">{canTorch&&<button className="button secondary" onClick={async()=>{try{await controls.current?.switchTorch?.(!torch);setTorch(!torch);}catch{setError('This camera does not support the torch.');}}}><Flashlight size={16}/>{torch?'Torch off':'Torch on'}</button>}<label className="button secondary"><ImagePlus size={16}/> Scan a photo<input className="file-input" type="file" accept="image/*" capture="environment" onChange={e=>{if(e.target.files?.[0])void photo(e.target.files[0]);}}/></label><button className="button quiet" onClick={onClose}>Enter EAN manually</button></div></div></div></div>;
}
