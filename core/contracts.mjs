/** 严格验证平台来源；文件键由完整框架/平台/机器人/会话元组生成。 */
import { createHash } from 'node:crypto';
export const validIdentity = value => typeof value==='string' && value.length>0 && value.length<=300 && !['undefined','null','None'].includes(value) && !/[\x00-\x1f]/u.test(value);
function identity(value,name) { if(!validIdentity(value))throw Error('无效来源字段：'+name);return value; }
export function validScope(value) {
  if(!/^scope:[a-f0-9]{64}$/.test(String(value)))throw Error('无效会话范围');return value;
}
export function scopeFor(event) {
  const tuple=['framework','platform','botId','kind','conversationId'].map(k=>identity(event[k],k));
  if(!['private','group','channel'].includes(event.kind))throw Error('无效会话类型');
  if(event.kind==='private' && event.conversationId!==event.senderId && !(event.self===true&&event.senderId===event.botId))throw Error('私聊身份不一致');
  return 'scope:'+createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}
export function normalizeMessage(row) {
  identity(row.mid,'messageId');identity(row.senderId,'senderId');
  if(!Number.isSafeInteger(row.ts)||row.ts<=0||row.ts>8640000000000000)throw Error('必须保留原始毫秒时间');
  if(typeof row.text!=='string'||row.text.length>16000)throw Error('正文无效或过长');
  if(!Number.isSafeInteger(row.id)||row.id<1)throw Error('无效本地顺序');
  if(typeof row.self!=='boolean'||typeof row.recalled!=='boolean'||!Array.isArray(row.media))throw Error('消息来源标记缺失');
  return structuredClone({...row,forwarded:row.forwarded===true});
}
export function messageFromEvent(event,id) {
  // 适配器必须明确提供引用、转发、媒体标记；缺失时不能默认成本人直接文字。
  for(const key of ['self','quoted','forwarded'])if(typeof event[key]!=='boolean')throw Error('缺少来源标记：'+key);
  if(!Array.isArray(event.media)||!event.media.every(v=>typeof v==='string'))throw Error('缺少媒体标记');
  const replyTo=event.replyTo==null?null:identity(event.replyTo,'引用消息ID');
  if(replyTo&&!event.quoted)throw Error('引用ID必须来自标记为引用的消息');
  return normalizeMessage({id,mid:identity(event.messageId,'messageId'),senderId:identity(event.senderId,'senderId'),
    senderName:String(event.senderName||''),ts:event.timestamp,text:event.text,self:event.self,recalled:false,
    reply:event.quoted||event.forwarded?{id:replyTo}:null,replyTo,forwarded:event.forwarded,media:event.media});
}
