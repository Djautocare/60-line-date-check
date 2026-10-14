/**
 * Map the visible guide to source pixels when the video uses object-fit: cover.
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {{width:number,height:number,guide:{left:number,top:number,width:number,height:number}}|null} [viewport]
 */
export function getGuideCrop(frameWidth,frameHeight,viewport=null){
 if(frameWidth<=0||frameHeight<=0)throw new RangeError('Camera frame is empty.');
 if(!viewport||viewport.width<=0||viewport.height<=0){
  const size=Math.max(1,Math.round(Math.min(frameWidth,frameHeight)*0.76));
  return {left:Math.floor((frameWidth-size)/2),top:Math.floor((frameHeight-size)/2),width:size,height:size};
 }
 const scale=Math.max(viewport.width/frameWidth,viewport.height/frameHeight);
 const offsetX=(frameWidth*scale-viewport.width)/2,offsetY=(frameHeight*scale-viewport.height)/2;
 const left=Math.max(0,Math.min(frameWidth-1,Math.floor((viewport.guide.left+offsetX)/scale)));
 const top=Math.max(0,Math.min(frameHeight-1,Math.floor((viewport.guide.top+offsetY)/scale)));
 const right=Math.max(left+1,Math.min(frameWidth,Math.ceil((viewport.guide.left+viewport.guide.width+offsetX)/scale)));
 const bottom=Math.max(top+1,Math.min(frameHeight,Math.ceil((viewport.guide.top+viewport.guide.height+offsetY)/scale)));
 return {left,top,width:right-left,height:bottom-top};
}
/** Require two consecutive camera frames to agree; misses reset the candidate. */
export function createScanConfirmation(){
 let last='',count=0;
 /** @param {string|null} ean */
 return ean=>{
  if(!ean){last='';count=0;return false;}
  count=ean===last?count+1:1;last=ean;
  return count>=2;
 };
}
