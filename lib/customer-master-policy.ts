import {all,clean,type CustomerAccount,type Member,type State} from './domain';
import {AppError} from './store';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility,type CustomerResponsibilityInput,type CustomerResponsibilityLists} from './customer-responsibility';

// User confirmation, 2026-10-13: sales/service maintain only their already
// assigned customers. Creating a customer cannot grant unrelated accounts access.
export const customerMasterPolicyVersion='2026-10-13-confirmed-own-customer-master-v1';
const scoped=(m:Member)=>m.active&&['sales','clerk'].includes(m.role);
const key=(v:unknown)=>clean(v).toLowerCase();
export function ownsCustomerMaster(s:State,m:Member,c:CustomerAccount){
 if(!scoped(m)||!c.active)return false;
 const aliases=customerQuoteAccessPolicy(s)?.aliasesByMember[m.id]||[];
 return matchesCustomerResponsibility(c,m,'sales',aliases)||matchesCustomerResponsibility(c,m,'service',aliases);
}
export function customerMasterCapabilities(s:State,m:Member,c?:CustomerAccount){
 const admin=m.active&&m.role==='admin',own=!!c&&ownsCustomerMaster(s,m,c);
 return {create:admin||scoped(m),master:admin||own,directory:m.active&&['admin','pmc'].includes(m.role),responsibility:admin||own,quoteMembers:admin,activation:admin};
}
type Input=Pick<CustomerAccount,'salesName'|'serviceName'|'pmcName'>&CustomerResponsibilityInput&{active?:boolean;expectedVersion?:number;directory?:CustomerAccount['directory']};
export function scopedMasterResponsibilities(s:State,m:Member,before:CustomerAccount|undefined,input:Input):CustomerResponsibilityLists|null{
 if(m.role==='admin'||m.role==='pmc')return null;
 if(!scoped(m)||before&&!ownsCustomerMaster(s,m,before))throw new AppError('仅可维护自己已经负责的客户；不能领取或修改其他客户。',403);
 if(before&&(input.expectedVersion===undefined||input.expectedVersion!==before.version))throw new AppError('请提供客户当前版本；资料或责任已有更新时须重新核对。',409);
 if(before&&input.active!==undefined&&input.active!==before.active||!before&&input.active===false)throw new AppError('客户启停须由管理员确认。',403);
 const protectedDirectory=['grade','gradeStatus','qualityGrade','productDifficulty','focus'] as const;
 if(protectedDirectory.some(k=>input.directory?.[k]!==undefined&&JSON.stringify(input.directory[k])!==JSON.stringify(before?.directory?.[k])))throw new AppError('客户等级、品质等级、产品难度及重点标记仍由管理员维护。',403);
 if(Object.prototype.hasOwnProperty.call(input,'quoteMemberIds')&&JSON.stringify(input.quoteMemberIds)!==JSON.stringify(before?.quoteMemberIds))throw new AppError('报价专属授权成员须由管理员确认。',403);
 const members=all(s,'member') as Member[],active=members.filter(v=>v.active);
 const resolve=(name:string,side:'sales'|'service'|'pmc')=>{
  if(!clean(name))return '';
  const allowed=side==='sales'?['sales']:side==='service'?['sales','clerk','pmc']:['pmc'];
  const found=active.filter(v=>allowed.includes(v.role)&&key(v.name)===key(name));
  if(found.length!==1)throw new AppError('新增责任人须对应唯一在职业务、客服或 PMC 账号，请由管理员核实名单。',409);
  return found[0].id;
 };
 if(!before){
  const salesId=resolve(input.salesName,'sales'),serviceId=resolve(input.serviceName,'service');
  if(input.pmcName||(!salesId&&!serviceId)||[salesId,serviceId].some(id=>id&&id!==m.id)||(['salesMemberIds','serviceMemberIds'] as const).some(k=>input[k]===null||input[k]?.some(id=>id!==m.id)))throw new AppError('新建客户只能由本人负责，不能同时授予其他成员客户权限。',403);
  return {salesMemberIds:salesId?[m.id]:[],serviceMemberIds:serviceId?[m.id]:[]};
 }
 if(key(input.pmcName)!==key(before.pmcName)&&input.pmcName)resolve(input.pmcName,'pmc');
 const result:CustomerResponsibilityLists={};
 for(const side of ['sales','service'] as const){
  const listKey=side==='sales'?'salesMemberIds':'serviceMemberIds',nameKey=side==='sales'?'salesName':'serviceName';
  const existing=Array.isArray(before[listKey])?before[listKey]!:members.filter(v=>matchesCustomerResponsibility(before,v,side,customerQuoteAccessPolicy(s)?.aliasesByMember[v.id]||[])).map(v=>v.id);
  const supplied=input[listKey];
  if(supplied===null)throw new AppError('责任维护保留现有协作成员，不能取消明确名单；主负责人移交请使用本人接收流程。',403);
  const added=supplied||[];
  if(added.some(id=>!existing.includes(id)&&!active.some(v=>v.id===id&&(side==='sales'?v.role==='sales':['sales','clerk','pmc'].includes(v.role)))))throw new AppError('新增协作成员须为对应岗位的在职账号。',403);
  const named=key(input[nameKey])!==key(before[nameKey])?resolve(input[nameKey],side):'';
  result[listKey]=[...new Set([...existing,...added,...(named?[named]:[])])];
 }
 if(Object.prototype.hasOwnProperty.call(before,'quoteMemberIds'))result.quoteMemberIds=before.quoteMemberIds;
 return result;
}
