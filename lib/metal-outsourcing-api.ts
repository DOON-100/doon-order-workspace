import {z} from 'zod';
import {all,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {requestedExportBusinessTeam} from './business-team-export';
import {metalApply,metalData,metalPermissions,metalVisible,metalVisibleOrderIds,type MetalAction,type MetalPostInputs} from './metal-outsourcing';

const id=z.string().trim().min(1).max(300),v=z.number().int().nonnegative(),positiveVersion=z.number().int().positive();
const note=z.string().trim().max(3000).default(''),text=z.string().trim().min(1).max(200),reference=z.string().trim().min(1).max(300),reason=z.string().trim().min(2).max(2000);
const decimalPlaces=(n:number)=>{const [coefficient,exponent]=String(n).toLowerCase().split('e');return Math.max(0,(coefficient.split('.')[1]||'').length-Number(exponent||0));};
const number=z.number().finite().min(0).max(100000000).refine(x=>decimalPlaces(x)<=6,'数量、单价和换算最多保留6位小数。');
const positive=number.refine(x=>x>0,'数量或换算必须大于0。'),amount=z.number().finite().min(-1000000000).max(1000000000).refine(x=>decimalPlaces(x)<=2,'金额最多保留2位小数。');
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'日期格式应为YYYY-MM-DD'),groupKey=z.string().min(1).max(1600);
const update={id,version:positiveVersion},cancel={...update,reason};
const partInput=z.object({code:text,name:text,specification:z.string().trim().max(1000),material:z.string().trim().max(100),side:z.string().trim().max(50),unit:text,revision:text,active:z.boolean(),note}).strict();
const bomLine=z.object({partId:id,partVersion:positiveVersion,processId:id,processVersion:positiveVersion,unitsPerProduct:positive,requirements:note}).strict();
const quoteInput={supplierId:id,partId:id,partVersion:positiveVersion,processId:id,processVersion:positiveVersion,requirements:note,pricingUnit:text,pricingFactor:positive,priceIncTax:number,taxRate:number.refine(n=>n<=1,'税率应使用0到1的小数，例如0.13。'),currency:z.string().trim().regex(/^[A-Z]{3}$/,'币种须为三位大写代码。'),validFrom:day,validTo:day,qtyFrom:number,qtyTo:number.nullable(),freeReason:note,reference};
const rawSchemas={
 'metal-part-save':z.object({id:id.optional(),version:v,part:partInput}),
 'metal-bom-create':z.object({groupKey,revision:text,reference,lines:z.array(bomLine).min(1).max(100)}),
 'metal-bom-approve':z.object(update),'metal-bom-retire':z.object(cancel),
 'metal-plan-create':z.object({bomId:id,bomVersion:positiveVersion,sourceVersions:z.array(z.object({lineId:id,version:positiveVersion}).strict()).min(1).max(2000),quantity:positive,dueDate:day,note}),
 'metal-plan-cancel':z.object(cancel),
 'metal-demand-create':z.object({sources:z.array(z.object({planId:id,planVersion:positiveVersion,bomLineId:id,quantity:positive}).strict()).min(1).max(200),dueDate:day,note}),
 'metal-demand-cancel':z.object(cancel),
 'metal-quote-create':z.object(quoteInput),'metal-quote-approve':z.object(update),'metal-quote-retire':z.object(cancel),
 'metal-job-create':z.object({date:day,lines:z.array(z.object({demandId:id,demandVersion:positiveVersion,quantity:positive,quoteId:id,quoteVersion:positiveVersion}).strict()).min(1).max(100),note}),
 'metal-job-cancel':z.object(cancel),
 'metal-job-release':z.object({jobId:id,jobVersion:positiveVersion,jobLineId:id,quantity:positive,reason,reference}),
 'metal-stock-add':z.object({demandId:id,demandVersion:positiveVersion,quantity:positive,date:day,reference,note,evidenceAttachmentId:id}),
 'metal-stock-confirm':z.object(update),
 'metal-delivery-create':z.object({date:day,dueDate:day,lines:z.array(z.object({jobId:id,jobVersion:positiveVersion,jobLineId:id,quantity:positive}).strict()).min(1).max(100),reference,note}),
 'metal-delivery-dispatch':z.object(update),'metal-delivery-cancel':z.object(cancel),
 'metal-delivery-sign':z.object({...update,signedAt:day,signedBy:text,reference}),
 'metal-receipt-create':z.object({deliveryId:id,deliveryVersion:positiveVersion,deliveryLineId:id,quantity:positive,date:day,reference,note}),
 'metal-quality-create':z.object({receiptId:id,receiptVersion:positiveVersion,date:day,billableGood:number,freeGood:number,bad:number,note}),
 'metal-rework-create':z.object({qcId:id,qcVersion:positiveVersion,quantity:positive,date:day,dueDate:day,quoteId:id.optional(),quoteVersion:positiveVersion.optional(),freeReason:note,reference,note}),
 'metal-issue-create':z.object({qcId:id,qcVersion:positiveVersion,planId:id,planVersion:positiveVersion,quantity:positive,date:day,reference,note}),
 'metal-settlement-create':z.object({qcIds:z.array(id).max(1000),adjustmentIds:z.array(id).max(1000).default([]),period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/,'账期格式应为YYYY-MM。'),reference,note}),
 'metal-settlement-confirm':z.object(update),'metal-settlement-cancel':z.object(cancel),
 'metal-payment-create':z.object({settlementId:id,settlementVersion:positiveVersion,amount:amount.refine(x=>x>0,'付款金额必须大于0。'),date:day,reference,note}),
 'metal-adjustment-create':z.object({qcId:id,qcVersion:positiveVersion,amountIncTax:amount.refine(x=>x!==0,'扣补金额不可为0。'),reason,reference}),
 'metal-adjustment-approve':z.object(update),
 'metal-disposition-create':z.object({qcId:id,qcVersion:positiveVersion,quantity:positive,date:day,type:z.enum(['scrap','return']),reason,reference}),
 'metal-correction':z.object({targetId:id,targetVersion:positiveVersion,reason,reference}),
} satisfies Record<MetalAction,z.AnyZodObject>;
export const metalPostActions=Object.keys(rawSchemas) as MetalAction[];
const stable=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
async function hash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');}
function reader(s:State,m:Member){if(!metalPermissions(s,m).read)throw new AppError('没有金属外发访问权限。',403);}
function replayPermission(action:MetalAction,s:State,m:Member){
 const permissions=metalPermissions(s,m),permission=action.startsWith('metal-part-')||action.startsWith('metal-bom-')?'master':action.startsWith('metal-plan-')?'plan':action==='metal-quote-approve'||action==='metal-quote-retire'?'approvePrice':action.startsWith('metal-stock-')||action==='metal-delivery-dispatch'||action==='metal-receipt-create'?'stock':action==='metal-quality-create'||action==='metal-disposition-create'?'quality':action==='metal-issue-create'?'issue':action.startsWith('metal-settlement-')||action.startsWith('metal-adjustment-')?'settle':action==='metal-payment-create'?'pay':action==='metal-correction'?null:'operate';
 if(permission&&!permissions[permission])throw new AppError('没有此金属外发操作权限。',403);
 if((action==='metal-quote-create'||action==='metal-job-create')&&!permissions.price)throw new AppError('没有供应商价格使用权限。',403);
 if(action==='metal-correction'&&m.role!=='admin'&&!permissions.settle)throw new AppError('没有业务事实冲销权限。',403);
}
export async function metalOutsourcingGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='metal-outsourcing')return null;reader(s,m);const teamId=requestedExportBusinessTeam(s,m,req),response=json(metalData(s,m,teamId));response.headers.set('Vary',businessTeamHeader);return response;
}
export async function metalOutsourcingPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!Object.prototype.hasOwnProperty.call(rawSchemas,action))return null;reader(s,m);const name=action as MetalAction;replayPermission(name,s,m);
 let raw:unknown;try{const content=await req.text();if(content.length>1000000)throw new Error();raw=JSON.parse(content);}catch{throw new AppError('提交内容无效或超出大小限制。');}
 const schema=rawSchemas[name].extend({token:z.string().uuid()}).strict(),parsed=schema.safeParse(raw);if(!parsed.success)throw new AppError(parsed.error.issues[0]?.message||'请检查提交字段。');
 const {token,...input}=parsed.data as any,teamId=requestedExportBusinessTeam(s,m,req),fingerprint=await hash({action:name,input,teamId}),requestId='metal_request_'+token;
 const prior=s.records.find(r=>r.id===requestId);
 if(prior){if(prior.kind!=='metal_request'||prior.actorId!==m.id||prior.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他操作，本次未写入。',409);
  const target=s.records.find(r=>r.id===prior.result.id);if(target?.sourceLineIds?.length&&!metalVisible(target,metalVisibleOrderIds(s,m,teamId)))throw new AppError('原请求目标已不在当前授权范围。',403);return json(prior.result);
 }
 // Stock must point to an already uploaded, authorized physical-document attachment.
 if(name==='metal-stock-add'||name==='metal-stock-confirm'){
  const stock=name==='metal-stock-confirm'?all(s,'metal_stock').find(t=>t.id===input.id):undefined,attachmentId=stock?.evidenceAttachmentId||input.evidenceAttachmentId;
  const file=all(s,'attachment').find(a=>a.id===attachmentId&&metalVisibleOrderIds(s,m,teamId).has(a.lineId));if(!file?.fileKey||!await bucket().get(file.fileKey))throw new AppError('出库/转出凭证原件不可读取，请先补齐真实附件。');
 }
 const delta=metalApply(name,input as MetalPostInputs[typeof name],s,m,teamId),result={ok:true,id:delta.item.id,version:delta.item.version};
 const records:Entity[]=[];
 for(const row of delta.records){if(!row.kind.startsWith('metal_'))throw new AppError('金属外发不允许改写原台账。',500);const before=s.records.find(x=>x.id===row.id)||null;records.push(row,audit(m,row,before,'金属外发 '+name));}
 records.push({id:requestId,kind:'metal_request',actorId:m.id,fingerprint,result,createdAt:now()});await commit(s.revision,records);return json(result);
}
