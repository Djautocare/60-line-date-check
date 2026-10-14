import {LuminanceSource,InvertedLuminanceSource,EAN13Reader,HybridBinarizer,BitArray,NotFoundException}from'@zxing/library';
/** Every 15 degrees across a half-turn; ZXing also reads each scan line backwards. */
export const SCAN_ANGLES=[0,90,45,135,30,120,60,150,15,105,75,165];
class AngledLuminanceSource extends LuminanceSource{
 /** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {number} angle */
 constructor(pixels,width,height,angle){
  const radians=angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const rotatedWidth=Math.ceil(Math.abs(cos)*width+Math.abs(sin)*height-1e-7);
  const rotatedHeight=Math.ceil(Math.abs(sin)*width+Math.abs(cos)*height-1e-7);
  super(rotatedWidth,rotatedHeight);this.pixels=pixels;this.sourceWidth=width;this.sourceHeight=height;this.cos=cos;this.sin=sin;
 }
 /** @param {number} y @param {Uint8ClampedArray} [row] */
 getRow(y,row){
  const width=this.getWidth();if(!row||row.length<width)row=new Uint8ClampedArray(width);
  const offsetY=y-(this.getHeight()-1)/2;
  const sourceCentreX=(this.sourceWidth-1)/2,sourceCentreY=(this.sourceHeight-1)/2;
  let sourceX=this.cos*(-(width-1)/2)+this.sin*offsetY+sourceCentreX;
  let sourceY=-this.sin*(-(width-1)/2)+this.cos*offsetY+sourceCentreY;
  for(let x=0;x<width;x++,sourceX+=this.cos,sourceY-=this.sin){
   const sx=Math.round(sourceX),sy=Math.round(sourceY);
   row[x]=sx<0||sy<0||sx>=this.sourceWidth||sy>=this.sourceHeight?255:this.pixels[sy*this.sourceWidth+sx];
  }
  return row;
 }
 getMatrix(){const width=this.getWidth(),height=this.getHeight();const result=new Uint8ClampedArray(width*height);for(let y=0;y<height;y++)result.set(this.getRow(y),y*width);return result;}
 invert(){return new InvertedLuminanceSource(this);}
}
/** A bounded local threshold fallback for shaded labels against high-contrast backgrounds. */
class LocalRowBinarizer extends HybridBinarizer{
 getBlackRow(y,row){
  const source=this.getLuminanceSource(),width=source.getWidth();
  if(!row||row.getSize()<width)row=new BitArray(width);else row.clear();
  const pixels=source.getRow(y),prefix=new Uint32Array(width+1);
  for(let x=0;x<width;x++)prefix[x+1]=prefix[x]+pixels[x];
  const radius=Math.max(12,Math.round(width/32));
  for(let x=0;x<width;x++){
   const start=Math.max(0,x-radius),end=Math.min(width,x+radius+1);
   const threshold=(prefix[end]-prefix[start])/(end-start)-5;
   if(pixels[x]<threshold)row.set(x);
  }
  return row;
 }
 createBinarizer(source){return new LocalRowBinarizer(source);}
}
/** Try later guards too: packaging text can resemble a start marker before the barcode. */
function readRows(reader,binarizer){
 const width=binarizer.getWidth(),height=binarizer.getHeight(),middle=Math.floor(height/2),step=Math.max(1,height>>6);
 const matches=new Map();let row=new BitArray(width);
 for(let n=0;n<49;n++){
  const offset=Math.floor((n+1)/2),y=middle+step*(n%2===0?offset:-offset);
  if(y<0||y>=height)continue;
  try{row=binarizer.getBlackRow(y,row);}catch{continue;}
  for(let direction=0;direction<2;direction++){
   if(direction)row.reverse();
   let start=0;
   for(let attempt=0;attempt<24&&start<width;attempt++){
    const candidate={getSize:()=>row.getSize(),get:x=>row.get(x),isRange:(a,b,value)=>row.isRange(a,b,value),getNextSet:x=>row.getNextSet(Math.max(start,x)),getNextUnset:x=>row.getNextUnset(Math.max(start,x))};
    let guard;
    try{guard=EAN13Reader.findStartGuardPattern(candidate);}catch{break;}
    try{
     const result=reader.decodeRow(y,candidate),text=result.getText();
     const match=matches.get(text)||{result,rows:new Set()};match.rows.add(y);matches.set(text,match);
     if(match.rows.size>=3)return match.result;
    }catch{}
    start=guard[1];
   }
  }
 }
 throw new NotFoundException();
}
/** Reuse a decoder across frames. Rotated sources are immutable and keep the correct dimensions. */
export function createEAN13Decoder(){
 const reader=new EAN13Reader();
 /** @type {number|null} */let lastAngle=null;
 /** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {number[]} [angles] */
 return (pixels,width,height,angles=SCAN_ANGLES)=>{
  const scanAngles=lastAngle===null?angles:[lastAngle,...angles.filter(angle=>angle!==lastAngle)];
  for(const Binarizer of [HybridBinarizer,LocalRowBinarizer])for(const angle of scanAngles){
   const source=new AngledLuminanceSource(pixels,width,height,angle);
   try{const result=readRows(reader,new Binarizer(source));lastAngle=angle;return result;}catch{}
  }
  throw new NotFoundException('No EAN-13 barcode found in this frame.');
 };
}
