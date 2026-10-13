import type {WorkspaceNavigationContext} from './handoff-navigation';
type ContextRecord={id?:string;customerId?:string;customerAccountId?:string|null};
export type ResolvedRecordContext<T>={status:'none'}|{status:'unavailable';reason:string}|{status:'customer';customerId:string}|{status:'record';record:T;customerId:string};
/** Inputs must be the latest server-authorized feed. No names/codes/row-order joins. */
export function resolveWorkspaceRecordContext<T extends ContextRecord>(context:WorkspaceNavigationContext|undefined,customers:readonly {id:string}[],records:readonly T[]):ResolvedRecordContext<T>{
 if(!context?.recordId&&!context?.customerId)return {status:'none'};
 if(context.customerId&&!customers.some(customer=>customer.id===context.customerId))return {status:'unavailable',reason:'指定客户不在当前授权清单内。'};
 if(context.recordId){const record=records.find(row=>row.id===context.recordId);if(!record)return {status:'unavailable',reason:'指定记录不存在或已无访问权限。'};const customerId=record.customerId||record.customerAccountId||'';if(context.customerId&&customerId!==context.customerId)return {status:'unavailable',reason:'记录与指定客户不一致，未打开其他记录。'};if(customerId&&!customers.some(customer=>customer.id===customerId))return {status:'unavailable',reason:'该记录的客户不在当前授权清单内。'};return {status:'record',record,customerId};}
 return {status:'customer',customerId:context.customerId!};
}
