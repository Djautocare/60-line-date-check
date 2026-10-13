import {BrowserMultiFormatReader}from'@zxing/browser';
import {BarcodeFormat,DecodeHintType,NotFoundException,ChecksumException,FormatException,type Result}from'@zxing/library';
import{createEAN13Decoder,SCAN_ANGLES}from'./ean-orientation.mjs';
/** Keep the existing camera and torch controls; add bounded rotated fallback passes. */
export function createOrientationReader(photo=false){
 const decode=createEAN13Decoder();const diagonalAngles=SCAN_ANGLES.filter(a=>a!==0&&a!==90);
 class OrientationReader extends BrowserMultiFormatReader{
  private work:HTMLCanvasElement|null=null;
  private nextAngle=0;
  override decodeFromCanvas(canvas:HTMLCanvasElement):Result{
   // Preserve the fast path for the orientation that already scans well.
   try{return super.decodeFromCanvas(canvas);}catch(error){if(!(error instanceof NotFoundException||error instanceof ChecksumException||error instanceof FormatException))throw error;}
   this.work??=document.createElement('canvas');
   const scale=Math.min(1,1280/Math.max(canvas.width,canvas.height));
   const width=Math.max(1,Math.round(canvas.width*scale)),height=Math.max(1,Math.round(canvas.height*scale));
   if(this.work.width!==width)this.work.width=width;if(this.work.height!==height)this.work.height=height;
   const ctx=this.work.getContext('2d',{willReadFrequently:true});if(!ctx)throw new NotFoundException('Camera frame unavailable.');
   ctx.drawImage(canvas,0,0,width,height);const rgba=ctx.getImageData(0,0,width,height).data;
   const pixels=new Uint8ClampedArray(width*height);for(let i=0,j=0;i<rgba.length;i+=4,j++)pixels[j]=rgba[i+3]===0?255:(306*rgba[i]+601*rgba[i+1]+117*rgba[i+2]+512)>>10;
   // Check sideways every frame, then cycle diagonals instead of blocking the phone on every angle.
   const angles=photo?SCAN_ANGLES:[90,diagonalAngles[this.nextAngle%diagonalAngles.length],diagonalAngles[(this.nextAngle+1)%diagonalAngles.length]];
   if(!photo)this.nextAngle=(this.nextAngle+2)%diagonalAngles.length;
   return decode(pixels,width,height,angles);
  }
 }
 return new OrientationReader(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13]]]),{delayBetweenScanAttempts:150,delayBetweenScanSuccess:300});
}
