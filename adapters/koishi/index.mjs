/** Koishi 中间件入口；其他 AI 插件通过 memoryFor(session) 取得上下文。 */
import { Schema } from 'koishi';
import { memoryTurn } from './client.mjs';
import { normalizeSession } from './normalize.mjs';
export const name='universal-memory-keeper';
export const Config=Schema.object({url:Schema.string().default('http://127.0.0.1:8765'),token:Schema.string().role('secret').required()});
const results=new WeakMap(),settings=new WeakMap();
export function memoryFor(session,options) {
  const config=options||settings.get(session);if(!config)throw Error('会话尚未经过记忆中间件，需要传入服务配置');
  if(!results.has(session))results.set(session,memoryTurn(normalizeSession(session),config));
  return results.get(session);
}
export function apply(ctx,options) {
  ctx.middleware(async(session,next)=> {
    if(!session.isDirect&&!session.stripped?.appel)return next();
    try {
      settings.set(session,options);
      const result=await memoryFor(session);
      if(result.command)return session.send(result.reply||'记忆操作完成');
    } catch {return session.send('记忆服务或来源核验失败，请检查配置。');}
    return next();
  },true);
}
