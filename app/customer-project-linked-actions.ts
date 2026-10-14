import type {CPRow} from './customer-project-ui';

export const customerProjectActionSources:Record<string,string>={project:'项目行动',collaboration:'跨部门待办',followup:'客户跟进'};
export const customerProjectActionStatuses:Record<string,string>={open:'待跟进',pending:'待跟进',in_progress:'进行中',blocked:'受阻',waiting_customer:'等客户',waiting_internal:'等内部',service_review:'待客服审核',sales_review:'待业务审核',returned:'已退回 · 待补充',done:'已完成',completed:'已完成',cancelled:'已取消'};

// These are independent work records linked to a project, not copies of its lifecycle.
export function customerProjectPendingActions({tasks=[],collaborationTasks=[],followups=[]}:{tasks?:CPRow[];collaborationTasks?:CPRow[];followups?:CPRow[]}):CPRow[]{
 const actions:CPRow[]=[
  ...tasks.map(row=>({...row,source:'project'})),
  ...collaborationTasks.map(row=>({...row,source:'collaboration'})),
  ...followups.filter(row=>row.projectId).map(row=>({...row,source:'followup',title:row.nextAction||row.title,dueDate:row.followUpDate||'',waitingFor:row.status==='waiting_customer'?'customer':row.status==='waiting_internal'?'self':'none'})),
 ];
 return actions.filter(row=>!['done','completed','cancelled'].includes(row.status));
}
