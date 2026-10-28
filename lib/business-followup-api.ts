import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {actor,AppError,audit,bucket,commit,json,snapshot} from './store';
import {sha} from './workbooks';
import {businessFollowupTargets,followupTargetScope,publicFollowupTarget,resolveBusinessFollowupTarget,type FollowupTargetKey,type ResolvedFollowupTarget} from './business-followup-targets';

const id=z.string().trim().min(1).max(160),keySchema=z.object({module:id,collection:id,recordId:id,sectionKey:z.string().trim().min(1).max(240)}).strict();
const saveSchema=keySchema.extend({token:z.string().uuid(),note:z.string().trim().max(12000).default('')}).strict();
const ENTRY='business_followup',ATTACHMENT='business_followup_attachment',REQUEST='business_followup_request';
const maxFile=20*1024*1024,maxRequest=50*1024*1024;
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{const result=schema.safeParse(input);if(!result.success)throw new AppError(result.error.issues.slice(0,3).map(issue=>issue.message).join('；'));return result.data;}
function key(row:FollowupTargetKey){const {module,collection,recordId,sectionKey}=row;return {module,collection,recordId,sectionKey};}
function sameTarget(row:Entity,target:ResolvedFollowupTarget){return Object.entries({...key(target),...followupTargetScope(target)}).every(([name,value])=>row[name]===value);}
function attachmentDto(row:Entity){return {id:row.id,originalName:row.originalName,size:row.size,sha256:row.sha256};}
function entryDto(s:State,row:Entity,target:ResolvedFollowupTarget){return {id:row.id,note:row.note,createdAt:row.createdAt,createdByName:row.createdByName,attachments:all(s,ATTACHMENT).filter(file=>file.entryId===row.id&&sameTarget(file,target)).map(attachmentDto)};}
function safeFilename(name:string){const value=Array.from(name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_')).slice(0,240).join('').replace(/[. ]+$/g,'');return (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)?'_'+value:value)||'未命名附件';}
function unique(s:State,id:string,kind:string){const rows=s.records.filter(row=>row.id===id);if(rows.length!==1||rows[0].kind!==kind)throw new AppError('记录不存在或无法核对。',404);return rows[0];}

export async function businessFollowupGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['business-followup-targets','business-followup-data','business-followup-download'].includes(action))return null;
 const query=new URL(req.url).searchParams;
 if(action==='business-followup-targets'){
  const module=parse(id,query.get('module')),projectId=query.get('projectId')||'';if(projectId)parse(id,projectId);
  const result=await businessFollowupTargets(req,s,m,module,projectId);return json({...result,targets:result.targets.map(publicFollowupTarget)});
 }
 if(action==='business-followup-data'){
  const target=await resolveBusinessFollowupTarget(req,s,m,parse(keySchema,Object.fromEntries(['module','collection','recordId','sectionKey'].map(name=>[name,query.get(name)]))));
  return json({target:publicFollowupTarget(target),entries:all(s,ENTRY).filter(row=>sameTarget(row,target)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(row=>entryDto(s,row,target))});
 }
 const file=unique(s,parse(id,query.get('id')),ATTACHMENT),entry=unique(s,file.entryId,ENTRY),target=await resolveBusinessFollowupTarget(req,s,m,key(file as any));
 if(!sameTarget(file,target)||!sameTarget(entry,target))throw new AppError('附件关联或授权范围已变化，请核对原记录。',403);
 const object=await bucket().get(file.fileKey);if(!object)throw new AppError('附件原件暂不可用。',404);
 const bytes=await object.arrayBuffer();if(bytes.byteLength!==file.size||await sha(bytes)!==file.sha256)throw new AppError('附件完整性校验未通过。',409);
 const fresh=await snapshot(),current=await actor(fresh),latest=unique(fresh,file.id,ATTACHMENT),latestEntry=unique(fresh,file.entryId,ENTRY);
 if(current.id!==m.id||latest.fileKey!==file.fileKey||latest.sha256!==file.sha256)throw new AppError('登录或附件状态已变化，请重新读取。',409);
 const currentTarget=await resolveBusinessFollowupTarget(req,fresh,current,key(latest as any));if(!sameTarget(latest,currentTarget)||!sameTarget(latestEntry,currentTarget))throw new AppError('附件授权范围已变化。',403);
 return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,'Content-Length':String(bytes.byteLength),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
}

export async function businessFollowupPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='business-followup-save')return null;
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data'))throw new AppError('请使用附件及沟通表单提交。');
 const bytes=await req.arrayBuffer();if(bytes.byteLength>maxRequest)throw new AppError('一次提交不能超过 50 MiB。',413);
 let form:FormData;try{form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('content-type')!}}).formData();}catch{throw new AppError('附件表单格式无效。');}
 const fields:Record<string,unknown>={};for(const name of Object.keys(saveSchema.shape)){if(form.getAll(name).length>1)throw new AppError('附件表单字段不能重复。');const value=form.get(name);if(value!==null&&typeof value!=='string')throw new AppError('附件表单文字字段格式无效。');if(typeof value==='string')fields[name]=value;}
 for(const name of form.keys())if(name!=='files'&&!Object.hasOwn(saveSchema.shape,name))throw new AppError('附件表单含未支持的字段。');
 const input=parse(saveSchema,fields),target=await resolveBusinessFollowupTarget(req,s,m,key(input),true),files=form.getAll('files');
 if(files.length>10)throw new AppError('一次最多上传 10 个附件。');
 if(!input.note&&!files.length)throw new AppError('请填写沟通内容或选择附件。');
 const prepared:{file:File;bytes:ArrayBuffer;originalName:string;sha256:string}[]=[];
 for(const file of files){if(!(file instanceof File)||!file.size||file.size>maxFile)throw new AppError('每个附件须为非空文件且不超过 20 MiB。');const raw=await file.arrayBuffer();prepared.push({file,bytes:raw,originalName:safeFilename(file.name),sha256:await sha(raw)});}
 const fingerprint=await sha(JSON.stringify({...input,...key(target),scope:followupTargetScope(target),files:prepared.map(file=>({originalName:file.originalName,size:file.file.size,sha256:file.sha256}))})),requestId=REQUEST+'_'+input.token;
 const previous=s.records.find(row=>row.id===requestId);
 if(previous){
  if(previous.kind!==REQUEST||previous.actorId!==m.id||previous.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他内容或身份。',409);
  const entry=unique(s,previous.entryId,ENTRY);if(!sameTarget(entry,target))throw new AppError('原跟进记录归属已变化。',403);
  return json({ok:true,idempotent:true,target:publicFollowupTarget(target),entry:entryDto(s,entry,target)});
 }
 const stamp=now(),scope={...key(target),...followupTargetScope(target)},entry:Entity={id:newId(ENTRY),kind:ENTRY,...scope,note:input.note,createdById:m.id,createdByName:m.name,createdAt:stamp};
 // Deterministic immutable keys let a failed transaction retry reuse its own bytes.
 // Do not delete on an unknown commit result: it might already reference the files.
 const attachments:Entity[]=prepared.map((file,index)=>({id:newId(ATTACHMENT),kind:ATTACHMENT,...scope,entryId:entry.id,originalName:file.originalName,size:file.file.size,sha256:file.sha256,fileKey:'business_followup_file_'+input.token+'_'+index+'_'+file.sha256,createdAt:stamp,createdById:m.id,createdByName:m.name}));
 for(let index=0;index<prepared.length;index++)await bucket().put(attachments[index].fileKey,prepared[index].bytes);
 const request:Entity={id:requestId,kind:REQUEST,...scope,entryId:entry.id,actorId:m.id,fingerprint,createdAt:stamp};
 await commit(s.revision,[entry,...attachments,request,audit(m,entry,null,'新增业务附件与沟通记录','人工跟进记录')]);
 return json({ok:true,target:publicFollowupTarget(target),entry:entryDto({...s,records:[...s.records,...attachments]},entry,target)});
}
