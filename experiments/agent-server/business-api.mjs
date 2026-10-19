import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import {AsyncLocalStorage} from 'node:async_hooks';
import {parsePublicOrigin,sessionCookie,canEnterStudio} from './session.mjs';
import {workflowSources} from '../mastra-studio/workflow-sources.mjs';
import {projectedDatasets,valueAt} from '../mastra-studio/workflow-triggers.mjs';
import {businessProjection,liveDataset,sameLiveEvent,readableLiveHistory,queryForEvent} from '../mastra-studio/workflow-live-data.mjs';
import {scheduleAuthorization} from './schedule-client.mjs';
export {businessProjection} from '../mastra-studio/workflow-live-data.mjs';

const context=new AsyncLocalStorage();
export const withBusinessAccess=(access,operation)=>context.run(access,operation);
export function currentBusinessAccess(){const access=context.getStore();if(!access)throw new Error('业务查询需要当前有效登录。');return access;}
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const sources=new Map(workflowSources.map(source=>[source.id,source]));

// Fixed GET read views only. Cookies remain in this closure, never in Mastra,
// model arguments, requestContext, traces, configuration or persistent storage.
export function createBusinessReader({publicOrigin,connectHost='host.docker.internal',transport=https.request}){
 const origin=parsePublicOrigin(publicOrigin);
 if(!['host.docker.internal','127.0.0.1','localhost'].includes(connectHost))throw new Error('Invalid platform connection host');
 return async(cookie,source,scope={})=>{
  const definition=sources.get(source),filtered=sessionCookie(cookie);
  if(!definition||!filtered)throw fail('业务模块或登录状态无效。');
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||Object.entries(scope).some(([key,value])=>!definition.scopeParams.includes(key)||typeof value!=='string'||value.length>160))throw fail('查询范围无效。');
  const url=new URL('/api/workspace/'+source,origin);for(const [key,value] of Object.entries(scope))if(value)url.searchParams.set(key,value);
  return new Promise((resolve,reject)=>{
   const request=transport({hostname:connectHost,port:Number(origin.port||443),method:'GET',path:url.pathname+url.search,servername:isIP(origin.hostname)?'':origin.hostname,rejectUnauthorized:true,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(origin.hostname,cert),headers:{Host:origin.host,Cookie:filtered,Accept:'application/json'},timeout:15000},response=>{
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){response.destroy();reject(fail('该模块数据过大，请缩小查询范围。',413));return;}chunks.push(chunk);});
    response.on('error',()=>reject(fail('业务读取暂时不可用。',503)));
    response.on('end',()=>{
     if(response.statusCode!==200)return reject(fail('业务模块 '+source+' 当前不可见或暂不可用（HTTP '+response.statusCode+'）。',[400,401,403,404].includes(response.statusCode)?response.statusCode:503));
     if(!String(response.headers['content-type']).includes('application/json'))return reject(fail('业务接口未返回结构化数据。',503));
     try{const body=JSON.parse(Buffer.concat(chunks));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();resolve(body);}catch{reject(fail('业务接口响应无效。',503));}
    });
   });request.on('timeout',()=>request.destroy());request.on('error',()=>reject(fail('业务读取暂时不可用。',503)));request.end();
  });
 };
}

// These fields are transport/account metadata, not business records. The
// original platform read handler remains authoritative for row/field grants.
export function createBusinessAccess({cookie,user,authenticate,read,scheduleClient,schedulerStatus,now=()=>Date.now()}){
 const actorId=String(user.identity?.id||user.username);
 async function verifyActor(){
  const current=await authenticate(cookie);
  if(!canEnterStudio(current)||String(current.identity?.id||current.username)!==actorId)throw fail('登录或读取权限已变化，请重新登录。');
 }
 // The platform read handler validates the same cookie, active membership and
 // current row/field permissions on every GET. Check Studio admission once per
 // tool operation rather than consuming an auth/session request per module.
 const authorized=async(source,scope={})=>businessProjection(await read(cookie,source,scope));
 const pendingCatalogs=new Map();
 function catalog(source,scope={}){
  const key=JSON.stringify([source,scope]);if(pendingCatalogs.has(key))return pendingCatalogs.get(key);
  const promise=loadCatalog(source,scope).finally(()=>pendingCatalogs.delete(key));pendingCatalogs.set(key,promise);return promise;
 }
 async function loadCatalog(source,scope={}){
  await verifyActor();
  if(source){const body=await authorized(source,scope);return{source,scope,datasets:projectedDatasets(body),mode:'authorized',eventsEnabled:false,revision:body.revision||0,readAt:new Date(now()).toISOString(),scopeOptions:{customers:(body.customers||body.customerAccounts||[]).filter(row=>typeof row.id==='string').map(row=>({id:row.id,label:row.customer||row.name||row.id}))}};}
  const modules=[],unavailable=[];let index=0;
  await Promise.all(Array.from({length:2},async()=>{while(index<workflowSources.length){const item=workflowSources[index++];try{const body=await authorized(item.id),datasets=projectedDatasets(body);if(datasets.length)modules.push({...item,datasetCount:datasets.length,fieldCount:datasets.reduce((sum,d)=>sum+d.fields.length,0)});}catch(error){if(error.status===401)throw error;if(![400,403,404].includes(error.status))unavailable.push({source:item.id,status:error.status||503});}}}));
  return{modules:modules.sort((a,b)=>a.id.localeCompare(b.id)),unavailable,mode:'authorized',eventsEnabled:false,readAt:new Date(now()).toISOString(),message:'实时读取当前账号可见的业务 API；unavailable 中的模块本次读取失败，不能当作没有业务数据。'+(scheduleClient?'后台定时任务需在定时任务页单独启用。':'后台自动调度尚未启用。')};
 }
 async function query({source,scope={},dataset,offset=0,limit=10,id,query,fields}){
  await verifyActor();
  const body=await authorized(source,scope),datasets=projectedDatasets(body),definition=datasets.find(row=>row.path===dataset);
  if(!definition)throw fail('数据对象不存在或当前不可见。');
  if(fields?.some(field=>!definition.fields.some(item=>item.path===field)))throw fail('所选字段当前不可见。');
  const value=valueAt(body,dataset);let rows=Array.isArray(value)?value.flat(Infinity).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):value&&typeof value==='object'?[value]:[];
  if(id)rows=rows.filter(row=>row.id===id);if(query)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  const selected=rows.slice(offset,offset+limit).map(row=>fields?.length?Object.fromEntries([...new Set(['/id','/version',...fields])].map(field=>[field,valueAt(row,field)])):row);
  const receipt={mode:'live-readonly',source,dataset,scope,readAt:new Date(now()).toISOString(),revision:body.revision??null,total:rows.length,offset,nextOffset:offset+limit<rows.length?offset+limit:null,records:selected};
  if(Buffer.byteLength(JSON.stringify(receipt))>48*1024)throw fail('本页内容过多，请指定必要的 fields 字段或缩小 limit。',413);
  return receipt;
 }
 async function visible(event,verify=false){
  await verifyActor();if(!event?.triggerConfig||event.simulation||event.syntheticOnly!==false)return false;
  const trigger=event.triggerConfig,view=liveDataset(await authorized(trigger.source,trigger.scope),trigger);
  return verify?sameLiveEvent(event,trigger,view.rows):view.rows.some(row=>row.id===event.recordId&&['customerId','customerAccountId','customer','projectId','orderId','lineId','supplierId'].every(k=>row[k]===event.after[k])&&readableLiveHistory(event.after,row));
 }
 const access={syntheticOnly:false,catalog,query,...(scheduleClient?scheduleAuthorization(scheduleClient,cookie,schedulerStatus):{scheduleStatus:async()=>({ready:false})}),poll:async()=>({enabled:false,events:[],message:'当前生产后台未启用变更采集。'}),verify:event=>visible(event,true),visible:event=>visible(event)};
 access.withEvent=(event,operation)=>withBusinessAccess({...access,query:async input=>query(queryForEvent(input,event))},operation);
 return access;
}
