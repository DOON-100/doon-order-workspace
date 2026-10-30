import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {catalogDepartments,catalogEntries,catalogEntryInput,catalogGrants,catalogIdentity,catalogImportPlan,catalogMappingStatus,canConfigureCatalogDepartment,canMaintainCatalog,canReadCatalog,type CatalogEntry,type CatalogGrant,type CatalogSetting} from './outsourcing-catalog';

const prefix='outsourcing-catalog';
const token=z.string().uuid(),version=z.number().int().nonnegative(),reason=z.string().trim().min(1).max(1000);
const id=z.string().min(1).max(150),department=z.string().trim().min(1).max(80);
const saveSchema=z.object({token,id:id.optional(),version,entry:catalogEntryInput,reason}).strict();
const settingSchema=z.object({token,entryId:id,department,version,enabled:z.boolean(),statDepartment:z.string().max(200),statProcess:z.string().max(200),includeCost:z.string().max(100),reason}).strict();
const grantSchema=z.object({token,memberId:id,version,departments:z.array(department).max(40),entryIds:z.array(id).max(1000),active:z.boolean(),reason}).strict();
const importSchema=z.object({token,entries:z.array(catalogEntryInput).min(1).max(2000),planHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
async function body<T>(req:Request,schema:z.ZodType<T>):Promise<T>{let raw:unknown;try{const text=await req.text();if(text.length>8000000)throw new Error();raw=JSON.parse(text);}catch{throw new AppError('资料内容无效或超出大小限制。');}const result=schema.safeParse(raw);if(!result.success)throw new AppError(result.error.issues[0]?.message||'请检查字段内容。');return result.data;}
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function requireReader(m:Member){if(!canReadCatalog(m))throw new AppError('没有外发基础资料访问权限。',403);}
function requireAdmin(m:Member){if(m.role!=='admin')throw new AppError('此操作需要管理员权限。',403);}
function revision(m:Member,item:Entity,before:Entity|null,why:string){return {id:newId('outsourcing_catalog_revision'),kind:'outsourcing_catalog_revision',entryId:item.id,version:item.version,snapshot:item,before,reason:why,actorId:m.id,actor:m.name,createdAt:now()};}
function publicEntry(s:State,m:Member,item:CatalogEntry){return {...item,canEdit:canMaintainCatalog(s,m,item)};}
export async function outsourcingCatalogGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(![prefix,prefix+'-history'].includes(action))return null;requireReader(m);
 if(action===prefix+'-history'){
  const target=new URL(req.url).searchParams.get('id'),entry=all(s,'outsourcing_catalog_entry').find(e=>e.id===target),setting=all(s,'outsourcing_catalog_setting').find(e=>e.id===target),grant=all(s,'outsourcing_catalog_grant').find(e=>e.id===target);
  if(!entry&&!setting&&!(grant&&m.role==='admin'))throw new AppError('资料不存在或无权查看。',404);
  return json({rows:all(s,'outsourcing_catalog_revision').filter(r=>r.entryId===target).sort((a,b)=>b.version-a.version)});
 }
 const entries=catalogEntries(s),grants=all(s,'outsourcing_catalog_grant') as CatalogGrant[],departments=[...catalogDepartments];
 for(const d of [...entries.map(e=>e.ownerDepartment),...grants.flatMap(g=>g.departments)])if(!departments.some(x=>x.id===d))departments.push({id:d,name:d});
 return json({entries:entries.map(e=>publicEntry(s,m,e)),settings:all(s,'outsourcing_catalog_setting'),departments,
  grants:m.role==='admin'?grants:grants.filter(g=>g.memberId===m.id),members:m.role==='admin'?all(s,'member').filter(e=>canReadCatalog(e as Member)).map(e=>({id:e.id,name:e.name,role:e.role})):[],
  permissions:{admin:m.role==='admin',maintainDepartments:m.role==='admin'?departments.map(d=>d.id):[...new Set(catalogGrants(s,m).flatMap(g=>g.departments))]},revision:s.revision});
}
export async function outsourcingCatalogPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(![prefix+'-save',prefix+'-department-setting',prefix+'-grant',prefix+'-import-preview',prefix+'-import-commit'].includes(action))return null;requireReader(m);
 const input=action.endsWith('-save')?await body(req,saveSchema):action.endsWith('-department-setting')?await body(req,settingSchema):action.endsWith('-grant')?await body(req,grantSchema):await body(req,importSchema);
 const fingerprint=await hash({action,input}),requestId='outsourcing_catalog_request_'+input.token;
 const prior=all(s,'outsourcing_catalog_request').find(e=>e.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他操作，请刷新核对。',409);return json(prior.result);}
 const records:Entity[]=[];let result:Record<string,unknown>;
 if(action===prefix+'-save'){
  const b=input as z.infer<typeof saveSchema>,before=b.id?catalogEntries(s).find(e=>e.id===b.id):undefined;
  if(b.id&&!before)throw new AppError('资料不存在。',404);if((before?.version||0)!==b.version)throw new AppError('资料已更新，请刷新后核对。',409);
  if(before&&before.category!==b.entry.category)throw new AppError('资料类别不可改变，请另建类型或工序并保留原记录。');
  if(!canMaintainCatalog(s,m,before||b.entry))throw new AppError('仅资料维护负责人可以保存。',403);
  if(before&&before.ownerDepartment!==b.entry.ownerDepartment&&m.role!=='admin')throw new AppError('维护归属由管理员调整。',403);
  if(!before&&!canConfigureCatalogDepartment(s,m,b.entry.ownerDepartment))throw new AppError('没有该部门新增资料权限。',403);
  if(b.entry.category==='process'&&b.entry.productFamily&&(!before||before.productFamily!==b.entry.productFamily)&&!catalogEntries(s).some(e=>e.category==='type'&&e.active&&e.code.normalize('NFKC').trim().toUpperCase()===b.entry.productFamily.normalize('NFKC').trim().toUpperCase()))throw new AppError('请先建立并启用对应产品族的类型资料。');
  if(before&&JSON.stringify(before.source)!==JSON.stringify(b.entry.source))throw new AppError('原始来源不可修改。');
  if(!before&&b.entry.source&&m.role!=='admin')throw new AppError('原始来源由管理员导入，手工新增请勿填写来源。',403);
  if(m.role!=='admin'&&b.entry.active!==(before?.active??true))throw new AppError('公司级停用或恢复由管理员处理；本部门停用请使用部门配置。',403);
  const proposedIdentity=catalogIdentity(b.entry),identity=before?.category==='process'&&before.mappingStatus==='pending'&&catalogMappingStatus(b.entry)==='pending'?before.identity:proposedIdentity;
  if(before&&before.identity!==identity&&!(before.mappingStatus==='pending'&&catalogMappingStatus(b.entry)==='ready'))throw new AppError('类型代码或加工含义变化请新增资料，旧身份须保留。');
  if(catalogEntries(s).some(e=>e.id!==before?.id&&(e.identity===identity||b.entry.category==='process'&&e.category==='process'&&e.name.normalize('NFKC').trim().toUpperCase()===b.entry.name.normalize('NFKC').trim().toUpperCase())))throw new AppError('该类型代码或工序身份已存在，请直接选用。',409);
  const item:CatalogEntry={...b.entry,id:before?.id||newId('outsourcing_catalog_entry'),kind:'outsourcing_catalog_entry',version:b.version+1,identity,mappingStatus:catalogMappingStatus(b.entry),createdAt:before?.createdAt||now(),updatedAt:now(),updatedBy:m.name,updatedById:m.id,reason:b.reason};
  records.push(item,revision(m,item,before||null,b.reason),audit(m,item,before||null,'维护外发共享基础资料'));result={ok:true,id:item.id,version:item.version};
 }else if(action===prefix+'-department-setting'){
  const b=input as z.infer<typeof settingSchema>;if(!canConfigureCatalogDepartment(s,m,b.department))throw new AppError('没有该部门配置维护权限。',403);
  if(!catalogEntries(s).some(e=>e.id===b.entryId))throw new AppError('资料不存在。',404);
  const before=(all(s,'outsourcing_catalog_setting') as CatalogSetting[]).find(e=>e.entryId===b.entryId&&e.department===b.department);
  if((before?.version||0)!==b.version)throw new AppError('部门配置已更新，请刷新。',409);
  const {token:unused,...fields}=b;void unused;const item={...fields,id:before?.id||newId('outsourcing_catalog_setting'),kind:'outsourcing_catalog_setting',version:b.version+1,updatedAt:now(),updatedBy:m.name};
  records.push(item,revision(m,item,before||null,b.reason),audit(m,item,before||null,'维护外发部门使用配置'));result={ok:true,id:item.id,version:item.version};
 }else if(action===prefix+'-grant'){
  requireAdmin(m);const b=input as z.infer<typeof grantSchema>,target=all(s,'member').find(e=>e.id===b.memberId&&canReadCatalog(e as Member));if(!target)throw new AppError('请选择有效内部人员。');
  if(b.entryIds.some(key=>!catalogEntries(s).some(e=>e.id===key)))throw new AppError('授权条目不存在。');
  const before=(all(s,'outsourcing_catalog_grant') as CatalogGrant[]).find(e=>e.memberId===b.memberId);if((before?.version||0)!==b.version)throw new AppError('维护授权已更新，请刷新。',409);
  const item={id:before?.id||newId('outsourcing_catalog_grant'),kind:'outsourcing_catalog_grant',memberId:b.memberId,departments:[...new Set(b.departments)],entryIds:[...new Set(b.entryIds)],active:b.active,version:b.version+1,reason:b.reason,updatedAt:now(),updatedBy:m.name};
  records.push(item,revision(m,item,before||null,b.reason),audit(m,item,before||null,'设置外发资料维护负责人'));result={ok:true,id:item.id,version:item.version};
 }else{
  requireAdmin(m);const b=input as z.infer<typeof importSchema>;
  const types=[...catalogEntries(s),...b.entries].filter(e=>e.category==='type'&&e.active).map(e=>e.code.normalize('NFKC').trim().toUpperCase());
  if(b.entries.some(e=>e.category==='process'&&e.productFamily&&!types.includes(e.productFamily.normalize('NFKC').trim().toUpperCase())))throw new AppError('加工分类引用的产品族尚未建立，请保留待映射或同时导入对应类型。');
  const rows=catalogImportPlan(s,b.entries),planHash=await hash({actorId:m.id,entries:b.entries,rows});
  if(action===prefix+'-import-preview')return json({planHash,rows,total:rows.length,newCount:rows.filter(r=>r.status==='new').length,existingCount:rows.filter(r=>r.status==='existing').length,conflictCount:rows.filter(r=>r.status==='conflict').length});
  if(!b.planHash||b.planHash!==planHash)throw new AppError('导入预览已变化，请重新预览。',409);if(rows.some(r=>r.status==='conflict'))throw new AppError('导入存在冲突，请先核对。',409);
  const ids:string[]=[];
  for(const row of rows.filter(r=>r.status==='new')){const entry=b.entries[row.index],item:CatalogEntry={...entry,id:newId('outsourcing_catalog_entry'),kind:'outsourcing_catalog_entry',version:1,identity:row.identity,mappingStatus:catalogMappingStatus(entry),createdAt:now(),updatedAt:now(),updatedBy:m.name,updatedById:m.id,reason:'原始资料首导'};records.push(item,revision(m,item,null,'原始资料首导'));ids.push(item.id);}
  const batch={id:newId('outsourcing_catalog_import'),kind:'outsourcing_catalog_import',actorId:m.id,planHash,entryIds:ids,sourceRows:b.entries.map(e=>e.source||null),createdAt:now()};records.push(batch,audit(m,batch,null,'导入外发共享基础资料'));result={ok:true,inserted:ids.length,existing:rows.length-ids.length,batchId:batch.id,ids};
 }
 records.push({id:requestId,kind:'outsourcing_catalog_request',actorId:m.id,fingerprint,result,createdAt:now()});await commit(s.revision,records);return json(result);
}
