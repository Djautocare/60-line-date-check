import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {EAN13Reader,LuminanceSource,InvertedLuminanceSource,HybridBinarizer,BinaryBitmap} from '@zxing/library';
import {getGuideCrop,createScanConfirmation} from '../src/scan-region.mjs';
import {createEAN13Decoder,SCAN_ANGLES} from '../src/ean-orientation.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/ean-rotations.json',import.meta.url),'utf8'));
const view={width:360,height:360,guide:{left:43.2,top:43.2,width:273.6,height:273.6}};
function cropPixels(pixels,width,crop){
 const result=new Uint8ClampedArray(crop.width*crop.height);
 for(let y=0;y<crop.height;y++)result.set(pixels.subarray((crop.top+y)*width+crop.left,(crop.top+y)*width+crop.left+crop.width),y*crop.width);
 return result;
}
function clutter(width,height){
 const pixels=new Uint8ClampedArray(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=((Math.floor(x/7)+Math.floor(y/13))%2)?245:12;
 return pixels;
}
function place(pixels,width,height,frame,shaded=false){
 const source=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64')));
 const left=Math.floor((width-frame.width)/2),top=Math.floor((height-frame.height)/2);
 for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
  const value=source[y*frame.width+x];
  pixels[(top+y)*width+left+x]=shaded?Math.round(130+65*x/frame.width+value*0.16):value;
 }
}
test('guide coordinates match the object-fit cover preview in landscape and portrait frames',()=>{
 assert.deepEqual(getGuideCrop(1920,1080,view),{left:549,top:129,width:822,height:822});
 assert.deepEqual(getGuideCrop(1080,1920,view),{left:129,top:549,width:822,height:822});
 const wide={width:400,height:300,guide:{left:56,top:6,width:288,height:288}};
 const crop=getGuideCrop(1920,1080,wide),scale=300/1080,offset=(1920*scale-400)/2;
 assert.ok(Math.abs(crop.left*scale-offset-wide.guide.left)<1);
 assert.ok(Math.abs(crop.top*scale-wide.guide.top)<1);
 assert.ok(crop.left>=0&&crop.top>=0&&crop.left+crop.width<=1920&&crop.top+crop.height<=1080);
});
test('guide crops remain inside the source when a layout extends beyond the preview',()=>{
 const crop=getGuideCrop(640,480,{width:320,height:240,guide:{left:-100,top:-100,width:1000,height:1000}});
 assert.deepEqual(crop,{left:0,top:0,width:640,height:480});
 assert.throws(()=>getGuideCrop(0,0),/empty/);
});
test('a live scan needs matching consecutive frames and resets after noise or a different code',()=>{
 const confirm=createScanConfirmation();
 assert.equal(confirm('4088600303390'),false);
 assert.equal(confirm('7088034303390'),false);
 assert.equal(confirm(null),false);
 assert.equal(confirm('4088600303390'),false);
 assert.equal(confirm('4088600303390'),true);
});
test('diagonal camera reads confirm on the next frame while angle batches keep cycling',()=>{
 const diagonals=SCAN_ANGLES.filter(angle=>angle!==0&&angle!==90);
 for(const frame of fixture.frames){
  const pixels=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64'))),decode=createEAN13Decoder(),confirm=createScanConfirmation();
  let confirmed=false;
  for(let n=0;n<diagonals.length+2;n+=2){
   const offset=n%diagonals.length,angles=[0,90,diagonals[offset],diagonals[(offset+1)%diagonals.length]];
   try{confirmed=confirm(decode(pixels,frame.width,frame.height,angles).getText());}catch{confirm(null);}
   if(confirmed)break;
  }
  assert.ok(confirmed,`${frame.angle} degrees must confirm without waiting for its angle batch to return`);
 }
});
for(const frame of fixture.frames.filter(f=>[0,45,17,73].includes(f.angle))){
 test(`a barcode at ${frame.angle} degrees reads inside the guide against busy packaging`,()=>{
  const width=1920,height=1080,pixels=clutter(width,height);place(pixels,width,height,frame);
  const crop=getGuideCrop(width,height,view),focused=cropPixels(pixels,width,crop);
  assert.equal(createEAN13Decoder()(focused,crop.width,crop.height).getText(),fixture.ean);
 });
}
test('low-contrast shaded bars remain readable when surrounding print dominates the histogram',()=>{
 const frame=fixture.frames.find(f=>f.angle===0),width=1920,height=1080,pixels=clutter(width,height);place(pixels,width,height,frame,true);
 const crop=getGuideCrop(width,height,view),focused=cropPixels(pixels,width,crop);
 class Source extends LuminanceSource{
  constructor(){super(crop.width,crop.height);}
  getRow(y){return focused.subarray(y*crop.width,(y+1)*crop.width);}
  getMatrix(){return focused;}
  invert(){return new InvertedLuminanceSource(this);}
 }
 assert.throws(()=>new EAN13Reader().decode(new BinaryBitmap(new HybridBinarizer(new Source()))));
 assert.equal(createEAN13Decoder()(focused,crop.width,crop.height,[0]).getText(),fixture.ean);
});
test('a complete barcode outside the guide is excluded from a live scan',()=>{
 const width=1920,height=1080,pixels=new Uint8ClampedArray(width*height).fill(255),frame=fixture.frames.find(f=>f.angle===0);
 const source=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64')));
 // A small label at the left of the full frame, outside the source-space guide.
 for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x+=2)pixels[(490+y)*width+20+Math.floor(x/2)]=source[y*frame.width+x];
 assert.equal(createEAN13Decoder()(pixels,width,height,[0]).getText(),fixture.ean);
 const crop=getGuideCrop(width,height,view);
 assert.throws(()=>createEAN13Decoder()(cropPixels(pixels,width,crop),crop.width,crop.height),/No EAN-13/);
});
