// Synthetic members, route metadata and server-rendered navigation; no production data or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const output=path.resolve('test-output','department-workspace-navigation-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'navigation.mjs');
await build({stdin:{contents:"export * from './lib/department-workspace-navigation';export * from './lib/handoff-navigation';export * from './lib/production-planning';export * from './lib/supplier-workspace';export {DepartmentWorkspaceNavigation} from './app/department-workspace-navigation';export {SidebarProvider} from './components/ui/sidebar';",resolveDir:process.cwd(),loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},loader:{'.css':'empty'}});
const nav=await import(pathToFileURL(outfile).href),checks=[];
const member=(role='pmc',extra={})=>({id:'synthetic-navigation-member',kind:'member',email:'navigation@test.invalid',name:'合成导航成员',role,departments:[],customers:[],userId:'synthetic-navigation-user',active:true,createdAt:'2026-10-18T00:00:00Z',...extra});
const flatten=items=>items.flatMap(item=>[item,...flatten(item.children||[])]);
const leaves=groups=>groups.flatMap(group=>group.children);
const pass=message=>{checks.push(message);console.log('PASS '+message);};
const destination=item=>item.view+'?'+(item.context?.tab||'');
const roles=['admin','pmc','production','clerk','sales','finance','programmer','viewer'];

assert.deepEqual(nav.departmentWorkspaceGroups.map(group=>group.label),['工作总览','业务部','客服与单证','工程部','PMC 计划','采购与外协','仓储物流','生产车间','品质部','财务部','系统管理']);
for(const role of roles){
 const user=member(role,{departments:role==='clerk'?['finished','outsourcing']:[]}),items=nav.memberWorkspaceNavigation(user),before=JSON.stringify(items),groups=nav.departmentWorkspaceNavigation(items,user),result=leaves(groups);
 const legacy=flatten(nav.supplierWorkspaceNavigation(nav.productionPlanningNavigation(items,user),user));
 for(const item of legacy){const retained=result.filter(entry=>entry.view===item.id);assert.equal(retained.length,1,`${role}: ${item.id} stays reachable exactly once`);assert.equal(retained[0].label,item.label);}
 assert.equal(new Set(result.map(item=>item.id)).size,result.length,'Each child has one unique UI ID');
 assert.equal(new Set(result.map(destination)).size,result.length,'Each destination has one department owner');
 assert(groups.every(group=>group.children.length&&group.children.every(item=>!item.children)),'Only two navigation levels');
 assert.equal(JSON.stringify(items),before,'Caller navigation remains unchanged');
 for(const id of ['documents','service-followups','shipment-followups','service-receivables','project-finance','payment-terms'])assert(result.some(item=>item.view===id),`Existing page ${id} is now direct`);
 for(const space of nav.productionPlanningSpaces)assert(result.some(item=>item.view===space.id));
 for(const space of nav.supplierWorkspaceSpaces)assert(result.some(item=>item.view===space.id));
 assert.equal(result.filter(item=>item.view==='process-workspace').length,14);
}
pass('All legacy, production-planning and supplier destinations remain reachable exactly once across eight internal roles.');

const user=member(),all=nav.memberWorkspaceNavigation(user),restricted=all.filter(item=>!['customer-quotes','customer-price-archive','maintenance','receiving'].includes(item.id));
const restrictedLeaves=leaves(nav.departmentWorkspaceNavigation(restricted,user));
for(const id of ['customer-quotes','customer-price-archive','maintenance','business-tools','supplier-workspace',...nav.supplierWorkspaceSpaces.map(space=>space.id)])assert(!restrictedLeaves.some(item=>item.view===id),`Filtered ${id} is never restored`);
assert(!restrictedLeaves.some(item=>item.context?.tab==='iqc'));
assert(!restrictedLeaves.some(item=>item.context?.tab==='supplier-reconciliation'));
assert(!leaves(nav.departmentWorkspaceNavigation([{id:'settings',label:'系统设置',icon:'settings',group:'管理'}],user)).some(item=>item.view==='maintenance'));
const owner=member('admin',{owner:true}),ownerLeaves=leaves(nav.departmentWorkspaceNavigation(nav.memberWorkspaceNavigation(owner),owner));
assert.equal(ownerLeaves.filter(item=>item.view==='business-tools').length,1);
for(const identity of [undefined,member('supplier'),member('pmc',{active:false})])assert(leaves(nav.departmentWorkspaceNavigation(all,identity)).every(item=>item.source==='existing'),'Unauthenticated, inactive and supplier identities gain no new process pages');
assert.deepEqual(nav.departmentWorkspaceNavigation([],user),[],'Empty authorized navigation stays empty');
pass('Quotation, maintenance and owner visibility remain caller-controlled; new entries require active internal membership and visible source pages.');

const groups=nav.departmentWorkspaceNavigation(all,user),result=leaves(groups);
for(const item of result){
 const match=nav.matchDepartmentWorkspaceNavigation(groups,item.view,item.context,'service');
 assert.equal(match?.item.id,item.id,'Exact destination overrides a legacy parent fallback');
 const breadcrumb=nav.departmentWorkspaceBreadcrumb(groups,item.view,item.context,'service');
 assert.equal(breadcrumb?.departmentId,match.department.id);
 assert.equal(breadcrumb?.label,item.label);
}
assert.equal(nav.matchDepartmentWorkspaceNavigation(groups,'process-workspace',{tab:'unknown'},'service'),undefined);
assert.equal(nav.matchDepartmentWorkspaceNavigation(groups,'process-workspace',{},'service').item.id,'process-rfq');
assert.equal(nav.departmentWorkspaceBreadcrumb(groups,'process-workspace',{}).label,'需求与询价评估');
assert.equal(nav.matchDepartmentWorkspaceNavigation(groups,'accounts',{}).item.view,'customers');
assert.equal(nav.matchDepartmentWorkspaceNavigation(groups,'service',{tab:'service-followups'}).item.view,'service-followups');
const sourceContext={recordId:'source-record',tab:'source-tab',customerId:'customer-a',projectId:'project-a',orderId:'order-a'},contextBefore=JSON.stringify(sourceContext);
assert.deepEqual(nav.departmentWorkspaceNavigationContext(result.find(item=>item.id==='process-iqc'),sourceContext),{customerId:'customer-a',projectId:'project-a',orderId:'order-a',tab:'iqc'});
assert.deepEqual(nav.departmentWorkspaceNavigationContext(result.find(item=>item.id==='pmc'),sourceContext),{customerId:'customer-a',projectId:'project-a',orderId:'order-a'});
assert.equal(JSON.stringify(sourceContext),contextBefore);
pass('Process tabs activate and breadcrumb precisely; cross-stage links retain business scope and discard unrelated record IDs.');

const unknown={id:'future-existing-route',label:'未来既有页面',icon:'unknown',group:'旧工作空间'};
const expanded=nav.departmentWorkspaceNavigation([...all,unknown],user);
assert.equal(leaves(expanded).filter(item=>item.view===unknown.id).length,1,'Newly supplied routes are never silently dropped');
const grouped=nav.supplierWorkspaceNavigation(nav.productionPlanningNavigation(all,user),user);
assert.deepEqual(nav.departmentWorkspaceNavigation(grouped,user),groups,'Previously grouped navigation can also be consumed');
pass('Unknown supplied routes remain available, and legacy grouped navigation gives the same two-level result.');

const Icon=()=>createElement('svg',{'aria-hidden':true}),icons=Object.fromEntries([...groups.map(group=>group.icon),...result.map(item=>item.icon)].map(key=>[key,Icon]));
const markup=(view,context={})=>renderToStaticMarkup(createElement(nav.SidebarProvider,null,createElement(nav.DepartmentWorkspaceNavigation,{items:all,member:user,view,activeView:nav.workspacePrimaryView(view),context,icons,onNavigate:()=>{}})));
for(const item of result){
 const html=markup(item.view,item.context),match=nav.matchDepartmentWorkspaceNavigation(groups,item.view,item.context),domIds=[...html.matchAll(/\sid="([^"]+)"/g)].map(entry=>entry[1]);
 assert.equal(new Set(domIds).size,domIds.length,'No duplicate DOM IDs');
 const toggles=[...html.matchAll(/<button\b[^>]*class="department-navigation-toggle"[^>]*>/g)].map(entry=>entry[0]);
 assert.equal(toggles.length,11);
 for(const toggle of toggles){const control=/aria-controls="([^"]+)"/.exec(toggle)?.[1];assert(domIds.includes(control),'Every toggle controls an existing child container');assert(toggle.includes('type="button"'));}
 assert(toggles.find(toggle=>toggle.includes(`aria-label="收起${match.department.label}"`))?.includes('aria-expanded="true"'),'Current department opens on direct entry');
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1,'Exactly one page is active');
 assert(html.includes(`aria-current="page" data-nav-id="${item.id}"`));
 for(const original of flatten(grouped))assert.equal((html.match(new RegExp(`data-nav-id="${original.id}"`,'g'))||[]).length,1);
}
const blank=markup('process-workspace',{tab:'unknown'});assert(!blank.includes('aria-current="page"'),'Unknown process tabs do not mark a false current page');
const defaultProcess=markup('process-workspace');assert.equal((defaultProcess.match(/aria-current="page"/g)||[]).length,1);assert(defaultProcess.includes('aria-current="page" data-nav-id="process-rfq"'),'A direct process route matches the inquiry page actually rendered');
pass('All direct entries render unique accessible expand controls, one active leaf and an expanded current department.');

await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'synthetic members, pure route metadata and SSR navigation'},null,2));
console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
