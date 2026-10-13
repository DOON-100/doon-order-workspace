// Exercise the real project panel's recycle-bin navigation and requests using synthetic data.
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const react=`
export function useState(initial){const H=globalThis.__trashFrame,i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,value=>{const next=typeof value==='function'?value(H.slots[i].value):value;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}
export function useRef(value){const H=globalThis.__trashFrame,i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}
export function useEffect(fn,deps){const H=globalThis.__trashFrame,i=H.index++,old=H.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}
export function useMemo(fn,deps){const H=globalThis.__trashFrame,i=H.index++,old=H.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))H.slots[i]={deps,value:fn()};return H.slots[i].value;}
export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`;
const stubs={
 react,
 'react/jsx-runtime':`export const Fragment='fragment';export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`,
 'lucide-react':`export const ArrowLeft='icon',ArrowRight='icon',Plus='icon',RefreshCw='icon',RotateCcw='icon',Search='icon',Trash2='icon',Users='icon',Save='icon',X='icon';`,
 button:`export const Button='button';`,
 'client-id':`let n=0;export const clientId=()=>'synthetic-token-'+(++n);`,
 ui:`export const request=(...args)=>globalThis.__trashRequest(...args);export const dateTime=value=>value||'—';`,
 'business-team-context':`export const useBusinessTeamScope=()=>globalThis.__trashBusinessTeam||null;`,
 'customer-project-entry-forms':`export const customerProjectEntryForms=()=>({});`,
 'customer-project-search-select':`export const CPSearchSelect='search-select';`,
 'customer-early-development':`export function CustomerEarlyDevelopment(){}`,
 'customer-project-finance-panel':`export function CustomerProjectFinancePanel(){}`,
 'customer-project-followup-panel':`export function CustomerProjectFollowupPanel(){}`,
 'customer-project-task-board':`export function CustomerProjectTaskBoard(){}export function CustomerProjectTaskTable(){}`,
 'customer-project-attachment-upload':`export function CustomerProjectAttachmentUpload(){}`,
 'customer-project-attachment-preview':`export function CustomerProjectAttachmentPreviewGallery(){}`,
 css:''
};
const bundled=await build({entryPoints:['app/customer-project-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'synthetic-project-panel',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.endsWith('.css')?'css':a.path.endsWith('/button')?'button':Object.hasOwn(stubs,a.path)?a.path:a.path.split('/').at(-1);return Object.hasOwn(stubs,key)?{path:key,namespace:'synthetic'}:undefined;});b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:stubs[a.path]}));}}]});
const {CustomerProjectPanel}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const originals=new Map(['window','requestAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let confirmations=0,allowLeave=true;
globalThis.window={addEventListener(){},removeEventListener(){},confirm(){confirmations++;return allowLeave;}};
globalThis.requestAnimationFrame=fn=>{fn();return 0;};
function nodes(node,result=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,result));else if(node&&typeof node==='object'&&node.type){result.push(node);for(const key of ['children','rows','actions'])nodes(node.props?.[key],result);}return result;}
function text(node){return node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);}
function render(model){for(let i=0;i<20;i++){globalThis.__trashFrame=model;model.index=0;model.changed=false;model.tree=CustomerProjectPanel(model.props);for(const effect of model.effects.splice(0))effect();if(!model.changed)return model;}throw Error('Render did not settle');}
const button=(model,label)=>nodes(model.tree).find(node=>node.type==='button'&&text(node)===label);
const testId=(model,id)=>nodes(model.tree).find(node=>node.props?.['data-testid']===id);
const form=model=>nodes(model.tree).find(node=>node.type?.name==='CPFormDialog');
const sections=model=>nodes(model.tree).filter(node=>node.type?.name==='CPSection');
const tableFor=(model,title)=>nodes(sections(model).find(node=>node.props.title===title)).find(node=>node.type?.name==='CPTable');
function unmount(model){for(const slot of model.slots)slot?.cleanup?.();}
async function settle(model){for(let i=0;i<12;i++){await Promise.resolve();render(model);}return model;}
const project={id:'project-synthetic',version:3,customerId:'customer-synthetic',code:'SYN-001',title:'Synthetic project',status:'paused',teamId:'team-synthetic',canWrite:true,canManageAssignments:true};
const customer={id:'customer-synthetic',customer:'Synthetic customer',customerCode:'SYN',active:true,canWrite:true};
const base={projects:[project],trashedProjects:[],customers:[customer],teams:[{id:'team-synthetic',name:'Synthetic team',active:true}],tasks:[{id:'task-synthetic',projectId:project.id,status:'open',title:'Synthetic task',dueDate:'2099-01-01'}],rounds:[],samples:[]};
let source,requests=[],mutationFailure='',refreshFailure=false,financeRefreshFailure=false,mutationGate;
globalThis.__trashRequest=async(action,values)=>{
 requests.push({action,values});
 if(action==='customer-project-data'){if(refreshFailure)throw new Error('Synthetic refresh failed');return structuredClone(source);}
 if(action==='project-finance-data'){if(financeRefreshFailure)throw new Error('Synthetic finance refresh failed');return {projects:source.projects,customers:source.customers,rounds:source.rounds};}
 if(mutationGate)await mutationGate;
 if(mutationFailure)throw new Error(mutationFailure);
 if(action==='customer-project-trash'){const row=source.projects.find(p=>p.id===values.id);const trashed={...row,version:row.version+1,trashedBy:'Synthetic admin',trashedAt:'2026-10-13T09:30:00.000Z',trashReason:values.reason};source={...source,projects:[],trashedProjects:[trashed],tasks:[]};return {item:trashed};}
 if(action==='customer-project-restore'){const row=source.trashedProjects.find(p=>p.id===values.id);const restored={...row,version:row.version+1,trashedAt:undefined};source={...source,projects:[restored],trashedProjects:[],tasks:base.tasks};return {item:restored};}
 throw new Error('Unexpected request '+action);
};
function mount(data=base){source=structuredClone(data);requests=[];mutationFailure='';refreshFailure=false;financeRefreshFailure=false;mutationGate=undefined;allowLeave=true;confirmations=0;return render({props:{data:{members:[{id:'admin-synthetic',name:'Synthetic admin',active:true}],me:{id:'admin-synthetic',role:'admin'},orders:[]},openOrder(){}},slots:[],effects:[],index:0,tree:null});}

let model;
try{
 model=mount();await settle(model);
 assert.equal(text(testId(model,'customer-project-trash-nav')),'回收站 0');
 assert.ok(button(model,'移入回收站'));
 button(model,'移入回收站').props.onClick();render(model);
 let dialog=form(model),spec=dialog.props.form;
 assert.equal(spec.action,'customer-project-trash');assert.equal(spec.fields[0].required,true);assert.ok(spec.description.includes('可在回收站恢复'));
 assert.throws(()=>spec.build({...spec.initial,reason:'   '}),/请填写移入原因/);
 assert.equal(requests.some(r=>r.action==='customer-project-trash'),false);
 let releaseMutation;mutationGate=new Promise(resolve=>{releaseMutation=resolve;});
 mutationFailure='Synthetic authorization/version conflict';
 dialog.props.onSubmit({...spec.initial,reason:'Duplicate synthetic record',title:'Unrelated unsaved title'});render(model);
 assert.equal(form(model).props.busy,true);assert.equal(testId(model,'customer-project-trash-nav').props.disabled,true);
 form(model).props.onClose();render(model);assert.ok(form(model));
 form(model).props.onSubmit({...spec.initial,reason:'Repeated click'});assert.equal(requests.filter(r=>r.action==='customer-project-trash').length,1);
 releaseMutation();mutationGate=undefined;await settle(model);
 assert.ok(form(model));assert.equal(form(model).props.error,mutationFailure);
 const firstWrite=requests.find(r=>r.action==='customer-project-trash');
 assert.deepEqual(Object.keys(firstWrite.values).sort(),['id','reason','token','version']);assert.equal(firstWrite.values.version,3);
 mutationFailure='';form(model).props.onSubmit({...spec.initial,reason:'Duplicate synthetic record'});await settle(model);
 assert.equal(form(model),undefined);assert.equal(text(testId(model,'customer-project-trash-nav')),'回收站 1');assert.equal(tableFor(model,'客户项目清单').props.rows.length,0);
 assert.ok(nodes(model.tree).some(node=>node.props?.role==='status'&&text(node).includes('已移入回收站')));
 assert.ok(requests.filter(r=>r.action==='project-finance-data').length>=2);
 console.log('PASS recycle requires reason, sends only dedicated versioned payload, preserves failed form and refreshes normal/financial lists after success');

 testId(model,'customer-project-trash-nav').props.onClick();render(model);
 assert.ok(testId(model,'customer-project-trash-view'));assert.equal(testId(model,'customer-project-list-nav').props['aria-current'],undefined);
 const trashTable=tableFor(model,'项目回收站');
 assert.equal(trashTable.props.rows.length,1);assert.ok(text(trashTable.props.rows).includes('暂停'));assert.ok(text(trashTable.props.rows).includes('Synthetic admin'));assert.ok(text(trashTable.props.rows).includes('Duplicate synthetic record'));
 button(model,'恢复项目').props.onClick();render(model);dialog=form(model);spec=dialog.props.form;
 assert.equal(spec.action,'customer-project-restore');assert.equal(spec.initial.version,4);assert.ok(spec.description.includes('原状态为“暂停”'));
 dialog.props.onSubmit({...spec.initial,reason:'Unrelated value'});await settle(model);
 assert.equal(testId(model,'customer-project-trash-view'),undefined);assert.equal(tableFor(model,'客户项目清单').props.rows.length,1);assert.equal(source.projects[0].status,'paused');assert.equal(text(testId(model,'customer-project-trash-nav')),'回收站 0');
 assert.deepEqual(Object.keys(requests.find(r=>r.action==='customer-project-restore').values).sort(),['id','token','version']);
 console.log('PASS recycle list shows retained status, actor, reason and timestamp; confirmed restore returns to the normal list without editing project status');
 unmount(model);

 model=mount({...base,projects:[{...project,canManageAssignments:false}],trashedProjects:[{...project,id:'trashed-readonly',canManageAssignments:false,trashedAt:'2026-10-13T09:30:00Z'}]});await settle(model);
 assert.equal(button(model,'移入回收站'),undefined);testId(model,'customer-project-trash-nav').props.onClick();render(model);assert.equal(button(model,'恢复项目'),undefined);
 testId(model,'customer-project-list-nav').props.onClick();render(model);button(model,'打开项目').props.onClick();render(model);assert.equal(button(model,'移入回收站'),undefined);
 console.log('PASS assignment permission gates recycle/restore in both list and detail while preserving read-only visibility');
 unmount(model);

 model=mount();await settle(model);button(model,'打开项目').props.onClick();render(model);
 assert.ok(button(model,'移入回收站'));
 const development=nodes(model.tree).find(node=>node.type?.name==='CustomerEarlyDevelopment');development.props.onDirtyChange(true);render(model);
 allowLeave=false;button(model,'移入回收站').props.onClick();render(model);assert.equal(form(model),undefined);assert.equal(confirmations,1);
 allowLeave=true;button(model,'移入回收站').props.onClick();render(model);dialog=form(model);assert.ok(dialog);assert.equal(requests.some(r=>r.action==='customer-project-save'),false);
 refreshFailure=true;financeRefreshFailure=true;dialog.props.onSubmit({...dialog.props.form.initial,reason:'Synthetic obsolete project'});await settle(model);
 assert.equal(form(model),undefined);assert.equal(tableFor(model,'客户项目清单').props.rows.length,0);assert.ok(testId(model,'customer-project-load-error'));assert.equal(nodes(model.tree).some(node=>node.type?.name==='CustomerEarlyDevelopment'),false);
 assert.equal(requests.some(r=>r.action==='customer-project-save'),false);
 button(model,'项目财务').props.onClick();render(model);assert.equal(tableFor(model,'授权客户项目财务').props.rows.length,0);
 console.log('PASS detail recycle respects unsaved-edit guard, never saves unrelated edits and clears stale detail/normal/finance lists even when both refreshes fail');
 unmount(model);

 globalThis.__trashBusinessTeam={teamId:'team-synthetic'};
 model=mount({...base,trashedProjects:[{...project,id:'trashed-scoped',trashedAt:'2026-10-13T09:30:00Z'}]});await settle(model);
 assert.equal(text(testId(model,'customer-project-trash-nav')),'回收站 1');testId(model,'customer-project-trash-nav').props.onClick();render(model);
 assert.equal(tableFor(model,'项目回收站').props.rows.length,1);assert.equal(nodes(model.tree).some(node=>node.props?.['aria-label']==='筛选回收站业务客服组'),false);
 button(model,'恢复项目').props.onClick();render(model);dialog=form(model);dialog.props.onSubmit(dialog.props.form.initial);await settle(model);
 assert.equal(testId(model,'customer-project-list-nav').props['aria-current'],'page');assert.equal(nodes(model.tree).find(node=>node.props?.['aria-label']==='搜索客户项目').props.value,'');
 assert.equal(nodes(model.tree).some(node=>node.props?.['aria-label']==='筛选业务客服组'),false);
 console.log('PASS unified group scope drives the recycle count and rows; restore returns to unfiltered normal list within the same group');
}finally{if(model)unmount(model);for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}delete globalThis.__trashFrame;delete globalThis.__trashRequest;delete globalThis.__trashBusinessTeam;}
