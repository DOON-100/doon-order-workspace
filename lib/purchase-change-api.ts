import {z} from 'zod';
import {all,broad,strictDate,type State,type Member} from './domain';
import {AppError} from './store';
import {buildPurchaseWrite} from './purchase-api';
import {visiblePurchases,remaining,full,roundQty,sourceClosed,followFields,type Purchase} from './purchases';
import {createConfirmedChangeApi,changeHash,schemaSignature} from './confirmed-change';

export const purchaseChangeLabels={followup:'采购跟进修改',receipt:'采购收货',return:'采购退货',replacement:'采购退货补回',archive:'采购齐货存档'};
const id=z.string().trim().min(1).max(160),version=z.number().int().positive();
const day=z.string().refine(value=>{try{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'请填写有效日期 YYYY-MM-DD');
const fields=z.object({promisedDate:z.union([day,z.literal('')]).optional(),expectedDate:z.union([day,z.literal('')]).optional(),nextFollowupDate:z.union([day,z.literal('')]).optional(),followupNote:z.string().max(3000).optional()}).strict().refine(value=>Object.keys(value).length>0,'请指定修改字段');
const event={id,version,quantity:z.number().finite().positive().max(1e9).refine(n=>Math.abs(n*10000-Math.round(n*10000))<0.01,'数量最多四位小数'),date:day,reference:z.string().trim().min(2).max(120),note:z.string().trim().min(2).max(3000)};
export const purchaseChangeSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('followup'),id,version,fields}).strict(),
 z.object({operation:z.literal('receipt'),...event}).strict(),
 z.object({operation:z.literal('return'),...event}).strict(),
 z.object({operation:z.literal('replacement'),...event}).strict(),
 z.object({operation:z.literal('archive'),id,version,date:day,note:z.string().trim().min(2).max(1000)}).strict(),
]);
type Payload=z.output<typeof purchaseChangeSchema>;
function authorize(s:State,m:Member,payload:Record<string,any>){
 if(!m.active||!broad(m)||!visiblePurchases(s,m).some(row=>row.id===payload.id))throw new AppError('当前身份没有这条采购明细的维护权限。',403);
}
function effects(row:Purchase){return {received:row.balanceKnown?row.received:null,returnPending:row.balanceKnown?row.returnPending:null,remaining:remaining(row),lifecycle:row.lifecycle,completedDate:row.completedDate||'',...Object.fromEntries(Object.keys(followFields).map(key=>[key,row[key]]))};}
function build(req:Request,s:State,m:Member,input:Record<string,any>,requestId?:string){
 const p=purchaseChangeSchema.parse(input);authorize(s,m,p);
 const before=visiblePurchases(s,m).find(row=>row.id===p.id)!;
 if(before.version!==p.version)throw new AppError('采购明细已更新，请重新查询并预览。',409);
 let action:string,body:unknown;
 if(p.operation==='followup'){action='purchase-save';body={changes:Object.entries(p.fields).map(([field,value])=>({id:p.id,version:p.version,field,value}))};}
 else if(p.operation==='archive'){action='purchase-archive';body={items:[{id:p.id,version:p.version}],date:p.date,note:p.note};}
 else{action='purchase-receipt';body={id:p.id,version:p.version,type:p.operation,quantity:p.quantity,date:p.date,reference:p.reference,note:p.note,token:requestId};}
 const plan=buildPurchaseWrite(action,body,s,m);
 const record=plan.updates.find(row=>row.kind==='purchase'&&row.id===p.id) as Purchase|undefined;
 if(!record||plan.idempotent)throw new AppError('发现已处理请求，请核查原结果。',409);
 // Only derived values relevant to this action enter the review. Raw import is preserved.
 return {payload:p,before,record,updates:plan.updates,idempotent:plan.idempotent,effects:{before:effects(before),after:effects(record)}};
}
const api=createConfirmedChangeApi({
 prefix:'purchase-change',kind:'purchase_change',protocol:'doon-purchase-change-v1',payloadSchema:purchaseChangeSchema,types:Object.keys(purchaseChangeLabels),
 rules:()=>changeHash({schema:schemaSignature(purchaseChangeSchema),code:[String(buildPurchaseWrite),String(build),String(authorize),String(effects),String(strictDate),String(remaining),String(full),String(roundQty),String(sourceClosed),String(broad),String(visiblePurchases)]}),
 authorize,
 sources(s,m,payload){return s.records.filter(row=>row.id===payload.id||row.id===m.id||row.kind==='purchase_event'&&row.purchaseId===payload.id).sort((a,b)=>a.id.localeCompare(b.id));},
 build,
 describe(payload){return {label:purchaseChangeLabels[(payload as Payload).operation],domain:'purchase',detailFields:[],fieldLabels:{...followFields,operation:'业务动作',quantity:'本次数量',date:'业务日期',reference:'凭证编号',note:'操作说明',received:'已收数量（净合格）',returnPending:'退货待补数量',remaining:'剩余数量（含退货待补）',lifecycle:'跟进状态',completedDate:'齐货日期'}};},
});
export async function purchaseChangeGet(action:string,req:Request,s:State,m:Member){if(!['purchase-change-contract','purchase-change'].includes(action))return null;return api.get(action,req,s,m);}
export async function purchaseChangePost(action:string,req:Request,s:State,m:Member){if(!['purchase-change-preview','purchase-change-confirm','purchase-change-cancel'].includes(action))return null;return api.post(action,req,s,m);}
