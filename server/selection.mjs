export const RISK_WEIGHTS=Object.freeze({high:3,normal:1,low:0.5});
export const validRisk=value=>Object.hasOwn(RISK_WEIGHTS,value);
/** Weighted random selection without replacement, using independent exponential clocks. */
export function selectProducts(products,count,random=Math.random){
 if(!Number.isInteger(count)||count<0||count>products.length)throw new RangeError('Not enough catalogue products for this selection.');
 return products.map(product=>{
  const u=Math.min(1-Number.EPSILON,Math.max(Number.EPSILON,random()));
  return {product,key:-Math.log(u)/(RISK_WEIGHTS[product.risk]||1)};
 }).sort((a,b)=>a.key-b.key).slice(0,count).map(({product})=>product);
}
