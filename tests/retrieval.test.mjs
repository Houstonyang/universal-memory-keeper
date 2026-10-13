/** 本次记忆串位回归：仅使用隔离的合成来源，不读取 QQ 数据。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryRuntime, jsonStores, scopeFor } from '../core/runtime.mjs';
import { normalizeSession } from '../adapters/koishi/normalize.mjs';
const base={framework:'regression',platform:'fixture',botId:'bot',kind:'group',conversationId:'room',senderId:'A',
  timestamp:Date.parse('2026-10-13T12:00:00+08:00'),text:'',self:false,quoted:false,forwarded:false,media:[]};
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-order-regression-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const stores=jsonStores(dir),runtime=new MemoryRuntime({...stores,now:()=>base.timestamp});let serial=0;
  const send=(text,extra={})=>runtime.turn({...base,messageId:'m-'+ ++serial,timestamp:base.timestamp+serial,text,...extra});
  const scope=scopeFor(base),query=options=>runtime.memory.query(scope,{userId:'A',...options});
  return {send,query,runtime,stores,scope,dir};
}
function revisions(send) {
  send('我的饮料偏好是绿茶',{messageId:'month',timestamp:Date.parse('2026-09-13T12:00:00+08:00')});
  send('我的饮料偏好改为红茶',{messageId:'week',timestamp:Date.parse('2026-10-06T12:00:00+08:00')});
  send('我的饮料偏好改为白茶',{messageId:'day',timestamp:Date.parse('2026-10-12T12:00:00+08:00')});
}
test('存档默认从最近开始，分页继续向较早来源读取',t=>{
  const {send,query}=setup(t);
  for(const [messageId,day] of [['day',12],['month',1],['week',6]])send('雨伞聊天',{messageId,timestamp:Date.UTC(2026,9,day)});
  assert.deepEqual(query({query:'雨伞',archive:true,limit:2}).hits.map(h=>h.messageId),['day','week']);
  assert.deepEqual(query({query:'雨伞',archive:true,limit:2,offset:2}).hits.map(h=>h.messageId),['month']);
});
test('明确 earliest 才从最早原始时间读取，不采用导入顺序',t=>{
  const {send,query}=setup(t);revisions(send);
  assert.deepEqual(query({query:'饮料偏好',history:true,order:'earliest'}).hits.map(h=>h.messageId),['month','week','day']);
  assert.throws(()=>query({order:'unknown'}),/顺序/);
});
test('当前事实保留最新，history 默认最近，最初问句开放旧版本',t=>{
  const {send}=setup(t);revisions(send);
  assert.equal(send('我的饮料偏好是什么').hits[0].messageId,'day');
  assert.deepEqual(send('/memory history 饮料偏好').hits.map(h=>h.messageId),['day','week','month']);
  const first=send('我最初说的饮料偏好是什么？');
  assert.equal(first.hits[0].messageId,'month');assert.equal(first.hits[0].status,'superseded');
  assert.equal(first.retrieval.order,'earliest');
});
test('不要从最早查询和引号内的第一次不改变默认顺序',t=>{
  const {send}=setup(t);revisions(send);
  assert.equal(send('不要从最早查询，查饮料偏好的历史').hits[0].messageId,'day');
  send('我的第一次会议地点是甲楼',{messageId:'meeting-old',timestamp:Date.UTC(2026,9,1)});
  send('我的第一次会议地点改为乙楼',{messageId:'meeting-new',timestamp:Date.UTC(2026,9,12)});
  const result=send('/memory history “第一次会议地点”');assert.equal(result.hits[0].messageId,'meeting-new');
  assert.equal(result.retrieval.order,'recent');
});
test('带引号话题完整命中，不混入部分相同的其他话题',t=>{
  const {send}=setup(t);send('我的蓝色雨伞是甲款');send('我的红色雨伞是乙款');
  const result=send('/memory search “蓝色雨伞”');assert.equal(result.hits.length,1);assert.match(result.hits[0].text,/甲款/);
  assert.equal(send('/memory search “紫色雨伞”').hits.length,0);
});
test('裸话题也不允许仅凭一个 bigram 混入其他话题',t=>{
  const {send,query}=setup(t);send('我的红色雨伞是乙款');
  assert.equal(query({query:'蓝色雨伞'}).hits.length,0);
  assert.equal(send('/memory search 蓝色雨伞').hits.length,0);
});
test('多个明确检索词必须一起出现',t=>{
  const {send,query}=setup(t);send('项目 甲组进度');send('项目 乙组进度');
  assert.equal(query({query:'项目 甲组'}).hits.length,1);
  assert.equal(query({query:'项目 丙组'}).hits.length,0);
});
test('本轮明确截止日期约束自然问句和 history，旧版本不变成当前状态',t=>{
  const {send}=setup(t);revisions(send);
  const result=send('/memory history 饮料偏好，截止到2026-10-06');
  assert.deepEqual(result.hits.map(h=>h.messageId),['week','month']);
  assert.equal(result.retrieval.dayTo,'2026-10-06');assert.equal(result.hits[0].status,'superseded');
  assert.equal(send('我的饮料偏好是什么').hits[0].messageId,'day');
  assert.equal(send('只查2026-10-06及之前的聊天，饮料偏好是什么').hits[0].messageId,'week');
  assert.throws(()=>send('饮料偏好是什么，截止到2026-02-30'),/日期/);
});
test('事实筛选在分页之前，不被大量普通聊天挤掉',t=>{
  const {send}=setup(t);send('我的饮料偏好是绿茶',{messageId:'fact'});
  for(let i=0;i<85;i++)send('饮料偏好闲聊 '+i);
  assert.deepEqual(send('/memory search 饮料偏好').hits.map(h=>h.messageId),['fact']);
});
test('当前提问不是过去来源，刚写入事项也不能冒充旧记忆',t=>{
  const {send}=setup(t);assert.equal(send('我的饮料偏好是绿茶').hits.length,0);
  assert.equal(send('我的饮料偏好是什么').hits.length,1);
});
test('日期、最早模式不能绕过本人禁记，B 不获得 A 的事实',t=>{
  const {send}=setup(t);revisions(send);send('/memory forget 饮料偏好');
  assert.equal(send('我最初说的饮料偏好是什么？').hits.length,0);
  assert.equal(send('/memory history 饮料偏好，截止到2026-10-06').hits.length,0);
  assert.equal(send('/memory history 饮料偏好',{senderId:'B'}).hits.length,0);
});
test('已记录的机器人引用精确复述原句，保留来源归属，不走模型拼接',t=>{
  const {send}=setup(t);send('我吃饭用嘴 不用锅',{messageId:'bot-source',senderId:'bot',self:true});
  const result=send('我引用的是你哪句话？只复述原句。',{quoted:true,replyTo:'bot-source'});
  assert.equal(result.command,true);assert.equal(result.reply,'我吃饭用嘴 不用锅');
  assert.equal(result.quote.source.self,true);assert.equal(result.quote.source.senderId,'bot');assert.equal(result.quote.source.messageId,'bot-source');
  assert.deepEqual(result.hits,[]);
});
test('引用的作者不能变成当前用户，引用正文不能变成本人事实',t=>{
  const {send,runtime,scope}=setup(t);send('我的饮料偏好是红茶',{messageId:'B-source',senderId:'B'});
  const result=send('我的饮料偏好是绿茶',{quoted:true,replyTo:'B-source'});
  assert.equal(result.quote.source.senderId,'B');assert.equal(result.command,false);
  assert.equal(runtime.memory.facts(scope).filter(f=>f.ownerId==='A').length,0);
  assert.match(result.context,/引用来源/);
});
test('引用来源缺失时明确拒绝，不用最近记忆替换',t=>{
  const {send}=setup(t);send('我的饮料偏好是绿茶');
  const result=send('只复述原句',{quoted:true,replyTo:'not-recorded'});
  assert.equal(result.command,true);assert.equal(result.quote.status,'unavailable');assert.match(result.reply,/无法核验/);assert.deepEqual(result.hits,[]);
});
test('没有结构化引用数据的精确复述请求不猜原句',t=>{
  const {send}=setup(t);const result=send('我引用的是你哪句话？只复述原句。');
  assert.equal(result.command,true);assert.match(result.reply,/无法核验/);assert.deepEqual(result.hits,[]);
});
for(const change of [{conversationId:'other-room'},{kind:'private',conversationId:'A'},{framework:'other'},{botId:'other-bot'}])
  test('引用只查同一完整会话范围 '+JSON.stringify(change),t=>{
    const {send}=setup(t);send('原句',{messageId:'source'});
    const result=send('只复述原句',{...change,quoted:true,replyTo:'source'});
    assert.equal(result.quote.status,'unavailable');assert.match(result.reply,/无法核验/);
  });
test('撤回、禁记、媒体和嵌套引用来源均不可用于精确文字复述',t=>{
  const {send,stores,scope}=setup(t);
  send('我的饮料偏好是绿茶',{messageId:'banned'});send('/memory forget 饮料偏好');
  send('待撤回',{messageId:'recalled'});stores.sourceStore.recall(scope,'recalled');
  send('图片说明',{messageId:'media',media:['image']});send('引用片段',{messageId:'nested',quoted:true});
  for(const replyTo of ['banned','recalled','media','nested'])assert.equal(send('只复述原句',{quoted:true,replyTo}).quote.status,'unavailable');
});
test('引用的命令不会执行遗忘或切换历史顺序',t=>{
  const {send}=setup(t);send('/memory forget 饮料偏好',{messageId:'command-source',senderId:'B'});revisions(send);
  const result=send('看看这句',{quoted:true,replyTo:'command-source'});assert.deepEqual(result.hits,[]);
  assert.equal(send('饮料偏好').hits[0].messageId,'day');
});
test('未标记引用不能暗带 replyTo；同一消息不得替换来源元数据',t=>{
  const {send}=setup(t);assert.throws(()=>send('测试',{replyTo:'hidden'}),/引用/);
  send('同文',{messageId:'same',timestamp:base.timestamp});
  assert.throws(()=>send('同文',{messageId:'same',timestamp:base.timestamp,forwarded:true}),/冲突/);
});
test('私聊已认证机器人原消息可以记录和被引用，但不能保存为对方事实',t=>{
  const {send}=setup(t);send('机器人原话',{kind:'private',conversationId:'A',senderId:'bot',self:true,messageId:'private-bot'});
  const result=send('只复述原句',{kind:'private',conversationId:'A',quoted:true,replyTo:'private-bot'});
  assert.equal(result.reply,'机器人原话');assert.equal(result.quote.source.self,true);
});
test('精确引用不把超过3000字的可核验原文截断',t=>{
  const {send}=setup(t),original='原文'.repeat(2000);
  send(original,{messageId:'long',senderId:'bot',self:true});
  assert.equal(send('只复述原句',{quoted:true,replyTo:'long'}).reply,original);
});
test('Koishi 原始 quote ID 和文本来源独立，多个来源冲突拒绝猜测',()=>{
  const session={platform:'qq',selfId:'bot',userId:'A',channelId:'room',messageId:'current',isDirect:false,
    quote:{id:'-123',content:'旧命令'},event:{timestamp:base.timestamp,user:{}},elements:[{type:'text',attrs:{content:'只复述原句'}}]};
  const result=normalizeSession(session);assert.equal(result.replyTo,'-123');assert.equal(result.text,'只复述原句');
  assert.throws(()=>normalizeSession({...session,elements:[...session.elements,{type:'quote',attrs:{id:'123'}}]}),/引用/);
  assert.equal(normalizeSession({...session,quote:null,elements:[...session.elements,{type:'quote',attrs:{id:'-456'}}]}).replyTo,'-456');
});
test('0.1.0旧消息与状态重载兼容，不清空来源或事实',t=>{
  const {send,dir,scope}=setup(t);send('我的饮料偏好是绿茶',{messageId:'old-id',timestamp:base.timestamp});
  const file=path.join(dir,'messages',scope.slice(6)+'.json'),doc=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const row of doc.rows)delete row.forwarded;
  fs.writeFileSync(file,JSON.stringify(doc));
  const runtime=new MemoryRuntime({...jsonStores(dir),now:()=>base.timestamp});
  assert.doesNotThrow(()=>runtime.turn({...base,messageId:'old-id',text:'我的饮料偏好是绿茶'}));
  assert.equal(runtime.turn({...base,messageId:'after-upgrade',text:'我的饮料偏好是什么'}).hits[0].messageId,'old-id');
});
test('是什么、是谁、是啥和几点问句都不能自动新增事实版本',t=>{
  const {send,runtime,scope}=setup(t);
  send('我的老板是甲先生',{messageId:'boss'});
  for(const text of ['我的老板是谁','我的老板是什么','我的老板是啥','我的会议时间是几点'])send(text);
  assert.equal(runtime.memory.facts(scope).length,1);
  assert.equal(send('我的老板是谁').hits[0].messageId,'boss');
});
test('旧版误存的普通问句不再覆盖本人陈述，保留磁盘原件和记录',t=>{
  const {send,stores,runtime,scope}=setup(t);send('我的饮料偏好是绿茶',{messageId:'real'});
  send('我的饮料偏好是什么',{messageId:'bad-question'});
  const state=stores.stateStore.load(scope),old=state.facts[0],row=runtime.memory.row(scope,'bad-question');
  state.facts.push({...old,id:'question-fact',sourceMessageId:row.mid,sourceLocalId:row.id,originalTime:row.ts,
    content:row.text,supersededBy:null,supersedes:[old.id],createdAt:base.timestamp+100});
  old.supersededBy='question-fact';stores.stateStore.save(scope,state);
  const before=structuredClone(stores.stateStore.load(scope));
  assert.equal(send('我的饮料偏好是什么').hits[0].messageId,'real');
  assert.deepEqual(stores.stateStore.load(scope),before);
  assert.equal(runtime.memory.row(scope,'bad-question').text,'我的饮料偏好是什么');
});
