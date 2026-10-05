/** 将 Koishi 原始会话的身份、消息链和原时间映射到核心契约。 */
export function normalizeSession(session) {
  if(!Array.isArray(session.elements))throw Error('消息链缺失');
  const kinds=session.elements.map(e=>e.type),sender=String(session.userId),botId=String(session.selfId);
  return {framework:'koishi',platform:session.platform,botId,kind:session.isDirect?'private':'channel',
    conversationId:session.isDirect?sender:session.channelId,messageId:session.messageId,senderId:sender,
    senderName:session.event.user?.name||'',timestamp:Number(session.event.timestamp),
    text:session.elements.filter(e=>e.type==='text').map(e=>e.attrs.content||'').join('').trim(),
    self:sender===botId,quoted:!!session.quote||kinds.includes('quote'),forwarded:kinds.some(k=>['message','figure','forward'].includes(k)),
    media:kinds.filter(k=>!['text','at','quote','message','figure','forward'].includes(k))};
}
