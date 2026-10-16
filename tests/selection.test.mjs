import{test}from'node:test';import assert from'node:assert/strict';import{selectProducts}from'../server/selection.mjs';import{orderByArea,CHECK_AREA_ORDER}from'../shared/area-order.mjs';
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
test('risk increases selection frequency while every level remains eligible',()=>{
 const items=[{id:'high',risk:'high'},{id:'normal',risk:'normal'},{id:'low',risk:'low'}],random=rng(234567),counts={high:0,normal:0,low:0};
 for(let i=0;i<9000;i++)counts[selectProducts(items,1,random)[0].id]++;
 assert.ok(counts.high>counts.normal*2);assert.ok(counts.normal>counts.low*1.5);assert.ok(counts.low>700);
});
test('daily samples contain 60 distinct entries and vary across seeds without area quotas',()=>{
 const items=Array.from({length:90},(_,i)=>({id:String(i),risk:i<30?'high':i<60?'normal':'low',section:'Only one area'}));
 const a=selectProducts(items,60,rng(123)),b=selectProducts(items,60,rng(456));assert.equal(a.length,60);assert.equal(new Set(a.map(x=>x.id)).size,60);assert.notDeepEqual(a.map(x=>x.id),b.map(x=>x.id));assert.equal(items.length,90);
});
test('a complete 60-product catalogue includes every entry regardless of risk',()=>{const items=Array.from({length:60},(_,i)=>({id:i,risk:i%2?'high':'low'}));assert.equal(new Set(selectProducts(items,60,rng(9)).map(x=>x.id)).size,60);});

test('area counts produce exactly 60 unique risk-weighted products with the requested split',async()=>{
 const {selectDailyProducts}=await import('../server/selection.mjs');
 const sections=['Short life','Long life','Ambient produce','Chilled produce','Bread'];
 const items=sections.flatMap(section=>Array.from({length:40},(_,i)=>({id:section+i,section,risk:i%3===0?'high':i%3===1?'normal':'low'})));
 const counts={'Short life':20,'Long life':15,'Ambient produce':10,'Chilled produce':10,Bread:5};
 const result=selectDailyProducts(items,counts,rng(1234));assert.equal(result.length,60);assert.equal(new Set(result.map(p=>p.id)).size,60);
 for(const [area,count] of Object.entries(counts))assert.equal(result.filter(p=>p.section===area).length,count);
 assert.notDeepEqual(result.map(p=>p.id),selectDailyProducts(items,counts,rng(5678)).map(p=>p.id));
 assert.deepEqual(selectDailyProducts(items,null,rng(777)),orderByArea(selectProducts(items,60,rng(777))));
 assert.equal(items.length,200);
});
test('area counts reject invalid totals, fractional counts, unavailable products and malformed settings',async()=>{
 const {validateAreaCounts,SelectionProblem}=await import('../server/selection.mjs');
 const items=Array.from({length:70},(_,i)=>({id:i,section:'Bread',risk:'normal'}));
 for(const counts of [undefined,[],{},'random',{Bread:59},{Bread:61},{Bread:59.5,Other:0.5},{Bread:'60'},{Bread:61,Other:-1},{Bread:59,Missing:1}])assert.throws(()=>validateAreaCounts(counts,items),SelectionProblem);
 assert.deepEqual(validateAreaCounts({Bread:60,'New area':0},items),{Bread:60,'New area':0});
 assert.throws(()=>validateAreaCounts({Bread:60},items.slice(0,59)),/only 59/);
 assert.equal(validateAreaCounts(null,items),null);
});
test('area splits preserve risk weighting within an area and can exclude other areas',async()=>{
 const {selectDailyProducts}=await import('../server/selection.mjs');
 const items=[...['high','normal','low'].map(risk=>({id:risk,risk,section:'Small'})),...Array.from({length:59},(_,id)=>({id:'fill'+id,section:'Fill',risk:'normal'})),{id:'excluded',section:'Excluded',risk:'high'}];
 const random=rng(456789),frequencies={high:0,normal:0,low:0};
 for(let i=0;i<4000;i++){const picked=selectDailyProducts(items,{Small:1,Fill:59,Excluded:0},random);assert.equal(picked.length,60);assert.ok(!picked.some(p=>p.id==='excluded'));frequencies[picked.find(p=>p.section==='Small').id]++;}
 assert.ok(frequencies.high>frequencies.normal*2);assert.ok(frequencies.normal>frequencies.low*1.5);assert.ok(frequencies.low>250);
 const odd=Array.from({length:60},(_,id)=>({id,section:'__proto__',risk:'normal'}));
 assert.equal(selectDailyProducts(odd,JSON.parse('{"__proto__":60}'),rng(1)).length,60);
});

test('checks group the selected products in walking order, with stable ordering and other areas last',async()=>{
 const items=['Long life','Bread','Chilled produce','Short life','Ambient produce','Bread','Z Other','A Other'].map((section,id)=>({id,section}));
 const original=items.map(p=>({...p}));const sorted=orderByArea(items);
 assert.deepEqual(sorted.map(p=>p.section),[...CHECK_AREA_ORDER.slice(0,1),'Bread',...CHECK_AREA_ORDER.slice(1),'A Other','Z Other']);
 assert.deepEqual(sorted.filter(p=>p.section==='Bread').map(p=>p.id),[1,5]);assert.deepEqual(items,original);
 const {selectDailyProducts}=await import('../server/selection.mjs');
 const catalogue=CHECK_AREA_ORDER.flatMap(section=>Array.from({length:30},(_,id)=>({section,id:section+id,risk:'normal'})));
 for(const counts of [null,Object.fromEntries(CHECK_AREA_ORDER.map(section=>[section,12]))]){
  const chosen=selectDailyProducts(catalogue,counts,rng(123));assert.deepEqual(chosen,orderByArea(chosen));assert.equal(chosen.length,60);assert.equal(new Set(chosen.map(p=>p.id)).size,60);
 }
});
