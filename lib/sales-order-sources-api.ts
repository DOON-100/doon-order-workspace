import {z} from 'zod';
import {all,clean,newId,now,personnelTypeOf,type CustomerAccount,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {businessTeamHeader,filterBusinessTeamRows} from './business-team-scope';
import {requestedExportBusinessTeam} from './business-team-export';
import {parseSalesOrderSource,SalesOrderSourceError,type SalesOrderSourceRecord} from './sales-order-sources';
import {latestSalesColorCatalog} from './sales-color-fields-api';
import {salesOrderDisplayLabels} from './sales-order-field-labels';

const importSchema=z.object({token:z.string().uuid(),source:z.unknown()}).strict();
const key=(value:string)=>clean(value).toLocaleLowerCase();
function internal(m:Member){if(!m.active||personnelTypeOf(m)!=='internal')throw new AppError('仅在职内部成员可读取销售原单资料。',403);}
function readable(s:State,m:Member,customer:string){
 if(m.role==='admin')return true;
 const target=key(customer),allAccounts=all(s,'customer_account') as CustomerAccount[];
 if(allAccounts.filter(account=>[account.customer,account.customerCode].some(value=>key(value)===target)).length>1)return false;
 const accounts=allAccounts.filter(account=>serviceOrderCustomerKeys(s,account).some(value=>key(value)===target));
 if(accounts.length>1)return false;
 // Raw source prices require explicit customer responsibility. Broad PMC/order
 // visibility and legacy customer-name lists do not grant commercial access.
 return !!accounts[0]&&assignedServiceCustomer(s,m,accounts[0]);
}
export async function salesOrderSourcesGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='sales-order-sources-data')return null;internal(m);
 const teamId=requestedExportBusinessTeam(s,m,req);
 const permitted=(all(s,'sales_order_source') as SalesOrderSourceRecord[]).filter(record=>readable(s,m,record.customer));
 // An id-less wrapper avoids treating source ids as existing order links.
 const items=filterBusinessTeamRows(s,permitted.map(record=>({customer:record.customer,record})),teamId).map(row=>row.record);
 const currentCatalog=latestSalesColorCatalog(s);
 const fieldLabels=salesOrderDisplayLabels(currentCatalog?.catalog||null,items);
 const response=json({items,status:'待核对',canImport:m.role==='admin',fieldLabels,...(currentCatalog?{fieldLabelsVersion:currentCatalog.catalog.dictionaryVersion}:{})});response.headers.set('Vary',businessTeamHeader);return response;
}
async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(value=>value.toString(16).padStart(2,'0')).join('');}
export async function salesOrderSourcesPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='sales-order-sources-import')return null;internal(m);
 if(m.role!=='admin')throw new AppError('仅管理员可导入销售原单资料。',403);
 const teamId=requestedExportBusinessTeam(s,m,req),raw=await req.text();
 if(new TextEncoder().encode(raw).byteLength>8*1024*1024)throw new AppError('销售原单资料超过8 MiB上限。');
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new AppError('销售原单请求不是有效JSON。');}
 const parsed=importSchema.safeParse(value);if(!parsed.success)throw new AppError('请提供有效请求标识和销售原单，不能包含额外参数。');
 let source;try{source=parseSalesOrderSource(parsed.data.source);}catch(error){if(error instanceof SalesOrderSourceError)throw new AppError(error.message);throw error;}
 if(teamId&&!filterBusinessTeamRows(s,[{customer:source.customer}],teamId).length)throw new AppError('销售原单不属于当前所选业务小组，请核对后切换范围。',403);
 const contentFingerprint=await fingerprint(source),requestFingerprint=await fingerprint({token:parsed.data.token,source});
 const requestId='sales_order_source_request_'+parsed.data.token;
 const prior=all(s,'sales_order_source_request').find(record=>record.id===requestId);
 if(prior){
  if(prior.actorId!==m.id||prior.action!==action||prior.fingerprint!==requestFingerprint)throw new AppError('请求标识已用于不同内容或人员。',409);
  return json({...prior.result,idempotent:true});
 }
 const sameOrder=(all(s,'sales_order_source') as SalesOrderSourceRecord[]).filter(record=>key(record.customer)===key(source.customer)&&key(record.orderNo)===key(source.orderNo));
 if(sameOrder.length){
  const before=sameOrder[0];
  if(sameOrder.length!==1||before.source.source.sha256.toLowerCase()!==source.source.sha256.toLowerCase()||before.source.source.sheet!==source.source.sheet||before.contentFingerprint!==contentFingerprint)throw new AppError('此客户订单已有不同来源或内容，请保留原资料并核对版本；本入口不会覆盖。',409);
  const result={ok:true,id:before.id,version:before.version,status:before.status,lineCount:before.source.lines.length,idempotent:true};
  await commit(s.revision,[{id:requestId,kind:'sales_order_source_request',actorId:m.id,action,fingerprint:requestFingerprint,result,createdAt:now()}]);
  return json(result);
 }
 const item:SalesOrderSourceRecord={id:newId('sales_order_source'),kind:'sales_order_source',version:1,status:'待核对',customer:source.customer,orderNo:source.orderNo,source,contentFingerprint,createdAt:now(),createdById:m.id};
 const result={ok:true,id:item.id,version:item.version,status:item.status,lineCount:source.lines.length};
 // One atomic, revision-guarded append. No Order, factory order, report, stock,
 // approval, ERP/MES command or historical business record is written here.
 await commit(s.revision,[item,audit(m,item,null,'导入销售原单资料','保留原文及来源；待核对，未发布生产需求'),{id:requestId,kind:'sales_order_source_request',actorId:m.id,action,fingerprint:requestFingerprint,result,createdAt:now()}]);
 return json(result);
}
