import {z} from 'zod';
export const purchaseActions=[
 {operation:'followup',label:'采购跟进修改'},
 {operation:'receipt',label:'采购收货'},
 {operation:'return',label:'采购退货'},
 {operation:'replacement',label:'采购退货补回'},
 {operation:'archive',label:'采购齐货存档'},
].map(row=>({...row,id:'prepare-purchase-'+row.operation,groups:['purchasing'],source:'purchase-data',nativeAction:row.operation==='followup'?'purchase-save':row.operation==='archive'?'purchase-archive':'purchase-receipt',kind:'purchase-draft',status:'draft-only'}));
const identifier=z.string().trim().min(1).max(160);
const day=z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2100&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'请填写 2000—2100 年间的有效日期 YYYY-MM-DD');
const basis=z.object({sources:z.array(z.object({field:z.string().min(1).max(160),reference:z.string().min(1).max(500),location:z.string().min(1).max(500)}).strict()).min(1).max(40),unknowns:z.array(z.string().min(1).max(500)).max(40).default([]),conflicts:z.array(z.string().min(1).max(500)).max(40).default([])}).strict();
export function purchaseDraftArguments(operation){
 const common={id:identifier,expectedVersion:z.number().int().positive(),basis};
 if(operation==='followup')return z.object({...common,fields:z.object({promisedDate:z.union([day,z.literal('')]).optional(),expectedDate:z.union([day,z.literal('')]).optional(),nextFollowupDate:z.union([day,z.literal('')]).optional(),followupNote:z.string().max(3000).optional()}).strict().refine(value=>Object.keys(value).length>0,'请填写修改字段')}).strict();
 if(operation==='archive')return z.object({...common,date:day,note:z.string().trim().min(2).max(1000)}).strict();
 if(!['receipt','return','replacement'].includes(operation))throw Error('采购动作未登记。');
 return z.object({...common,quantity:z.number().finite().positive().max(1e9).refine(value=>Math.abs(value*10000-Math.round(value*10000))<0.01,'数量最多四位小数'),date:day,reference:z.string().trim().min(2).max(120),note:z.string().trim().min(2).max(3000)}).strict();
}
export async function preparePurchase(action,input,access){
 if(typeof access.purchaseDraftContext!=='function')throw Object.assign(Error('当前任务不能生成采购修改提案。'),{status:403});
 const args=purchaseDraftArguments(action.operation).parse(input);
 const context=await access.purchaseDraftContext(args.id);
 if(!context.canEdit||!context.record)throw Object.assign(Error('当前账号无权维护这条采购明细。'),{status:403});
 if(context.record.version!==args.expectedVersion)throw Object.assign(Error('采购明细已更新，请重新查询核对。'),{status:409});
 const {expectedVersion,basis,...values}=args;
 const proposed={operation:action.operation,...values,version:context.record.version};
 const draft={domain:'purchase',status:'draft-only',saved:false,executed:false,writeEnabled:false,approvalRequired:true,basisVerified:false,
  proposed,basis,binding:{actorId:context.actorId,recordId:args.id,recordVersion:context.record.version},
  target:Object.fromEntries(['id','po','supplier','itemCode','itemName','unit','quantity','sourceRow','sourceFile','customerOrder','received','returnPending','balanceKnown','lifecycle'].map(key=>[key,context.record[key]])),
  message:'这是待核对采购提案，尚未修改业务。数量变化及是否允许执行由中台固定规则校验；来源、数量或凭证不明时保持待核查。'};
 if(Buffer.byteLength(JSON.stringify(draft))>48*1024)throw Object.assign(Error('采购提案过大，请缩小修改范围。'),{status:413});
 return access.stagePurchaseDraft?access.stagePurchaseDraft(draft):draft;
}
