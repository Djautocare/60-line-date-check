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

export class SelectionProblem extends Error {}
/** null preserves fully random selection; otherwise area counts must total 60. */
export function validateAreaCounts(counts,products){
 if(counts===null)return null;
 if(!counts||typeof counts!=='object'||Array.isArray(counts))throw new SelectionProblem('Enter a whole-number count for each area, or choose random across the catalogue.');
 const entries=Object.entries(counts);
 if(entries.length>2000||entries.some(([area,count])=>!area.trim()||area.length>80||!Number.isInteger(count)||count<0||count>60))throw new SelectionProblem('Area counts must be whole numbers from 0 to 60.');
 const total=entries.reduce((sum,[,count])=>sum+count,0);
 if(total!==60)throw new SelectionProblem(`Area counts must add up to 60. The current total is ${total}.`);
 const available=new Map();for(const p of products)available.set(p.section,(available.get(p.section)||0)+1);
 for(const [area,count] of entries){const stock=available.get(area)||0;if(count>stock)throw new SelectionProblem(`${area} needs ${count} products, but only ${stock} are in the catalogue. Reduce its count or add more products.`);}
 return Object.fromEntries(entries);
}
export function selectDailyProducts(products,counts=null,random=Math.random){
 const policy=validateAreaCounts(counts,products);
 if(policy===null)return selectProducts(products,60,random);
 const groups=new Map();for(const p of products){if(!groups.has(p.section))groups.set(p.section,[]);groups.get(p.section).push(p);}
 const chosen=Object.entries(policy).flatMap(([area,count])=>count?selectProducts(groups.get(area),count,random):[]);
 // Mix the chosen areas without changing their requested counts.
 for(let i=chosen.length-1;i>0;i--){const j=Math.floor(Math.min(1-Number.EPSILON,Math.max(0,random()))*(i+1));[chosen[i],chosen[j]]=[chosen[j],chosen[i]];}
 return chosen;
}
