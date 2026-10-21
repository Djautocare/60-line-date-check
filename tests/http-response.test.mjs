import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {writeHttpResponse} from '../server/http-response.mjs';
const body=Buffer.from(JSON.stringify({products:Array(100).fill({name:'Bread',plu:'123456'})}));
async function response(encoding,type='application/json',content=body,method='GET'){
 const result={};const res={writeHead(status,headers){Object.assign(result,{status,headers});},end(data){result.body=data;}};
 await writeHttpResponse({method,headers:encoding?{'accept-encoding':encoding}:{}},res,200,{'content-type':type,'cache-control':'no-store','set-cookie':'session=test; HttpOnly'},content);
 return result;
}
test('gzip reduces text/JSON while preserving private response headers and content',async()=>{
 for(const encoding of ['gzip','br, gzip;q=0.8','*;q=0.5','GZIP']){
  const r=await response(encoding);assert.equal(r.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(r.body),body);assert.ok(r.body.length<body.length/2);assert.equal(r.headers['content-length'],String(r.body.length));assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['set-cookie'],'session=test; HttpOnly');assert.match(r.headers.vary,/Accept-Encoding/);
 }
});
test('clients can refuse gzip; tiny responses and images avoid compression; HEAD has no body',async()=>{
 for(const encoding of ['', 'br','gzip;q=0','gzip;q=0, *;q=1','*;q=0'])assert.equal((await response(encoding)).headers['content-encoding'],undefined);
 assert.equal((await response('gzip','image/png')).headers['content-encoding'],undefined);
 assert.equal((await response('gzip','application/json',Buffer.from('{"ok":true}'))).headers['content-encoding'],undefined);
 const head=await response('gzip','application/json',body,'HEAD');assert.equal(head.body,undefined);assert.ok(Number(head.headers['content-length'])>0);
});
