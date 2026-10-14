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
const model={index:0,slots:[],effects:[],changed:false,tree:null};let changed=0,opened='',reads=0,pendingRead,slowRead=false,signals=[],mutations=0;
const props={meId:'sales',onDirtyChange(){},onBusyChange(){},onDataChanged(){changed++;},onOpenProject:id=>{opened=id;}};
globalThis.__followupLinksRequest=async(action,values,options)=>{
 if(action==='customer-project-followup-data'){reads++;signals.push(options?.signal);if(slowRead){slowRead=false;const snapshot=structuredClone(source);return await new Promise(resolve=>{pendingRead=()=>resolve(snapshot);});}return structuredClone(source);}
 if(action==='customer-project-followup-save'){mutations++;const item={...source.followups.find(row=>row.id===values.id),...values,version:2};source.followups=source.followups.map(row=>row.id===item.id?item:row);return {item};}
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
try{
 render();await settle();
 assert.match(text(byTestId('followup-link-summary')),/2 条跟进：1 条已关联 1 个项目，1 条未关联项目/);
 assert.match(text(byTestId('followup-link-summary')),/全部可见项目 2 个/);
 assert.match(text(followupCard()),/项目另有 1 条未完成待办/);
 const projectSection=nodes(model.tree).find(node=>node.props?.title==='尚未建立客户跟进的项目');assert(projectSection);
 const table=nodes(projectSection).find(node=>node.type==='table');assert.equal(table.props.rows.length,1);assert.match(text(table.props.rows),/Synthetic engineering drawing/);assert.match(text(table.props.rows),/Synthetic engineer/);
 nodes(table.props.rows).find(node=>node.type==='button').props.onClick();assert.equal(opened,'without-followup');assert.equal(mutations,0);
 console.log('PASS followup view explains project/entry counts, includes same-project tasks and exposes projects without inventing followups');

 slowRead=true;for(const listener of [...listeners.get('focus')])listener();render();assert(pendingRead);const oldSignal=signals.at(-1);
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
 const beforeDirtyFocus=reads;byLabel('下一步').props.onChange({target:{value:'Unsaved change'}});render();for(const listener of [...listeners.get('focus')])listener();await settle();assert.equal(reads,beforeDirtyFocus);assert.equal(byLabel('下一步').props.value,'Unsaved change');
 console.log('PASS project deep links open the exact followup and focus refresh preserves unsaved edits');
}finally{
 pendingRead?.();
 for(const slot of model.slots)slot?.cleanup?.();
 for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
