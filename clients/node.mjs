/** Node 框架共用客户端，认证令牌仅留在配置中；不记录正文或令牌。 */
export async function memoryTurn(event,{url='http://127.0.0.1:8765',token=process.env.MEMORY_TOKEN}={}) {
  const target=new URL(url);if(!['http:','https:'].includes(target.protocol))throw Error('无效服务地址');
  if(!token||token.length<24)throw Error('需要 MEMORY_TOKEN');
  const response=await fetch(new URL('/v1/turn',target),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({event}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Memory service HTTP '+response.status);return response.json();
}
