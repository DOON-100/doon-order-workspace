// Exercise the real project list and table using synthetic, permission-scoped data.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const react=`
export function useState(initial){const H=globalThis.__projectFilterFrame,i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,value=>{const next=typeof value==='function'?value(H.slots[i].value):value;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}
export function useRef(value){const H=globalThis.__projectFilterFrame,i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}
export function useEffect(fn,deps){const H=globalThis.__projectFilterFrame,i=H.index++,old=H.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}
export function useMemo(fn,deps){const H=globalThis.__projectFilterFrame,i=H.index++,old=H.slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))H.slots[i]={deps,value:fn()};return H.slots[i].value;}
export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`;
const stubs={
 react,
 'react/jsx-runtime':`export const Fragment='fragment';export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`,
 'lucide-react':`export const ArrowLeft='icon',ArrowRight='icon',Plus='icon',RefreshCw='icon',RotateCcw='icon',Search='icon',Trash2='icon',Users='icon',Save='icon',X='icon';`,
 button:`export const Button='button';`,
 'client-id':`let n=0;export const clientId=()=>'synthetic-filter-token-'+(++n);`,
 ui:`export const request=(...args)=>globalThis.__projectFilterRequest(...args);export const dateTime=value=>value||'—';`,
 'business-team-context':`export const useBusinessTeamScope=()=>globalThis.__projectFilterBusinessTeam||null;`,
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
const labels=['筛选项目客户','筛选项目名称或编号','创建开始日期','创建结束日期','筛选项目业务','筛选项目客服','筛选项目状态','筛选开发轮次数','筛选款色数量','筛选下一行动','筛选行动负责人','筛选行动期限','搜索下一行动'];
const members=[
 {id:'admin-filter',name:'Synthetic admin',active:true},
 {id:'sales-a',name:'Synthetic sales A',active:true},
 {id:'sales-b',name:'Synthetic sales B',active:true},
 {id:'service-a',name:'Synthetic service A',active:true},
 {id:'service-b',name:'Synthetic service B',active:true},
 {id:'historical-member',name:'Synthetic former member',active:false},
 {id:'owner-a',name:'Synthetic action owner A',active:true},
 {id:'owner-b',name:'Synthetic action owner B',active:true}
];
const makeProject=(letter,overrides={})=>({id:'project-'+letter,code:'FLT-'+letter,title:'Synthetic '+letter+' project',customerId:'customer-a',teamId:'team-a',status:'active',version:1,canWrite:true,canManageAssignments:false,...overrides});
const fixture={
 projects:[
  makeProject('A',{title:'Amber frame',createdAt:'2026-10-12T16:00:00Z',salesMemberId:'sales-a',serviceMemberIds:['service-a','service-b']}),
  makeProject('B',{createdAt:'2026-10-13T15:59:59Z',salesMemberId:'sales-a',serviceMemberId:'service-b'}),
  makeProject('C',{customerId:'customer-b',teamId:'team-b',createdAt:'2026-10-12T15:59:59Z',salesMemberId:'sales-b',serviceMemberIds:[],serviceMemberId:'service-b'}),
  makeProject('D',{customerId:'customer-b',teamId:'team-b',status:'paused',createdAt:'2026-10-13T16:00:00Z',salesMemberId:'sales-b',serviceMemberIds:['service-a']}),
  makeProject('E',{status:'cancelled',createdAt:'',serviceMemberIds:[]}),
  makeProject('F',{customerId:'customer-b',teamId:'team-b',status:'archived',createdAt:'invalid-date',salesMemberId:'historical-member',serviceMemberIds:['historical-member']}),
  makeProject('G',{title:'Amber variant',createdAt:'2026-10-13T04:00:00Z',salesMemberId:'sales-a',serviceMemberIds:['service-b']}),
  makeProject('H',{createdAt:'2026-10-13T04:00:00Z',serviceMemberIds:[]})
 ],
 customers:[{id:'customer-a',customerCode:'SYNCA',customer:'Synthetic Alpha customer',active:true,canWrite:true},{id:'customer-b',customerCode:'SYNCB',customer:'Synthetic Beta customer',active:true,canWrite:true}],
 teams:[{id:'team-a',name:'Synthetic team A',active:true},{id:'team-b',name:'Synthetic team B',active:true}],
 trashedProjects:[makeProject('TRASH',{trashedAt:'2026-10-13T01:00:00Z',trashReason:'Synthetic deleted record'})],
 rounds:[
  {id:'round-a',projectId:'project-A',status:'open'},
  {id:'round-b',projectId:'project-B',status:'transferred'},
  {id:'round-d1',projectId:'project-D',status:'open'},
  {id:'round-d2',projectId:'project-D',status:'transferred'},
  {id:'round-f',projectId:'project-F',status:'transferred'},
  {id:'round-g1',projectId:'project-G',status:'partial'},
  {id:'round-g2',projectId:'project-G',status:'open'}
 ],
 items:[
  {id:'item-a1',projectId:'project-A',model:'SYN-MODEL-SEARCH'},
  {id:'item-a2',projectId:'project-A',color:'Synthetic red'},
  {id:'item-b',projectId:'project-B'},
  {id:'item-d1',projectId:'project-D'},{id:'item-d2',projectId:'project-D'},{id:'item-d3',projectId:'project-D'},
  {id:'item-g1',projectId:'project-G'},{id:'item-g2',projectId:'project-G'},
  {id:'item-h',projectId:'project-H'}
 ],
 communications:[{id:'communication-b',projectId:'project-B',content:'Synthetic communication keyword'}],
 // Deliberately unsorted; completed/cancelled tasks and later actions must not win.
 tasks:[
  {id:'task-a-undated',projectId:'project-A',title:'Unscheduled later keyword',status:'open',ownerId:'owner-b'},
  {id:'task-a-done',projectId:'project-A',title:'Completed hidden keyword',status:'done',dueDate:'2026-10-01',ownerId:'owner-b'},
  {id:'task-a-cancelled',projectId:'project-A',title:'Cancelled hidden keyword',status:'cancelled',dueDate:'2026-10-02',ownerId:'owner-b'},
  {id:'task-a-later',projectId:'project-A',title:'Later customer reminder',status:'open',dueDate:'2026-10-13',ownerId:'owner-b',waitingFor:'customer'},
  {id:'task-a-next',projectId:'project-A',title:'Review amber drawing',status:'service_review',dueDate:'2026-10-12',ownerId:'owner-a'},
  {id:'task-b-next',projectId:'project-B',title:'Confirm blue drawing',status:'open',dueDate:'2026-10-13',ownerId:'owner-b'},
  {id:'task-d-next',projectId:'project-D',title:'Prepare future sample',status:'returned',dueDate:'2026-10-14',ownerId:'owner-a'},
  {id:'task-e-next',projectId:'project-E',title:'Undated assignment',status:'open'},
  {id:'task-g-next',projectId:'project-G',title:'Prepare green sample',status:'open',dueDate:'2026-10-15',ownerId:'owner-b'},
  {id:'task-h-done',projectId:'project-H',title:'Finished only action',status:'done',dueDate:'2026-10-13',ownerId:'owner-a'}
 ],
 samples:[]
};

function nodes(node,result=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,result));else if(node&&typeof node==='object'&&node.type){result.push(node);for(const key of ['children','rows','actions','filters'])nodes(node.props?.[key],result);}return result;}
function text(node){return node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);}
const tableFor=model=>{const section=nodes(model.tree).find(node=>node.type?.name==='CPSection'&&node.props.title==='客户项目清单');const table=nodes(section).find(node=>node.type?.name==='CPTable');assert.ok(table,'Customer project table is present');return table;};
const control=(model,label)=>{const matches=nodes(model.tree).filter(node=>node.props?.['aria-label']===label);assert.equal(matches.length,1,'Exactly one control: '+label);return matches[0];};
const button=(model,label)=>{const found=nodes(model.tree).find(node=>node.type==='button'&&text(node)===label);assert.ok(found,'Button is present: '+label);return found;};
const testId=(model,id)=>{const found=nodes(model.tree).find(node=>node.props?.['data-testid']===id);assert.ok(found,'Test target is present: '+id);return found;};
const codes=model=>tableFor(model).props.rows.map(row=>text(row[0]).match(/FLT-[A-Z]+/)?.[0]);
const expectCodes=(model,letters,message)=>assert.deepEqual(codes(model),letters.map(letter=>'FLT-'+letter),message);
const optionValues=(model,label)=>nodes(control(model,label)).filter(node=>node.type==='option').map(node=>String(node.props.value));
const unmount=model=>{for(const slot of model.slots)slot?.cleanup?.();};

export async function runCustomerProjectListFiltersUiTests(){
 const bundled=await build({entryPoints:['app/customer-project-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'synthetic-project-list-filters',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.endsWith('.css')?'css':a.path.endsWith('/button')?'button':Object.hasOwn(stubs,a.path)?a.path:a.path.split('/').at(-1);return Object.hasOwn(stubs,key)?{path:key,namespace:'synthetic-filter'}:undefined;});b.onLoad({filter:/.*/,namespace:'synthetic-filter'},a=>({contents:stubs[a.path]}));}}]});
 const {CustomerProjectPanel}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const globalKeys=['window','requestAnimationFrame','Date','__projectFilterFrame','__projectFilterRequest','__projectFilterBusinessTeam'];
 const originals=new Map(globalKeys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const NativeDate=globalThis.Date;
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-13T04:00:00Z']));}static now(){return new NativeDate('2026-10-13T04:00:00Z').getTime();}};
 globalThis.window={addEventListener(){},removeEventListener(){},confirm(){return true;}};
 globalThis.requestAnimationFrame=fn=>{fn();return 0;};
 let source,model,requests=[],checks=[];
 const pass=description=>{checks.push(description);console.log('PASS '+description);};
 const render=model=>{for(let i=0;i<20;i++){globalThis.__projectFilterFrame=model;model.index=0;model.changed=false;model.tree=CustomerProjectPanel(model.props);for(const effect of model.effects.splice(0))effect();if(!model.changed)return model;}throw Error('Synthetic filter render did not settle');};
 const settle=async model=>{for(let i=0;i<12;i++){await Promise.resolve();render(model);}return model;};
 const change=(label,value)=>{control(model,label).props.onChange({target:{value}});render(model);};
 const clear=()=>{button(model,'清空筛选').props.onClick();render(model);};
 const metric=label=>{const found=nodes(model.tree).find(node=>node.type==='button'&&text(node).startsWith(label));assert.ok(found,'Queue button: '+label);found.props.onClick();render(model);};
 globalThis.__projectFilterRequest=async(action,values)=>{
  requests.push({action,values});
  if(action==='customer-project-data')return structuredClone(source);
  if(action==='project-finance-data')return {projects:[makeProject('FINANCE',{customerId:'finance-only'})],customers:[{id:'finance-only',customer:'Synthetic finance-only customer'}],rounds:[]};
  throw Error('Filters must not send a mutation: '+action);
 };
 const mount=async(data=fixture,scope=null)=>{
  if(model)unmount(model);
  source=structuredClone(data);requests=[];globalThis.__projectFilterBusinessTeam=scope;
  model=render({props:{data:{members,me:{id:'admin-filter',role:'admin'},orders:[]},openOrder(){}},slots:[],effects:[],index:0,tree:null});
  await settle(model);
 };
 try{
  await mount();
  expectCodes(model,['A','B','C','D','E','F','G','H']);
  assert.equal(button(model,'清空筛选').props.disabled,true);
  const table=tableFor(model);
  assert.equal(table.props.filters.length,table.props.headers.length);
  const renderedTable=table.type(table.props),thead=nodes(renderedTable).find(node=>node.type==='thead');
  assert.equal(nodes(thead).filter(node=>node.type==='tr').length,2,'Filters occupy the second table-header row');
  for(const label of labels)assert.equal(nodes(thead).filter(node=>node.props?.['aria-label']===label).length,1,label+' is in the header');
  const plainTable=table.type({...table.props,filters:undefined});
  assert.equal(nodes(nodes(plainTable).find(node=>node.type==='thead')).filter(node=>node.type==='tr').length,1,'Tables without filters retain one header row');
  pass('project list exposes every data-column filter in a second header row without changing ordinary tables');

  change('筛选项目客户','customer-a');change('筛选项目名称或编号','  aMbEr  ');change('筛选项目业务','sales-a');change('筛选项目客服','service-b');change('筛选项目状态','前期跟进中');change('筛选开发轮次数','1');change('筛选款色数量','2');change('筛选下一行动','has');change('筛选行动负责人','owner-a');change('筛选行动期限','overdue');change('搜索下一行动','  AMBER  ');
  expectCodes(model,['A'],'All column filters combine with AND');
  change('筛选项目客服','historical-member');expectCodes(model,[],'A contradictory column cannot be ignored');
  assert.ok(optionValues(model,'筛选项目客服').includes('service-b'),'Filter choices stay stable with no matching rows');
  clear();change('筛选项目名称或编号','  flt-b  ');expectCodes(model,['B']);
  change('筛选项目名称或编号','SYNCA');expectCodes(model,[],'Project-column text does not search customer fields');
  clear();change('搜索客户项目','  syncb  ');expectCodes(model,['C','D','F'],'Global search includes customer codes');
  change('搜索客户项目','syn-model-search');expectCodes(model,['A'],'Existing item search is preserved');
  change('搜索客户项目','communication keyword');expectCodes(model,['B'],'Existing communication search is preserved');
  clear();pass('column filters combine, choices stay stable, and project text stays distinct from broad customer/item/communication search');

  change('创建开始日期','2026-10-13');change('创建结束日期','2026-10-13');
  expectCodes(model,['A','B','G','H'],'Shanghai midnight and end-of-day are both included');
  change('创建开始日期','');expectCodes(model,['A','B','C','G','H'],'End-only range includes earlier dates but excludes missing/invalid dates');
  change('创建开始日期','2026-10-13');change('创建结束日期','');expectCodes(model,['A','B','D','G','H'],'Start-only range excludes missing/invalid dates');
  change('创建开始日期','2026-10-14');change('创建结束日期','2026-10-13');expectCodes(model,[],'Reversed range never silently swaps its endpoints');
  assert.ok(nodes(model.tree).some(node=>['alert','status'].includes(node.props?.role)&&/开始|起始/.test(text(node))&&/结束|截止/.test(text(node))),'Reversed range has an accessible explanatory message');
  clear();expectCodes(model,['A','B','C','D','E','F','G','H'],'Missing and invalid dates return when the date range is cleared');
  pass('creation-date ranges use inclusive Shanghai dates, handle one-sided ranges and explain reversed ranges');

  change('筛选项目客服','service-b');expectCodes(model,['A','B','G'],'Secondary service members and legacy serviceMemberId are searchable');
  change('筛选项目客服','__unassigned__');expectCodes(model,['C','E','H'],'Explicit empty serviceMemberIds overrides the legacy scalar');
  clear();change('筛选项目业务','__unassigned__');expectCodes(model,['E','H']);
  clear();assert.ok(optionValues(model,'筛选项目业务').includes('historical-member'));assert.ok(optionValues(model,'筛选项目客服').includes('historical-member'));
  change('筛选项目业务','historical-member');change('筛选项目客服','historical-member');expectCodes(model,['F'],'Inactive assigned members remain selectable');
  clear();pass('assignment filters support multiple and historical members, legacy service assignment and precise unassigned values');

  for(const [status,expected] of [['待建立开发轮次',['C','H']],['前期跟进中',['A','G']],['本轮前期完成 · 已转内部',['B']],['已暂停',['D']],['已取消',['E']],['已归档',['F']]]){change('筛选项目状态',status);expectCodes(model,expected,'Displayed status: '+status);}
  clear();change('筛选开发轮次数','0');expectCodes(model,['C','E','H']);
  change('筛选款色数量','0');expectCodes(model,['C','E'],'Zero is a real count filter, distinct from all values');
  change('筛选开发轮次数','');expectCodes(model,['C','E','F']);
  change('筛选开发轮次数','2');change('筛选款色数量','2');expectCodes(model,['G']);
  clear();pass('status filters match the displayed lifecycle, while round/item counts distinguish zero from no filter');

  const actionCell=tableFor(model).props.rows.find(row=>text(row[0]).includes('FLT-A'))[5];
  assert.ok(text(actionCell).includes('Review amber drawing'));assert.ok(!text(actionCell).includes('Later customer reminder'));
  change('搜索下一行动','review AMBER');expectCodes(model,['A']);
  change('搜索下一行动','2026-10-12');expectCodes(model,['A']);
  change('搜索下一行动','  synthetic action owner a  ');expectCodes(model,['A','D']);
  change('搜索下一行动','未设日期');expectCodes(model,['E'],'The displayed undated-action placeholder is searchable');
  change('搜索下一行动','暂无待办');expectCodes(model,['C','F','H'],'The displayed no-action placeholder is searchable');
  for(const hidden of ['Completed hidden','Cancelled hidden','Later customer reminder','Unscheduled later','Finished only action']){change('搜索下一行动',hidden);expectCodes(model,[],'Only the displayed next action is searched: '+hidden);}
  clear();change('筛选下一行动','none');expectCodes(model,['C','F','H'],'Only completed actions means no pending action');
  change('筛选下一行动','has');expectCodes(model,['A','B','D','E','G']);
  clear();change('筛选行动负责人','__unassigned__');expectCodes(model,['E'],'Unassigned action requires an actual pending action');
  clear();for(const [due,expected] of [['overdue',['A']],['today',['B']],['upcoming',['D','G']],['undated',['E']]]){change('筛选行动期限',due);expectCodes(model,expected,'Next-action deadline: '+due);}
  clear();metric('等待客户');expectCodes(model,['A']);change('筛选行动期限','today');expectCodes(model,[],'Queue can see any pending task but deadline describes the displayed next action');
  clear();pass('next-action filters use the earliest unfinished action, including its title/date/owner and explicit deadline buckets');

  change('搜索客户项目','SYNCA');change('筛选业务客服组','team-a');change('筛选项目客户','customer-a');
  change('筛选项目名称或编号','FLT-A');change('创建开始日期','2026-10-13');change('创建结束日期','2026-10-13');change('筛选项目业务','sales-a');change('筛选项目客服','service-b');change('筛选项目状态','前期跟进中');change('筛选开发轮次数','1');change('筛选款色数量','2');change('筛选下一行动','has');change('筛选行动负责人','owner-a');change('筛选行动期限','overdue');change('搜索下一行动','amber');metric('今日 / 逾期行动');
  expectCodes(model,['A']);clear();expectCodes(model,['A','B','C','D','E','F','G','H']);
  for(const label of [...labels,'搜索客户项目','筛选业务客服组'])assert.equal(control(model,label).props.value,'','Clear resets '+label);
  assert.equal(button(model,'清空筛选').props.disabled,true);
  const allQueue=nodes(model.tree).find(node=>node.type==='button'&&text(node).startsWith('全部新项目'));assert.equal(allQueue.props.className,'active');
  change('筛选项目业务','sales-b');change('筛选项目名称或编号','missing');testId(model,'customer-project-list-nav').props.onClick();render(model);expectCodes(model,['A','B','C','D','E','F','G','H'],'Returning to the main list clears new filters too');
  assert.deepEqual(requests.map(row=>row.action),['customer-project-data','project-finance-data'],'Filtering and clearing do not request or mutate data');
  pass('one clear resets every column, global search, local team and queue; list navigation also clears filters without sending writes');

  const scoped=structuredClone(fixture);scoped.projects=scoped.projects.filter(p=>p.teamId==='team-a');scoped.teams=scoped.teams.filter(t=>t.id==='team-a');scoped.customers=scoped.customers.filter(c=>c.id==='customer-a');
  const scopedIds=new Set(scoped.projects.map(p=>p.id));for(const key of ['rounds','items','tasks','communications'])scoped[key]=scoped[key].filter(row=>scopedIds.has(row.projectId));
  const scope={teamId:'team-a'};await mount(scoped,scope);
  assert.equal(nodes(model.tree).some(node=>node.props?.['aria-label']==='筛选业务客服组'),false,'Unified team context hides the local team selector');
  assert.equal(optionValues(model,'筛选项目业务').includes('sales-b'),false,'Filter choices cannot introduce out-of-scope assignees');
  change('筛选项目名称或编号','missing');metric('已转内部');expectCodes(model,[]);clear();
  expectCodes(model,['A','B','E','G','H'],'Clear preserves the authoritative scoped dataset');
  assert.equal(globalThis.__projectFilterBusinessTeam,scope);
  assert.equal(codes(model).some(code=>['FLT-TRASH','FLT-FINANCE','FLT-C','FLT-D','FLT-F'].includes(code)),false);
  for(const label of labels)assert.equal(control(model,label).props.value,'');
  assert.deepEqual(requests.map(row=>row.action),['customer-project-data','project-finance-data']);
  pass('clearing within a unified team preserves its scope and never pulls recycle-bin or finance-only records into the project list');
  return checks;
 }finally{
  if(model)unmount(model);
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runCustomerProjectListFiltersUiTests();
