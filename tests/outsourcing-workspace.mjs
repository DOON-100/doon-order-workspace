// Synthetic records only. Exercise the rendered workspaces and real export handler without a database.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as XLSX from 'xlsx';

const output=path.resolve('test-output','outsourcing-workspace-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'workspace.mjs');
await build({stdin:{contents:"export * from './lib/outsourcing-workspace';export {supplierGet} from './lib/supplier-api';export {businessFollowupTargets,resolveBusinessFollowupTarget,followupTargetScope} from './lib/business-followup-targets';export {businessFollowupGet} from './lib/business-followup-api';export {LegacySupplierPanel} from './app/supplier-panel';export {ReceivingPanel} from './app/receiving-panel';",resolveDir:process.cwd(),loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},loader:{'.css':'empty'},plugins:[{name:'no-production-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'synthetic'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return null}':'export const env={};'}));}}]});
const api=await import(pathToFileURL(outfile).href);
const member={id:'synthetic-member',kind:'member',email:'member@test.invalid',name:'合成成员',role:'admin',customers:[],departments:[],active:true,userId:'synthetic-user'};
const order={id:'synthetic-order',kind:'order',orderNo:'SYNTHETIC-ORDER',customer:'合成客户',ownerEmail:member.email,drawing:'SYNTHETIC-DRAWING',color:'C1',lens:'',quantity:100,stage:'生产中',sourceStatus:'',extra:{},productType:'钛架',version:1};
const row=(id,process,lineId=order.id)=>({id,kind:'outsource',lineId,process,reference:id,supplier:'合成供应商',quantity:10,received:2,dueDate:'2099-12-31',status:'待回货',approvalStatus:'已审批',buyerEmail:member.email,actor:member.name,version:1});
const sources=[row('SYNTHETIC-PLATING','plating'),row('SYNTHETIC-WELDING','welding'),row('SYNTHETIC-PLASTIC','cnc'),row('SYNTHETIC-UNKNOWN','historical-process')];
const scopeCases=[['plating',['SYNTHETIC-PLATING']],['titanium',['SYNTHETIC-WELDING']],['plastic',['SYNTHETIC-PLASTIC']],['semifinished',['SYNTHETIC-WELDING','SYNTHETIC-PLASTIC']],['all',sources.map(row=>row.id)]];
const receipts=[{id:'mixed-document',kind:'receipt',photoId:'original-photo',deliveryNo:'SYNTHETIC-DELIVERY',lines:sources.map((source,index)=>({outsourceId:source.id,process:source.process,accepted:index+2,rejected:index===0?1:0}))},{id:'legacy-process-reference',kind:'receipt',photoId:'legacy-photo',lines:[{outsourceId:sources[0].id,accepted:1,rejected:0}]}];
const before=JSON.stringify({sources,receipts});
for(const [scope,expected] of scopeCases){
 const projected=api.scopeOutsourcingReceipts(receipts,scope,sources);
 assert.deepEqual([...new Set(projected.flatMap(receipt=>receipt.lines.map(line=>line.outsourceId)))],expected);
 assert.equal(projected[0].photoId,'original-photo');
 if(scope==='plating')assert.equal(projected.length,2,'Historical receipt lines resolve through the original outsource ID.');
 if(scope==='all')assert.equal(projected[0],receipts[0],'Legacy documents retain their full original content.');
}
assert.equal(JSON.stringify({sources,receipts}),before,'Scope projections must not mutate original records or receipt lines.');
assert.deepEqual(api.outsourcingStages('plating').map(stage=>stage.id),['plating']);
assert.deepEqual(api.outsourcingStages('titanium').map(stage=>stage.id),['welding','polishing','titanium']);
assert.deepEqual(api.outsourcingStages('plastic').map(stage=>stage.id),['temple','cnc','kit','assembly']);
for(const scope of ['titanium','plastic','semifinished','plating'])assert(!api.matchesOutsourcingScope('packing',scope),'包装入仓 must not be reclassified as an outsource return.');
for(const [scope,label] of [['titanium','钛架部'],['plastic','胶架部'],['plating','电镀外发']]){assert(api.isOutsourcingScope(scope));assert.equal(api.outsourcingScopeLabel(scope),label);}
assert.deepEqual(api.outsourcingStages('semifinished').map(stage=>stage.id),['welding','polishing','titanium','temple','cnc','kit','assembly']);
assert(!api.matchesOutsourcingScope('spray','plating'),'Do not infer unsupported PVD or spray identifiers.');
console.log('PASS Scoped receipt projections preserve originals and only include supported process identifiers.');

const data={me:member,members:[member],orders:[order],outsource:sources,receipts,suppliers:[],supplierFollowups:[]};
const common={data,act:async()=>{throw new Error('Rendering must not write');},busy:false,openOrder:()=>{}};
for(const Component of [api.LegacySupplierPanel,api.ReceivingPanel]){
 for(const [scope,expected] of scopeCases){
  const html=renderToStaticMarkup(createElement(Component,{...common,scope}));
  for(const row of sources)assert.equal(html.includes(row.reference),expected.includes(row.id),`${Component.name}: ${scope} must show only its own tracking rows`);
 }
 const legacy=renderToStaticMarkup(createElement(Component,common));
 for(const row of sources)assert(legacy.includes(row.reference),'Old unscoped entry retains every historical process.');
}
console.log('PASS Tracking and receiving workspaces isolate titanium, plastic and plating; legacy combined scopes remain complete.');

const otherOrder={...order,id:'unreadable-order',orderNo:'UNREADABLE',customer:'其他客户',ownerEmail:'other@test.invalid'};
const restricted={...member,role:'viewer'},state={revision:1,records:[order,otherOrder,...sources,row('SYNTHETIC-UNREADABLE','plating',otherOrder.id)]};
async function exported(scope,user=restricted){
 const response=await api.supplierGet('supplier-export',new Request('https://synthetic.test/api/workspace/supplier-export'+(scope?'?scope='+scope:'')),state,user);
 assert.equal(response.status,200);
 const workbook=XLSX.read(await response.arrayBuffer());
 return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]).map(row=>row['外发单号']);
}
assert.deepEqual(await exported('plating'),['SYNTHETIC-PLATING']);
assert.deepEqual(await exported('titanium'),['SYNTHETIC-WELDING']);
assert.deepEqual(await exported('plastic'),['SYNTHETIC-PLASTIC']);
assert.deepEqual(await exported('semifinished'),['SYNTHETIC-WELDING','SYNTHETIC-PLASTIC']);
assert.deepEqual(await exported(''),sources.map(row=>row.id));
assert.deepEqual(await exported('all'),sources.map(row=>row.id));
await assert.rejects(()=>exported('invalid'),/有效的外发工作空间/);
assert.equal(JSON.stringify({sources,receipts}),before,'Export and rendering must preserve all input records.');
console.log('PASS Real XLSX exports match workspace scope, retain legacy defaults and enforce the original order visibility.');

const followupState={revision:1,records:[restricted,...state.records]},followupRequest=new Request('https://synthetic.test/api/workspace/business-followup-targets');
const existing=await api.businessFollowupTargets(followupRequest,followupState,restricted,'supplier-outsourcing');
for(const [module,expectedId] of [['supplier-semifinished','SYNTHETIC-WELDING'],['supplier-semifinished-plastic','SYNTHETIC-PLASTIC'],['supplier-plating','SYNTHETIC-PLATING']]){
 const catalog=await api.businessFollowupTargets(followupRequest,followupState,restricted,module);
 assert.equal(catalog.supported,true);
 assert.deepEqual(catalog.targets.map(target=>target.recordId),[expectedId]);
 const target=catalog.targets[0],original=existing.targets.find(target=>target.recordId===expectedId);
 assert.deepEqual(target,original,'New entry retains the canonical original target, scope identity and permissions.');
 assert.equal(target.module,'supplier-outsourcing');
 assert.equal(target.canAppend,false,'Read-only members must not gain followup write access.');
 const originalEntry={id:'existing-'+expectedId,kind:'business_followup',module:target.module,collection:target.collection,recordId:target.recordId,sectionKey:target.sectionKey,...api.followupTargetScope(target),note:'合成原有沟通记录',createdAt:'2026-10-30T00:00:00Z',createdByName:'合成成员'};
 const originalAttachment={...originalEntry,id:'attachment-'+expectedId,kind:'business_followup_attachment',entryId:originalEntry.id,originalName:'synthetic-original.txt',size:12,sha256:'synthetic-hash'};
 followupState.records.push(originalEntry,originalAttachment);
 const key={module,collection:'outsource',recordId:expectedId,sectionKey:'record'};
 const response=await api.businessFollowupGet('business-followup-data',new Request('https://synthetic.test/api/workspace/business-followup-data?'+new URLSearchParams(key)),followupState,restricted),feed=await response.json();
 assert.equal(feed.target.module,'supplier-outsourcing');
 assert.equal(feed.entries.length,1);
 assert.equal(feed.entries[0].id,originalEntry.id);
 assert.equal(feed.entries[0].attachments[0].id,originalAttachment.id,'Original attachment links stay attached to the same entry.');
 for(const foreign of sources.filter(row=>row.id!==expectedId))await assert.rejects(()=>api.resolveBusinessFollowupTarget(followupRequest,followupState,restricted,{...key,recordId:foreign.id}),/业务记录不存在/);
 await assert.rejects(()=>api.resolveBusinessFollowupTarget(followupRequest,followupState,restricted,{...key,recordId:'SYNTHETIC-UNREADABLE'}),/业务记录不存在/);
 await assert.rejects(()=>api.resolveBusinessFollowupTarget(followupRequest,followupState,restricted,key,true),/仅可查看/);
}
const writerState={...followupState,records:followupState.records.map(row=>row.id===member.id?member:row)};
assert.equal((await api.businessFollowupTargets(followupRequest,writerState,member,'supplier-plating')).targets.find(target=>target.recordId==='SYNTHETIC-PLATING').canAppend,true);
assert.deepEqual((await api.businessFollowupTargets(followupRequest,followupState,restricted,'receiving')).targets,existing.targets,'Legacy receipt catalog stays unchanged.');
console.log('PASS New followup catalogs preserve original communication and attachment history, process scope and write permissions.');
