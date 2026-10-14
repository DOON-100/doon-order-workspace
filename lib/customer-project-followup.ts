import {all,type Entity,type Member,type State} from './domain';
import {isProjectTrashed,projectAccess} from './customer-projects';

export const followupCategories=['shipping','order','exhibition','engineering','other'] as const;
export const followupStatuses=['pending','in_progress','waiting_customer','waiting_internal','completed'] as const;
export type CustomerProjectFollowup=Entity&{kind:'customer_project_followup';version:number;ownerId:string;customerId:string;projectId:string;title:string;category:typeof followupCategories[number];stars:number;status:typeof followupStatuses[number];followUpDate:string;notes:string;nextAction:string;checklist:{id:string;text:string;checked:boolean}[];sourceKey:string;sourceId:string;source:unknown};
export function followupAccess(s:State,m:Member,row:Entity,write=false):boolean{
 if(!m.active)return false;
 if(row.projectId){
  const project=all(s,'customer_project').find(p=>p.id===row.projectId);
  // The linked project is authoritative: a stale customer ID must not expose a
  // different customer's project or leave an orphan followup in the daily feed.
  if(!project||project.customerId!==row.customerId)return false;
  if(write&&(isProjectTrashed(project)||project.status==='archived'))return false;
 }
 if(row.customerId){const a=projectAccess(s,m,row.customerId);return write?a.write:a.read;}
 return ['admin','sales','clerk','pmc'].includes(m.role)&&(m.role==='admin'||row.ownerId===m.id);
}
/** One authorized, live followup set supplies both the project and followup pages. */
export function getVisibleProjectFollowups(s:State,m:Member):Entity[]{
 const recycled=new Set(all(s,'customer_project').filter(isProjectTrashed).map(p=>p.id));
 return all(s,'customer_project_followup').filter(row=>!recycled.has(row.projectId)&&followupAccess(s,m,row));
}
/** Projects and followups are different grains; show the relationship explicitly. */
export function customerProjectFollowupSummary(followups:Entity[],projects:Entity[]){
 const projectIds=new Set(projects.map(project=>project.id));
 const linked=followups.filter(row=>projectIds.has(row.projectId));
 const linkedIds=new Set(linked.map(row=>row.projectId));
 return {visibleProjects:projects.length,linkedFollowups:linked.length,linkedProjects:linkedIds.size,unlinkedFollowups:followups.filter(row=>!row.projectId).length,unassignedCustomers:followups.filter(row=>!row.customerId).length,projectsWithoutFollowups:projects.filter(project=>!linkedIds.has(project.id)).length};
}
export function followupMailAccess(s:State,m:Member,row:Entity,write=false):boolean{
 if(!m.active)return false;
 if(write&&m.role!=='admin'&&row.ownerId!==m.id)return false;
 const linked=Array.isArray(row.followupIds)?row.followupIds:[];
 if(!linked.length)return ['admin','sales','clerk','pmc'].includes(m.role)&&(m.role==='admin'||row.ownerId===m.id);
 return linked.every((id:string)=>{const followup=all(s,'customer_project_followup').find(r=>r.id===id);return !!followup&&followupAccess(s,m,followup,write);});
}
