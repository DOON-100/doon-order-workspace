export const roles=['admin','pmc','production','clerk','sales','finance','programmer','viewer','supplier'] as const;
export type Role=typeof roles[number];
export const roleLabels:Record<Role,string>={admin:'管理员',pmc:'PMC',production:'生产管理人员',clerk:'文员 / 跟单',sales:'客服 / 销售',finance:'财务人员',programmer:'程序员',viewer:'只读成员',supplier:'供应商填报人'};
export const roleDescriptions:Record<Role,string>={admin:'管理全部订单、部门、账号与权限。',pmc:'兼任采购，维护供应商资料、外发单、回复交期和催交；维护源订单、排期、分工、工序和结单归档。',production:'查看全部订单，维护生产进度、各部门工序及供应商收货；源单、结单和账号权限由 PMC / 管理员处理。',clerk:'按设置查看总表；维护本人跟单与获分配部门的工序。',sales:'按设置查看总表和导出报表；只可维护负责客户或本人订单的回复交期和跟进。',finance:'查询全部订单、在制与归档、供应商收货和凭证，导出报表；不修改生产数据。',programmer:'查看系统运行与备份状态；业务订单需另行分配客户范围，只能查询和导出。',viewer:'只读查询和导出获授权范围内的报表。',supplier:'仅查看公司发布给所属供应商的成品外发任务，填写进度、交期、送货和返工；公司入仓及结单由内部确认。'};
export type Member={id:string;kind:'member';email:string;name:string;role:Role;customers:string[];userId:string;active:boolean;owner?:boolean;departments?:string[];orderScope?:'all'|'assigned';supplierId?:string;createdAt:string};
export type CustomerAccount={id:string;kind:'customer_account';customer:string;customerCode:string;salesName:string;serviceName:string;pmcName:string;salesMemberIds?:string[];serviceMemberIds?:string[];quoteMemberIds?:string[];active:boolean;notes:string;version:number;createdAt:string;updatedAt:string;updatedBy:string};
export const workflowStatuses=['业务待提交','客服待审核','退回业务补充','PMC待接单','PMC已接单','PMC已排期','生产中','待出货','已完成'] as const;
export const fields = [
 ['orderNo','订单号'],['customer','客户'],['customerPO','客户 PO'],['drawing','图纸编号'],['color','色号'],['lens','镜片类型'],['productCode','产品编码'],['productType','产品类型'],['specialRequirements','特殊要求'],['batch','交货批次'],['quantity','订单数量'],['requestedDate','客户要求交期'],['ownerEmail','负责人邮箱'],['stage','计划阶段'],['plannedDate','预计完工日'],['shipDate','预计可出货日'],['promisedDate','回复交期'],['promiseConfirmed','交期已确认'],['customerNote','对客备注'],['arrangement','分批交货安排'],['notes','内部跟进备注'],['sourceStatus','订单来源状态'],
] as const;
export const fieldLabels:Record<string,string>=Object.fromEntries(fields);
export const stages=['待下达','备料中','生产中','表面处理','装配中','包装中','待核验关闭','暂停'];
export type Order={id:string;kind:'order';version:number;createdAt:string;updatedAt:string;updatedBy:string;source:string;orderNo:string;customer:string;customerPO:string;drawing:string;color:string;lens:string;batch:string;quantity:number;requestedDate:string;ownerEmail:string;stage:string;plannedDate:string;shipDate:string;promisedDate:string;promiseConfirmed:boolean;customerNote:string;arrangement:string;notes:string;sourceStatus:string;extra:Record<string,string>;unit?:'付'|'副';businessType?:'finished_full_outsource';workflowStatus?:typeof workflowStatuses[number];salesName?:string;serviceName?:string;pmcName?:string;productCode?:string;productType?:string;specialRequirements?:string;productionStartDate?:string;productionFinishDate?:string;materialStatus?:string;scheduleStatus?:string;exceptionReason?:string;handoffNote?:string;submittedAt?:string;serviceReviewedAt?:string;pmcAcceptedAt?:string;ledger?:Ledger;lifecycle?:'active'|'archived';archivedAt?:string;closedDate?:string;archiveReason?:string};
export type Report={id:string;kind:'report';version:number;lineId:string;orderNo:string;drawing:string;color:string;lens:string;workOrder:string;task:string;process:string;batch:string;startedAt:string;reportedAt:string;quantity:number;approval:string;nativeId:string;identityType:string;source:string;updatedAt:string;updatedBy:string};
export type Entity={id:string;kind:string;[key:string]:any};
export type State={revision:number;records:Entity[]};
export type PreviewRow={index:number;status:'new'|'update'|'conflict'|'skip'|'error';reason:string;before?:any;after?:any;changes?:string[];expectedVersion?:number};
export const all=(s:State,kind:string)=>s.records.filter(r=>r.kind===kind);
export const now=()=>new Date().toISOString();
export const newId=(prefix:string)=>prefix+'_'+crypto.randomUUID();
export const clean=(x:unknown)=>String(x??'').normalize('NFKC').trim();
export const email=(x:unknown)=>clean(x).toLowerCase();
export const businessKey=(x:Partial<Order>)=>[x.orderNo,x.drawing,x.color,x.lens,x.batch].map(v=>clean(v).toUpperCase()).join('\u001f');
export const broad=(m:Member)=>m.role==='admin'||m.role==='pmc';
export const managesProduction=(m:Member)=>broad(m)||m.role==='production';
export const readsAllOrders=(m:Member)=>m.role!=='supplier'&&(managesProduction(m)||m.role==='finance'||m.orderScope==='all');
// New and standard orders use productType; historical ledger orders retain the source value in column W.
export const productTypeOf=(o:Order)=>clean(o.productType||o.ledger?.columns?.W||o.extra?.['W · 产品类型']||o.extra?.['产品类型']);
export const assignedOrder=(m:Member,o:Order)=>o.ownerEmail===m.email||m.customers.includes(o.customer);
export function canRead(m:Member,o:Order){return m.role!=='supplier'&&(readsAllOrders(m)||assignedOrder(m,o)||(m.orderScope===undefined&&m.role==='clerk'&&!!o.ledger&&!!m.departments?.length));}
export function allowedFields(m:Member,o:Order):string[]{
 if(o.lifecycle==='archived')return [];
 if(!canRead(m,o)||m.role==='viewer'||m.role==='finance'||m.role==='programmer')return [];
 if(broad(m))return ['ownerEmail','stage','plannedDate','shipDate','notes','promisedDate','promiseConfirmed','customerNote','arrangement'];
 if(m.role==='production')return ['stage','plannedDate','shipDate','notes'];
 if(m.role==='sales')return assignedOrder(m,o)?['productCode','productType','specialRequirements','notes','promisedDate','promiseConfirmed','customerNote','arrangement']:[];
 return o.ownerEmail===m.email?['notes','plannedDate','shipDate','customerNote','arrangement']:[];
}
export const validApproval=(r:Report)=>['已审批','审批完成'].includes(r.approval);
export function packed(o:Order,reports:Report[]){return reports.filter(r=>r.lineId===o.id&&validApproval(r)).reduce((n,r)=>n+r.quantity,0);}
export function progress(o:Order,reports:Report[]){const qty=packed(o,reports);return qty>o.quantity?'超量待核对':qty===o.quantity&&qty>0?'包装足量 · 待验收':qty>0?'部分包装完成':o.stage;}
export function strictDate(value:unknown,withTime=false){
 const raw=clean(value);if(!raw)return '';
 const m=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?(?:\.\d+)?(?:Z|\+08:00)?$/);
 if(!m)throw new Error('日期格式应为 YYYY-MM-DD'+(withTime?' HH:mm:ss':''));
 const [y,mo,d]=[+m[1],+m[2],+m[3]];const test=new Date(Date.UTC(y,mo-1,d));
 if(y<2000||y>2100||test.getUTCMonth()!==mo-1||test.getUTCDate()!==d||+(m[4]||0)>23||+(m[5]||0)>59||+(m[6]||0)>59)throw new Error('日期不存在或超出有效范围');
 const day=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 if(withTime&&!m[4])throw new Error('报工时间必须包含时分秒');
 return withTime?`${day} ${m[4].padStart(2,'0')}:${m[5].padStart(2,'0')}:${(m[6]||'0').padStart(2,'0')}`:day;
}
export function normalizeField(key:string,value:unknown):any{
 if(key==='quantity'){const n=Number(clean(value).replace(/,/g,''));if(!Number.isSafeInteger(n)||n<0||n>10000000)throw new Error('数量必须为 0 至 10000000 的整数');return n;}
 if(['requestedDate','plannedDate','shipDate','promisedDate'].includes(key))return strictDate(value);
 if(key==='promiseConfirmed'){if(value===true||['是','已确认','true','1'].includes(clean(value)))return true;if(value===false||['否','未确认','false','0',''].includes(clean(value)))return false;throw new Error('交期确认只能为是或否');}
 if(key==='ownerEmail')return email(value);
 const text=clean(value);if(text.length>3000)throw new Error('单个字段不能超过 3000 字');
 if(key==='stage'&&text&&!stages.includes(text))throw new Error('计划阶段不在支持列表中');
 if(key==='sourceStatus'&&text&&!['待正式订单确认','正式订单','已取消'].includes(text))throw new Error('订单来源状态不在支持列表中');
 return text;
}
export function mergeFields(current:Order,base:Order,patch:Record<string,any>){
 const next={...current},conflicts:string[]=[];
 for(const [key,val] of Object.entries(patch)){if(JSON.stringify(val)===JSON.stringify((base as any)[key]))continue;if(JSON.stringify((current as any)[key])!==JSON.stringify((base as any)[key])&&JSON.stringify((current as any)[key])!==JSON.stringify(val))conflicts.push(key);else (next as any)[key]=val;}
 if(patch.promisedDate!==undefined&&patch.promisedDate!==base.promisedDate)next.promiseConfirmed=patch.promiseConfirmed===true;
 return {next,conflicts};
}
export const customerFields=['orderNo','customer','customerPO','drawing','color','lens','batch','quantity','requestedDate','promisedDate','arrangement','customerNote'];

export type Ledger={columns:Record<string,string>;sourceRow:number;sheet:string;filename:string;sourceHash:string;issues:string[];ownerName:string;originalOutstanding:string};
