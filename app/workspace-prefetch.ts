import {businessTeamFetch} from './business-team-client';

// Only small, read-only list endpoints. Files, archives, history and privileged
// administration are deliberately loaded only when their page asks for them.
const pageReads:Record<string,string[]>={
 'customer-projects':['customer-project-data'],
 'customer-quotes':['customer-quotes'],
 'engineering-drawings':['drawing-data'],
 'engineering-sop':['sop-data'],
 'communications':['unified-communication-data'],
 'service':['service-data'],
 'payment-terms':['payment-terms-data'],
 'business-rules':['framework-knowledge'],
 'workbench':['customer-project-data','customer-project-followup-data','unified-communication-data','handoff-business-data','customer-workflow-transfers','handoff-business-review-data','framework-notices','customer-workflow-data','framework-finance-tasks'],
};

export function prefetchWorkspacePages(views:string[],current:string,signal:AbortSignal){
 const currentReads=new Set(pageReads[current]||[]);
 const actions=[...new Set(views.flatMap(view=>pageReads[view]||[]))].filter(action=>!currentReads.has(action));
 void (async()=>{
  for(const action of actions){
   if(signal.aborted)return;
   try{await businessTeamFetch('/api/workspace/'+action,{signal,cache:'no-store'},{background:true});}
   catch{if(signal.aborted)return;/* A failed optional preload never interrupts the page. */}
  }
 })();
}
