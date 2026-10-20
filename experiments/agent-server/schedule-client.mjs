import fs from 'node:fs/promises';
import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import {parsePublicOrigin,sessionCookie} from './session.mjs';
import {equal,validateTrigger} from '../mastra-studio/workflow-triggers.mjs';
import {queryForEvent} from '../mastra-studio/workflow-live-data.mjs';

const fail=(message,status=503)=>Object.assign(new Error(message),{status});
export async function loadScheduleKey(env=process.env){
 if(env.DOON_AGENT_SCHEDULES_ENABLED!=='1')return null;
 let key;try{key=(await fs.readFile(env.DOON_AGENT_SCHEDULES_KEY_FILE,'utf8')).trim();}catch{throw fail('后台调度密钥文件不可用。');}
 if(!/^[\w-]{43,128}$/.test(key))throw fail('后台调度密钥格式无效。');return key;
}
// The independent service key is read from a mounted file. It never enters
// browser responses, models, traces, workflow definitions or saved grants.
export function createScheduleClient({publicOrigin,key,connectHost='host.docker.internal',transport=https.request}){
 const origin=parsePublicOrigin(publicOrigin);
 if(!['host.docker.internal','127.0.0.1','localhost'].includes(connectHost))throw fail('后台连接配置无效。');
 return async(action,body,{cookie,service=false}={})=>{
  if(!key)throw fail('此实例未启用后台调度。',409);
  if(!/^(?:status|grant|revoke|service\/(?:probe|lease|owners|catalog|schedule|verify|query))$/.test(action)||service!==action.startsWith('service/'))throw fail('不支持的调度操作。',400);
  const filtered=sessionCookie(cookie);if(!service&&!filtered)throw fail('需要当前登录身份。',401);
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
   const request=transport({hostname:connectHost,port:Number(origin.port||443),path:'/api/agent-schedules/'+action,method:bytes?'POST':'GET',servername:isIP(origin.hostname)?'':origin.hostname,rejectUnauthorized:true,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(origin.hostname,cert),headers:{Host:origin.host,Origin:origin.origin,Accept:'application/json',...(service?{Authorization:'Bearer '+key}:{Cookie:filtered}),...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})},timeout:20000},response=>{
    let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>3*1024*1024){response.destroy();reject(fail('调度响应超过限制。',413));return;}chunks.push(chunk);});
    response.on('error',()=>reject(fail('后台调度通道暂时不可用。')));
    response.on('end',()=>{if(response.statusCode!==200)return reject(fail([401,403].includes(response.statusCode)?'后台授权或当前读取权限已失效。':response.statusCode===413?'本次匹配超过处理上限，请缩小触发范围。':'后台调度通道未接通或暂不可用。',[400,401,403,409,413].includes(response.statusCode)?response.statusCode:503));try{if(!String(response.headers['content-type']).includes('application/json'))throw Error();resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(fail('调度接口响应无效。'));}});
   });request.on('timeout',()=>request.destroy());request.on('error',()=>reject(fail('后台调度通道暂时不可用。')));request.end(bytes);
  });
 };
}
export function scheduleAuthorization(client,cookie,schedulerStatus){
 return{
  scheduleStatus:async()=>{try{await client('service/probe',{},{service:true});return{...await client('status',undefined,{cookie}),worker:schedulerStatus?.()||null};}catch{return{ready:false};}},
  authorizeSchedule:input=>client('grant',input,{cookie}),
  revokeSchedule:input=>client('revoke',input,{cookie}),
 };
}
export function createScheduledAccess({client,worker,user,grantId,configVersionId,trigger,valid=()=>true}){
 const call=async(action,body={})=>{if(!valid())throw fail('后台执行租约已失效。',409);return client('service/'+action,{...worker(),grantId,...body},{service:true});};
 const check=async()=>{const metadata=await call('catalog');if(metadata.ownerId!==user.identity.id||metadata.configVersionId!==configVersionId||!equal(metadata.trigger,validateTrigger(trigger)))throw fail('后台授权不属于当前流程版本。',403);return metadata;};
 const t=validateTrigger(trigger);
 const access={
  syntheticOnly:false,scheduledReadOnly:true,assertCurrent:check,
  async catalog(source,scope={}){if(source&&(source!==t.source||!equal(scope,t.scope)))throw fail('查询超出此工作流授权。',403);const metadata=await check();return source?metadata:{...metadata,modules:[{id:t.source,label:t.source}]};},
  schedule:async requested=>{if(!equal(validateTrigger(requested),t))throw fail('定时配置不匹配。',403);await check();return call('schedule');},
  verify:async event=>{await check();return(await call('verify',{event})).valid;},
  query:async query=>{await check();return call('query',{query});},
  poll:async()=>({enabled:false,events:[]}),
 };
 access.forEvent=event=>({...access,query:async input=>access.query(queryForEvent(input,event))});return access;
}
