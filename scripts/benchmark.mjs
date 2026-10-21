import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {performanceFixture,seedPerformance} from './performance-fixture.mjs';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/auth.mjs';
import {writeHttpResponse} from '../server/http-response.mjs';

const count=Number(process.argv[2]||116);
if(!Number.isInteger(count)||count<1||count>300)throw new Error('Choose between 1 and 300 simulated stores.');
const fixture=await performanceFixture(process.env.DATECHECK_TEST_DATABASE_URL);
let server;
try{
 const stores=await seedPerformance(fixture,count),password='Synthetic-benchmark-password-123';
 await fixture.db.pool.query("UPDATE members SET password_hash=$1 WHERE id<>'owner'",[await hashPassword(password)]);
 let app,origin;
 server=createServer(async(req,res)=>{
  try{
   let body='';for await(const chunk of req)body+=chunk;
   const result=await app(new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body})}),req.socket.remoteAddress);
   await writeHttpResponse(req,res,result.status,result.headers,Buffer.from(await result.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 app=await createApp({db:fixture.db,origin});
 const phases={},samples={};let phase='';
 const request=async(store,path,body)=>{
  const started=performance.now();
  const response=await fetch(origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin,'accept-encoding':'gzip',...(store.cookie?{cookie:store.cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const raw=await response.text(),data=JSON.parse(raw);
  assert.equal(response.status,200,`${path}: ${raw}`);
  const wire=Number(response.headers.get('content-length')||Buffer.byteLength(raw));
  (phases[phase]??=[]).push({ms:performance.now()-started,wire});
  samples[phase]??={rawBytes:Buffer.byteLength(raw),bodyBytes:wire,gzip:response.headers.get('content-encoding')==='gzip'};
  if(response.headers.has('set-cookie'))store.cookie=response.headers.get('set-cookie').split(';')[0];
  return data;
 };
 const started=performance.now();
 phase='login';await Promise.all(stores.map(s=>request(s,'login',{username:s.user,password})));
 phase='initial';await Promise.all(stores.map(s=>request(s,'state')));
 phase='start';await Promise.all(stores.map(async s=>{s.check=await request(s,'rounds/start',{});assert.equal(s.check.lines.length,60);}));
 phase='changed';await Promise.all(stores.map(async s=>{s.live=await request(s,'state?view=daily');}));
 phase='unchanged';for(let n=0;n<3;n++)await Promise.all(stores.map(async s=>{const r=await request(s,'state?view=daily&since='+s.live.liveVersion);assert.equal(r.unchanged,true);}));
 // A deliberately heavy burst: every store saves a result, refreshes, then immediately saves the next.
 for(let i=0;i<60;i++){
  phase='save';await Promise.all(stores.map(s=>request(s,'lines/save',{id:s.check.lines[i].id,status:i===0?'rotation_issue':'okay',quantity:0,revision:0})));
  phase='changed';await Promise.all(stores.map(async s=>{s.live=await request(s,'state?view=daily&since='+s.live.liveVersion);assert.equal(s.live.lines.filter(l=>l.status).length,i+1);}));
 }
 phase='finish';await Promise.all(stores.map(s=>request(s,'rounds/finish',{id:s.check.round.id})));
 const rounds=await fixture.db.pool.query('SELECT COUNT(*) AS n FROM rounds WHERE finished IS NOT NULL');assert.equal(Number(rounds.rows[0].n),count);
 const lines=await fixture.db.pool.query('SELECT COUNT(*) AS n FROM lines WHERE status IS NOT NULL');assert.equal(Number(lines.rows[0].n),count*60);
 const summary={stores:count,products:907,poolConnections:10,seconds:Number(((performance.now()-started)/1000).toFixed(2)),requests:0,errors:0,phases:{},responseSamples:samples};
 for(const [name,values] of Object.entries(phases)){
  const sorted=values.map(v=>v.ms).sort((a,b)=>a-b),p=q=>Math.round(sorted[Math.ceil(sorted.length*q)-1]);
  summary.requests+=values.length;summary.phases[name]={requests:values.length,p50ms:p(.5),p95ms:p(.95),maxMs:Math.round(sorted.at(-1)),bodyMB:Number((values.reduce((n,v)=>n+v.wire,0)/1e6).toFixed(3))};
 }
 console.log(JSON.stringify(summary,null,2));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await fixture.close();
}
