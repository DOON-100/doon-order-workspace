import assert from 'node:assert/strict';
import {auditProjectRelations} from '../scripts/data-tools/audit-customer-project-relations.mjs';
const records=[
 {id:'c',kind:'customer_account'},
 {id:'p',kind:'customer_project',customerId:'c'},
 {id:'q',kind:'customer_project',customerId:'c'},
 {id:'trash',kind:'customer_project',customerId:'c',trashedAt:'2026-01-01'},
 {id:'f1',kind:'customer_project_followup',customerId:'c',projectId:'p'},
 {id:'f2',kind:'customer_project_followup',customerId:'c',projectId:'p'},
 {id:'pending',kind:'customer_project_followup',customerId:'',projectId:''},
 {id:'hidden',kind:'customer_project_followup',customerId:'c',projectId:'trash'},
 {id:'charge1',kind:'project_charge',customerId:'c',projectId:'p'},
 {id:'charge2',kind:'project_charge',customerId:'c',projectId:'q'},
 {id:'credit',kind:'project_credit_application',customerId:'c',projectId:'q',sourceChargeId:'charge1',targetChargeId:'charge2'},
];
const before=JSON.stringify(records),valid=auditProjectRelations(records);
assert.equal(JSON.stringify(records),before);
assert.equal(valid.issues.length,0);
assert.equal(valid.summary.visibleProjects,2);
assert.equal(valid.summary.visibleFollowups,3);
assert.equal(valid.summary.linkedFollowups,2);
assert.equal(valid.summary.projectsWithFollowups,1);
assert.equal(valid.summary.unlinkedFollowups,1);
const broken=auditProjectRelations([...records,
 {id:'orphan',kind:'customer_project_task',customerId:'c',projectId:'missing'},
 {id:'r1',kind:'customer_project_round',projectId:'p',customerId:'c',parentRoundId:'r2'},
 {id:'r2',kind:'customer_project_round',projectId:'p',customerId:'c',parentRoundId:'r1'},
 {id:'promoted',kind:'customer_project_followup',projectId:'q',promotedProjectId:'q',customerId:'c'},
 {id:'wrong-item',kind:'customer_project_item',projectId:'p',customerId:'other'},
]);
for(const code of ['missing_reference','round_cycle','missing_project_backlink','project_customer_mismatch'])assert(broken.issues.some(i=>i.code===code),code);
const transferred=[...records,{id:'original-owner',kind:'member'},{id:'new-owner',kind:'member'},
 {id:'transferred-followup',kind:'customer_project_followup',customerId:'c',projectId:'p',ownerId:'new-owner',sourceOwnerId:'original-owner'},
 {id:'original-mail',kind:'customer_project_followup_mail',ownerId:'original-owner',followupIds:['transferred-followup']}];
assert.equal(auditProjectRelations(transferred).issues.length,0,'transferring responsibility preserves the original mail source');
transferred.at(-1).ownerId='new-owner';
assert(auditProjectRelations(transferred).issues.some(i=>i.code==='mail_owner_mismatch'),'a mismatched original source is still detected');
console.log('PASS read-only project integrity audit distinguishes legitimate many-to-one links and pending attribution from broken references, cycles and mismatched customers');
