import {randomUUID,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import {personnelTypeOf} from './personnel.mjs';
import {workflowSources} from './schedule-engine/workflow-sources.mjs';
import {validateTrigger,evaluateTrigger,equal} from './schedule-engine/workflow-triggers.mjs';
import {scheduleSlot} from './schedule-engine/workflow-schedule.mjs';
import {liveDataset,liveQuery,sameLiveEvent} from './schedule-engine/workflow-live-data.mjs';

const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status});};
const strict=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail('调度请求字段无效。',400);};
const word=value=>typeof value==='string'&&/^[\w-]{1,160}$/.test(value);
export async function scheduleBridgeConfig(env=process.env){
 if(env.DOON_STUDIO_SCHEDULES_ENABLED!=='1')return null;
 let token;try{token=(await fs.readFile(env.DOON_STUDIO_SCHEDULES_KEY_FILE,'utf8')).trim();}catch{fail('请配置独立的后台调度密钥文件。',500);}
 if(!/^[\w-]{43,128}$/.test(token))fail('后台调度密钥格式无效。',500);
 return{token};
}

// Enabled explicitly. These append-only grants and the worker lease are separate
// tables; original records, accounts, sessions and workspace revision never change.
export function createScheduleBridge({db,config,currentForOwner,readView,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS studio_schedule_grants(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,owner_id TEXT NOT NULL,workflow_id TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_studio_schedule_grants_owner ON studio_schedule_grants(owner_id,workflow_id,seq);
 CREATE TABLE IF NOT EXISTS studio_schedule_lease(id TEXT PRIMARY KEY,worker TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL);`);
 const latest=(owner,workflow)=>{const row=db.prepare('SELECT data FROM studio_schedule_grants WHERE owner_id=? AND workflow_id=? ORDER BY seq DESC LIMIT 1').get(owner,workflow);return row?JSON.parse(row.data):null;};
 const get=id=>{const row=db.prepare('SELECT data FROM studio_schedule_grants WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
 const append=(owner,workflow,payload)=>{const row={...payload,id:'grant-'+randomUUID(),ownerId:owner,workflowId:workflow,at:new Date(now()).toISOString()};db.prepare('INSERT INTO studio_schedule_grants(id,owner_id,workflow_id,data) VALUES(?,?,?,?)').run(row.id,owner,workflow,JSON.stringify(row));return row;};
 function admit(current){if(!current?.member?.active||current.account?.must_change||personnelTypeOf(current.member)!=='internal'||!current.member.userId)fail('后台授权身份已失效。');return current;}
 const owner=current=>admit(current).member.userId;
 const publicUser=current=>({username:current.account.username,mustChange:false,role:current.member.role,personnelType:personnelTypeOf(current.member),identity:{id:current.member.userId,name:current.member.name}});
 async function dataset(current,trigger){return liveDataset(await readView(current,trigger.source,trigger.scope),trigger);}
 function service(request){const a=Buffer.from(request.headers.get('authorization')||''),b=Buffer.from('Bearer '+config.token);if(a.length!==b.length||!timingSafeEqual(a,b))fail('后台服务身份无效。',401);}
 function lease(input){const row=db.prepare("SELECT * FROM studio_schedule_lease WHERE id='scheduler'").get();if(!row||row.worker!==input.workerId||row.fence!==input.fence||row.expires_at<=now())fail('后台执行租约已失效。',409);}
 async function grantFor(input){const row=get(input.grantId);if(!row||row.status!=='active'||row.expiresAt<=now()||latest(row.ownerId,row.workflowId)?.id!==row.id)fail('后台授权已暂停、过期或被替换。');const current=admit(await currentForOwner(row.ownerId));if(current.account.id!==row.accountId)fail('后台授权账号已变化，请重新启用。');return{row,current};}
 async function handle(request,current){
  const path=new URL(request.url).pathname,serviceRoute=path.startsWith('/api/agent-schedules/service/');
  if(serviceRoute)service(request);else admit(current);
  if(path==='/api/agent-schedules/status'&&request.method==='GET')return Response.json({ready:true,maxGrantDays:30});
  if(request.method!=='POST')fail('后台调度接口仅接受 POST。',405);
  let input;try{input=await request.json();}catch{fail('请求格式无效。',400);}
  if(!serviceRoute){
   if(request.headers.get('origin')!==new URL(request.url).origin)fail('不允许跨站修改后台授权。');
   if(path==='/api/agent-schedules/grant'){
    strict(input,['workflowId','configVersionId','trigger']);if(!word(input.workflowId)||!word(input.configVersionId))fail('流程版本无效。',400);
    let trigger;try{trigger=validateTrigger(input.trigger);}catch{fail('触发配置无效。',400);}
    const source=workflowSources.find(s=>s.id===trigger.source);if(trigger.mode!=='schedule'||!source||Object.keys(trigger.scope).some(k=>!source.scopeParams.includes(k)))fail('仅允许已注册模块的定时只读查询。');
    await dataset(current,trigger);admit(await currentForOwner(owner(current)));
    const row=append(owner(current),input.workflowId,{accountId:current.account.id,configVersionId:input.configVersionId,trigger,status:'active',expiresAt:now()+30*86400000});
    return Response.json({grantId:row.id,expiresAt:row.expiresAt});
   }
   if(path==='/api/agent-schedules/revoke'){
    strict(input,['workflowId','grantId']);if(!word(input.workflowId)||input.grantId!==undefined&&!word(input.grantId))fail('授权标识无效。',400);
    const row=latest(owner(current),input.workflowId);
    if(row?.status==='active'&&(!input.grantId||row.id===input.grantId))append(owner(current),input.workflowId,{status:'revoked',previousGrantId:row.id});
    return Response.json({revoked:true});
   }
   fail('未找到调度入口。',404);
  }
  const action=path.split('/').at(-1);
  if(action==='probe'){strict(input,[]);return Response.json({ready:true});}
  if(action==='lease'){
   strict(input,['workerId','fence','release']);if(!word(input.workerId)||input.fence!==undefined&&!Number.isSafeInteger(input.fence))fail('执行租约参数无效。',400);
   if(input.release){db.prepare("UPDATE studio_schedule_lease SET expires_at=0 WHERE id='scheduler' AND worker=? AND fence=?").run(input.workerId,input.fence??-1);return Response.json({released:true});}
   // One atomic SQLite statement fences other processes, even after a restart.
   const row=db.prepare("INSERT INTO studio_schedule_lease VALUES('scheduler',?,1,?) ON CONFLICT(id) DO UPDATE SET worker=excluded.worker,fence=CASE WHEN studio_schedule_lease.worker=excluded.worker AND studio_schedule_lease.expires_at>? THEN studio_schedule_lease.fence ELSE studio_schedule_lease.fence+1 END,expires_at=excluded.expires_at WHERE studio_schedule_lease.expires_at<=? OR (studio_schedule_lease.worker=excluded.worker AND studio_schedule_lease.fence=?) RETURNING fence,expires_at").get(input.workerId,now()+90000,now(),now(),input.fence??-1);
   return Response.json(row?{acquired:true,fence:row.fence,expiresAt:row.expires_at}:{acquired:false});
  }
  if(action==='owners'){
   strict(input,['workerId','fence']);lease(input);const all=db.prepare('SELECT data FROM studio_schedule_grants ORDER BY seq').all(),map=new Map(),users=new Map();for(const item of all){const row=JSON.parse(item.data);map.set(JSON.stringify([row.ownerId,row.workflowId]),row);}
   for(const row of map.values())if(row.status==='active'&&row.expiresAt>now())try{const person=admit(await currentForOwner(row.ownerId));users.set(row.ownerId,publicUser(person));}catch{}
   return Response.json({users:[...users.values()]});
  }
  strict(input,['workerId','fence','grantId','event','query']);lease(input);const {row,current:person}=await grantFor(input),view=await dataset(person,row.trigger);lease(input);const checked=await grantFor(input);if(!equal(person.member,checked.current.member))fail('读取期间账号权限已变化，请重新核对。');
  const metadata={mode:'authorized',eventsEnabled:false,schedulesEnabled:true,source:row.trigger.source,scope:row.trigger.scope,trigger:row.trigger,datasets:[view.definition],revision:view.revision,grantId:row.id,configVersionId:row.configVersionId,ownerId:row.ownerId};
  if(action==='catalog')return Response.json(metadata);
  if(action==='schedule'){
   const slot=scheduleSlot(row.trigger.schedule,now()),events=[];
   if(slot.due)for(const after of view.rows){const candidate={id:'schedule-'+slot.day+'-'+row.trigger.schedule.time,recordId:after.id,source:row.trigger.source,dataset:row.trigger.dataset,scope:row.trigger.scope,type:'schedule',origin:'schedule',before:null,after,syntheticOnly:false};if(evaluateTrigger(row.trigger,candidate,view.definition).matched)events.push({...candidate,matched:true});}
   if(events.length>100||Buffer.byteLength(JSON.stringify(events))>2*1024*1024)fail('本次匹配超过 100 条或 2 MiB，请缩小条件后重新发布。',413);
   return Response.json({enabled:true,day:slot.day,events});
  }
  if(action==='verify')return Response.json({valid:!!input.event&&sameLiveEvent(input.event,row.trigger,view.rows)});
  if(action==='query'){
   const query=input.query;strict(query,['source','dataset','scope','offset','limit','id','query','fields']);if(query.source!==row.trigger.source||query.dataset!==row.trigger.dataset||!equal(query.scope||{},row.trigger.scope))fail('查询超出此工作流的后台授权。');
   return Response.json(liveQuery(view,query,now()));
  }
  fail('未找到调度入口。',404);
 }
 return{handle};
}
