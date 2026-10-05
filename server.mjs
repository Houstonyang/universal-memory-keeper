/** 本地 HTTP 桥：已认证框架事件接入核心；不暴露用户身份覆盖参数。 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { MemoryRuntime, jsonStores } from './core/runtime.mjs';
export function createMemoryServer({token,dataDir}) {
  if(typeof token!=='string'||token.length<24)throw Error('MEMORY_TOKEN 至少24字符');
  const runtime=new MemoryRuntime(jsonStores(dataDir)),expected=Buffer.from('Bearer '+token);
  return http.createServer(async(req,res)=> {
    const respond=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    const supplied=Buffer.from(String(req.headers.authorization||''));
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return respond(401,{ok:false,error:'未认证'});
    if(req.method==='GET'&&req.url==='/health')return respond(200,{ok:true,version:'0.1.0'});
    if(req.method!=='POST'||req.url!=='/v1/turn')return respond(404,{ok:false,error:'接口不存在'});
    try {
      let size=0;const chunks=[];
      for await(const chunk of req) {size+=chunk.length;if(size>128*1024){respond(413,{ok:false,error:'请求过大'});req.destroy();return;}chunks.push(chunk);}
      const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      respond(200,runtime.turn(payload.event));
    } catch {respond(400,{ok:false,error:'事件或记忆操作无效，请检查原消息、标记和本地存储'});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dataDir=path.resolve(process.env.MEMORY_DATA_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'data'));
  const port=Number(process.env.MEMORY_PORT||8765);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('无效端口');
  const server=createMemoryServer({token:process.env.MEMORY_TOKEN,dataDir});
  server.requestTimeout=10000;server.headersTimeout=10000;
  server.listen(port,'127.0.0.1',()=>console.log('Memory Keeper listening on 127.0.0.1:'+port));
}
