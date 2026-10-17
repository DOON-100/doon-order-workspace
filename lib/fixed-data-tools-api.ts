import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json,snapshot} from './store';
import {eligibleCustomerQuoteAccounts} from './customer-quote-access';
import {inspectFixedWorkbook} from './fixed-tool-workbook';
import {fixedToolFeesGet,fixedToolFeesPost,verifyFixedToolFeeReceipt} from './fixed-tool-fees';
import {assertFixedToolOwner,assertFixedToolJobAccess,findFixedToolRequest,fixedToolBytesHash,fixedToolCustomers,fixedToolHash,fixedToolIds,fixedToolJobId,fixedToolRequestKey,fixedToolRuleVersion,parseFixedTool,publicFixedToolJob,readFixedToolBody,readFixedToolJson,type FixedToolJob} from './fixed-data-tools-common';

const readonlyActions=['fixed-tool-workbook','fixed-tool-ownership'];
const getActions=['fixed-data-tools','fixed-tool-job','fixed-tool-file','fixed-tool-quote'];
const resultLimit=4*1024*1024;
function jobs(s:State){return all(s,'fixed_tool_job') as FixedToolJob[];}
function visibleJobs(s:State,m:Member){return jobs(s).filter(job=>{try{assertFixedToolJobAccess(s,m,job);return true;}catch{return false;}});}
function selectedJob(req:Request,s:State,m:Member){
 const query=new URL(req.url).searchParams,id=query.get('id'),requestKey=query.get('requestKey');
 if((!!id)===(!!requestKey))throw new AppError('请指定一个任务编号或原请求编号。');
 const job=jobs(s).find(v=>id?v.id===id:v.actorId===m.id&&v.requestKey===requestKey);
 if(!job)throw new AppError('未查到原任务，请保留请求编号并刷新核对；不要另建请求重复执行。',404);
 assertFixedToolJobAccess(s,m,job);return job;
}
async function verifiedObject(key:string,expected:string,limit:number){
 const object=await bucket().get(key);if(!object)throw new AppError('任务文件暂不可用，请保留原任务并联系管理员核查。',503);
 const bytes=await readFixedToolBody(new Response(object.body),limit);
 if(await fixedToolBytesHash(bytes)!==expected)throw new AppError('任务文件与记录摘要不一致，请保留原任务核查。',409);
 return bytes;
}
async function verifiedJob(s:State,job:FixedToolJob){
 if(job.status!=='completed')return publicFixedToolJob(job);
 if(job.operation==='quote-fees')await verifyFixedToolFeeReceipt(s,job);
 else {await verifiedObject(job.resultFileKey,job.resultHash,resultLimit);if(job.sourceFileKey)await verifiedObject(job.sourceFileKey,job.sourceHash,10*1024*1024);}
 return publicFixedToolJob({...job,verification:'verified',receipt:{...job.receipt,verified:true}});
}
async function persistReadOnly(s:State,m:Member,job:FixedToolJob,result:unknown,source?:ArrayBuffer){
 const bytes=new TextEncoder().encode(JSON.stringify(result,null,2)+'\n').buffer;
 if(bytes.byteLength>resultLimit)throw new AppError('结果超过 4 MiB，请缩小工作表范围或客户集合。',413);
 job.resultHash=await fixedToolBytesHash(bytes);job.resultFileKey=newId('fixed_tool_result');
 if(source){job.sourceFileKey=newId('fixed_tool_source');await bucket().put(job.sourceFileKey,source);await verifiedObject(job.sourceFileKey,job.sourceHash,10*1024*1024);}
 await bucket().put(job.resultFileKey,bytes);await verifiedObject(job.resultFileKey,job.resultHash,resultLimit);
 job.receipt={resultHash:job.resultHash,sourceHash:job.sourceHash,verified:true};job.verification='verified';job.verifiedAt=now();
 const summary={id:job.id,kind:job.kind,operation:job.operation,actorId:job.actorId,customerIds:job.customerIds,requestHash:job.requestHash,sourceHash:job.sourceHash,resultHash:job.resultHash,status:job.status};
 // Immutable objects are private until this transaction publishes their keys.
 // A failed transaction may leave an unreferenced object, never overwrite a source.
 await commit(s.revision,[job,audit(m,summary,null,'固定工具生成只读结果','固定业务工具',summary)]);
 const saved=jobs(await snapshot()).find(v=>v.id===job.id);
 if(!saved||saved.requestHash!==job.requestHash||saved.resultHash!==job.resultHash)throw new AppError('结果回读未通过，请按原请求编号查询，不要重新执行。',503);
 return json({ok:true,job:publicFixedToolJob(saved)});
}
export async function fixedDataToolsGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!getActions.includes(action))return null;
 assertFixedToolOwner(m);
 const fees=await fixedToolFeesGet(action,req,s,m);if(fees)return fees;
 if(action==='fixed-data-tools'){
  const accounts=eligibleCustomerQuoteAccounts(s,m),ids=new Set(accounts.map(a=>a.id));
  return json({customers:accounts.map(a=>({id:a.id,customer:a.customer,customerCode:a.customerCode})),members:all(s,'member').filter(v=>v.active&&v.role!=='supplier').map(v=>({id:v.id,name:v.name})),quotes:all(s,'customer_quote').filter(q=>q.status==='draft'&&ids.has(q.customerAccountId)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(q=>({id:q.id,version:q.version,customerName:q.customerName,quoteNo:q.quoteNo})),jobs:visibleJobs(s,m).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(publicFixedToolJob)});
 }
 const job=selectedJob(req,s,m);
 if(action==='fixed-tool-job')return json({job:await verifiedJob(s,job)});
 const artifact=new URL(req.url).searchParams.get('artifact');
 if(artifact!=='source'&&artifact!=='result')throw new AppError('文件类型必须为原件或结果。');
 const key=artifact==='source'?job.sourceFileKey:job.resultFileKey,hash=artifact==='source'?job.sourceHash:job.resultHash;
 if(!key||!hash)throw new AppError('该任务没有此文件。',404);
 const bytes=await verifiedObject(key,hash,artifact==='source'?10*1024*1024:resultLimit);
 const filename=artifact==='source'?String(job.filename):`fixed-tool-${job.operation}-${job.id.slice(-12)}.json`;
 return new Response(bytes,{headers:{'Content-Type':artifact==='source'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer'}});
}
export async function fixedDataToolsPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!readonlyActions.includes(action)&&!['fixed-tool-fees-preview','fixed-tool-fees-decision'].includes(action))return null;
 assertFixedToolOwner(m);
 const fees=await fixedToolFeesPost(action,req,s,m);if(fees)return fees;
 if(action==='fixed-tool-workbook')return workbook(req,s,m);
 return ownership(req,s,m);
}
async function workbook(req:Request,s:State,m:Member){
 const body=await readFixedToolBody(req,11*1024*1024);let form:FormData;
 try{form=await new Response(body,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();}catch{throw new AppError('请使用文件上传表单。');}
 const allowed=new Set(['file','operation','sheet','range','headerRow','includeEmpty','requestKey']);
 for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)throw new AppError('文件表单含未知或重复参数。');
 const input=parseFixedTool(z.object({requestKey:fixedToolRequestKey,operation:z.enum(['inspect','rows']),sheet:z.string().min(1).max(200).optional(),range:z.string().min(1).max(40).optional(),headerRow:z.number().int().min(0).max(1048576).optional(),includeEmpty:z.boolean().optional()}).strict(),{
  requestKey:form.get('requestKey'),operation:form.get('operation'),...(form.has('sheet')?{sheet:form.get('sheet')}:{}),...(form.has('range')?{range:form.get('range')}:{}),...(form.has('headerRow')?{headerRow:/^\d+$/.test(String(form.get('headerRow')))?Number(form.get('headerRow')):NaN}:{}),...(form.has('includeEmpty')?{includeEmpty:form.get('includeEmpty')==='true'?true:form.get('includeEmpty')==='false'?false:null}:{}),
 });
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.xlsx'))throw new AppError('请上传非空、大小不超过 10 MiB 的 XLSX 原件。');
 const filename=(file.name.split(/[\\/]/).pop()||'workbook.xlsx').replace(/[\u0000-\u001f\u007f]/g,'_').slice(0,180);
 const bytes=await file.arrayBuffer(),sourceHash=await fixedToolBytesHash(bytes),{requestKey,...options}=input;
 const operation=`workbook-${input.operation}`,requestHash=await fixedToolHash({operation,options,filename,sourceHash,ruleVersion:fixedToolRuleVersion});
 const existing=findFixedToolRequest(s,m,requestKey,requestHash);if(existing)return json({ok:true,alreadyPresent:true,job:await verifiedJob(s,existing)});
 const result=inspectFixedWorkbook(bytes,options);
 if(sourceHash!==await fixedToolBytesHash(bytes))throw new AppError('原件一致性检查未通过。',409);
 const job:FixedToolJob={id:await fixedToolJobId(m,requestKey),kind:'fixed_tool_job',operation,actorId:m.id,customerIds:[],createdAt:now(),requestKey,requestHash,ruleVersion:fixedToolRuleVersion,status:'completed',filename,sourceHash,preview:workbookPreview(result)};
 return persistReadOnly(s,m,job,{ruleVersion:fixedToolRuleVersion,source:{filename,sha256:sourceHash},result},bytes);
}
function workbookPreview(result:ReturnType<typeof inspectFixedWorkbook>){
 // Full bounded data stays in the download; list queries carry only a small preview.
 if(result&&typeof result==='object'&&'rows' in result&&Array.isArray(result.rows))return {...result,rows:result.rows.slice(0,20),previewRowLimit:20};
 return result;
}
async function ownership(req:Request,s:State,m:Member){
 const input=parseFixedTool(z.object({requestKey:fixedToolRequestKey,customerIds:fixedToolIds.refine(ids=>ids.length>0,'必须明确选择客户'),memberIds:fixedToolIds.default([])}).strict(),await readFixedToolJson(req));
 const customerIds=[...input.customerIds].sort(),memberIds=[...input.memberIds].sort(),accounts=fixedToolCustomers(s,m,customerIds);
 const operation='ownership-export',requestHash=await fixedToolHash({operation,customerIds,memberIds,ruleVersion:fixedToolRuleVersion});
 const existing=findFixedToolRequest(s,m,input.requestKey,requestHash);if(existing)return json({ok:true,alreadyPresent:true,job:await verifiedJob(s,existing)});
 const members=all(s,'member') as Member[];
 const member=(id:string)=>{const found=members.find(v=>v.id===id&&v.role!=='supplier');if(!found)throw new AppError('客户责任记录引用了不存在的成员，请先核对原记录。',409);return {id:found.id,name:found.name};};
 for(const id of memberIds)member(id);
 const storedIds=(value:unknown)=>{if(value==null)return [];const parsed=z.array(z.string().min(1).max(160)).max(1000).refine(ids=>new Set(ids).size===ids.length).safeParse(value);if(!parsed.success)throw new AppError('客户责任编号格式不完整，请先核对原记录。',409);return parsed.data;};
 const rows=accounts.map(account=>{
  const sales=storedIds(account.salesMemberIds),service=storedIds(account.serviceMemberIds);
  return {id:account.id,customer:account.customer,customerCode:account.customerCode,salesMembers:sales.map(member),serviceMembers:service.map(member),salesStatus:account.salesMemberIds==null?'unconfirmed':'explicit',serviceStatus:account.serviceMemberIds==null?'unconfirmed':'explicit',ownershipStatus:account.salesMemberIds==null||account.serviceMemberIds==null?'unconfirmed':'explicit'};
 }).filter(row=>!memberIds.length||[...row.salesMembers,...row.serviceMembers].some(v=>memberIds.includes(v.id)));
 const source={workspaceRevision:s.revision,customers:await Promise.all(accounts.map(async account=>({id:account.id,version:account.version,hash:await fixedToolHash(account)})))};
 const result={schemaVersion:1,scope:'ownership',ruleVersion:fixedToolRuleVersion,source,customerCount:rows.length,memberCount:new Set(rows.flatMap(row=>[...row.salesMembers,...row.serviceMembers].map(v=>v.id))).size,customersWithoutExplicitOwnership:rows.filter(row=>row.ownershipStatus==='unconfirmed').length,customers:rows,note:'人员筛选仅缩小已选客户集合；未登记的责任编号保持待核对，不由姓名猜测。'};
 const job:FixedToolJob={id:await fixedToolJobId(m,input.requestKey),kind:'fixed_tool_job',operation,actorId:m.id,customerIds,createdAt:now(),requestKey:input.requestKey,requestHash,ruleVersion:fixedToolRuleVersion,status:'completed',sourceHash:await fixedToolHash(source),preview:result};
 return persistReadOnly(s,m,job,result);
}
