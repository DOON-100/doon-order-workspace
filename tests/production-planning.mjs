// Navigation regression only: synthetic members and route metadata; no production data or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output','production-planning-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'navigation.mjs');
await build({stdin:{contents:"export * from './lib/production-planning';export * from './lib/handoff-navigation';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm'});
const nav=await import(pathToFileURL(outfile).href);
const {PRODUCTION_PLANNING_ID:parentId,PRODUCTION_PLANNING_TITLE:parentTitle,productionPlanningSpaces:spaces,productionPlanningNavigation:groupNavigation}=nav;
const expectedSpaces=['pmc-handoff','pmc','orders','mine','receiving','department','finished-outsourcing','mes','dashboard','losses','completed','imports','reports'];
const ids=items=>items.map(item=>item.id),spaceIds=new Set(expectedSpaces),checks=[];
const pass=message=>{checks.push(message);console.log('PASS '+message);};
const member=(role='sales',departments=[])=>({id:'synthetic-navigation-member',kind:'member',email:'navigation@test.invalid',name:'合成导航成员',role,departments,customers:[],userId:'synthetic-navigation-user',active:true,createdAt:'2026-10-15T00:00:00Z'});
const leaves=items=>items.flatMap(item=>item.children?.length?item.children:[item]);
const assertUnique=items=>{
 const all=items.flatMap(item=>[item,...(item.children||[])]);
 assert.equal(new Set(ids(all)).size,all.length,'Every root or secondary navigation id occurs once.');
};

assert.equal(parentId,'production-planning');
assert.equal(parentTitle,'度昂生产计划工作台');
assert.deepEqual(ids(spaces),expectedSpaces);
assert.equal(new Set(ids(spaces)).size,13);
for(const space of spaces){
 for(const field of ['label','area','detail'])assert.equal(typeof space[field],'string',`${space.id}.${field} must be display text.`);
 for(const field of ['label','area','detail'])assert(space[field].trim(),`${space.id}.${field} must not be empty.`);
 assert(nav.isProductionPlanningView(space.id));
}
assert(nav.isProductionPlanningView(parentId));
for(const view of ['workbench','sales','customers','factory-orders','production-orders','engineering-drawings','ar-workspace','members','maintenance','unknown'])assert.equal(nav.isProductionPlanningView(view),false,view+' keeps its existing scope.');
pass('Production planning defines one named root and exactly 13 existing secondary spaces.');

for(const user of [undefined,member(),member('clerk',['plastic']),member('pmc')]){
 const original=nav.memberWorkspaceNavigation(user),snapshot=JSON.stringify(original),grouped=groupNavigation(original,user);
 const firstChild=original.findIndex(item=>spaceIds.has(item.id));
 const parent=grouped.find(item=>item.id===parentId);
 assert(parent,'The production planning root must be present.');
 assert.equal(parent.label,parentTitle);
 assert.deepEqual(ids(parent.children),expectedSpaces,'Ordinary users see the configured production workflow order.');
 const expectedRootIds=ids(original.slice(0,firstChild)).concat(parentId,ids(original.slice(firstChild).filter(item=>!spaceIds.has(item.id))));
 assert.deepEqual(ids(grouped),expectedRootIds,'The root replaces the first production entry; unrelated root order is retained.');
 assert.equal(grouped.filter(item=>spaceIds.has(item.id)).length,0,'Production spaces are secondary entries for ordinary users.');
 for(const item of original.filter(item=>!spaceIds.has(item.id)))assert.deepEqual(grouped.find(candidate=>candidate.id===item.id),item,'Unrelated navigation metadata remains unchanged for '+item.id);
 assert.deepEqual(ids(leaves(grouped)).sort(),ids(original).sort(),'Grouping retains every existing destination.');
 assertUnique(grouped);
 assert.equal(JSON.stringify(original),snapshot,'Grouping does not mutate the input navigation.');
}
pass('Ordinary users retain unrelated navigation and all routes while production spaces move beneath one root.');

const finished=member('clerk',['finished','outsourcing']);
const originalFinished=nav.memberWorkspaceNavigation(finished),finishedSnapshot=JSON.stringify(originalFinished);
assert.deepEqual(ids(originalFinished).slice(0,3),['workbench','finished-outsourcing','department']);
const finishedNavigation=groupNavigation(originalFinished,finished),finishedParent=finishedNavigation.find(item=>item.id===parentId);
assert.deepEqual(ids(finishedNavigation).slice(0,3),['workbench','finished-outsourcing','department'],'Finished clerks keep both priority shortcuts on the first screen.');
assert(finishedParent);
assert.deepEqual(ids(finishedParent.children),expectedSpaces.filter(id=>!['finished-outsourcing','department'].includes(id)),'Priority shortcuts are not repeated in the secondary menu.');
assert.deepEqual(ids(leaves(finishedNavigation)).sort(),ids(originalFinished).sort());
assertUnique(finishedNavigation);
assert.equal(JSON.stringify(originalFinished),finishedSnapshot);
assert.deepEqual(ids(spaces),expectedSpaces,'The overview still contains all 13 spaces for finished clerks.');
pass('Finished clerks retain priority shortcuts without duplicates, and the overview keeps all 13 entry cards.');

const incoming={customerId:'synthetic-customer',projectId:'synthetic-project',orderId:'synthetic-order',recordId:'synthetic-pmc-record',tab:'pmc'};
const incomingSnapshot=JSON.stringify(incoming);
assert.equal(nav.resolveWorkspaceView('production-orders',incoming),'pmc');
assert.equal(nav.workspacePrimaryView('factory-orders'),'production-orders');
for(const id of expectedSpaces)assert.equal(nav.resolveWorkspaceView(id,incoming),id,'Existing direct route '+id+' retains its identity.');
assert.equal(nav.resolveWorkspaceView(parentId),parentId);
assert.equal(nav.resolveWorkspaceView('factory-orders',incoming),'factory-orders');
const scope=nav.departmentNavigationContext(incoming);
assert.deepEqual(scope,{customerId:incoming.customerId,projectId:incoming.projectId,orderId:incoming.orderId});
assert.equal(nav.resolveWorkspaceView('production-orders',scope),'production-orders');
assert.equal(nav.resolveWorkspaceView('documents',{tab:'customer-quotes'}),'customer-quotes');
assert.equal(nav.resolveWorkspaceView('engineering-drawings',{recordId:'synthetic-drawing',tab:'drawings'}),'engineering-drawings');
assert.equal(JSON.stringify(incoming),incomingSnapshot);
pass('Legacy parent deep links, direct routes and business scope handling remain unchanged.');

await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'synthetic members and navigation metadata; no production access'},null,2));
console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
