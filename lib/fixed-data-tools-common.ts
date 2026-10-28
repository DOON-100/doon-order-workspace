import {z} from 'zod';
import {all,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount} from './customer-quote-access';
import {AppError} from './store';
import {canUseFixedDataTools} from './fixed-data-tools-access';

export const fixedToolRuleVersion='fixed-tools-v1';
export type FixedToolJob=Entity & {
 kind:'fixed_tool_job';operation:string;actorId:string;customerIds:string[];createdAt:string;
 requestKey:string;requestHash:string;ruleVersion:string;status:'completed'|'pending'|'rejected'|'deferred';
};
export const fixedToolRequestKey=z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const fixedToolIds=z.array(z.string().trim().min(1).max(160)).max(100).refine(ids=>new Set(ids).size===ids.length,'编号不能重复');
export function parseFixedTool<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{
 const parsed=schema.safeParse(value);if(!parsed.success)throw new AppError(parsed.error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).slice(0,4).join('；'));
 return parsed.data;
}
export function assertFixedToolOwner(m:Member){
 if(!canUseFixedDataTools(m))throw new AppError('固定工具仅对已登录的有效管理员开放。',403);
}
export function fixedToolCustomers(s:State,m:Member,ids:string[]):CustomerAccount[]{
 assertFixedToolOwner(m);
 return ids.map(id=>{
  const account=all(s,'customer_account').find(a=>a.id===id) as CustomerAccount|undefined;
  if(!account||!canMaintainCustomerQuoteAccount(s,m,account))throw new AppError('客户不存在、已停用或当前账号无权操作，请重新核对范围。',403);
  return account;
 });
}
export function assertFixedToolJobAccess(s:State,m:Member,job:FixedToolJob){
 assertFixedToolOwner(m);
 if(job.actorId!==m.id)throw new AppError('只能访问本人创建的固定工具任务。',403);
 fixedToolCustomers(s,m,job.customerIds);
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(v=>canonical(v===undefined?null:v)).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export async function fixedToolBytesHash(bytes:ArrayBuffer){
 const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function fixedToolHash(value:unknown){return fixedToolBytesHash(new TextEncoder().encode(canonical(value)).buffer);}
export async function fixedToolJobId(m:Member,requestKey:string){return 'fixed_tool_job_'+await fixedToolHash({actorId:m.id,requestKey});}
export async function findFixedToolRequest(s:State,m:Member,requestKey:string,requestHash:string){
 const expectedId=await fixedToolJobId(m,requestKey),collision=s.records.find(v=>v.id===expectedId);if(collision&&(collision.kind!=='fixed_tool_job'||collision.actorId!==m.id||collision.requestKey!==requestKey))throw new AppError('固定工具请求编号与原记录冲突。',409);const job=all(s,'fixed_tool_job').find(v=>v.actorId===m.id&&v.requestKey===requestKey) as FixedToolJob|undefined;
 if(job){assertFixedToolJobAccess(s,m,job);if(job.requestHash!==requestHash)throw new AppError('同一请求编号的内容已变化，请重新预览并使用新的请求编号。',409);}
 return job;
}
export function publicFixedToolJob(job:FixedToolJob){
 // Never expose storage keys or the full internal quotation/source snapshot.
 const keys=['id','operation','status','createdAt','updatedAt','requestKey','ruleVersion','expiresAt','previewHash','preview','receipt','filename','resultHash','sourceHash','verification','verifiedAt'];
 return {...Object.fromEntries(keys.filter(key=>job[key]!==undefined).map(key=>[key,job[key]])),hasSource:!!job.sourceFileKey,hasResult:!!job.resultFileKey,expired:!!job.expiresAt&&Date.parse(job.expiresAt)<=Date.now()};
}
export async function readFixedToolBody(req:Request|Response,limit:number):Promise<ArrayBuffer>{
 const length=req.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw new AppError('请求或文件超过工具允许的大小。',413);
 const reader=req.body?.getReader();if(!reader)return new ArrayBuffer(0);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AppError('请求或文件超过工具允许的大小。',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
export async function readFixedToolJson(req:Request){
 try{return JSON.parse(new TextDecoder().decode(await readFixedToolBody(req,64*1024)));}catch(error){if(error instanceof AppError)throw error;throw new AppError('请提交有效的 JSON 参数。');}
}
