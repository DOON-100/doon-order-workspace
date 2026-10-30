import {z} from 'zod';
import {all,clean,personnelTypeOf,type Entity,type Member,type State} from './domain';

export const catalogDepartments=[{id:'titanium',name:'钛架部'},{id:'plastic',name:'胶架部'},{id:'packaging',name:'包装部'},{id:'plating',name:'电镀外发'},{id:'purchase',name:'采购'},{id:'未分配',name:'未分配'}];
const text=(max=200)=>z.string().max(max).default('');
const rawValue=z.union([z.string().max(6000),z.number().finite(),z.boolean(),z.null()]);
export const catalogSourceSchema=z.object({filename:z.string().min(1).max(255),sha256:z.string().regex(/^[a-f0-9]{64}$/),sheet:z.string().min(1).max(100),row:z.number().int().positive(),raw:z.record(rawValue)}).strict();
export const catalogEntryInput=z.object({
 category:z.enum(['type','process']),code:text(100),name:z.string().trim().min(1).max(300),sequence:text(40),ownerDepartment:z.string().trim().min(1).max(80),note:text(3000),
 productFamily:text(100),processingObject:text(200),actions:z.array(z.string().trim().min(1).max(100)).max(30).default([]),statDepartment:text(),statProcess:text(),includeCost:text(100),originalEditor:text(),
 costHistory:z.record(z.string().max(200)).default({}),active:z.boolean().default(true),source:catalogSourceSchema.optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.category==='type'&&!clean(value.code))ctx.addIssue({code:'custom',path:['code'],message:'类型代码不能为空'});
 if(value.category==='process'&&[!!value.productFamily,!!value.processingObject,!!value.actions.length].some(Boolean)&&![!!value.productFamily,!!value.processingObject,!!value.actions.length].every(Boolean))ctx.addIssue({code:'custom',message:'加工分类映射须同时填写产品族、加工对象及动作顺序，或全部留待核对'});
 if(Object.keys(value.costHistory).length>30||Object.keys(value.source?.raw||{}).length>300)ctx.addIssue({code:'custom',message:'来源字段过多'});
});
export type CatalogEntryInput=z.infer<typeof catalogEntryInput>;
export type CatalogEntry=CatalogEntryInput&{id:string;kind:'outsourcing_catalog_entry';version:number;identity:string;mappingStatus:'ready'|'pending';createdAt:string;updatedAt:string;updatedBy:string;updatedById:string;reason:string};
export type CatalogGrant=Entity&{kind:'outsourcing_catalog_grant';memberId:string;departments:string[];entryIds:string[];active:boolean;version:number};
export type CatalogSetting=Entity&{kind:'outsourcing_catalog_setting';entryId:string;department:string;enabled:boolean;statDepartment:string;statProcess:string;includeCost:string;version:number};
const normalized=(value:string)=>clean(value).toLocaleUpperCase();
export function catalogIdentity(input:CatalogEntryInput){
 if(input.category==='type')return JSON.stringify(['type',normalized(input.code)]);
 return input.productFamily&&input.processingObject&&input.actions.length?JSON.stringify(['process',normalized(input.productFamily),normalized(input.processingObject),input.actions.map(normalized)]):JSON.stringify(['source-process',normalized(input.name)]);
}
export function catalogMappingStatus(input:CatalogEntryInput):'ready'|'pending'{return input.category==='type'||!!(input.productFamily&&input.processingObject&&input.actions.length)?'ready':'pending';}
export function catalogEntries(s:State){return all(s,'outsourcing_catalog_entry') as CatalogEntry[];}
export function canReadCatalog(m:Member){return m.active&&m.role!=='supplier'&&personnelTypeOf(m)==='internal';}
export function catalogGrants(s:State,m:Member){return (all(s,'outsourcing_catalog_grant') as CatalogGrant[]).filter(g=>g.memberId===m.id&&g.active);}
export function canMaintainCatalog(s:State,m:Member,entry:{id?:string;ownerDepartment:string}){return canReadCatalog(m)&&(m.role==='admin'||catalogGrants(s,m).some(g=>g.departments.includes(entry.ownerDepartment)||!!entry.id&&g.entryIds.includes(entry.id)));}
export function canConfigureCatalogDepartment(s:State,m:Member,department:string){return canReadCatalog(m)&&(m.role==='admin'||catalogGrants(s,m).some(g=>g.departments.includes(department)));}
export function catalogComparable(input:CatalogEntryInput){
 // Row location is evidence, not the definition of an otherwise identical item.
 const definition={category:input.category,code:input.code,name:input.name,sequence:input.sequence,ownerDepartment:input.ownerDepartment,note:input.note,productFamily:input.productFamily,processingObject:input.processingObject,actions:input.actions,statDepartment:input.statDepartment,statProcess:input.statProcess,includeCost:input.includeCost,originalEditor:input.originalEditor,costHistory:input.costHistory,active:input.active};return JSON.stringify(definition);
}
export function catalogImportPlan(s:State,inputs:CatalogEntryInput[]){
 const known=new Map(catalogEntries(s).map(entry=>[entry.identity,{id:entry.id,input:entry}]));
 return inputs.map((input,index)=>{
  const identity=catalogIdentity(input),existing=known.get(identity);
  if(existing)return {index,status:catalogComparable(existing.input)===catalogComparable(input)?'existing':'conflict',id:existing.id,identity,name:input.name,reason:catalogComparable(existing.input)===catalogComparable(input)?'相同资料已存在，不重复新增':'相同身份的资料内容不同，请核对后再导入'};
  const nameConflict=input.category==='process'&&Array.from(known.values()).some(v=>v.input.category==='process'&&normalized(v.input.name)===normalized(input.name));
  if(nameConflict)return {index,status:'conflict',id:'',identity,name:input.name,reason:'同名工序已有其他映射，请核对'};
  known.set(identity,{id:'candidate:'+index,input:input as CatalogEntry});return {index,status:'new',id:'',identity,name:input.name,reason:'新增共享资料'};
 });
}
