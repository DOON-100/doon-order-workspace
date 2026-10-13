import {all,type CustomerAccount,type Member,type State} from './domain';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {customerProjectAssignmentRoster} from './customer-project-assignment';
import {assignedServiceCustomer,type ServiceRecord} from './service-workspace';
import {AppError} from './store';

export type ServiceAssignment=Pick<ServiceRecord,'teamId'|'ownerId'|'serviceReviewerId'|'salesReviewerId'>;
export type ServiceAssignmentOptions={customerId:string;teamId:string;ownerIds:string[];serviceReviewerIds:string[];salesReviewerIds:string[]};
const assignmentKeys=['teamId','ownerId','serviceReviewerId','salesReviewerId'] as const;
const writableRoles=new Set(['admin','sales','clerk','pmc']);
const stringIds=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(id=>typeof id==='string');

function assignmentTeam(s:State,customerId:string,teamId:string){
 const teams=all(s,'customer_project_team').filter(team=>team.id===teamId),team=teams[0];
 return teams.length===1&&team.active===true&&stringIds(team.customerIds)&&team.customerIds.includes(customerId)
  &&stringIds(team.serviceMemberIds)&&stringIds(team.salesMemberIds)&&stringIds(team.leaderIds)?team:null;
}

/** Team and roster membership narrow existing customer authority; neither grants access. */
export function serviceAssignmentOptions(s:State,customerId:string,teamId=''):ServiceAssignmentOptions{
 const empty={customerId,teamId,ownerIds:[],serviceReviewerIds:[],salesReviewerIds:[]};
 const accounts=all(s,'customer_account').filter(account=>account.id===customerId),account=accounts[0] as CustomerAccount|undefined;
 if(accounts.length!==1||!account?.active)return empty;
 const members=(all(s,'member') as Member[]).filter(member=>member.active&&writableRoles.has(member.role)&&assignedServiceCustomer(s,member,account));
 let serviceIds:string[],salesIds:string[];
 if(teamId){
  const team=assignmentTeam(s,customerId,teamId);if(!team)return empty;
  serviceIds=team.serviceMemberIds;salesIds=[...team.salesMemberIds,...team.leaderIds];
 }else{
  const policy=customerQuoteAccessPolicy(s);
  const responsible=(side:'sales'|'service')=>members.filter(member=>matchesCustomerResponsibility(account,member,side,
   policy&&Object.prototype.hasOwnProperty.call(policy.aliasesByMember,member.id)?policy.aliasesByMember[member.id]:[])).map(member=>member.id);
  serviceIds=responsible('service');salesIds=responsible('sales');
 }
 const allowed=new Set(members.map(member=>member.id)),roster=customerProjectAssignmentRoster(s);
 if(!roster.valid)return empty;
 const permitted=(ids:string[])=>[...new Set(ids)].filter(id=>allowed.has(id));
 return {customerId,teamId,
  ownerIds:permitted(serviceIds).filter(id=>!roster.configured||roster.serviceFollowerIds.includes(id)),
  serviceReviewerIds:permitted([...serviceIds,...salesIds]),
  salesReviewerIds:permitted(salesIds).filter(id=>!roster.configured||roster.salesReviewerIds.includes(id))};
}

/** Old clients omit these keys; unchanged historical assignments do not block unrelated edits. */
export function validateServiceAssignment(s:State,customerId:string,input:ServiceAssignment,before:ServiceRecord|null){
 const merged:ServiceAssignment={};
 for(const key of assignmentKeys)merged[key]=input[key]===undefined?before?.[key]:input[key];
 if(before&&!assignmentKeys.some(key=>(merged[key]||'')!==(before[key]||'')))return;
 if(merged.teamId&&!assignmentTeam(s,customerId,merged.teamId))throw new AppError('请选择包含当前客户的有效业务客服组。');
 const candidates=serviceAssignmentOptions(s,customerId,merged.teamId||'');
 for(const [key,allowed,label] of [
  ['ownerId',candidates.ownerIds,'客服跟进人'],
  ['serviceReviewerId',candidates.serviceReviewerIds,'客服审核人'],
  ['salesReviewerId',candidates.salesReviewerIds,'业务审核人'],
 ] as const){
  const id=merged[key];if(id&&!allowed.includes(id))throw new AppError(`${label}须为当前客户已授权、有效且符合所选小组分工的成员。`);
 }
 if(merged.ownerId&&[merged.serviceReviewerId,merged.salesReviewerId].includes(merged.ownerId))throw new AppError('客服跟进人不能同时担任该记录的审核人；两类审核人可以为同一人。');
}

export function serviceAssignmentData(s:State,customers:CustomerAccount[],records:ServiceRecord[]){
 const customerIds=new Set(customers.map(customer=>customer.id));
 const teams=all(s,'customer_project_team').filter(team=>stringIds(team.customerIds)&&team.customerIds.some(id=>customerIds.has(id)))
  .map(team=>({id:team.id,name:String(team.name||''),active:team.active===true,customerIds:(team.customerIds as string[]).filter(id=>customerIds.has(id))}));
 const assignmentOptions=customers.flatMap(customer=>['',...teams.filter(team=>team.active&&team.customerIds.includes(customer.id)).map(team=>team.id)]
  .map(teamId=>serviceAssignmentOptions(s,customer.id,teamId)));
 const memberIds=new Set(assignmentOptions.flatMap(options=>[...options.ownerIds,...options.serviceReviewerIds,...options.salesReviewerIds]));
 for(const record of records)for(const key of ['ownerId','serviceReviewerId','salesReviewerId'] as const)if(record[key])memberIds.add(record[key]!);
 const members=(all(s,'member') as Member[]).filter(member=>memberIds.has(member.id)).map(member=>({id:member.id,name:member.name}));
 return {teams,members,assignmentOptions};
}
