import {z} from 'zod';
import {all,clean,type Member,type State,type Entity} from './domain';
import {validateServiceRecordInput} from './service-workspace';

const binding=z.object({sourceId:z.string().min(1),targetId:z.string().min(1),targetVersion:z.number().int().positive(),confirmedCustomerCode:z.string().trim().max(80).default('')}).strict();
export const ivyMigrationConfig=z.object({
 instanceId:z.string().trim().min(1).max(160),customerBindings:z.array(binding).max(1000),
 waitingForOverrides:z.record(z.enum(['customer','factory','jennifer','none'])).default({}),
}).strict();
const sourceRow=z.object({id:z.string().min(1).max(160)}).passthrough();
const sourceText=z.string().max(20000).nullish();
const sourceCustomer=sourceRow.extend({name:sourceText,notes:sourceText,contactPerson:sourceText,email:sourceText,phone:sourceText,address:sourceText});
const sourceWaiting=sourceRow.extend({customerId:z.string().min(1).max(160),owner:sourceText,what:sourceText,project:sourceText,description:sourceText,dateRequested:sourceText,nextFollowUp:sourceText,category:sourceText,resolved:z.boolean().nullish()});
// All row properties remain in source.original. Unknown top-level stores must
// not be silently stripped: this adapter cannot promise to migrate them.
const backupSchema=z.object({
 customers:z.array(sourceCustomer).max(10000),waitingItems:z.array(sourceWaiting).max(10000),
 projects:z.array(sourceRow).max(10000),orders:z.array(sourceRow).max(10000),samples:z.array(sourceRow).max(10000),
 shipments:z.array(sourceRow).max(10000),payments:z.array(sourceRow).max(10000),tasks:z.array(sourceRow).max(10000),
}).strict();
const stable=(value:any):string=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
async function digest(value:any){const bytes=new TextEncoder().encode(stable(value)),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');}

/** Preview only: no storage calls. The caller must atomically INSERT the additions. */
export async function prepareIvyMigration(s:State,raw:unknown,configuration:unknown,actor:Member){
 if(!actor.active||actor.role!=='admin')throw new Error('仅管理员可以确认历史数据迁入。');
 const config=ivyMigrationConfig.parse(configuration),backup=backupSchema.parse(raw);
 for(const [table,rows] of Object.entries(backup)){
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`来源 ${table} 有重复 ID，停止迁入。`);
  if(!['customers','waitingItems'].includes(table)&&rows.length)throw new Error(`来源 ${table} 有 ${rows.length} 条数据，当前适配器只处理客户与等待事项，不能忽略其他历史数据。`);
 }
 const sourceIds=new Set(backup.customers.map(row=>row.id));
 if(config.customerBindings.length!==sourceIds.size||new Set(config.customerBindings.map(row=>row.sourceId)).size!==sourceIds.size||new Set(config.customerBindings.map(row=>row.targetId)).size!==sourceIds.size)throw new Error('每个来源客户必须唯一匹配一个现有客户，不能重复或遗漏。');
 if(config.customerBindings.some(row=>!sourceIds.has(row.sourceId)))throw new Error('客户映射含来源中不存在的客户。');
 const waitingIds=new Set(backup.waitingItems.map(row=>row.id));
 if(Object.keys(config.waitingForOverrides).some(id=>!waitingIds.has(id)))throw new Error('等待对象确认中存在无效来源 ID。');
 const accounts=all(s,'customer_account'),bindings=new Map(config.customerBindings.map(row=>[row.sourceId,row]));
 const codeKey=(value:unknown)=>clean(value).toLowerCase();
 const existingProfiles=all(s,'service_record').filter(row=>row.type==='customer_profile');
 for(const item of config.customerBindings){
  const account=accounts.find(row=>row.id===item.targetId);
  if(!account?.active||account.version!==item.targetVersion)throw new Error('客户责任清单已变化或停用，请重新核对映射；不会覆盖客户档案。');
  const code=codeKey(item.confirmedCustomerCode);
  if(code&&account.customerCode&&codeKey(account.customerCode)!==code)throw new Error('确认的客户编码与现有客户编码不一致。');
  if(code&&(accounts.some(row=>row.id!==item.targetId&&[row.customerCode,row.customer].some(value=>codeKey(value)===code))
   ||existingProfiles.some(row=>row.customerId!==item.targetId&&codeKey(row.source?.confirmedCustomerCode)===code)
   ||config.customerBindings.some(row=>row.targetId!==item.targetId&&codeKey(row.confirmedCustomerCode)===code)))throw new Error('确认的编码已属于其他客户或本批其他映射。');
 }
 const additions:Entity[]=[],rows:Array<{sourceId:string;table:string;targetId:string;action:string}>=[],capturedAt=new Date().toISOString();
 async function add(table:string,source:Record<string,any>,input:unknown,confirmedCustomerCode=''){
  const key=await digest([config.instanceId,table,source.id]),id='service_ivy_'+key.slice(0,40),validated=validateServiceRecordInput(input);
  const existing=s.records.find(row=>row.id===id);
  const origin={system:'ivy-workbench',instanceId:config.instanceId,table,id:source.id,original:source,mappingHash:await digest(validated),...(confirmedCustomerCode?{confirmedCustomerCode}:{})};
  if(existing){
   if(existing.kind!=='service_record'||existing.customerId!==validated.customerId||stable(existing.source)!==stable(origin))throw new Error('来源记录已迁入但内容或映射发生变化，请人工核对；不会覆盖已有记录。');
   rows.push({sourceId:source.id,table,targetId:id,action:'skip'});return;
  }
  if(validated.type==='customer_profile'&&all(s,'service_record').some(row=>row.type==='customer_profile'&&row.customerId===validated.customerId))throw new Error('目标客户已有联系档案，请人工对比；不能覆盖现有联系资料。');
  if(s.records.some(row=>[id+'_revision_1',id+'_audit'].includes(row.id)))throw new Error('迁入记录的历史编号已存在，请人工核对，不能覆盖历史凭证。');
  const record={...validated,id,kind:'service_record',version:1,createdAt:capturedAt,updatedAt:capturedAt,updatedBy:actor.name,source:origin};
  additions.push(record,
   {id:id+'_revision_1',kind:'service_revision',recordId:id,customerId:record.customerId,version:1,action:'增量迁入 Ivy 历史记录',actorId:actor.id,actor:actor.name,createdAt:capturedAt,snapshot:structuredClone(record)},
   {id:id+'_audit',kind:'audit',targetId:id,lineId:'',action:'增量迁入 Ivy 历史记录',actorId:actor.id,actor:actor.name,source:'管理员确认的 Ivy 备份',createdAt:capturedAt,before:null,after:structuredClone(record)});
  rows.push({sourceId:source.id,table,targetId:id,action:'insert'});
 }
 for(const row of backup.customers){
  const map=bindings.get(row.id)!;
  await add('customers',row,{type:'customer_profile',customerId:map.targetId,title:String(row.name||'客户联系资料'),description:String(row.notes||''),details:{contactPerson:String(row.contactPerson||''),email:String(row.email||''),phone:String(row.phone||''),address:String(row.address||'')}},map.confirmedCustomerCode);
 }
 for(const row of backup.waitingItems){
  const map=bindings.get(row.customerId);if(!map)throw new Error('等待事项未能匹配客户，停止迁入。');
  const waitingFor=config.waitingForOverrides[row.id]??row.owner;
  if(!['customer','factory','jennifer','none'].includes(waitingFor))throw new Error('等待对象未确认，不能猜测归属。');
  const description=[row.description,row.project?`来源项目 / PO：${row.project}`:'',row.dateRequested?`原提出日期：${row.dateRequested}`:''].filter(Boolean).join('\n');
  await add('waitingItems',row,{type:'followup',customerId:map.targetId,title:String(row.what||row.project||'历史跟进事项'),description,status:row.resolved===true?'done':'open',waitingFor,nextFollowUp:row.nextFollowUp||'',details:{category:String(row.category||'')}});
 }
 const planHash=await digest({adapterVersion:1,actorId:actor.id,revision:s.revision,stateHash:await digest(s.records),backup:raw,config,rows});
 return {expectedRevision:s.revision,planHash,additions,rows,counts:{customers:backup.customers.length,waitingItems:backup.waitingItems.length,newRecords:rows.filter(row=>row.action==='insert').length,skipped:rows.filter(row=>row.action==='skip').length},originalHash:await digest(raw)};
}
