import {z} from 'zod';

// Names and rules only. Customer source workbooks and actual colour values are
// private data imported through the authenticated configuration endpoint.
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,159}$/);
const label=(max:number)=>z.string().min(1).max(max).refine(value=>value.trim().length>0,'名称不能全为空白');
const kingdeeFieldSchema=z.object({label:label(300),column:z.string().regex(/^[A-Z]{1,3}$/),sourceRef:label(500),basis:z.literal('same-meaning')}).strict();
const fieldNames={
 labelZh:label(300),labelEn:label(300),sourceRef:label(500),
 originalLabelZh:label(300).optional(),originalLabelEn:label(300).optional(),
 aliases:z.array(label(300)).max(50).optional(),kingdee:kingdeeFieldSchema.optional(),
};
const fieldSchema=z.object({id,...fieldNames}).strict();
export const salesOrderFieldKeys=['customer','orderNo','customerPO','drawing','model','sku','color','quantity','unit','sampleQuantity','unitPrice','deliveryText'] as const;
const orderFieldSchema=z.object({key:z.enum(salesOrderFieldKeys),...fieldNames,notes:z.string().max(2000).optional()}).strict();
const slotSchema=z.object({
 id,sourceColumn:z.string().regex(/^[A-Z]{1,3}$/),sourceLabel:label(600),
 fieldId:id.nullable(),status:z.enum(['adopted','pending','composite']),
 candidateFieldIds:z.array(id).max(100),qualifier:z.string().max(2000),
}).strict();
const profileSchema=z.object({
 id,name:label(300),customer:label(160),productType:label(160),sourceSheet:label(300),
 slots:z.array(slotSchema).min(1).max(300),
}).strict();
export const salesColorCatalogSchema=z.object({
 schemaVersion:z.literal(1),title:label(300),dictionaryVersion:label(160),
 sourceSha256:z.string().regex(/^[a-fA-F0-9]{64}$/),
 fields:z.array(fieldSchema).min(1).max(1000),profiles:z.array(profileSchema).max(500),
 orderFields:z.array(orderFieldSchema).max(salesOrderFieldKeys.length).optional(),
}).strict().superRefine((catalog,ctx)=>{
 const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,path,message});
 const fieldIds=new Set<string>();
 catalog.fields.forEach((field,i)=>{if(fieldIds.has(field.id))issue(['fields',i,'id'],'标准字段ID重复');fieldIds.add(field.id);});
 const orderKeys=new Set<string>();
 catalog.orderFields?.forEach((field,i)=>{if(orderKeys.has(field.key))issue(['orderFields',i,'key'],'订单基本字段重复');orderKeys.add(field.key);});
 for(const group of ['fields','orderFields'] as const)(catalog[group]||[]).forEach((field,i)=>{
  if(field.kingdee&&field.labelZh!==field.kingdee.label)issue([group,i,'kingdee','label'],'已确认同义的中文标题必须与金蝶模板标题一致');
  if((field.originalLabelZh===undefined)!==(field.originalLabelEn===undefined))issue([group,i,'originalLabelZh'],'原字典中英文标题须同时保留');
 });
 const profileIds=new Set<string>();
 catalog.profiles.forEach((profile,i)=>{
  if(profileIds.has(profile.id))issue(['profiles',i,'id'],'客户对应规则ID重复');profileIds.add(profile.id);
  const slots=new Set<string>(),columns=new Set<string>();
  profile.slots.forEach((slot,j)=>{
   const at=['profiles',i,'slots',j];
   if(slots.has(slot.id))issue([...at,'id'],'来源栏目ID重复');slots.add(slot.id);
   if(columns.has(slot.sourceColumn))issue([...at,'sourceColumn'],'同一来源列不能重复定义');columns.add(slot.sourceColumn);
   if(slot.fieldId!==null&&!fieldIds.has(slot.fieldId))issue([...at,'fieldId'],'引用的标准字段不存在');
   if(new Set(slot.candidateFieldIds).size!==slot.candidateFieldIds.length)issue([...at,'candidateFieldIds'],'候选字段ID重复');
   if(slot.candidateFieldIds.some(candidate=>!fieldIds.has(candidate)))issue([...at,'candidateFieldIds'],'候选标准字段不存在');
   if(slot.status==='adopted'&&slot.fieldId===null)issue([...at,'fieldId'],'已采用栏目必须引用标准字段');
   if(slot.status!=='adopted'&&slot.fieldId!==null)issue([...at,'fieldId'],'待定或组合栏目不能标记为单一已采用字段');
   if(slot.status==='composite'&&slot.candidateFieldIds.length<2)issue([...at,'candidateFieldIds'],'组合栏目须保留至少两个关联标准字段');
  });
 });
});

export type SalesColorCatalog=z.infer<typeof salesColorCatalogSchema>;
export type SalesColorField=SalesColorCatalog['fields'][number];
export type SalesColorProfile=SalesColorCatalog['profiles'][number];
export type SalesColorSlot=SalesColorProfile['slots'][number];
export type SalesOrderFieldLabel=NonNullable<SalesColorCatalog['orderFields']>[number];
export class SalesColorCatalogError extends Error{}
export function parseSalesColorCatalog(value:unknown):SalesColorCatalog{
 const result=salesColorCatalogSchema.safeParse(value);
 if(!result.success)throw new SalesColorCatalogError(result.error.issues.slice(0,5).map(issue=>issue.path.join('.')+'：'+issue.message).join('；'));
 return result.data;
}

export type SalesColorMatch={
 status:'matched'|'candidates'|'pending'|'composite'|'unknown';
 fieldId:string|null;field?:SalesColorField;candidateFieldIds:string[];sourceSlotIds:string[];
 profileId?:string;
 basis:'dictionary-exact'|'profile-alias'|'profile-slot'|'dictionary-similar'|'ambiguous-profile'|'none';
};
// Title lookup only; original labels and all business values stay untouched.
const nameKey=(value:string)=>value.normalize('NFKC').replace(/圏/g,'圈').trim().replace(/\s+/g,' ').toLowerCase();
export const salesColorFieldNames=(field:Pick<SalesColorField,'labelZh'|'labelEn'|'originalLabelZh'|'originalLabelEn'|'aliases'>)=>[field.labelZh,field.labelEn,field.originalLabelZh,field.originalLabelEn,...(field.aliases||[])].filter((value):value is string=>!!value);
const sourceNames=(value:string)=>new Set([value,...value.split(/\r\n?|\n/)].map(nameKey).filter(Boolean));
const compact=(value:string)=>nameKey(value).replace(/[\s\p{P}\p{S}]/gu,'');
function similar(a:string,b:string){
 const x=compact(a),y=compact(b);if(Math.min(x.length,y.length)<2||Math.max(x.length,y.length)>100)return false;
 if(x===y)return true;
 if((x.includes(y)||y.includes(x))&&Math.min(x.length,y.length)/Math.max(x.length,y.length)>=0.6)return true;
 // Suggestions only. Edit distance never promotes an unapproved alias to a match.
 let prior=Array.from({length:y.length+1},(_,i)=>i);
 for(let i=1;i<=x.length;i++){
  const next=[i];for(let j=1;j<=y.length;j++)next[j]=Math.min(next[j-1]+1,prior[j]+1,prior[j-1]+(x[i-1]===y[j-1]?0:1));prior=next;
 }
 return Math.max(x.length,y.length)>=4&&1-prior[y.length]/Math.max(x.length,y.length)>=0.75;
}
/** Pure lookup: never mutates a catalogue, source column, order, or value. */
export function matchSalesColorField(catalog:SalesColorCatalog,label:string,context:{profileId?:string;sourceColumn?:string}={}):SalesColorMatch{
 const unknown:SalesColorMatch={status:'unknown',fieldId:null,candidateFieldIds:[],sourceSlotIds:[],basis:'none'};
 const key=nameKey(label);if(!key)return unknown;
 const fields=new Map(catalog.fields.map(field=>[field.id,field]));
 if(context.sourceColumn&&!context.profileId)return unknown;
 if(context.profileId){
  const profile=catalog.profiles.find(item=>item.id===context.profileId);if(!profile)return unknown;
  let slots:SalesColorSlot[];
  if(context.sourceColumn){
   const slot=profile.slots.find(item=>item.sourceColumn===context.sourceColumn);
   if(!slot)return unknown;
   const field=slot.fieldId?fields.get(slot.fieldId):undefined;
   if(!sourceNames(slot.sourceLabel).has(key)&&(!field||!salesColorFieldNames(field).some(value=>nameKey(value)===key)))return unknown;
   slots=[slot];
  }else slots=profile.slots.filter(slot=>sourceNames(slot.sourceLabel).has(key));
  if(slots.length){
   const sourceSlotIds=slots.map(slot=>slot.id),candidateFieldIds=[...new Set(slots.flatMap(slot=>slot.fieldId?[slot.fieldId]:slot.candidateFieldIds))];
   if(slots.length>1)return {status:'candidates',fieldId:null,candidateFieldIds,sourceSlotIds,profileId:profile.id,basis:'ambiguous-profile'};
   const slot=slots[0],field=slot.fieldId?fields.get(slot.fieldId):undefined;
   return {status:slot.status==='adopted'?'matched':slot.status,fieldId:field?.id||null,...(field?{field}:{}),candidateFieldIds,sourceSlotIds,profileId:profile.id,basis:context.sourceColumn?'profile-slot':'profile-alias'};
  }
 }
 const exact=catalog.fields.filter(field=>salesColorFieldNames(field).some(value=>nameKey(value)===key));
 if(exact.length===1)return {status:'matched',fieldId:exact[0].id,field:exact[0],candidateFieldIds:[exact[0].id],sourceSlotIds:[],basis:'dictionary-exact'};
 if(exact.length>1)return {status:'candidates',fieldId:null,candidateFieldIds:exact.map(field=>field.id),sourceSlotIds:[],basis:'dictionary-exact'};
 const candidates=catalog.fields.filter(field=>salesColorFieldNames(field).some(value=>similar(label,value)));
 return candidates.length?{status:'candidates',fieldId:null,candidateFieldIds:candidates.map(field=>field.id),sourceSlotIds:[],basis:'dictionary-similar'}:unknown;
}
