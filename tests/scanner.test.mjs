import {test} from 'node:test';import assert from 'node:assert/strict';
import {MultiFormatReader,BarcodeFormat,DecodeHintType,RGBLuminanceSource,HybridBinarizer,BinaryBitmap}from'@zxing/library';
test('camera decoder reads a rendered EAN-13 for the supplied Aldi barcode',()=>{
 const ean='4088600303390';
 const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
 const G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
 const R=L.map(x=>[...x].map(d=>d==='0'?'1':'0').join(''));
 const parity=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][Number(ean[0])];
 const bits='000000000000'+'101'+[...ean.slice(1,7)].map((n,i)=>(parity[i]==='L'?L:G)[Number(n)]).join('')+'01010'+[...ean.slice(7)].map(n=>R[Number(n)]).join('')+'101'+'000000000000';
 const scale=4,width=bits.length*scale,height=100;const pixels=new Uint8ClampedArray(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=bits[Math.floor(x/scale)]==='1'?0:255;
 const reader=new MultiFormatReader();reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13]]]));
 const result=reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,width,height))));assert.equal(result.getText(),ean);
});

import{readFileSync}from'node:fs';import{inflateSync,deflateSync}from'node:zlib';import{createEAN13Decoder,SCAN_ANGLES}from'../src/ean-orientation.mjs';
const rotated=JSON.parse(readFileSync(new URL('./fixtures/ean-rotations.json',import.meta.url),'utf8'));
// Derive exact quarter turns by transposing pixels. Diagonal base images were resampled independently with Pillow.
function quarterTurn(frame){
 const source=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64'))),width=frame.height,height=frame.width,pixels=new Uint8ClampedArray(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=source[x*frame.width+frame.width-1-y];
 return {angle:(frame.angle+90)%360,width,height,pixels:deflateSync(pixels).toString('base64')};
}
rotated.frames=rotated.frames.flatMap(frame=>{const frames=[frame];if(frame.angle!==359)for(let i=0;i<3;i++)frames.push(quarterTurn(frames.at(-1)));return frames;});
for(const frame of rotated.frames){
 test(`orientation decoder reads the Aldi barcode at ${frame.angle} degrees`,()=>{
  const pixels=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64')));const original=pixels.slice();
  const decode=createEAN13Decoder();const result=decode(pixels,frame.width,frame.height);assert.equal(result.getText(),rotated.ean);assert.deepEqual(pixels,original,'Rotation must not mutate the captured frame.');
 });
}
test('live camera angle batches eventually cover every diagonal orientation',()=>{
 const diagonals=SCAN_ANGLES.filter(a=>a!==0&&a!==90);
 for(const frame of rotated.frames){
  const pixels=new Uint8ClampedArray(inflateSync(Buffer.from(frame.pixels,'base64')));const decode=createEAN13Decoder();let found=false;
  for(let offset=0;offset<diagonals.length;offset+=2){try{const result=decode(pixels,frame.width,frame.height,[0,90,diagonals[offset],diagonals[offset+1]]);assert.equal(result.getText(),rotated.ean);found=true;break;}catch{}}
  assert.ok(found,`${frame.angle} degrees must be readable by the live scan cycle`);
 }
});
test('a blank camera frame keeps scanning instead of producing a barcode',()=>{const pixels=new Uint8ClampedArray(640*480).fill(255);assert.throws(()=>createEAN13Decoder()(pixels,640,480),/No EAN-13 barcode found/);});
