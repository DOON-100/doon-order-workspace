import {loadProjectPermissionFunctions} from './project-policy-loader.mjs';

const taskKinds=new Set(['customer_workflow_task','customer_project_task','customer_project_collaboration_task']);
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{status});};
const sorted=rows=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));

/** Read-only, minimized projections; caller resolves actorId from its trusted session. */
export async function createProjectReadPolicy(state) {
  if(!state||!Array.isArray(state.records)||!Number.isInteger(state.revision))fail('P1_PROJECT_STATE_INVALID');
  const loaded=await loadProjectPermissionFunctions(),p=loaded.functions;
  function rows(kind){return state.records.filter(row=>row?.kind===kind);}
  function unique(kind,id){const matches=rows(kind).filter(row=>row.id===id);return matches.length===1?matches[0]:undefined;}
  function member(actorId){
    if(typeof actorId!=='string'||!actorId)fail('P1_PROJECT_SESSION_REQUIRED',401);
    const actor=unique('member',actorId);
    if(!actor)fail('P1_PROJECT_SESSION_REQUIRED',401);
    if(actor.active!==true||actor.role==='supplier'||!p.roles.includes(actor.role))fail('P1_PROJECT_ACTOR_FORBIDDEN',403);
    if(!Array.isArray(actor.customers)||actor.customers.some(value=>typeof value!=='string'))fail('P1_PROJECT_ACTOR_FORBIDDEN',403);
    return actor;
  }
  function readableCustomers(actor){return rows('customer_account').filter(customer=>unique('customer_account',customer.id)===customer&&p.assignedServiceCustomer(state,actor,customer));}
  function customerDto(actor,customer){return {
    id:customer.id,customer:customer.customer,customerCode:customer.customerCode,active:customer.active===true,
    version:customer.version,capabilities:{...p.customerMasterCapabilities(state,actor,customer)},
  };}
  function teams(actor){
    const readableIds=new Set(readableCustomers(actor).map(customer=>customer.id));
    return sorted(p.businessTeamData(state,actor).teams.filter(team=>unique('customer_project_team',team.id)).map(team=>({
      id:team.id,name:team.name,active:team.active,customerIds:team.customerIds.filter(id=>readableIds.has(id)),
    })).filter(team=>team.customerIds.length));
  }
  function options(actor,value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['teamId','limit'].includes(key)))fail('P1_PROJECT_QUERY_INVALID');
    const {teamId='',limit=20}=value;
    if(typeof teamId!=='string'||teamId.length>160||!Number.isInteger(limit)||limit<1||limit>50)fail('P1_PROJECT_QUERY_INVALID');
    if(teamId&&teamId!=='__ungrouped'&&!teams(actor).some(team=>team.id===teamId))fail('P1_PROJECT_TEAM_FORBIDDEN',403);
    return {teamId,limit};
  }
  function taskAccess(actor,task){
    if(!taskKinds.has(task.kind)||state.records.filter(row=>row.id===task.id).length!==1)return null;
    if(task.kind==='customer_workflow_task'){
      if(task.customerId&&!unique('customer_account',task.customerId))return null;
      return p.customerTaskCanEdit(state,actor,task)?{canEdit:true}:null;
    }
    const project=unique('customer_project',task.projectId);
    if(!project||!unique('customer_account',project.customerId)||task.customerId!==project.customerId)return null;
    if(task.kind==='customer_project_task')return p.canReadProject(state,actor,task)?{
      ...p.projectTaskPermissions(state,actor,project,task),canOpenProject:!project.trashedAt&&p.projectAccess(state,actor,project.customerId).read,
    }:null;
    return p.canReadProjectCollaboration(state,actor,task)?{...p.projectCollaborationPermissions(state,actor,task)}:null;
  }
  function taskDto(actor,task,capabilities){
    const customer=unique('customer_account',task.customerId);
    const mayOpenCustomer=!!customer&&p.assignedServiceCustomer(state,actor,customer);
    const project=task.projectId?unique('customer_project',task.projectId):undefined;
    return {id:task.id,kind:task.kind,version:task.version,title:task.title,status:task.status,dueDate:task.dueDate||task.due||'',
      customerId:mayOpenCustomer?task.customerId:'',projectId:mayOpenCustomer&&project?project.id:'',teamId:mayOpenCustomer&&project?project.teamId||'':'',
      ownedByMe:task.ownerId===actor.id,capabilities};
  }
  return Object.freeze({
    policyInputs:loaded.inputs,policyProvenance:Object.freeze({...loaded.provenance,
      differences:Object.freeze(['Every entry requires an active internal actor; domain.canRead alone does not check active.',
        'Team directory is further intersected with CRM-readable customers; order, quotation or drawing access alone does not expose a customer here.',
        'Task-only assignees receive no customer/project/team identifiers, descriptions, results or history. Capability flags are informational; no business write API is exposed.'])}),
    listCustomers(actorId,value={}){
      const actor=member(actorId),{teamId,limit}=options(actor,value);
      const visible=sorted(p.filterBusinessTeamRows(state,readableCustomers(actor),teamId));
      return {items:visible.slice(0,limit).map(customer=>customerDto(actor,customer)),total:visible.length};
    },
    getCustomer(actorId,id){
      const actor=member(actorId),customer=unique('customer_account',id);
      if(!customer||!p.assignedServiceCustomer(state,actor,customer))fail('P1_PROJECT_CUSTOMER_NOT_FOUND',404);
      return customerDto(actor,customer);
    },
    listTeams(actorId){return {items:teams(member(actorId))};},
    listTasks(actorId,value={}){
      const actor=member(actorId),{teamId,limit}=options(actor,value),permissions=new Map();
      const authorized=state.records.filter(task=>{const result=taskAccess(actor,task);if(result)permissions.set(task.id,result);return !!result;});
      const visible=sorted(p.filterBusinessTeamRows(state,authorized,teamId));
      return {items:visible.slice(0,limit).map(task=>taskDto(actor,task,permissions.get(task.id))),total:visible.length};
    },
    getTask(actorId,id){
      const actor=member(actorId),found=state.records.filter(row=>row.id===id),task=found.length===1?found[0]:undefined;
      const permissions=task&&taskAccess(actor,task);
      if(!permissions)fail('P1_PROJECT_TASK_NOT_FOUND',404);
      return taskDto(actor,task,permissions);
    },
  });
}
