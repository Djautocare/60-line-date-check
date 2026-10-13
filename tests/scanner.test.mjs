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
