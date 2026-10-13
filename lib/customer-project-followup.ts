import {all,type Entity,type Member,type State} from './domain';
import {projectAccess} from './customer-projects';

export const followupCategories=['shipping','order','exhibition','engineering','other'] as const;
export const followupStatuses=['pending','in_progress','waiting_customer','waiting_internal','completed'] as const;
export type CustomerProjectFollowup=Entity&{kind:'customer_project_followup';version:number;ownerId:string;customerId:string;projectId:string;title:string;category:typeof followupCategories[number];stars:number;status:typeof followupStatuses[number];followUpDate:string;notes:string;nextAction:string;checklist:{id:string;text:string;checked:boolean}[];sourceKey:string;sourceId:string;source:unknown};
export function followupAccess(s:State,m:Member,row:Entity,write=false):boolean{
 if(!m.active)return false;
 if(row.customerId){const a=projectAccess(s,m,row.customerId);return !!a.customer?.active&&(write?a.write:a.read);}
 return ['admin','sales','clerk','pmc'].includes(m.role)&&(m.role==='admin'||row.ownerId===m.id);
}
export function followupMailAccess(s:State,m:Member,row:Entity,write=false):boolean{
 if(!m.active)return false;
 if(write&&m.role!=='admin'&&row.ownerId!==m.id)return false;
 const linked=Array.isArray(row.followupIds)?row.followupIds:[];
 if(!linked.length)return ['admin','sales','clerk','pmc'].includes(m.role)&&(m.role==='admin'||row.ownerId===m.id);
 return linked.every((id:string)=>{const followup=all(s,'customer_project_followup').find(r=>r.id===id);return !!followup&&followupAccess(s,m,followup,write);});
}
