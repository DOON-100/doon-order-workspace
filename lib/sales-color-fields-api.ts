import {z} from 'zod';
import {all,broad,canRead,clean,newId,now,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {businessTeamHeader,filterBusinessTeamRows} from './business-team-scope';
import {requestedExportBusinessTeam} from './business-team-export';
import {parseSalesColorCatalog,SalesColorCatalogError,type SalesColorCatalog,type SalesColorProfile} from './sales-color-fields';

export type SalesColorCatalogRecord=Entity&{kind:'sales_color_field_catalog';version:number;previousId:string;catalog:SalesColorCatalog;createdAt:string;createdById:string};
const saveSchema=z.object({version:z.number().int().nonnegative(),token:z.string().uuid(),catalog:z.unknown()}).strict();
function internal(m:Member){if(!m.active||m.role==='supplier')throw new AppError('仅在职内部成员可读取颜色字段库。',403);}
function latest(s:State):SalesColorCatalogRecord|null{
 const rows=(all(s,'sales_color_field_catalog') as SalesColorCatalogRecord[]).sort((a,b)=>b.version-a.version);
 if(rows.length>1&&rows[0].version===rows[1].version)throw new AppError('字段库版本存在冲突，请由管理员核对。',409);
 return rows[0]||null;
}
const customerKey=(value:string)=>clean(value).toLocaleLowerCase();
function profileReadable(s:State,m:Member,profile:SalesColorProfile){
 if(broad(m))return true;
 const target=customerKey(profile.customer);
 const allAccounts=all(s,'customer_account') as CustomerAccount[];
 if(allAccounts.filter(account=>[account.customer,account.customerCode].some(value=>customerKey(value)===target)).length>1)return false;
 const accounts=allAccounts.filter(account=>serviceOrderCustomerKeys(s,account).some(key=>customerKey(key)===target));
 // Ambiguous customer identities must not widen responsibility-based access.
 if(accounts.length>1)return false;
 const account=accounts[0];
 if(account&&assignedServiceCustomer(s,m,account))return true;
 const keys=new Set([target,...(account?serviceOrderCustomerKeys(s,account).map(customerKey):[])]);
 if(m.customers.some(value=>keys.has(customerKey(value))))return true;
 return (all(s,'order') as Order[]).some(order=>keys.has(customerKey(order.customer))&&canRead(m,order));
}
export async function salesColorFieldsGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='sales-color-fields-data')return null;internal(m);
 const teamId=requestedExportBusinessTeam(s,m,req),current=latest(s);
 // Filter wrappers without a profile id, which must never be resolved as a
 // coincidentally same-named business record by the shared team association.
 const permitted=current?.catalog.profiles.filter(profile=>profileReadable(s,m,profile))||[];
 const profiles=filterBusinessTeamRows(s,permitted.map(profile=>({customer:profile.customer,profile})),teamId).map(row=>row.profile);
 const catalog=current?{...current.catalog,profiles}:null;
 const response=json({catalog,version:current?.version||0,canConfigure:m.role==='admin'});response.headers.set('Vary',businessTeamHeader);return response;
}
async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function salesColorFieldsPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='sales-color-fields-save')return null;internal(m);
 if(m.role!=='admin')throw new AppError('仅管理员可维护颜色字段库及客户对应规则。',403);
 const raw=await req.text();if(raw.length>2000000)throw new AppError('字段库配置超过大小上限。');
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new AppError('字段库请求不是有效JSON。');}
 const parsed=saveSchema.safeParse(value);if(!parsed.success)throw new AppError('请提供有效版本、请求标识和字段库配置，不能包含额外参数。');
 const input=parsed.data;let catalog:SalesColorCatalog;
 try{catalog=parseSalesColorCatalog(input.catalog);}catch(error){if(error instanceof SalesColorCatalogError)throw new AppError(error.message);throw error;}
 const fp=await fingerprint({version:input.version,token:input.token,catalog});
 const requestId='sales_color_field_request_'+input.token,prior=all(s,'sales_color_field_request').find(row=>row.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.action!==action||prior.fingerprint!==fp)throw new AppError('请求标识已用于不同内容或人员。',409);return json({...prior.result,idempotent:true});}
 const before=latest(s);if((before?.version||0)!==input.version)throw new AppError('字段库已更新，请读取最新版本后重新保存。',409);
 const nextIds=new Set(catalog.fields.map(field=>field.id));
 if(before?.catalog.fields.some(field=>!nextIds.has(field.id)))throw new AppError('已有标准字段ID必须保留；不能通过全量保存静默删除历史字段。');
 for(const profile of before?.catalog.profiles||[]){
  const next=catalog.profiles.find(value=>value.id===profile.id);
  if(!next||profile.slots.some(slot=>!next.slots.some(value=>value.id===slot.id)))throw new AppError('已有客户规则及来源栏目ID必须保留；请上传完整配置，不能保存经过客户或业务组筛选的局部目录。');
 }
 const item:SalesColorCatalogRecord={id:newId('sales_color_field_catalog'),kind:'sales_color_field_catalog',version:input.version+1,previousId:before?.id||'',catalog,createdAt:now(),createdById:m.id};
 const result={ok:true,id:item.id,version:item.version};
 await commit(s.revision,[item,audit(m,item,before,'保存颜色字段库','独立字段配置；不修改历史订单或业务值'),{id:requestId,kind:'sales_color_field_request',actorId:m.id,action,fingerprint:fp,result,createdAt:now()}]);
 return json(result);
}
