/** 框架公共入口：授权始终来自当前事件原文，默认只召回当前发送者事实。 */
import { ManagedMemory, parseControl } from './engine.mjs';
import { messageFromEvent, scopeFor } from './contracts.mjs';
import { retrievalPlan, queryForTurn, exactQuoteRequest, memoryContext, factQuestion } from './retrieval.mjs';
export { ManagedMemory } from './engine.mjs';
export { jsonStores } from './storage.mjs';
export { scopeFor } from './contracts.mjs';
export class MemoryRuntime {
  constructor(stores) {this.sources=stores.sourceStore;this.memory=new ManagedMemory(stores);}
  turn(event) {
    const scope=scopeFor(event),row=this.sources.append(scope,messageFromEvent(event,1));
    if(row.self||row.recalled||row.forwarded||row.media.length)return {ok:true,skipped:true,hits:[],context:'',reply:null};
    // 引用请求可读来源但不授权本人写入、遗忘或解锁；不混入普通自动召回。
    if(row.reply||exactQuoteRequest(row.text)) {
      const source=row.replyTo&&row.replyTo!==row.mid?this.memory.quote(scope,row.replyTo):null;
      const verified=source&&source.originalTime<=row.ts?source:null;
      const quote=verified?{status:'resolved',source:verified}:{status:'unavailable',reason:'当前会话无法核验可用的引用原文，不能猜测原句或作者。'};
      const command=exactQuoteRequest(row.text);
      return {ok:true,scope,ownerId:row.senderId,skipped:true,command,hits:[],quote,
        reply:command?(verified?verified.text:quote.reason):null,
        context:memoryContext({ownerId:row.senderId,hits:[],引用来源:quote})};
    }
    const text=row.text.trim();let reply=null,command=false;
    if(parseControl(text)) {const result=this.memory.control(scope,row);reply=result.message;command=true;}
    else if(/^\/?memory\s+status$/i.test(text)) {
      const state=this.memory.state(scope),facts=this.memory.facts(scope).filter(f=>f.ownerId===row.senderId);
      reply=JSON.stringify({facts:facts.length,bans:state.bans.filter(b=>b.ownerId===row.senderId&&b.active).map(b=>b.topic)});command=true;
    } else if(/^\/?memory\s+note\s+/i.test(text)) {
      const match=/^\/?memory\s+note\s+([^|\n]{2,60})\|\s*(.{1,600})$/iu.exec(text);
      if(!match)throw Error('格式：/memory note 话题 | 本人原文事实');
      this.memory.note(scope,row,{topic:match[1].trim(),content:match[2].trim()});reply='已按本条原消息记录本人事实。';command=true;
    } else {
      // 只自动记录明确的本人事项陈述；不用模型推断任意聊天或同义关系。
      const match=/^我的([^：:，,。！？?!；;\n]{2,40}?)(?:现在)?(?:改为|改成|变为|变成|是|为)([^，,。！？?!；;\n]{1,500})[。！!]?$/u.exec(text);
      if(match&&!factQuestion(text)) {
        try {this.memory.note(scope,row,{topic:match[1].trim(),content:text});}
        catch(e) {if(!e.message.includes('禁记'))throw e;}
      }
    }
    const search=/^\/?memory\s+(search|history)\s+(.+)$/iu.exec(text);
    if(search)command=true;
    // 本版默认仅输出核验过的事实，不把普通聊天存档或机器人草稿注入模型。
    const plan=retrievalPlan(text),history=search?.[1].toLowerCase()==='history'||plan.history;
    const state=this.memory.state(scope),facts=this.memory.facts(scope,{history}).filter(f=>f.ownerId===row.senderId);
    const query=queryForTurn(search?.[2]||text,facts);
    const result=this.memory.query(scope,{query,userId:row.senderId,history,order:plan.order,dayTo:plan.dayTo,factsOnly:true,limit:5,excludeMessageIds:[row.mid]});
    const hits=result.hits;
    const activeBans=state.bans.filter(b=>b.ownerId===row.senderId&&b.active).map(b=>b.topic);
    const context=(hits.length||activeBans.length)?memoryContext({ownerId:row.senderId,activeBans,retrieval:plan,hits}):'';
    if(search)reply=JSON.stringify({hits,retrieval:plan});
    return {ok:true,scope,ownerId:row.senderId,command,reply,hits,activeBans,retrieval:plan,context};
  }
}
