import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
function acceptsGzip(header=''){
 const values=new Map(header.toLowerCase().split(',').map(part=>{
  const [name,...options]=part.trim().split(';');
  const q=options.map(x=>x.trim()).find(x=>x.startsWith('q='));
  return [name,q?Number(q.slice(2)):1];
 }));
 return (values.get('gzip')??values.get('*')??0)>0;
}
export async function writeHttpResponse(req,res,status,headers,body){
 const values=new Headers(headers),type=values.get('content-type')||'';
 let content=Buffer.isBuffer(body)?body:Buffer.from(body);
 const compressible=/^(text\/|application\/(json|manifest\+json|javascript))/.test(type)||type.startsWith('image/svg+xml');
 if(compressible){
  const vary=values.get('vary');values.set('vary',vary?vary+', Accept-Encoding':'Accept-Encoding');
  if(content.length>=1024&&acceptsGzip(req.headers['accept-encoding'])&&!values.has('content-encoding')){
   content=await compress(content,{level:1});values.set('content-encoding','gzip');
  }
 }
 values.set('content-length',String(content.length));
 res.writeHead(status,Object.fromEntries(values));res.end(req.method==='HEAD'?undefined:content);
}
