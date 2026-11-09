/** Shared strict quotation fields; safe in the browser and on the server. */
import {z} from 'zod';
import {strictDate} from './domain';
import {calculateIeQuote} from './ie-quote-calculation';
import {ieMaterialNameReference} from './ie-material-names';

const text=(n=4000)=>z.string().trim().max(n).default('');
const id=z.string().trim().min(1).max(120);
const precise=(n:number)=>Math.abs(n-Math.round(n*1e6)/1e6)<=Number.EPSILON*Math.max(1,Math.abs(n))*2;
export const ieNumericValue=z.number().finite().min(0).max(100000000).refine(precise,'最多保留 6 位小数');
const num=ieNumericValue.nullable();
const date=z.string().refine(v=>{try{return !v||strictDate(v)===v;}catch{return false;}},'日期格式应为有效 YYYY-MM-DD').default('');
const catalogRef={catalogId:text(120),catalogVersion:z.number().int().positive().nullable().default(null),priceSource:text(1000)};
const manualAdjustment=z.object({target:z.string().min(1).max(1000),value:ieNumericValue,reason:z.string().trim().min(1,'人工调整必须填写原因').max(1000),sourceSignature:z.string().regex(/^ie-adjust-v1:[0-9a-f]{16}$/,'人工调整须绑定当前计算依据')}).strict();
const material=z.object({id,name:text(240),specification:text(1000),unit:text(40),basePrice:num,usage:num,coefficient:num,lossRate:z.number().finite().min(0.1,'材料正常损耗固定为 10%，仅允许逐项追加损耗').max(10).refine(precise,'损耗比例最多保留 6 位小数').default(0.1),lossAdjustmentReason:text(1000),notApplicable:z.boolean(),notes:text(),nameReference:ieMaterialNameReference.optional(),...catalogRef}).strict();
export const ieProcessSchema=z.object({id,name:text(240),parentId:text(120),sequence:z.number().int().nonnegative().max(10000),standardSeconds:num,basePrice:num,difficulty:num,usage:num.default(1),notApplicable:z.boolean(),notes:text(),...catalogRef}).strict();
const outsourcing=z.object({id,category:z.enum(['plating','general']),name:text(240),part:text(240),unitPrice:num,usage:num.default(1),notApplicable:z.boolean(),notes:text(),...catalogRef}).strict();
const line=z.object({id,model:text(200),customerModel:text(200),color:text(200),drawingNo:text(200),drawingRevision:text(200),quantityMin:z.number().int().positive().max(10000000).nullable(),quantityMax:z.number().int().positive().max(10000000).nullable(),structureNotes:text(),scopeNotes:text(),materials:z.array(material).max(200),processes:z.array(ieProcessSchema).max(300),outsourcing:z.array(outsourcing).max(100)}).strict();
const tooling=z.object({id,toolingId:text(120),name:text(240),lineIds:z.array(id).max(100),amount:num,chargeMode:z.enum(['charge','already_charged','included_in_batch','not_applicable']),chargeQuoteId:text(120),chargeVersion:z.number().int().positive().nullable().default(null),evidence:text(),notes:text()}).strict();
export const ieQuoteInput=z.object({id:id.optional(),version:z.number().int().positive().optional(),materialPricingMode:z.literal('checklist').optional(),customerAccountId:id,quoteNo:text(120),quoteDate:date,validUntil:date,batchId:text(120),exchangeRateCnyPerUsd:num,exchangeRateDate:date,exchangeRateSource:text(1000),notes:text(8000),lines:z.array(line).min(1).max(100),tooling:z.array(tooling).max(100),manualAdjustments:z.array(manualAdjustment).max(60000).optional()}).strict().superRefine((v,ctx)=>{
 if(v.id&&!v.version)ctx.addIssue({code:'custom',path:['version'],message:'编辑必须提供当前版本'});
 if(!v.id&&v.version)ctx.addIssue({code:'custom',path:['version'],message:'新建不能提供版本'});
 const unique=(items:{id:string}[],path:(string|number)[])=>{if(new Set(items.map(i=>i.id)).size!==items.length)ctx.addIssue({code:'custom',path,message:'行编号不能重复'});};
 unique(v.lines,['lines']);unique(v.tooling,['tooling']);v.lines.forEach((l,i)=>{unique(l.materials,['lines',i,'materials']);unique(l.processes,['lines',i,'processes']);unique(l.outsourcing,['lines',i,'outsourcing']);});
 if(v.manualAdjustments?.length){const valid=new Set(calculateIeQuote(v).adjustmentCells.map(c=>c.target)),seen=new Set<string>();v.manualAdjustments.forEach((a,i)=>{if(!valid.has(a.target))ctx.addIssue({code:'custom',path:['manualAdjustments',i,'target'],message:'人工调整对应的格位已删除或不存在'});if(seen.has(a.target))ctx.addIssue({code:'custom',path:['manualAdjustments',i,'target'],message:'同一格位只能有一项人工调整'});seen.add(a.target);});}
});
export type IeQuoteFields=Omit<z.infer<typeof ieQuoteInput>,'id'|'version'>;
