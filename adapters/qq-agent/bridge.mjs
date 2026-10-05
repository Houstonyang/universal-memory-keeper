/** QQ Agent 本轮真实 ChatStore 消息桥；不覆盖生产插件。 */
import { memoryTurn } from './client.mjs';
export function normalizeEntry(chatKey,row,botId) {
  const match=/^(private|group):([1-9]\d*)$/.exec(chatKey);if(!match)throw Error('无效 QQ Agent 会话');
  return {framework:'qq-agent',platform:'onebot-v11',botId:String(botId),kind:match[1],conversationId:match[2],
    messageId:String(row.mid),senderId:String(row.senderId),senderName:row.senderName||'',timestamp:Number(row.ts),text:row.text,
    self:!!row.self,quoted:!!row.reply,forwarded:!!row.forwarded,media:(row.media||[]).map(m=>typeof m==='string'?m:'media')};
}
export async function memoryForEntry(chatKey,row,botId,config) {return memoryTurn(normalizeEntry(chatKey,row,botId),config);}
