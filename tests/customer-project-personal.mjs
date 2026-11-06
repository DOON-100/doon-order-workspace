// Read-only personal queue projection and navigation, using synthetic records only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

await fs.mkdir('test-output',{recursive:true});
await build({stdin:{contents:"export {customerProjectPersonalWork} from './lib/customer-project-personal';export {projectCollaborationGet} from './lib/project-collaboration-api';",loader:'ts',resolveDir:process.cwd()},outfile:'test-output/customer-project-personal.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-personal-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'synthetic'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='env'?'export const env={};':'export async function getChatGPTUser(){return null;}'}));}}]});
const {customerProjectPersonalWork,projectCollaborationGet}=await import(pathToFileURL(path.resolve('test-output/customer-project-personal.mjs')).href);
const member=(id,role='clerk')=>({id,kind:'member',name:'Synthetic '+id,role,active:true,personnelType:'internal'});
const me=member('me'),other=member('other'),sales=member('sales','sales'),admin=member('admin','admin');
const customer={id:'customer',kind:'customer_account',customer:'Synthetic customer',customerCode:'SYN',active:true,salesMemberIds:[sales.id],serviceMemberIds:[me.id,other.id]};
const project={id:'project',kind:'customer_project',customerId:customer.id,title:'Synthetic responsible project',code:'SYN-P',status:'active',salesMemberId:sales.id,serviceMemberId:other.id,serviceMemberIds:[me.id,other.id],dueDate:'2026-11-12'};
const task=(id,patch={})=>({id,kind:'customer_project_task',customerId:customer.id,projectId:project.id,title:'Synthetic '+id,status:'open',ownerId:me.id,serviceReviewerId:other.id,salesReviewerId:sales.id,dueDate:'2026-11-12',...patch});
const followup=(id,patch={})=>({id,kind:'customer_project_followup',customerId:customer.id,projectId:project.id,title:'Synthetic '+id,nextAction:'Follow '+id,status:'pending',ownerId:me.id,followUpDate:'2026-11-11',...patch});
const state={revision:7,records:[me,other,sales,admin,customer,{...customer,id:'hidden-customer',serviceMemberIds:[],salesMemberIds:[]},project,{...project,id:'unowned',serviceMemberIds:[],salesMemberId:other.id},{...project,id:'hidden',customerId:'hidden-customer'},{...project,id:'trashed',trashedAt:'2026-11-01'},
 task('open'),task('returned',{status:'returned'}),task('service-mine',{status:'service_review',ownerId:other.id,serviceReviewerId:me.id}),task('sales-mine',{status:'sales_review',ownerId:other.id,serviceReviewerId:sales.id,salesReviewerId:me.id}),task('owner-waiting',{status:'service_review'}),task('other-open',{ownerId:other.id}),task('done',{status:'done'}),task('cancelled',{status:'cancelled'}),task('mismatch',{customerId:'hidden-customer'}),task('hidden-task',{projectId:'hidden',customerId:'hidden-customer'}),task('orphan',{projectId:'missing'}),task('trashed-task',{projectId:'trashed'}),task('unconfigured',{serviceReviewerId:''}),
 followup('followup'),followup('unlinked',{projectId:'',customerId:''}),followup('other-followup',{ownerId:other.id}),followup('completed-followup',{status:'completed'}),followup('hidden-followup',{projectId:'hidden',customerId:'hidden-customer'}),followup('mismatched-followup',{customerId:'hidden-customer'}),followup('trashed-followup',{projectId:'trashed'}),followup('orphan-followup',{projectId:'missing'}),
 {id:'collaboration',kind:'customer_project_collaboration_task',projectId:project.id,customerId:customer.id,ownerId:me.id,title:'Synthetic collaboration',status:'open',updatedAt:'2026-11-06',history:[]}
]};
const original=JSON.stringify(state),feed=customerProjectPersonalWork(state,me);
assert.deepEqual(feed.actions.map(row=>row.id).sort(),['followup','open','returned','sales-mine','service-mine','unconfigured','unlinked']);
assert.deepEqual(feed.projects.map(row=>row.id),['project'],'Explicit empty serviceMemberIds must not revive the legacy scalar owner');
assert.deepEqual(feed.projects[0].roles,['service']);
assert.equal(feed.actions.find(row=>row.id==='service-mine').stage,'service_review');
assert.equal(feed.actions.find(row=>row.id==='service-mine').canAct,true);
assert.equal(feed.actions.find(row=>row.id==='sales-mine').stage,'sales_review');
assert.equal(feed.actions.find(row=>row.id==='unconfigured').canAct,false);
assert.match(feed.actions.find(row=>row.id==='unconfigured').unavailableReason,/审核配置/);
assert.equal(feed.actions.find(row=>row.id==='followup').title,'Follow followup');
assert.deepEqual(customerProjectPersonalWork(state,{...me,active:false}),{actions:[],projects:[]});
assert.deepEqual(customerProjectPersonalWork(state,member('unauthorized')),{actions:[],projects:[]});
assert.equal(customerProjectPersonalWork(state,admin).projects.length,0,'Admin access alone does not fabricate personal responsibility');
const paused=structuredClone(state);paused.records.find(row=>row.id===project.id).status='paused';
assert.equal(customerProjectPersonalWork(paused,me).actions.find(row=>row.id==='open').canAct,false);
const reassigned=structuredClone(state);reassigned.records.find(row=>row.id==='open').ownerId=other.id;
assert(!customerProjectPersonalWork(reassigned,me).actions.some(row=>row.id==='open'),'Reassigned tasks leave the former owner queue');
assert.equal(JSON.stringify(state),original,'Personal reads must not mutate projects, responsibilities, original task IDs or records');
const get=async query=>await (await projectCollaborationGet('project-collaboration-data',new Request('https://synthetic.invalid/api/workspace/project-collaboration-data'+query),state,me)).json();
const personal=await get('');assert.deepEqual(personal.personalProjectWork,feed);assert.deepEqual(personal.tasks.map(row=>row.id),['collaboration']);
assert.equal((await get('?taskId=collaboration')).personalProjectWork,undefined);
assert.equal((await get('?projectId=project')).personalProjectWork,undefined);
assert.equal(JSON.stringify(state),original);
console.log('PASS personal GET retains collaboration tasks and aggregates original actions, current review stages, responsible projects and followups within existing permissions');

const ui=await build({entryPoints:['app/customer-project-personal-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,alias:{'@':process.cwd()},plugins:[{name:'synthetic-personal-ui',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));
 b.onResolve({filter:/workspace-read-queue$/},()=>({path:'request',namespace:'synthetic'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?'export const useState=()=>[globalThis.__personalSearch||"",value=>{globalThis.__personalSearch=value;}];':a.path==='react/jsx-runtime'?'export const Fragment="fragment";export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;':a.path==='@tanstack/react-query'?'export const useQuery=options=>{globalThis.__personalQueryOptions=options;return globalThis.__personalQuery;};':a.path==='button'?'export const Button="button";':a.path==='request'?'export const workspaceFetch=async (...args)=>{globalThis.__personalRequest=args;return Response.json(globalThis.__personalResponse);};':''}));
}}]});
const {CustomerProjectPersonalPanel,personalProjectActionContext,personalResponsibleProjectContext}=await import('data:text/javascript;base64,'+Buffer.from(ui.outputFiles[0].text).toString('base64'));
assert.deepEqual(personalProjectActionContext(feed.actions.find(row=>row.id==='service-mine')),{customerId:customer.id,projectId:project.id,recordId:'service-mine',tab:'project-task'});
assert.deepEqual(personalProjectActionContext(feed.actions.find(row=>row.id==='unlinked')),{recordId:'unlinked',tab:'followup'});
assert.deepEqual(personalResponsibleProjectContext(feed.projects[0]),{projectId:project.id,customerId:customer.id,tab:'directory'});
globalThis.__personalQuery={data:personal,isPending:false,isError:false,isFetching:false,refetch:async()=>{}};
globalThis.__personalResponse=personal;
const navigation=[],props={data:{me,revision:state.revision},onNavigate:(...args)=>navigation.push(args)};
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
const nodes=(node,result=[])=>{if(Array.isArray(node))node.forEach(value=>nodes(value,result));else if(node&&typeof node==='object'){result.push(node);nodes(node.props?.children,result);}return result;};
let tree=CustomerProjectPersonalPanel(props);
assert(text(tree).includes('Synthetic responsible project'));assert(text(tree).includes('由我客服审核'));
assert.deepEqual(globalThis.__personalQueryOptions.queryKey,['project-collaboration',me.id,state.revision,'']);
assert.equal(globalThis.__personalQueryOptions.refetchOnMount,'always','Returning after an original task mutation must read fresh personal work');
await globalThis.__personalQueryOptions.queryFn({signal:new AbortController().signal});assert.deepEqual(globalThis.__personalRequest[2],{unscoped:true});
nodes(tree).find(node=>node.type==='button'&&text(node)==='打开处理 · Synthetic service-mine').props.onClick();assert.equal(navigation[0][1].recordId,'service-mine');assert.equal(navigation[0][1].tab,'project-task');
globalThis.__personalQuery={...globalThis.__personalQuery,isError:true,error:new Error('Synthetic revoked')};tree=CustomerProjectPersonalPanel(props);assert(!text(tree).includes('Synthetic responsible project'));assert(text(tree).includes('已隐藏上次资料'));
globalThis.__personalQuery={...globalThis.__personalQuery,isError:false};globalThis.__personalSearch='nothing matches';tree=CustomerProjectPersonalPanel(props);assert(text(tree).includes('0 条待办 · 0 个负责项目'));
globalThis.__personalSearch='';tree=CustomerProjectPersonalPanel({...props,initialContext:{projectId:'other-project'}});assert(text(tree).includes('0 条待办 · 0 个负责项目'));
console.log('PASS personal panel exact-ID navigation, cross-team reads, scoped filtering and stale-data hiding');
