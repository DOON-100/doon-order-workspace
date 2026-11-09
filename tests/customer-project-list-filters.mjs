import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['lib/customer-project-list.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {projectListPendingTasks,projectListOwnerNames,matchesProjectListFilters,projectListFilterValues,projectListExtraFollowers}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const people=[
 {id:'selected',active:true,role:'admin',personnelType:'internal'},
 {id:'unselected',active:true,role:'clerk',personnelType:'internal'},
 {id:'inactive',active:false,role:'clerk'},
 {id:'external',active:true,role:'viewer',personnelType:'external'},
 {id:'supplier',active:true,role:'supplier'}
];
for(const invalid of ['', 'null','{}','"selected"','[1]','["selected","bad id"]'])assert.deepEqual(projectListExtraFollowers(people,invalid),[]);
assert.deepEqual(projectListExtraFollowers(people,'[]'),[],'No configuration must not expand to all employees');
assert.deepEqual(projectListExtraFollowers(people,'["selected","selected","missing","inactive","external","supplier"]'),[people[0]],'Only the explicitly named valid internal member is added');
assert.deepEqual(projectListExtraFollowers(people.filter(person=>person.id!=='selected'),'["selected"]'),[],'Configuration cannot expose a member absent from the authorized response');
const names={first:'Synthetic first follower',later:'Synthetic later follower',former:'Synthetic former follower'};
const tasks=[
 {id:'later',projectId:'project-a',ownerId:'later',dueDate:'2026-11-09',status:'open'},
 {id:'first',projectId:'project-a',ownerId:'first',dueDate:'2026-11-06',status:'service_review'},
 {id:'same-owner',projectId:'project-a',ownerId:'later',status:'waiting_customer'},
 {id:'done',projectId:'project-a',ownerId:'former',dueDate:'2026-11-01',status:'done'},
 {id:'completed',projectId:'project-a',ownerId:'former',status:'completed'},
 {id:'cancelled',projectId:'project-a',ownerId:'former',status:'cancelled'},
 {id:'other-project',projectId:'project-b',ownerId:'former',status:'open'}
];
const original=JSON.stringify(tasks),pending=projectListPendingTasks(tasks,'project-a');
assert.deepEqual(pending.map(task=>task.id),['first','later','same-owner']);
assert.equal(JSON.stringify(tasks),original,'Reading and sorting never edits task records');
const ownerNames=projectListOwnerNames(pending,id=>names[id]);
assert.deepEqual(ownerNames,[names.first,names.later],'All unfinished task owners are shown once, including a later task');
assert.deepEqual(projectListOwnerNames([],id=>names[id]),['尚未安排下一步']);
assert.deepEqual(projectListOwnerNames([{ownerId:'first'},{}],id=>names[id]),[names.first,'待指派']);

const row=(id,owners,customer='Synthetic customer',dueDate='2026-11-06')=>({id,ownerNames:owners,values:[customer,id,'Original progress','Earliest task',owners.join('、'),dueDate,'Synthetic team','开发中','Synthetic sales','Synthetic service','记录 / 指派']});
const rows=[row('project-a',ownerNames),row('project-b',[names.former]),row('empty',['待指定'])];
const match=filters=>rows.filter(item=>matchesProjectListFilters(item,filters)).map(item=>item.id);
assert.deepEqual(match({4:[names.later]}),['project-a'],'An owner on a non-earliest task is independently selectable');
assert.deepEqual(match({4:[names.first,names.former]}),['project-a','project-b'],'Same-column choices use OR');
assert.deepEqual(match({4:[]}),[],'Selecting no people matches nothing');
assert.deepEqual(match({4:['Synthetic candidate without tasks']}),[],'Candidate selection does not fabricate assignments');
assert.deepEqual(match({4:['待指定']}),['empty']);
assert.deepEqual(match({4:{kind:'text',operator:'equals',value:names.later}}),['project-a']);
assert.deepEqual(match({4:{kind:'text',operator:'contains',value:'later'}}),['project-a']);
assert.deepEqual(match({4:{kind:'text',operator:'notContains',value:'later'}}),['project-b','empty'],'Excluding a person cannot match another owner on the same project');
assert.deepEqual(match({4:{kind:'text',operator:'notEquals',value:names.later}}),['project-b','empty']);
assert.deepEqual(match({4:[names.later],0:['Another customer']}),[],'Different columns use AND');
assert.deepEqual(match({4:[names.later],5:{kind:'date',operator:'between',value:'2026-11-05',to:'2026-11-07'},2:{kind:'text',operator:'contains',value:'progress'}}),['project-a'],'Dates and text conditions remain available alongside people');
assert.deepEqual(match({4:[names.later],5:{kind:'date',operator:'after',value:'2026-11-07'}}),[]);
assert.deepEqual(match({}),['project-a','project-b','empty'],'Clearing all conditions restores the authorized list');

const candidates=[names.first,names.later,'Synthetic candidate without tasks'];
const options=projectListFilterValues(rows,4,candidates);
assert(options.includes('Synthetic candidate without tasks'));
assert(options.includes(names.former),'Historical assignees remain selectable without becoming assignable candidates');
assert(options.includes('待指定'));
assert(!options.includes(names.first+'、'+names.later),'People appear individually, never as combined-name options');
assert.equal(options.filter(value=>value===names.later).length,1);
assert(!options.includes('Synthetic unauthorized person'),'Only supplied authorized candidates and rows contribute options');
assert.deepEqual(projectListFilterValues(rows,0,candidates),['Synthetic customer'],'Candidate people do not enter other columns');
assert.deepEqual(projectListFilterValues([],4,['Synthetic candidate without tasks']),['Synthetic candidate without tasks'],'Candidates can be filtered even in an empty list');
const manyRows=Array.from({length:160},(_,index)=>row('synthetic-'+index,[index===159?names.later:names.first]));
assert.deepEqual(manyRows.filter(item=>matchesProjectListFilters(item,{4:[names.later]})).slice(0,20).map(item=>item.id),['synthetic-159'],'Filtering the complete input precedes any page slice');

// Exercise the real list state and CPTable prop forwarding with synthetic records.
const stubs={
 react:`export const Fragment='fragment';export const useMemo=fn=>fn();export const useCallback=fn=>fn;export const useEffect=()=>{};export const useRef=value=>({current:value});export function useState(initial){const h=globalThis.__projectListFilterHooks,i=h.index++;if(!(i in h.slots))h.slots[i]=typeof initial==='function'?initial():initial;return [h.slots[i],value=>{h.slots[i]=typeof value==='function'?value(h.slots[i]):value;}];}`,
 'react/jsx-runtime':`export const Fragment='fragment';export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`,
 'lucide-react':`export const Save='icon',X='icon';`,
 button:`export const Button='button';`,
 'business-followup-panel':`export function BusinessFollowupSlot(){return null;}`,
 'excel-table':`export const ExcelTable='excel-table';`,
 'customer-project-search-select':`export const CPSearchSelect='search-select';`,
 css:''
};
const uiBundle=await build({entryPoints:['app/simple-customer-projects.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'project-list-filter-ui',setup(b){b.onResolve({filter:/.*/},args=>{const key=args.path.endsWith('.css')?'css':args.path.split('/').at(-1);const target=Object.hasOwn(stubs,args.path)?args.path:key;return Object.hasOwn(stubs,target)?{path:target,namespace:'test'}:undefined;});b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:stubs[args.path]}));}}]});
const {SimpleCustomerProjects}=await import('data:text/javascript;base64,'+Buffer.from(uiBundle.outputFiles[0].text).toString('base64'));
const originalHooks=Object.getOwnPropertyDescriptor(globalThis,'__projectListFilterHooks');
const hooks={index:0,slots:[]};
let assignedProject='';
const props={onAssign:id=>{assignedProject=id;},projects:[{salesMemberId:'first',serviceMemberIds:['first','later'],canAssignCollaboration:true,id:'project-a',customerId:'customer-a',title:'Synthetic A',code:'SYN-A',teamId:'team-a'},{id:'project-b',customerId:'customer-b',title:'Synthetic B',code:'SYN-B',teamId:'team-a'}],tasks,communications:[],teams:[{id:'team-a',name:'Synthetic team'}],followupMembers:candidates.map((name,index)=>({id:'candidate-'+index,name})),customerName:id=>id,memberName:id=>names[id],statusFor:()=>'进行中',onOpen(){},busy:false};
function find(node,predicate){if(!node)return;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return;}if(typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate);}}
function render(){globalThis.__projectListFilterHooks=hooks;hooks.index=0;const tree=SimpleCustomerProjects(props);const table=find(tree,node=>node.type?.name==='CPTable');assert(table);const forwarded=find(table.type(table.props),node=>node.type==='excel-table');assert.equal(forwarded.props.filterModel,table.props.filterModel,'CPTable forwards the same model to the shared Excel controls');return table.props;}
try{
 let table=render();
 assert.equal(table.rows.length,2);
 assert(!table.headers.includes('负责部门')&&!table.headers.includes('项目状态'),'The two removed columns must not remain in the list or its filter controls');
 assert.equal(table.headers.length,11);
 assert.equal(table.rows[0][9],names.first+'、'+names.later);
 assert(table.filterModel.values(9).includes(names.later));
 table.filterModel.setFilter(9,[names.later]);table=render();assert.equal(table.rows.length,1);
 table.filterModel.clearFilters();table=render();
 find(table.rows[0][10],node=>node.type==='button'&&node.props.children==='指派待办').props.onClick();assert.equal(assignedProject,'project-a');
 assert.equal(table.rows[0][4],names.first+'、'+names.later,'The visible cell includes the later task owner');
 assert.equal(table.filterModel.total,2);
 assert(table.filterModel.values(4).includes('Synthetic candidate without tasks'));
 table.filterModel.setFilter(4,[names.later]);table=render();
 assert.equal(table.rows.length,1);assert.equal(table.rows[0][0],'customer-a');assert.equal(table.filterModel.total,2);
 table.filterModel.setFilter(0,['customer-b']);table=render();assert.equal(table.rows.length,0);
 table.filterModel.setFilter(0,null);table=render();assert.equal(table.rows.length,1);
 table.filterModel.setFilter(4,['Synthetic candidate without tasks']);table=render();assert.equal(table.rows.length,0);
 assert(table.filterModel.values(4).includes(names.later),'Filter options stay based on the complete authorized input');
 table.filterModel.clearFilters();table=render();assert.equal(table.rows.length,2);
 assert.equal(JSON.stringify(tasks),original);
 props.tasks=[];table=render();assert.equal(table.rows[0][4],'尚未安排下一步');assert.equal(table.rows[0][9],names.first+'、'+names.later,'Project responsibility survives an empty task list');
}finally{
 if(originalHooks)Object.defineProperty(globalThis,'__projectListFilterHooks',originalHooks);else delete globalThis.__projectListFilterHooks;
}
console.log('PASS customer project list filters: all unfinished owners, candidate-only options, combined conditions, late rows, and source preservation');
