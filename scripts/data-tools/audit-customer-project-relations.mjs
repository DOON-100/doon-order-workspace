// Read-only customer project integrity scan. Reports belong in ignored test-output.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export function auditProjectRelations(records) {
 const byId=new Map(records.map(r=>[r.id,r]));
 const get=kind=>records.filter(r=>r.kind===kind);
 const projects=get('customer_project'),followups=get('customer_project_followup');
 const issues=[],warnings=[];
 const issue=(row,field,code,targetId)=>issues.push({id:row.id,kind:row.kind,field,code,targetId});
 const ref=(row,field,targetId,kind,{scope=true,round=false}={})=>{
  if(!targetId)return;
  const target=byId.get(targetId);
  if(!target||kind&&target.kind!==kind){issue(row,field,'missing_reference',targetId);return;}
  if(scope&&row.projectId&&target.projectId&&row.projectId!==target.projectId)issue(row,field,'different_project',targetId);
  if(scope&&row.customerId&&target.customerId&&row.customerId!==target.customerId)issue(row,field,'different_customer',targetId);
  if(round&&row.roundId&&target.roundId&&row.roundId!==target.roundId)issue(row,field,'different_round',targetId);
  return target;
 };
 const fieldKinds={roundId:'customer_project_round',parentRoundId:'customer_project_round',sampleId:'customer_project_sample',drawingId:'customer_project_drawing',previousId:'customer_project_drawing',pairedDrawingId:'customer_project_drawing',quoteLinkId:'customer_project_quote_link',quoteId:'customer_quote',communicationId:'customer_project_communication',itemId:'customer_project_item',chargeId:'project_charge',receiptId:'project_receipt',documentId:'project_document',caseId:'project_after_sale'};
 const listKinds={itemIds:'customer_project_item',attachmentIds:'customer_project_attachment',drawingIds:'customer_project_drawing',requiredSampleIds:'customer_project_sample'};
 const financeKinds=['project_charge','project_receipt','project_receipt_reversal','project_allocation','project_adjustment','project_credit_application','project_payment_requirement','project_payment_notice','project_document','project_document_send','project_refund','project_after_sale','project_finance_entry','project_finance_grant'];
 const entities=records.filter(r=>(r.kind.startsWith('customer_project')&&!r.kind.endsWith('_request'))||r.kind==='customer_workflow_project'&&r.projectId||financeKinds.includes(r.kind));
 for(const row of entities){
  if(row.customerId)ref(row,'customerId',row.customerId,'customer_account',{scope:false});
  if(row.projectId){const p=ref(row,'projectId',row.projectId,'customer_project');if(p&&row.customerId!==p.customerId)issue(row,'projectId','project_customer_mismatch',p.id);}
  for(const [field,kind] of Object.entries(fieldKinds))ref(row,field,row[field],kind,{round:['sampleId','quoteLinkId'].includes(field)});
  for(const [field,kind] of Object.entries(listKinds))for(const id of row[field]||[])ref(row,field,id,kind);
  // Customer-level documents and credit applications may legitimately span projects.
  for(const field of ['sourceChargeId','targetChargeId'])ref({...row,projectId:''},field,row[field],'project_charge');
  for(const id of row.chargeIds||[])ref({...row,projectId:''},'chargeIds',id,'project_charge');
  for(const field of ['scope','lines','orderLinks'])for(const line of row[field]||[]){ref(row,field+'.itemId',line.itemId,'customer_project_item');if(line.orderId)ref(row,field+'.orderId',line.orderId,'order');}
  for(const field of ['ownerId','sourceOwnerId','salesMemberId','serviceMemberId','serviceReviewerId','salesReviewerId'])if(row[field])ref(row,field,row[field],'member',{scope:false});
  for(const field of ['leaderIds','salesMemberIds','serviceMemberIds','serviceFollowerIds','salesReviewerIds'])for(const id of row[field]||[])ref(row,field,id,'member',{scope:false});
  if(row.teamId)ref(row,'teamId',row.teamId,'customer_project_team',{scope:false});
  for(const id of row.customerIds||[])ref(row,'customerIds',id,'customer_account',{scope:false});
  if(row.kind==='customer_project_round'){
   const seen=new Set([row.id]);let parent=row.parentRoundId;
   while(parent){if(seen.has(parent)){issue(row,'parentRoundId','round_cycle',parent);break;}seen.add(parent);parent=byId.get(parent)?.parentRoundId;}
  }
  if(row.kind==='customer_project_followup'){
   if(row.promotedProjectId){const p=ref(row,'promotedProjectId',row.promotedProjectId,'customer_project');if(row.projectId!==row.promotedProjectId)issue(row,'promotedProjectId','promotion_link_mismatch',row.promotedProjectId);if(p&&p.followupId!==row.id)issue(row,'promotedProjectId','missing_project_backlink',p.id);}
   if(!row.projectId)warnings.push({id:row.id,code:'unlinked_followup',title:row.title,customerId:row.customerId,ownerId:row.ownerId});
  }
  if(row.kind==='customer_project'&&row.followupId){const f=ref(row,'followupId',row.followupId,'customer_project_followup');if(f&&f.projectId!==row.id)issue(row,'followupId','followup_project_mismatch',f.id);}
  if(row.kind==='customer_project_followup_mail')for(const id of row.followupIds||[]){const f=ref(row,'followupIds',id,'customer_project_followup',{scope:false});if(f&&(f.sourceOwnerId||f.ownerId)!==(row.sourceOwnerId||row.ownerId))issue(row,'followupIds','mail_owner_mismatch',id);}
  if(row.sourceHash&&createHash('sha256').update(JSON.stringify(row.source)).digest('hex')!==row.sourceHash)issue(row,'sourceHash','original_source_changed',row.sourceId);
 }
 const active=projects.filter(p=>!p.trashedAt),activeIds=new Set(active.map(p=>p.id));
 const visible=followups.filter(f=>!f.projectId||activeIds.has(f.projectId));
 const linkedProjectIds=new Set(visible.map(f=>f.projectId).filter(Boolean));
 return {checkedAt:new Date().toISOString(),readOnly:true,counts:Object.fromEntries([...new Set([...entities.map(r=>r.kind),...financeKinds])].map(kind=>[kind,get(kind).length])),summary:{projects:projects.length,visibleProjects:active.length,trashedProjects:projects.length-active.length,followups:followups.length,visibleFollowups:visible.length,linkedFollowups:visible.filter(f=>f.projectId).length,unlinkedFollowups:visible.filter(f=>!f.projectId).length,projectsWithFollowups:linkedProjectIds.size,projectsWithoutFollowups:active.filter(p=>!linkedProjectIds.has(p.id)).map(p=>({id:p.id,title:p.title,customerId:p.customerId})),unclassifiedMails:get('customer_project_followup_mail').filter(m=>!m.followupIds?.length).length},issues,warnings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const dataDir=path.resolve(process.env.DOON_DATA_DIR||'lan-data');
 const out=path.resolve(process.argv[2]||'test-output/customer-project-relations-audit.json');
 const db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
 let records,report;
 try{db.exec('PRAGMA query_only=ON; BEGIN');records=db.prepare("SELECT data FROM records WHERE kind NOT IN ('audit','customer_project_request','customer_project_followup_request')").all().map(r=>JSON.parse(r.data));report=auditProjectRelations(records);report.revision=db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision;report.sqliteIntegrity=Object.values(db.prepare('PRAGMA quick_check').get())[0];db.exec('ROLLBACK');}finally{db.close();}
 const files=records.filter(r=>['customer_project_attachment','customer_project_followup_source'].includes(r.kind)&&r.fileKey);
 report.files={checked:files.length,valid:0};
 for(const row of files){try{const bytes=await fs.readFile(path.join(dataDir,'files',createHash('sha256').update(row.fileKey).digest('hex')));if(row.size!==bytes.length||row.hash&&row.hash!==createHash('sha256').update(bytes).digest('hex'))report.issues.push({id:row.id,kind:row.kind,code:'attachment_content_mismatch'});else report.files.valid++;}catch(e){if(e.code!=='ENOENT')throw e;report.issues.push({id:row.id,kind:row.kind,code:'attachment_file_missing'});}}
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,reportPath:out},null,2));
}
