// Synthetic navigation metadata and rendered HTML only; no business records or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const output=path.resolve('test-output','supplier-workspace-navigation-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'navigation.mjs');
await build({stdin:{contents:"export * from './lib/supplier-workspace';export * from './lib/production-planning';export * from './lib/handoff-navigation';export {ProductionPlanningNavigation} from './app/production-planning-navigation';export {SidebarProvider} from './components/ui/sidebar';",resolveDir:process.cwd(),loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},loader:{'.css':'empty'}});
const nav=await import(pathToFileURL(outfile).href);
const expected=['supplier-pending','supplier-followup','supplier-kit','supplier-outsourcing','supplier-risk','supplier-samples','supplier-reconciliation'];
const ids=items=>items.map(item=>item.id),checks=[];
const member=(role='pmc',departments=[])=>({id:'synthetic-supplier-navigation',kind:'member',email:'supplier-navigation@test.invalid',name:'合成采购导航成员',role,departments,customers:[],userId:'synthetic-supplier-user',active:true,createdAt:'2026-10-15T00:00:00Z'});
const pass=message=>{checks.push(message);console.log('PASS '+message);};
const flatten=items=>items.flatMap(item=>[item,...flatten(item.children||[])]);
const group=(items,user)=>nav.supplierWorkspaceNavigation(nav.productionPlanningNavigation(items,user),user);

assert.equal(nav.SUPPLIER_WORKSPACE_ID,'supplier-workspace');
assert.equal(nav.SUPPLIER_WORKSPACE_TITLE,'供应商管理工作台');
assert.deepEqual(ids(nav.supplierWorkspaceSpaces),expected);
for(const item of nav.supplierWorkspaceSpaces){assert(nav.isSupplierWorkspaceView(item.id));assert.equal(nav.supplierWorkspaceTitle(item.id),item.label);for(const key of ['area','detail','icon'])assert(item[key]);}
assert(nav.isSupplierWorkspaceView('supplier-workspace'));
for(const id of ['receiving','finished-outsourcing','production-planning','supplier-pending-extra','unknown'])assert.equal(nav.isSupplierWorkspaceView(id),false);
assert.equal(nav.supplierWorkspaceTitle('receiving'),undefined);
pass('One supplier root has seven manufacturing procurement spaces and does not absorb receiving.');

for(const role of ['admin','pmc','production','clerk','sales','finance','programmer','viewer']){
 const user=member(role,role==='clerk'?['finished','outsourcing']:[]),items=nav.memberWorkspaceNavigation(user),before=JSON.stringify(items),planning=nav.productionPlanningNavigation(items,user),result=group(items,user);
 const root=result.find(item=>item.id==='supplier-workspace');assert(root);
 assert.deepEqual(ids(root.children),expected);
 assert(root.children.every(item=>item.parent==='supplier-workspace'));
 assert.deepEqual(result.filter(item=>item.id!=='supplier-workspace'),planning,'Existing destinations, grouping and permissions are untouched.');
 assert.equal(flatten(result).filter(item=>item.id==='receiving').length,1);
 assert.equal(new Set(ids(flatten(result))).size,flatten(result).length,'No duplicate navigation IDs.');
 assert.equal(JSON.stringify(items),before,'Input navigation is not mutated.');
 assert.deepEqual(nav.supplierWorkspaceNavigation(result,user),result,'Repeated composition is idempotent.');
 if(role==='clerk')assert.deepEqual(ids(result).slice(0,3),['workbench','finished-outsourcing','department']);
 const withoutReceiving=items.filter(item=>item.id!=='receiving');
 assert(!flatten(group(withoutReceiving,user)).some(item=>nav.isSupplierWorkspaceView(item.id)),'Hidden receiving cannot grant the new entry.');
}
for(const user of [undefined,member('supplier'),{...member(),active:false}]){
 assert.equal(nav.canSeeSupplierWorkspace(user),false);
 assert(!flatten(group(nav.memberWorkspaceNavigation(user),user)).some(item=>nav.isSupplierWorkspaceView(item.id)));
}
pass('Internal visibility follows receiving; supplier, inactive and unregistered identities receive no new entry.');

const user=member(),items=nav.memberWorkspaceNavigation(user),Icon=()=>createElement('svg',{'aria-hidden':true});
const icons=Object.fromEntries([...flatten(group(items,user)).map(item=>item.icon)].map(key=>[key,Icon]));
const markup=view=>renderToStaticMarkup(createElement(nav.SidebarProvider,null,createElement(nav.ProductionPlanningNavigation,{items,member:user,view,activeView:view,icons,onNavigate:()=>{}})));
const controls=html=>[...html.matchAll(/<button\b[^>]*aria-controls="([^"]+)"[^>]*>/g)].map(match=>({id:match[1],tag:match[0]}));
for(const view of ['supplier-workspace',...expected,'production-planning','receiving','workbench']){
 const html=markup(view),toggles=controls(html),idsInHtml=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(new Set(idsInHtml).size,idsInHtml.length,'All rendered DOM IDs are unique.');
 assert.deepEqual(toggles.map(item=>item.id),['production-planning-spaces','supplier-workspace-spaces']);
 for(const toggle of toggles)assert(idsInHtml.includes(toggle.id),'Each aria-controls points to its own container.');
 const supplier=nav.isSupplierWorkspaceView(view),planning=nav.isProductionPlanningView(view);
 assert(toggles[0].tag.includes(`aria-expanded="${planning}"`));
 assert(toggles[1].tag.includes(`aria-expanded="${supplier}"`));
 assert(toggles[0].tag.includes(`aria-label="${planning?'收起':'展开'}度昂生产计划工作台"`));
 assert(toggles[1].tag.includes(`aria-label="${supplier?'收起':'展开'}供应商管理工作台"`));
 assert.equal((html.match(/data-nav-id="receiving"/g)||[]).length,1);
 if(supplier)assert(html.includes(`aria-current="page" data-nav-id="${view}"`),'Direct supplier routes receive current-page navigation.');
}
pass('Both hierarchies render separate accessible expand controls and open the current branch on direct entry.');

await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'synthetic members, route metadata and server-rendered navigation'},null,2));
console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
