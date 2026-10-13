import {z} from 'zod';
import {all,type CustomerAccount,type Member,type State} from './domain';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility} from './customer-responsibility';
import type {CustomerProject} from './customer-projects';

export const customerProjectAssignmentRosterId='customer_project_assignment_roster';
const memberIds=z.array(z.string().trim().min(1).max(160)).max(300).refine(ids=>new Set(ids).size===ids.length);
const rosterSchema=z.object({
 id:z.literal(customerProjectAssignmentRosterId),kind:z.literal('customer_project_assignment_roster'),
 version:z.number().int().positive(),serviceFollowerIds:memberIds,salesReviewerIds:memberIds,
}).passthrough();
export type ProjectAssignmentRoster={configured:boolean;valid:boolean;serviceFollowerIds:string[];salesReviewerIds:string[]};

/** Roster membership only narrows assignment choices; it never grants customer access. */
export function customerProjectAssignmentRoster(s:State):ProjectAssignmentRoster{
 const rows=all(s,'customer_project_assignment_roster');
 if(!rows.length)return {configured:false,valid:true,serviceFollowerIds:[],salesReviewerIds:[]};
 const parsed=rows.length===1?rosterSchema.safeParse(rows[0]):null;
 if(!parsed?.success)return {configured:true,valid:false,serviceFollowerIds:[],salesReviewerIds:[]};
 return {configured:true,valid:true,serviceFollowerIds:parsed.data.serviceFollowerIds,salesReviewerIds:parsed.data.salesReviewerIds};
}

function projectAssignmentScope(s:State,project:Pick<CustomerProject,'teamId'|'customerId'>){
 const empty={service:[] as string[],sales:[] as string[],all:[] as string[]};
 if(project.teamId){
  const teams=all(s,'customer_project_team').filter(team=>team.id===project.teamId),team=teams[0];
  if(teams.length!==1||team.active!==true||!Array.isArray(team.customerIds)||!team.customerIds.includes(project.customerId))return empty;
  if(![team.serviceMemberIds,team.salesMemberIds,team.leaderIds].every(ids=>Array.isArray(ids)&&ids.every(id=>typeof id==='string')))return empty;
  const service=[...new Set<string>(team.serviceMemberIds)],sales=[...new Set<string>([...team.salesMemberIds,...team.leaderIds])];
  return {service,sales,all:[...new Set([...service,...sales])]};
 }
 // Projects without a team use actual customer responsibilities, never an administrator's broad access.
 const customers=all(s,'customer_account').filter(customer=>customer.id===project.customerId),customer=customers[0] as CustomerAccount|undefined;
 if(customers.length!==1||!customer?.active)return empty;
 const policy=customerQuoteAccessPolicy(s),members=all(s,'member') as Member[];
 const responsible=(side:'sales'|'service')=>members.filter(member=>matchesCustomerResponsibility(customer,member,side,policy&&Object.prototype.hasOwnProperty.call(policy.aliasesByMember,member.id)?policy.aliasesByMember[member.id]:[])).map(member=>member.id);
 const service=responsible('service'),sales=responsible('sales');
 return {service,sales,all:[...new Set([...service,...sales])]};
}

/** The caller supplies members authorized by the current project/customer snapshot. */
export function projectTaskAssignmentCandidates(s:State,project:Pick<CustomerProject,'teamId'|'customerId'>,roster:ProjectAssignmentRoster,writableMemberIds:string[]){
 if(!roster.configured)return {taskOwnerMemberIds:writableMemberIds,taskServiceReviewerMemberIds:writableMemberIds,taskSalesReviewerMemberIds:writableMemberIds};
 if(!roster.valid)return {taskOwnerMemberIds:[],taskServiceReviewerMemberIds:[],taskSalesReviewerMemberIds:[]};
 const writable=new Set(writableMemberIds);
 const scope=projectAssignmentScope(s,project),serviceScope=new Set(scope.service),salesScope=new Set(scope.sales);
 return {taskOwnerMemberIds:roster.serviceFollowerIds.filter(id=>writable.has(id)&&serviceScope.has(id)),taskServiceReviewerMemberIds:scope.all.filter(id=>writable.has(id)),taskSalesReviewerMemberIds:roster.salesReviewerIds.filter(id=>writable.has(id)&&salesScope.has(id))};
}

/** Legacy role assignments may remain, but execution must stay in the current customer's group. */
export function projectTaskParticipantsInScope(s:State,project:Pick<CustomerProject,'teamId'|'customerId'>,memberIds:string[]){
 const roster=customerProjectAssignmentRoster(s);if(!roster.configured)return true;if(!roster.valid)return false;
 const scope=new Set(projectAssignmentScope(s,project).all);
 return memberIds.every(id=>!!id&&scope.has(id));
}
