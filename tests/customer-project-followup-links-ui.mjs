import assert from 'node:assert/strict';
import {build} from 'esbuild';

const react=`
export function useState(initial){const h=globalThis.__followupLinksHooks,i=h.index++;if(!h.slots[i])h.slots[i]={value:typeof initial==='function'?initial():initial};return [h.slots[i].value,value=>{const next=typeof value==='function'?value(h.slots[i].value):value;if(!Object.is(next,h.slots[i].value)){h.slots[i].value=next;h.changed=true;}}];}
export function useRef(value){const h=globalThis.__followupLinksHooks,i=h.index++;return h.slots[i]||(h.slots[i]={current:value});}
export function useEffect(fn,deps){const h=globalThis.__followupLinksHooks,i=h.index++,old=h.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){h.slots[i]={deps,cleanup:old?.cleanup};h.effects.push(()=>{old?.cleanup?.();h.slots[i].cleanup=fn();});}}
export function useMemo(fn,deps){const h=globalThis.__followupLinksHooks,i=h.index++,old=h.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))h.slots[i]={deps,value:fn()};return h.slots[i].value;}
export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`;
const stubs={react,
 'react/jsx-runtime':`export const Fragment='fragment';export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`,
 'lucide-react':`export const ArrowRight='icon',CheckCheck='icon',Download='icon',Inbox='icon',Plus='icon',RefreshCw='icon',Save='icon',Search='icon',X='icon';`,
 button:`export const Button='button';`,
 'client-id':`let n=0;export const clientId=()=>'followup-links-test-'+(++n);`,
 'business-followup-panel':`export function BusinessFollowupSlot(){return null;}`,
 'excel-table':`export const ExcelTable='table';`,
 ui:`export const request=(...args)=>globalThis.__followupLinksRequest(...args);export const dateTime=value=>value||'—';`,
 'customer-project-ui':`export const CPBadge='badge',CPEmpty='empty',CPSection='section',CPTable='table';export const cpToday=()=>'2026-10-14';`,css:''
};
const result=await build({entryPoints:['app/customer-project-followup-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'followup-links-ui',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.endsWith('.css')?'css':a.path.endsWith('/button')?'button':Object.hasOwn(stubs,a.path)?a.path:a.path.split('/').at(-1);return Object.hasOwn(stubs,key)?{path:key,namespace:'test'}:undefined;});b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:stubs[a.path]}));}}]});
const {CustomerProjectFollowupPanel}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const originals=new Map(['window','__followupLinksHooks','__followupLinksRequest'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const listeners=new Map();globalThis.window={confirm:()=>true,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
const row=(id,extra={})=>({id,version:1,ownerId:'sales',customerId:'customer',projectId:'project',title:'Synthetic '+id,category:'other',stars:0,status:'pending',followUpDate:'2026-10-16',nextAction:'Original next action',notes:'',checklist:[],canWrite:true,...extra});
let source={
 followups:[row('followup'),row('unlinked',{projectId:'',customerId:'',nextAction:'Confirm customer'})],
 projects:[{id:'project',customerId:'customer',code:'SYN-1',title:'Synthetic linked project',salesMemberId:'sales'},{id:'without-followup',customerId:'customer',code:'SYN-2',title:'Synthetic project without followup',salesMemberId:'sales'}],
 projectTasks:[{id:'task',projectId:'project',source:'project',title:'Synthetic review action',ownerId:'sales',dueDate:'2026-10-14',status:'service_review'},{id:'collaboration',projectId:'without-followup',source:'collaboration',title:'Synthetic engineering drawing',ownerId:'engineer',ownerName:'Synthetic engineer',dueDate:'2026-10-15',status:'open'}],
 customers:[{id:'customer',customer:'Synthetic customer',active:true}],members:[{id:'sales',name:'Synthetic sales'}],people:[{id:'sales',name:'Synthetic sales'}],canImport:true,mails:[],sourceBundles:[],
 summary:{visibleProjects:2,linkedFollowups:1,linkedProjects:1,unlinkedFollowups:1,unassignedCustomers:1,projectsWithoutFollowups:1}
};
const model={index:0,slots:[],effects:[],changed:false,tree:null};let changed=0,opened='',openedTeam='',reads=0,pendingRead,slowRead=false,signals=[],mutations=0,promotions=[];
const props={meId:'sales',onDirtyChange(){},onBusyChange(){},onDataChanged(){changed++;},onOpenProject:(id,teamId)=>{opened=id;openedTeam=teamId;}};
globalThis.__followupLinksRequest=async(action,values,options)=>{
 if(action==='customer-project-followup-data'){reads++;signals.push(options?.signal);if(slowRead){slowRead=false;const snapshot=structuredClone(source);return await new Promise(resolve=>{pendingRead=()=>resolve(snapshot);});}return structuredClone(source);}
 if(action==='customer-project-followup-save'){mutations++;const item={...source.followups.find(row=>row.id===values.id),...values,version:2};source.followups=source.followups.map(row=>row.id===item.id?item:row);return {item};}
 if(action==='customer-project-followup-promote'){promotions.push(values);const project={id:'promoted-'+values.id,customerId:values.customerId,teamId:values.teamId,code:values.code,title:values.title,salesMemberId:'sales'},item={...source.followups.find(row=>row.id===values.id),projectId:project.id};return {project,item};}
 throw Error('Unexpected action '+action);
};
function nodes(node,out=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,out));else if(node&&typeof node==='object'&&node.type){out.push(node);for(const key of ['children','rows','actions'])nodes(node.props?.[key],out);}return out;}
function text(node){return node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);}
function render(){for(let i=0;i<30;i++){globalThis.__followupLinksHooks=model;model.index=0;model.changed=false;model.tree=CustomerProjectFollowupPanel(props);for(const effect of model.effects.splice(0))effect();if(!model.changed)return;}throw Error('Render did not settle');}
async function settle(){for(let i=0;i<15;i++){await Promise.resolve();render();}}
const byLabel=label=>{const node=nodes(model.tree).find(node=>node.props?.['aria-label']===label);assert(node,label);return node;};
const byTestId=id=>nodes(model.tree).find(node=>node.props?.['data-testid']===id);
const followupCard=()=>nodes(model.tree).find(node=>node.props?.['data-testid']==='followup-card'&&text(node).includes('Synthetic followup'));
const button=label=>{const node=nodes(model.tree).find(node=>node.type==='button'&&text(node)===label);assert(node,label);return node;};
const personButton=name=>{const node=nodes(byLabel('按人员查看客户跟进')).find(node=>node.type==='button'&&text(node).startsWith(name));assert(node,name);return node;};
const unlinkedProjectRows=()=>{const section=nodes(model.tree).find(node=>node.props?.title==='尚未建立客户跟进的项目');return section?nodes(section).find(node=>node.type==='table').props.rows:[];};
const assertProjectCount=(label,count)=>{const card=byTestId('followup-project-count');assert(card);assert.match(text(card),new RegExp(label));assert.equal(text(nodes(card).find(node=>node.type==='b')),String(count));};
try{
 render();await settle();
 assert.match(text(byTestId('followup-link-summary')),/2 条跟进记录：1 条已关联 1 个项目，1 条未关联项目/);
 assert.match(text(byTestId('followup-link-summary')),/全部可见项目 2 个/);
 assert.match(text(followupCard()),/项目另有 1 条未完成待办/);
 const projectSection=nodes(model.tree).find(node=>node.props?.title==='尚未建立客户跟进的项目');assert(projectSection);
 const table=nodes(projectSection).find(node=>node.type==='table');assert.equal(table.props.rows.length,1);assert.match(text(table.props.rows),/Synthetic engineering drawing/);assert.match(text(table.props.rows),/Synthetic engineer/);
 nodes(table.props.rows).find(node=>node.type==='button').props.onClick();assert.equal(opened,'without-followup');assert.equal(mutations,0);
 console.log('PASS followup view explains project/entry counts, includes same-project tasks and exposes projects without inventing followups');

 const initialReads=reads,initialChanged=changed;
 for(const listener of listeners.get('focus')||[])listener();await settle();
 assert.equal(reads,initialReads,'Focus must not reload followups');assert.equal(changed,initialChanged,'Focus must not reload parent project/finance data');
 slowRead=true;button('刷新跟进').props.onClick();render();assert(pendingRead);const oldSignal=signals.at(-1);
 button('查看 / 更新跟进').props.onClick();render();
 assert.equal(byTestId('followup-project-tasks').props.children[0].props.children[0],'关联项目待办 ');
 assert.match(text(byTestId('followup-project-tasks')),/Synthetic review action/);
 byLabel('下一步').props.onChange({target:{value:'Updated shared action'}});render();
 byLabel('下一跟进日期').props.onChange({target:{value:'2026-10-18'}});render();
 const changedBefore=changed;const form=nodes(model.tree).find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});await settle();
 assert.equal(oldSignal.aborted,true,'Saving aborts an older background read');assert.equal(mutations,1);assert.equal(changed,changedBefore+1,'Save invalidates parent project data exactly once');assert.match(text(followupCard()),/Updated shared action/);
 pendingRead();await settle();assert.match(text(followupCard()),/Updated shared action/);assert.match(text(followupCard()),/2026-10-18/);
 console.log('PASS followup saves invalidate project data and older background reads cannot overwrite the saved linked action/date');

 props.initialFollowupId='followup';render();await settle();assert.equal(byLabel('下一步').props.value,'Updated shared action');
 const beforeDirtyFocus=reads;byLabel('下一步').props.onChange({target:{value:'Unsaved change'}});render();for(const listener of listeners.get('focus')||[])listener();await settle();assert.equal(reads,beforeDirtyFocus);assert.equal(byLabel('下一步').props.value,'Unsaved change');
 console.log('PASS project deep links open the exact followup, focus never reloads and manual refresh preserves save concurrency guards');
 button('关闭').props.onClick();render();
 source.teams=[{id:'custom',name:'Synthetic custom group',active:true,customerIds:['customer'],salesMemberIds:['sales'],leaderIds:[],serviceMemberIds:[]},{id:'stock',name:'Synthetic stock group',active:true,customerIds:['customer'],salesMemberIds:['sales'],leaderIds:[],serviceMemberIds:[]}];
 source.projects[0].teamId='custom';source.projects[1].teamId='stock';
 source.followups=[row('followup',{canPromote:true,projectId:''})];
 button('刷新跟进').props.onClick();await settle();button('查看 / 更新跟进').props.onClick();render();
 const projectChoices=nodes(byLabel('关联完整项目')).filter(node=>node.type==='option').map(text);
 assert(projectChoices.some(label=>label.includes('Synthetic custom group')&&label.includes('业务：Synthetic sales')));
 assert(projectChoices.some(label=>label.includes('Synthetic stock group')&&label.includes('业务：Synthetic sales')));
 button('创建并关联完整项目').props.onClick();render();assert.equal(byLabel('本项目业务客服组').props.value,'');
 let promoteForm=nodes(model.tree).find(node=>node.type==='form');promoteForm.props.onSubmit({preventDefault(){}});await settle();
 assert.equal(promotions.length,0);assert.match(text(model.tree),/请明确选择本项目所属组/);
 byLabel('本项目业务客服组').props.onChange({target:{value:'stock'}});render();
 promoteForm=nodes(model.tree).find(node=>node.type==='form');promoteForm.props.onSubmit({preventDefault(){}});await settle();
 assert.equal(promotions.at(-1).teamId,'stock');assert.equal(opened,'promoted-followup');assert.equal(openedTeam,'stock','Successful promotion passes the saved group to project navigation');
 source.teams=source.teams.filter(team=>team.id==='custom');
 button('刷新跟进').props.onClick();await settle();button('查看 / 更新跟进').props.onClick();render();button('创建并关联完整项目').props.onClick();render();
 assert.equal(byLabel('本项目业务客服组').props.value,'custom');
 button('取消').props.onClick();render();
 source.teams=[];button('刷新跟进').props.onClick();await settle();button('查看 / 更新跟进').props.onClick();render();button('创建并关联完整项目').props.onClick();render();
 assert.equal(byLabel('本项目业务客服组').props.value,'');assert.equal(byLabel('本项目业务客服组').props.required,false);
 console.log('PASS project choices identify group and sales owner; promotion auto-selects one eligible group, requires explicit choice among several and preserves ungrouped compatibility');

 button('取消').props.onClick();render();
 source={
  followups:[row('other-linked',{ownerId:'other',projectId:'service-project',title:'Synthetic other-owned followup'})],
  projects:[
   {id:'sales-project',customerId:'customer',code:'SYN-SALES',title:'Synthetic sales assignment',salesMemberId:'zero',serviceMemberIds:['zero']},
   {id:'service-project',customerId:'customer',code:'SYN-SERVICE',title:'Synthetic service assignment',salesMemberId:'other',serviceMemberIds:['zero']},
   {id:'task-project',customerId:'customer',code:'SYN-TASK',title:'Synthetic task assignment',salesMemberId:'other',serviceMemberIds:[]},
   {id:'unrelated-project',customerId:'customer',code:'SYN-UNRELATED',title:'Synthetic unrelated project',salesMemberId:'other',serviceMemberIds:[]}
  ],
  projectTasks:[
   {id:'sales-task-1',projectId:'sales-project',source:'project',title:'Synthetic first action',ownerId:'zero',dueDate:'2026-10-16',status:'open'},
   {id:'sales-task-2',projectId:'sales-project',source:'collaboration',title:'Synthetic second action',ownerId:'zero',dueDate:'2026-10-17',status:'open'},
   {id:'task-1',projectId:'task-project',source:'project',title:'Synthetic completed task',ownerId:'zero',dueDate:'2026-10-14',status:'completed'},
   {id:'task-2',projectId:'task-project',source:'collaboration',title:'Synthetic current task',ownerId:'zero',dueDate:'2026-10-18',status:'open'},
   {id:'unrelated-task',projectId:'unrelated-project',source:'project',title:'Synthetic unrelated action',ownerId:'other',dueDate:'2026-10-19',status:'open'}
  ],
  customers:[{id:'customer',customer:'Synthetic customer',active:true}],
  members:[{id:'zero',name:'Synthetic zero'},{id:'other',name:'Synthetic other'}],
  people:[{id:'zero',name:'Synthetic zero'},{id:'other',name:'Synthetic other'}],
  teams:[],canImport:true,mails:[],sourceBundles:[],
  summary:{visibleProjects:4,linkedFollowups:1,linkedProjects:1,unlinkedFollowups:0,unassignedCustomers:0,projectsWithoutFollowups:3}
 };
 const mutationsBeforeScope=mutations;
 button('刷新跟进').props.onClick();await settle();
 assert.match(text(personButton('Synthetic zero')),/跟进记录\s*0\s*条/);
 assert.match(text(personButton('Synthetic zero')),/负责项目\s*3\s*个/,'Sales, service and task responsibility counts projects once, including a project linked to another owner’s followup');
 assert.match(text(personButton('Synthetic other')),/跟进记录\s*1\s*条/);
 assert.match(text(personButton('Synthetic other')),/负责项目\s*3\s*个/);
 assert.match(text(personButton('全部可见')),/跟进记录\s*1\s*条/);
 assert.match(text(personButton('全部可见')),/可见项目\s*4\s*个/);
 assertProjectCount('可见项目',4);
 assert.equal(byTestId('followup-project-count').props.onClick,undefined,'Project count is explanatory, not a followup queue filter');
 assert.equal(unlinkedProjectRows().length,3);

 personButton('Synthetic zero').props.onClick();render();
 assert.equal(byLabel('跟进负责人范围').props.value,'zero');
 assert.equal(personButton('Synthetic zero').props['aria-pressed'],true);
 assert.equal(nodes(model.tree).filter(node=>node.props?.['data-testid']==='followup-card').length,0);
 assertProjectCount('负责项目',3);
 const zeroEmpty=text(nodes(model.tree).find(node=>node.type==='empty'));
 assert.match(zeroEmpty,/Synthetic zero/);
 assert.match(zeroEmpty,/跟进记录/);
 assert.match(zeroEmpty,/3\s*个.*项目|项目.*3\s*个/,'Zero followups must still explain the owner’s assigned projects');
 assert.equal(unlinkedProjectRows().length,2);
 assert.match(text(unlinkedProjectRows()),/SYN-SALES/);
 assert.match(text(unlinkedProjectRows()),/SYN-TASK/);
 assert.doesNotMatch(text(unlinkedProjectRows()),/SYN-UNRELATED|SYN-SERVICE/);

 byLabel('跟进负责人范围').props.onChange({target:{value:'other'}});render();
 assert.equal(personButton('Synthetic other').props['aria-pressed'],true);
 assert.equal(nodes(model.tree).filter(node=>node.props?.['data-testid']==='followup-card').length,1);
 assertProjectCount('负责项目',3);
 assert.equal(unlinkedProjectRows().length,2);
 assert.doesNotMatch(text(unlinkedProjectRows()),/SYN-SALES/);
 personButton('全部可见').props.onClick();render();
 assert.equal(byLabel('跟进负责人范围').props.value,'');
 assertProjectCount('可见项目',4);
 assert.equal(unlinkedProjectRows().length,3);
 assert.equal(mutations,mutationsBeforeScope,'Viewing owner counts must not create followup records');
 console.log('PASS people and summary show followup records separately from deduplicated responsible projects, including zero-record owners and all-visible scope');

}finally{
 pendingRead?.();
 for(const slot of model.slots)slot?.cleanup?.();
 for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
