import {LuminanceSource,InvertedLuminanceSource,EAN13Reader,HybridBinarizer,BinaryBitmap,NotFoundException}from'@zxing/library';
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
/** Reuse a decoder across frames. Rotated sources are immutable and keep the correct dimensions. */
export function createEAN13Decoder(){
 const reader=new EAN13Reader();
 /** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {number[]} [angles] */
 return (pixels,width,height,angles=SCAN_ANGLES)=>{
  for(const angle of angles){
   try{const source=new AngledLuminanceSource(pixels,width,height,angle);return reader.decode(new BinaryBitmap(new HybridBinarizer(source)));}catch{}
  }
  throw new NotFoundException('No EAN-13 barcode found in this frame.');
 };
}
