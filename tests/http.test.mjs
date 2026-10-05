/** 启动真实环回 HTTP 服务验证认证、持久化和错误边界。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryServer } from '../server.mjs';
import { memoryTurn } from '../clients/node.mjs';
test('HTTP 服务认证、事件接入、本人召回与非法输入',async t=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-http-test-')),token='test-only-token-1234567890-abcdef';
  const server=createMemoryServer({dataDir:dir,token});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/health')).status,401);
  assert.equal((await fetch(url+'/health',{headers:{Authorization:'Bearer '+token}})).status,200);
  const event={framework:'http',platform:'qq',botId:'bot',kind:'group',conversationId:'group',senderId:'openid',messageId:'one',timestamp:1790812800000,text:'我的饮料偏好是绿茶',self:false,quoted:false,forwarded:false,media:[]};
  await memoryTurn(event,{url,token});const result=await memoryTurn({...event,messageId:'two',text:'饮料偏好'},{url,token});assert.equal(result.hits.length,1);
  await assert.rejects(()=>memoryTurn({...event,messageId:'three'},{url,token:'wrong-token-123456789012345678'}),/401/);
  assert.equal((await fetch(url+'/v1/turn',{method:'POST',headers:{Authorization:'Bearer '+token},body:'invalid'})).status,400);
  assert.equal((await fetch(url+'/unknown',{headers:{Authorization:'Bearer '+token}})).status,404);
});
test('服务拒绝弱令牌',()=>assert.throws(()=>createMemoryServer({token:'short',dataDir:'.'}),/24/));
