import{test}from'node:test';import assert from'node:assert/strict';import{selectProducts}from'../server/selection.mjs';
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
