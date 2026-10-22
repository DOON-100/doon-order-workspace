import {z} from 'zod';

// Source evidence only: parsing never normalizes business values or creates
// production demand, product codes, colour values, dates, or document approvals.
const text=(max:number)=>z.string().max(max);
const label=(max:number)=>text(max).min(1).refine(value=>value.trim().length>0,'不能全为空白');
const identifier=label(160).refine(value=>value===value.trim(),'标识不能带首尾空白');
const sha256=z.string().regex(/^[a-fA-F0-9]{64}$/);
const column=z.string().regex(/^[A-Z]{1,3}$/);
const quantity=z.number().finite().nonnegative().max(1000000000);
const rawValue=text(32000).nullable();
const colorFieldSchema=z.object({
 sourceColumn:column,sourceLabel:text(1000),sourceCell:label(300),value:rawValue,
 status:z.enum(['adopted','pending','composite']),standardZh:text(1000),standardEn:text(1000),
 qualifier:text(4000),candidates:z.array(label(1000)).max(100),
}).strict();
const rawFieldSchema=z.object({
 column,label:text(1000),cell:label(300),value:rawValue,
 sourceAnchor:label(300).optional(),sourceRange:label(300).nullable().optional(),
 formula:rawValue.optional(),cachedValue:rawValue.optional(),hidden:z.boolean().optional(),
}).strict();
const lineSchema=z.object({
 id:identifier,sourceRow:z.number().int().min(1).max(1048576),drawing:text(500),model:text(500),
 color:text(500),sku:text(500),quantity,unit:label(80),sampleQuantity:quantity.nullable(),
 unitPrice:text(500),deliveryText:text(4000),colorFields:z.array(colorFieldSchema).max(300),
 rawFields:z.array(rawFieldSchema).max(300),notes:z.array(text(4000)).max(100),
}).strict();

export const salesOrderSourceSchema=z.object({
 schemaVersion:z.literal(1),orderNo:label(300),customer:label(300),productType:text(300),
 customerPO:text(1000),documentType:z.literal('Sales Order Confirmation'),
 source:z.object({filename:label(300),sha256,sheet:label(300),detailRange:label(300)}).strict(),
 dictionaryVersion:label(300).optional(),dictionarySha256:sha256.optional(),
 warnings:z.array(text(4000)).max(300),lines:z.array(lineSchema).min(1).max(1000),
}).strict().superRefine((source,ctx)=>{
 const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:z.ZodIssueCode.custom,path,message});
 if((source.dictionaryVersion===undefined)!==(source.dictionarySha256===undefined))issue(['dictionaryVersion'],'颜色规则版本和哈希须同时提供');
 const ids=new Set<string>(),rows=new Set<number>();
 source.lines.forEach((line,index)=>{
  if(ids.has(line.id))issue(['lines',index,'id'],'来源明细标识重复');ids.add(line.id);
  if(rows.has(line.sourceRow))issue(['lines',index,'sourceRow'],'来源行号重复');rows.add(line.sourceRow);
  // Separate source slots may share a standard field or label, but a physical
  // column must remain one slot. Never collapse slots by their translated name.
  for(const key of ['colorFields','rawFields'] as const){
   const columns=new Set<string>();
   line[key].forEach((field,fieldIndex)=>{
    const value=key==='colorFields'?(field as z.infer<typeof colorFieldSchema>).sourceColumn:(field as z.infer<typeof rawFieldSchema>).column;
    if(columns.has(value))issue(['lines',index,key,fieldIndex], '来源列重复');columns.add(value);
   });
  }
 });
});

export type SalesOrderSource=z.infer<typeof salesOrderSourceSchema>;
export type SalesOrderSourceLine=SalesOrderSource['lines'][number];
export type SalesOrderSourceColorField=SalesOrderSourceLine['colorFields'][number];
export type SalesOrderSourceRawField=SalesOrderSourceLine['rawFields'][number];
export type SalesOrderSourceRecord={
 id:string;kind:'sales_order_source';version:1;status:'待核对';customer:string;orderNo:string;
 source:SalesOrderSource;contentFingerprint:string;createdAt:string;createdById:string;
};
export class SalesOrderSourceError extends Error{}
export function parseSalesOrderSource(value:unknown):SalesOrderSource{
 const result=salesOrderSourceSchema.safeParse(value);
 if(!result.success)throw new SalesOrderSourceError(result.error.issues.slice(0,5).map(issue=>issue.path.join('.')+'：'+issue.message).join('；'));
 return result.data;
}
