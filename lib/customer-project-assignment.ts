import {z} from 'zod';
import {all,type State} from './domain';

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

/** The caller supplies members authorized by the current project/customer snapshot. */
export function projectTaskAssignmentCandidates(roster:ProjectAssignmentRoster,writableMemberIds:string[]){
 const writable=new Set(writableMemberIds);
 const service=roster.configured?roster.serviceFollowerIds.filter(id=>writable.has(id)):writableMemberIds;
 const sales=roster.configured?roster.salesReviewerIds.filter(id=>writable.has(id)):writableMemberIds;
 return {taskOwnerMemberIds:service,taskServiceReviewerMemberIds:service,taskSalesReviewerMemberIds:sales};
}
