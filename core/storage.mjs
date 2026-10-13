/** 原消息与维护状态分文件原子保存。损坏时报错保留原件；单进程访问。 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validScope, normalizeMessage } from './contracts.mjs';
function read(file,fallback) {
  try {
    if(fs.statSync(file).size>64*1024*1024)throw Error('会话文件超过64MiB，请接入数据库存储');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  } catch(e) {if(e.code==='ENOENT')return fallback;throw e;}
}
function write(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp',data=JSON.stringify(value);
  if(Buffer.byteLength(data)>64*1024*1024)throw Error('会话文件超过64MiB');
  try {fs.writeFileSync(temp,data);fs.renameSync(temp,file);} finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function jsonStores(dataDir) {
  const file=(type,key)=>path.join(dataDir,type,validScope(key).slice(6)+'.json');
  const sourceStore={
    list(key) {const doc=read(file('messages',key),{chatKey:key,rows:[]});if(doc.chatKey!==key||!Array.isArray(doc.rows))throw Error('来源存储格式错误');return doc.rows.map(normalizeMessage);},
    append(key,row) {
      const rows=this.list(key),old=rows.find(r=>r.mid===row.mid);
      if(old) {
        if(old.text!==row.text||old.senderId!==row.senderId||old.ts!==row.ts||old.self!==row.self||old.forwarded!==row.forwarded||old.replyTo!==row.replyTo||JSON.stringify(old.reply)!==JSON.stringify(row.reply)||JSON.stringify(old.media)!==JSON.stringify(row.media))throw Error('来源 ID 冲突');
        return old;
      }
      const next=normalizeMessage({...row,id:(rows.at(-1)?.id||0)+1});rows.push(next);write(file('messages',key),{chatKey:key,rows});return next;
    },
    recall(key,mid) {const rows=this.list(key),row=rows.find(r=>r.mid===mid);if(!row)throw Error('撤回来源不存在');row.recalled=true;write(file('messages',key),{chatKey:key,rows});}
  };
  const stateStore={
    load(key) {return read(file('states',key),{version:1,chatKey:key,facts:[],bans:[],controls:[]});},
    save(key,state) {write(file('states',key),state);}
  };
  return {sourceStore,stateStore};
}
