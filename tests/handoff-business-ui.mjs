// Synthetic React state harness: no browser, production data or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
await fs.mkdir('test-output',{recursive:true});
const hooks={slots:[],effects:[],index:0,changed:false};
const react=`const H=globalThis.__hbHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v;H.changed=true;}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useMemo(fn){H.index++;return fn();}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
globalThis.__hbHooks=hooks;
await build({entryPoints:['app/handoff-business-panel.tsx'],outfile:'test-output/handoff-business-ui.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-hooks',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const Fragment='fragment';export function jsx(type,props){return {type,props:props||{}}};export const jsxs=jsx;`:a.path==='@tanstack/react-query'?`export function useQuery(o){return globalThis.__hbQueries[o.queryKey[0]];}export function useQueryClient(){return globalThis.__hbClient;}`:a.path==='button'?`export const Button='button';`:''}));
 }}]});
const {HandoffBusinessPanel,ProductionReviewPanel}=await import(pathToFileURL(path.resolve('test-output/handoff-business-ui.mjs')).href);
globalThis.window={confirm:()=>true,addEventListener(){},removeEventListener(){}};
let invalidationFails=false;
globalThis.__hbClient={invalidateQueries:async()=>{if(invalidationFails)throw Error('refresh failed');},setQueryData:(key,fn)=>{const q=globalThis.__hbQueries[key[0]];q.data=fn(q.data);}};
const source={id:'s1',kind:'handoff_business_source',type:'po',customerId:'c1',orderId:'o1',projectId:'',number:'SYNTHETIC-PO',version:1,status:'draft',fields:{currency:'USD',reference:'Synthetic original'},lines:[{orderLineId:'o1',description:'Synthetic line',quantity:2,unitPrice:'3.50'}],sourceRefs:[],updatedAt:'2026-10-13',updatedBy:'Synthetic user',canWrite:true,sourceChanged:false};
const feed={revision:1,items:[source],attachments:[],customers:[{id:'c1',customer:'Synthetic customer',canWrite:true}],orders:[{id:'o1',customerId:'c1',orderNo:'Synthetic order',drawing:'X',quantity:2,customerPO:'PO'}],projects:[],members:[],queues:{drawings:[],sops:[],orders:[],factory:[],service:[],finance:{},quotes:[]}};
const props={data:{me:{id:'m1',active:true,role:'sales'},revision:1},onNavigate:()=>{},onDirtyChange:v=>{globalThis.__hbDirty=v;},initialSection:'order-pi',initialContext:{recordId:'s1',customerId:'c1',orderId:'o1'}};
function reset(){hooks.slots=[];hooks.effects=[];hooks.index=0;hooks.changed=false;globalThis.__hbQueries={'handoff-business':{data:structuredClone(feed),isPending:false,isError:false,refetch:async()=>{}},'handoff-production-review':{data:null,isPending:false,isError:false}};}
let tree;
function render(component=HandoffBusinessPanel,p=props){for(let i=0;i<8;i++){hooks.index=0;hooks.changed=false;tree=component(p);for(const effect of hooks.effects.splice(0))effect();if(!hooks.changed)break;}return tree;}
function nodes(node=tree,out=[]){if(Array.isArray(node)){for(const n of node)nodes(n??null,out);return out;}if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children??null,out);}return out;}
function text(node=tree){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(v=>text(v??null)).join('');if(typeof node==='string'||typeof node==='number')return String(node);return text(node.props?.children??null);}
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
reset();render();assert.ok(text().includes('编辑客户 PO'));assert.ok(!nodes().some(n=>n.type==='nav'&&n.props['aria-label']==='业务单据子页'));
const number=nodes().find(n=>n.type==='input'&&n.props.value==='SYNTHETIC-PO');number.props.onChange({target:{value:'UPDATED-PO'}});render();assert.equal(globalThis.__hbDirty,true);
let requests=[],first=true;globalThis.fetch=async(url,options)=>{requests.push({url,body:options.body});if(first){first=false;throw Error('response lost after commit');}return Response.json({ok:true,item:{...source,number:'UPDATED-PO',version:2}});};
button('保存人工草稿').props.onClick();await tick();render();assert.ok(button('重试并核实原请求'));assert.equal(button('保存人工草稿').props.disabled,true);
invalidationFails=true;button('重试并核实原请求').props.onClick();await tick();await tick();render();assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(JSON.parse(requests[0].body).expectedVersion,1);assert.ok(!button('重试并核实原请求'));assert.ok(text().includes('V2'));assert.ok(!text().includes('保存结果尚不确定'));
console.log('PASS exact pending request replay, edit freeze and successful save despite refresh failure');
globalThis.__hbQueries['handoff-business'].isError=true;render();assert.ok(!text().includes('UPDATED-PO'));assert.ok(!button('保存人工草稿'));assert.ok(text().includes('读取失败'));
console.log('PASS permission refresh failure hides stale source, editor and history');
reset();render(HandoffBusinessPanel,{...props,initialContext:{recordId:'not-visible'}});assert.ok(text().includes('无权查看或已不存在'));assert.ok(!text().includes('编辑客户 PO'));
console.log('PASS deep link opens only a record present in current authorized feed');
reset();const review={reviewerRole:'drawing_lead',policyVersion:1,canConfigure:false,drawings:[{id:'d1',version:1,number:'DRAW',style:'STYLE',versionLabel:'A',drawingNumber:'D1',path:'Synthetic path',configured:true,effective:false,lead:null,supervisor:null,attachments:[]}]};globalThis.__hbQueries['handoff-production-review'].data=review;
render(ProductionReviewPanel,props);nodes().find(n=>n.type==='select').props.onChange({target:{value:'d1'}});render(ProductionReviewPanel,props);nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Version A review note'}});render(ProductionReviewPanel,props);assert.equal(button('确认此版本可用于生产').props.disabled,false);
globalThis.__hbQueries['handoff-production-review'].data={...review,drawings:[{...review.drawings[0],version:2,versionLabel:'B'}]};render(ProductionReviewPanel,props);assert.equal(button('确认此版本可用于生产').props.disabled,true);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Version A review note'));assert.ok(text().includes('图纸或审核岗位已变化'));
console.log('PASS source/policy versions pinned while reviewing, old note never signs a new version');

await build({entryPoints:['app/unified-communication-panel.tsx'],outfile:'test-output/unified-communication-ui.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'communication-hooks',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|@tanstack\/react-query|lucide-react)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));b.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'synthetic'}));b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const Fragment='fragment';export function jsx(type,props){return {type,props:props||{}}};export const jsxs=jsx;`:a.path==='@tanstack/react-query'?`export function useQuery(o){return globalThis.__hbQueries[o.queryKey[0]];}export function useQueryClient(){return globalThis.__hbClient;}`:a.path==='button'?`export const Button='button';`:a.path==='ui'?`export const Input='input';export const dateTime=v=>v;`:a.path==='lucide-react'?`export const MessageSquareText='icon',Plus='icon',Save='icon',History='icon',ShieldCheck='icon';`:''}));
 }}]});
const {UnifiedCommunicationPanel}=await import(pathToFileURL(path.resolve('test-output/unified-communication-ui.mjs')).href);
globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};globalThis.__hbClient.cancelQueries=async()=>{};
const comm={id:'comm1',customerId:'c1',projectId:'',orderId:'o1',channel:'email',title:'Synthetic communication',sourceText:'Private synthetic source',sourceReference:'Source',occurredAt:'2026-10-13',draftText:'Manual draft',internalNote:'Internal note',version:1,status:'draft',createdAt:'2026-10-13',updatedAt:'2026-10-13',canWrite:true,canSubmit:true};
const cp={...props,initialContext:{recordId:'comm1',customerId:'c1'}};
reset();globalThis.__hbQueries['unified-communication']={data:{items:[comm],customers:feed.customers,orders:feed.orders,projects:[]},isError:false};globalThis.__hbQueries['unified-communication-history']={isError:false};
render(UnifiedCommunicationPanel,cp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Private synthetic source'));
nodes().find(n=>n.props?.id==='comm-title').props.onChange({target:{value:'Unsaved change'}});render(UnifiedCommunicationPanel,{...cp,initialContext:{recordId:'inaccessible'}});assert.ok(nodes().some(n=>n.props?.id==='comm-title'&&n.props.value==='Unsaved change'));assert.ok(text().includes('有未保存内容'));
button('放弃本次编辑').props.onClick();render(UnifiedCommunicationPanel,{...cp,initialContext:{recordId:'inaccessible'}});assert.ok(text().includes('不存在'));assert.ok(!nodes().some(n=>n.type==='textarea'&&n.props.value==='Private synthetic source'));
render(UnifiedCommunicationPanel,cp);globalThis.__hbQueries['unified-communication'].isError=true;globalThis.__hbQueries['unified-communication'].error=Error('Scope refresh failed');render(UnifiedCommunicationPanel,cp);assert.ok(!text().includes('Synthetic communication'));assert.ok(!nodes().some(n=>n.type==='textarea'));
globalThis.__hbQueries['unified-communication'].isError=false;globalThis.__hbQueries['unified-communication'].data={...globalThis.__hbQueries['unified-communication'].data,items:[]};render(UnifiedCommunicationPanel,cp);assert.ok(text().includes('内容与历史已隐藏'));assert.ok(!nodes().some(n=>n.type==='textarea'));
console.log('PASS unified communication authorized deep links, dirty navigation protection, failed scope refresh and revoked record concealment');

reset();const production={...source,id:'prod1',type:'production_order',number:'PROD-1',status:'pending_check',fields:{style:'X',materialState:'物料齐备',purchaseState:'采购完成'},sourceRefs:[]};
const gate={allowed:false,hardMissing:[],fundingMissing:['Deposit gap'],productionId:'prod1',productionVersion:1,piId:'pi1',piVersion:1,declarationSequence:0,canAuthorizeException:true,canDeclareDeposit:false,fundingReminder:false,fundingBasisCurrent:true};
globalThis.__hbQueries['handoff-business'].data={...structuredClone(feed),items:[production],queues:{...feed.queues,orders:[{id:'o1',productionGate:gate}]}};
const fp={...props,initialSection:'production',initialContext:{recordId:'prod1',customerId:'c1',orderId:'o1'}};
render(HandoffBusinessPanel,fp);nodes().find(n=>n.props?.['aria-label']==='款项例外或定金确认依据').props.onChange({target:{value:'Exact PI version one funding note'}});render(HandoffBusinessPanel,fp);assert.equal(button('本人确认仅款项例外投产').props.disabled,false);
globalThis.__hbQueries['handoff-business'].data.queues.orders[0].productionGate={...gate,piVersion:2};render(HandoffBusinessPanel,fp);assert.equal(button('本人确认仅款项例外投产').props.disabled,true);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Exact PI version one funding note'));
button('放弃当前款项确认备注').props.onClick();render(HandoffBusinessPanel,fp);nodes().find(n=>n.props?.['aria-label']==='款项例外或定金确认依据').props.onChange({target:{value:'Rechecked current PI version two'}});render(HandoffBusinessPanel,fp);
let fundingRequests=[];first=true;globalThis.fetch=async(url,options)=>{fundingRequests.push(options.body);if(first){first=false;throw Error('committed but response lost');}return Response.json({ok:true,productionId:'prod1',gate:{...gate,piVersion:2,declarationSequence:1,paymentException:{actor:'Synthetic sales',createdAt:'Synthetic time'},canAuthorizeException:false,canDeclareDeposit:true,fundingReminder:true}});};
button('本人确认仅款项例外投产').props.onClick();await tick();render(HandoffBusinessPanel,fp);assert.ok(button('重试并核实原请求'));assert.equal(button('本人确认仅款项例外投产').props.disabled,true);button('重试并核实原请求').props.onClick();await tick();await tick();render(HandoffBusinessPanel,fp);assert.deepEqual(fundingRequests,[fundingRequests[0],fundingRequests[0]]);assert.equal(JSON.parse(fundingRequests[0]).expectedPiVersion,2);assert.ok(!button('本人确认仅款项例外投产'));assert.ok(button('本人确认该 PI 约定定金已收齐'));assert.ok(text().includes('款项跟进提醒持续'));
console.log('PASS funding review pins current PI and declaration sequence, preserves note on version changes, replays lost response once and updates cached gate after success');

reset();const fullInvoice={...source,id:'full-invoice',kind:'handoff_business_document',type:'invoice',number:'FULL-INVOICE',status:'checked',version:3};
const oldRequest={...source,id:'old-request',kind:'handoff_business_document',type:'paymentrequest',number:'BALANCE-1',status:'checked',version:7};
globalThis.__hbQueries['handoff-business'].data={...structuredClone(feed),items:[fullInvoice,oldRequest]};
const gp={...props,initialSection:'logistics',initialContext:{customerId:'c1',orderId:'o1'}};
render(HandoffBusinessPanel,gp);button('准备尾款请款草稿').props.onClick();render(HandoffBusinessPanel,gp);assert.ok(button('更新原请款草稿'));assert.ok(text().includes('按最新依据更新原请款'));
globalThis.__hbQueries['handoff-business'].data.items[1]={...oldRequest,version:8};render(HandoffBusinessPanel,gp);assert.equal(button('更新原请款草稿').props.disabled,true);
globalThis.__hbQueries['handoff-business'].data.items[1]=oldRequest;render(HandoffBusinessPanel,gp);let paymentBody;globalThis.fetch=async(url,options)=>{paymentBody=JSON.parse(options.body);return Response.json({ok:true,item:{...oldRequest,version:8,status:'draft'}});};
button('更新原请款草稿').props.onClick();await tick();await tick();render(HandoffBusinessPanel,gp);assert.equal(paymentBody.targetId,'old-request');assert.equal(paymentBody.expectedVersion,7);assert.equal(paymentBody.sourceId,'full-invoice');assert.equal(paymentBody.sourceVersion,3);assert.equal(paymentBody.number,'BALANCE-1');
console.log('PASS payment request regeneration pins both current invoice and prior request versions and reuses its identity');

reset();render();
const dateInputs=nodes().filter(n=>n.type==='input'&&n.props.type==='date');assert.equal(dateInputs.length,2);
dateInputs[0].props.onInput({currentTarget:{value:'2026-10-11'}});render();
nodes().filter(n=>n.type==='input'&&n.props.type==='date')[1].props.onInput({currentTarget:{value:'2026-10-25'}});render();
nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Notes entered after date input'}});render();
assert.deepEqual(nodes().filter(n=>n.type==='input'&&n.props.type==='date').map(n=>n.props.value),['2026-10-11','2026-10-25']);
let savedDates;globalThis.fetch=async(_url,o)=>{savedDates=JSON.parse(o.body);return Response.json({ok:true,item:{...source,fields:savedDates.fields,version:2}});};
button('保存人工草稿').props.onClick();await tick();await tick();render();assert.equal(savedDates.fields.date,'2026-10-11');assert.equal(savedDates.fields.paymentDueDate,'2026-10-25');
reset();globalThis.__hbQueries['unified-communication']={data:{items:[comm],customers:feed.customers,orders:feed.orders,projects:[]},isError:false};globalThis.__hbQueries['unified-communication-history']={isError:false};
render(UnifiedCommunicationPanel,cp);nodes().find(n=>n.props?.id==='comm-date').props.onInput({currentTarget:{value:'2026-10-09'}});render(UnifiedCommunicationPanel,cp);
nodes().find(n=>n.props?.id==='comm-note').props.onChange({target:{value:'Follow-up note'}});render(UnifiedCommunicationPanel,cp);assert.equal(nodes().find(n=>n.props?.id==='comm-date').props.value,'2026-10-09');
let savedCommunication;globalThis.fetch=async(_url,o)=>{savedCommunication=JSON.parse(o.body);return Response.json({ok:true,item:{...comm,...savedCommunication,version:2}});};
button('保存新版本').props.onClick();await tick();await tick();render(UnifiedCommunicationPanel,cp);assert.equal(savedCommunication.occurredAt,'2026-10-09');
console.log('PASS native date input events survive subsequent edits and persist exact business/communication dates');
