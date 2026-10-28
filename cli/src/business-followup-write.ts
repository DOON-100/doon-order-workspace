import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {readWriteInput,type WriteSchema} from './write-input.js';
import {fields,pick,page,pagination,identifier} from './business.js';
import {readQuoteFile,writeNewQuoteFile} from './quote-files.js';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Route} from './routes.js';

// Canonical local modules only. Kingdee and source-snapshot projections remain deferred.
export const followupModules=['orders','customer-projects','project-finance','factory-orders','finished-outsourcing','mes','losses','supplier-outsourcing','service-workspace','process-workspace','planning-control','engineering-drawings','purchase','customer-quotes','ie-quotes','communications','documents','personal-tasks','customer-followups','customers','payment-terms','ar-workspace','customer-price-archive','imports'];
const id={type:'string',required:true,min:1,max:160} as const;
const keyFields:WriteSchema={module:{...id,enum:followupModules},collection:id,recordId:id,sectionKey:{...id,max:160}},saveFields:WriteSchema={...keyFields,note:{type:'string',max:12000}};
const targetKeys=fields('module collection recordId sectionKey label sectionLabel canAppend'),entryKeys=fields('id note createdAt createdByName'),fileKeys=fields('id originalName size sha256');
type Options={team?:string;limit?:string;offset?:string};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const safeName=(name:string)=>{const value=Array.from(name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_')).slice(0,240).join('').replace(/[. ]+$/g,'');return (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)?'_'+value:value)||'未命名附件';};
const unknown=()=>new CliError('READBACK_FAILED','业务跟进结果尚待核查，请查询原目录和记录，不换UUID盲目重发。',5,{outcomeUnknown:true});
export class BusinessFollowupWriteService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 schema(){return {fields:saveFields,modules:followupModules,maxFiles:10,maxFileBytes:20*1024*1024,maxCombinedFileBytes:49*1024*1024,semantics:'独立追加沟通及不可变附件，不更新原单据/审批/账务；没有修改或删除入口。先查targets并保留服务器返回的目标四元组；当前权限与来源归属由原服务器重核，UUID绑定身份、目标、内容和原件摘要。金蝶/采购源快照暂缓。'};}
 private async request(route:Route,body?:unknown,query?:Record<string,string>,team?:string){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先登录。',4);return (await new ApiClient(config,this.transport,60000).request(route,session,body,{query,team:identifier(team,'业务组')})).data as any;}
 private target(row:any){if(!row||Object.keys(keyFields).some(k=>typeof row[k]!=='string'||!row[k])||typeof row.canAppend!=='boolean'||!followupModules.includes(row.module))throw new CliError('INVALID_RESPONSE','业务跟进目标无法核对。',5);return pick(row,targetKeys);}
 private entry(row:any):Record<string,any>{if(!row||typeof row.id!=='string'||!row.id||typeof row.note!=='string'||!Array.isArray(row.attachments)||row.attachments.some((f:any)=>typeof f.id!=='string'||typeof f.originalName!=='string'||!Number.isSafeInteger(f.size)||f.size<1||f.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256)))throw new CliError('INVALID_RESPONSE','业务跟进记录或附件摘要无效。',5);return {...pick(row,entryKeys),attachments:row.attachments.map((f:any)=>pick(f,fileKeys))};}
 private async key(file:string){return await readWriteInput(file,keyFields) as Record<string,string>;}
 private async feed(key:Record<string,string>,team?:string){const data=await this.request('/api/workspace/business-followup-data',undefined,key,team),target=this.target(data?.target);if(Object.keys(keyFields).some(k=>target[k]!==key[k])||!Array.isArray(data.entries))throw new CliError('INVALID_RESPONSE','服务器未确认所选业务跟进范围。',5);const entries=data.entries.map((row:any)=>this.entry(row));if(new Set(entries.map((r:any)=>r.id)).size!==entries.length)throw new CliError('INVALID_RESPONSE','业务跟进编号重复。',5);return {target,entries};}
 async targets(rawModule:string,options:Options&{project?:string}={}){if(!followupModules.includes(rawModule))throw new CliError('UNSUPPORTED_OPERATION','未接入此栏目；金蝶及源快照继续暂缓。',2);const projectId=identifier(options.project,'项目'),data=await this.request('/api/workspace/business-followup-targets',undefined,{module:rawModule,...(projectId?{projectId}:{})},options.team);if(typeof data?.supported!=='boolean'||!Array.isArray(data.targets))throw new CliError('INVALID_RESPONSE','业务跟进授权目录无效。',5);return {supported:data.supported,notice:typeof data.notice==='string'?data.notice:'',page:page(data.targets.map((r:any)=>this.target(r)),pagination(options))};}
 async list(file:string,options:Options={}){const data=await this.feed(await this.key(file),options.team);return {target:data.target,page:page(data.entries,pagination(options))};}
 async show(file:string,rawId:string,team?:string){const id=identifier(rawId,'跟进记录',true),data=await this.feed(await this.key(file),team),rows=data.entries.filter((r:any)=>r.id===id);if(rows.length!==1)throw new CliError('NOT_IN_SCOPE','跟进记录不属于当前授权目标。',7);return {target:data.target,entry:rows[0]};}
 async files(file:string,id:string,team?:string){const data=await this.show(file,id,team);return {target:data.target,entryId:data.entry.id,files:data.entry.attachments};}
 async save(file:string,requestId:string,paths:string[]=[],team?:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId||''))throw new CliError('INVALID_INPUT','须提供UUID请求标识。',2);
  const input=await readWriteInput(file,saveFields),key=Object.fromEntries(Object.keys(keyFields).map(k=>[k,String(input[k])])),before=await this.feed(key,team);if(!before.target.canAppend)throw new CliError('FORBIDDEN','当前目标只可读取。',4);
  if(paths.length>10||(!String(input.note||'').trim()&&!paths.length))throw new CliError('INVALID_INPUT','须填写沟通或选择1至10个附件。',2);
  const form=new FormData(),expected=[];for(const [k,v]of Object.entries({...input,note:String(input.note||'').trim(),token:requestId}))form.set(k,String(v));let size=0;
  for(const filePath of paths){const bytes=await readQuoteFile(filePath,20*1024*1024);size+=bytes.length;if(size>49*1024*1024)throw new CliError('INVALID_INPUT','附件合计超过客户端49MiB上限。',2);const name=basename(filePath);form.append('files',new File([Uint8Array.from(bytes)],name));expected.push({originalName:safeName(name),size:bytes.length,sha256:hash(bytes)});}
  const response=await this.request('/api/workspace/business-followup-save',form,undefined,team);let entry:Record<string,any>;
  try{if(response?.ok!==true||Object.keys(keyFields).some(k=>response.target?.[k]!==key[k]))throw Error('scope');entry=this.entry(response.entry);if(entry.note!==String(input.note||'').trim()||!isDeepStrictEqual(entry.attachments.map((f:any)=>pick(f,fields('originalName size sha256'))),expected))throw Error('content');const current=await this.feed(key,team),found=current.entries.find((e:any)=>e.id===entry.id);if(!isDeepStrictEqual(found,entry))throw Error('readback');return {target:current.target,entry:found,idempotent:response.idempotent===true};}catch{throw unknown();}
 }
 async download(file:string,entryId:string,rawId:string,output:string,team?:string){const id=identifier(rawId,'附件',true)!,current=await this.files(file,entryId,team),item=current.files.find((f:any)=>f.id===id);if(!item)throw new CliError('NOT_IN_SCOPE','附件不属于此目标的跟进记录。',7);const bytes=await this.request('/api/workspace/business-followup-download',undefined,{id},team) as Buffer;if(bytes.length!==item.size||hash(bytes)!==item.sha256)throw new CliError('INVALID_RESPONSE','附件原件大小或摘要不符。',5);return {target:current.target,entryId,file:await writeNewQuoteFile(bytes,output)};}
}
