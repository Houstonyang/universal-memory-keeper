/** 用独立合成消息验证来源、版本、隔离、禁记与磁盘重载。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryRuntime, jsonStores, scopeFor } from '../core/runtime.mjs';
import { inferExpiry } from '../core/engine.mjs';
import { normalizeSession } from '../adapters/koishi/normalize.mjs';
const base={framework:'fixture',platform:'qq',botId:'bot-openid',kind:'group',conversationId:'group-openid',senderId:'user-A',senderName:'A',timestamp:Date.UTC(2026,9,1),text:'',self:false,quoted:false,forwarded:false,media:[]};
let serial=0;
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'universal-memory-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const stores=jsonStores(dir),runtime=new MemoryRuntime({...stores,now:()=>Date.UTC(2026,9,5)});
  const send=(text,extra={})=>runtime.turn({...base,messageId:'id-'+ ++serial,timestamp:base.timestamp+serial*1000,text,...extra});
  return {runtime,stores,send,dir};
}
test('OpenID/UUID 来源能写入、查询，并保留原始时间',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶',{messageId:'uuid-α'});
  const result=send('饮料偏好');assert.equal(result.hits.length,1);assert.equal(result.hits[0].messageId,'uuid-α');assert.equal(result.hits[0].senderId,'user-A');assert.ok(result.hits[0].originalTime>0);
});
test('同一成员事项更新后默认只返回最新，history 保留旧版本',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');send('我的饮料偏好改为红茶');
  assert.equal(send('饮料偏好').hits.length,1);assert.match(send('饮料偏好').hits[0].text,/红茶/);
  const history=send('/memory history 饮料偏好');assert.equal(history.hits.length,2);assert.ok(history.hits.some(h=>h.status==='superseded'));
});
test('群成员同名同值不会串给其他本人',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');send('我的饮料偏好是红茶',{senderId:'user-B'});
  assert.equal(send('饮料偏好').hits[0].senderId,'user-A');assert.equal(send('饮料偏好',{senderId:'user-B'}).hits[0].senderId,'user-B');
});
for(const field of ['framework','platform','botId','conversationId'])test(field+' 隔离',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');assert.equal(send('饮料偏好',{[field]:'different'}).hits.length,0);
});
test('群/私聊隔离，私聊身份不一致拒绝',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');assert.equal(send('饮料偏好',{kind:'private',conversationId:'user-A'}).hits.length,0);
  assert.throws(()=>send('饮料偏好',{kind:'private'}),/私聊身份/);
});
test('遗忘禁止本人历史检索和重提写入，解锁恢复原始来源',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');const original=send('饮料偏好').hits[0];
  assert.match(send('/memory forget 饮料偏好').reply,/禁止/);assert.equal(send('/memory history 饮料偏好').hits.length,0);
  send('我的饮料偏好是红茶');assert.equal(send('饮料偏好').hits.length,0);
  send('/memory unlock 饮料偏好');const restored=send('饮料偏好');assert.equal(restored.hits.length,1);assert.equal(restored.hits[0].messageId,original.messageId);assert.equal(restored.hits[0].originalTime,original.originalTime);
});
test('A禁记不影响B同值；B解锁不能代替A解锁',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');send('我的饮料偏好是绿茶',{senderId:'user-B'});send('/memory forget 饮料偏好');
  assert.equal(send('饮料偏好',{senderId:'user-B'}).hits.length,1);send('/memory unlock 饮料偏好',{senderId:'user-B'});assert.equal(send('饮料偏好').hits.length,0);
});
for(const extra of [{quoted:true},{forwarded:true},{media:['image']},{self:true}])test('不接受引用/转发/媒体/机器人代作授权 '+JSON.stringify(extra),t=> {
  const {send}=setup(t);const r=send('我的饮料偏好是绿茶',extra);assert.equal(r.skipped,true);assert.equal(send('饮料偏好').hits.length,0);
});
test('模糊维护不会修改状态',t=> {
  const {send}=setup(t);send('我的饮料偏好是绿茶');assert.match(send('忘记这件事').reply,/明确/);assert.equal(send('饮料偏好').hits.length,1);
});
test('维护原消息重复提交幂等',t=> {
  const {send,runtime}=setup(t);send('我的饮料偏好是绿茶');const event={...base,messageId:'control-id',timestamp:base.timestamp,text:'/memory forget 饮料偏好'};
  runtime.turn(event);runtime.turn(event);assert.equal(runtime.memory.state(scopeFor(event)).controls.length,1);
});
test('重复 ID 不得换身份、文本或媒体来源',t=> {
  const {runtime}=setup(t),event={...base,messageId:'same-id',text:'我的饮料偏好是绿茶'};runtime.turn(event);
  for(const change of [{senderId:'B'},{text:'我的饮料偏好是红茶'},{media:['image']}])assert.throws(()=>runtime.turn({...event,...change}),/冲突/);
});
test('核心公开写入口拒绝伪造存档行',t=> {
  const {runtime}=setup(t),event={...base,messageId:'original',text:'我的饮料偏好是绿茶'};runtime.turn(event);const scope=scopeFor(event),row=runtime.memory.row(scope,'original');
  assert.throws(()=>runtime.memory.control(scope,{...row,text:'/memory forget 饮料偏好'}),/来源核验/);
  assert.throws(()=>runtime.memory.note(scope,{...row,senderId:'B'},{topic:'饮料偏好',content:row.text}),/来源核验/);
});
test('无来源ID、原时间、来源标记不能接入',t=> {
  const {runtime}=setup(t);for(const key of ['messageId','timestamp','quoted','media','botId']) {
    const event={...base,messageId:'invalid-'+key,text:'test'};delete event[key];assert.throws(()=>runtime.turn(event));
  }
});
test('召回只返回本人事实，不把机器人断言或普通闲聊变为事实',t=> {
  const {send}=setup(t);send('我记得你喜欢咖啡',{self:true});send('咖啡很好喝');assert.equal(send('咖啡').hits.length,0);
});
test('磁盘重载保留事实、禁记和原时间',t=> {
  const {send,dir}=setup(t);send('我的饮料偏好是绿茶');send('/memory forget 饮料偏好');
  const restored=new MemoryRuntime(jsonStores(dir));assert.equal(restored.turn({...base,messageId:'after-reload',text:'饮料偏好'}).hits.length,0);
  const r=restored.turn({...base,messageId:'unlock-reload',text:'/memory unlock 饮料偏好'});assert.match(r.reply,/解除/);
  assert.equal(restored.turn({...base,messageId:'query-reload',text:'饮料偏好'}).hits.length,1);
});
test('损坏状态或来源不能静默覆盖为空',t=> {
  const {send,dir}=setup(t);send('我的饮料偏好是绿茶');const key=scopeFor(base).slice(6);
  const state=path.join(dir,'states',key+'.json');fs.writeFileSync(state,'{broken');assert.throws(()=>send('饮料偏好'));assert.equal(fs.readFileSync(state,'utf8'),'{broken');
});
test('撤回事实失去可用来源，不恢复旧版本',t=> {
  const {send,stores,runtime}=setup(t);send('我的饮料偏好是绿茶',{messageId:'old'});send('我的饮料偏好改为红茶',{messageId:'new'});
  stores.sourceStore.recall(scopeFor(base),'new');assert.equal(send('饮料偏好').hits.length,0);
  assert.equal(runtime.memory.row(scopeFor(base),'old').mid,'old');
});
test('到期事实默认不可召回，历史保留过期状态',t=> {
  const {send}=setup(t);send('/memory note 测试安排 | 我的测试安排是有效期：2026-10-01');assert.equal(send('测试安排').hits.length,0);assert.equal(send('/memory history 测试安排').hits[0].status,'expired');
});
test('相对日期用北京时间，不依赖部署机器时区',()=> {
  assert.equal(inferExpiry({text:'明天要去考试',ts:Date.parse('2026-10-01T23:00:00+08:00')}),Date.parse('2026-10-02T23:59:59.999+08:00'));
});
test('旧维护状态与原时间或发送者失配不能输出为核验事实',t=> {
  const {send,stores}=setup(t);send('我的饮料偏好是绿茶');const scope=scopeFor(base),state=stores.stateStore.load(scope);
  state.facts[0].originalTime+=1000;stores.stateStore.save(scope,state);assert.equal(send('饮料偏好').hits.length,0);
  state.facts[0].originalTime-=1000;state.facts[0].ownerId='other-owner';stores.stateStore.save(scope,state);assert.equal(send('饮料偏好').hits.length,0);
});
test('会话路径不由原平台ID拼接，避免路径遍历和分隔符碰撞',()=> {
  assert.match(scopeFor({...base,conversationId:'../../outside'}),/^scope:[a-f0-9]{64}$/);
  assert.notEqual(scopeFor({...base,platform:'a:b',botId:'c'}),scopeFor({...base,platform:'a',botId:'b:c'}));
});
test('Koishi 映射原ID、原时间和引用，不生成当前时间',()=> {
  const s={platform:'qq',selfId:'bot',userId:'A',channelId:'group',messageId:'uuid',isDirect:false,quote:{id:'quoted'},event:{timestamp:1790812800000,user:{}},elements:[{type:'text',attrs:{content:'原文'}}]};
  const e=normalizeSession(s);assert.equal(e.quoted,true);assert.equal(e.messageId,'uuid');assert.equal(e.timestamp,s.event.timestamp);assert.equal(e.text,'原文');
});
