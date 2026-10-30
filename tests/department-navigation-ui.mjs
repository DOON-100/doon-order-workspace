// Synthetic state and authorized-list tests only: no production data or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
await fs.mkdir('test-output',{recursive:true});
const H={slots:[],effects:[],index:0,changed:false};globalThis.__departmentHooks=H;
const react=`const H=globalThis.__departmentHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v;H.changed=true;}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useMemo(fn){H.index++;return fn();}export function useCallback(fn,deps){const i=H.index++,old=H.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))H.slots[i]={deps,fn};return H.slots[i].fn;}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
const jsx=`export const Fragment='fragment';export function jsx(type,props){return {type,props:props||{}}};export const jsxs=jsx;`;
for(const name of ['factory-order','engineering-department'])await build({entryPoints:[`app/${name}-panel.tsx`],outfile:`test-output/${name}-ui.mjs`,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-ui',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|@tanstack\/react-query|lucide-react)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));
 b.onResolve({filter:/^\.\/ui$/},()=>({path:'ui',namespace:'synthetic'}));
 b.onResolve({filter:/engineering-(drawing-panel|sop-panel|task-board)$/},a=>({path:a.path,namespace:'synthetic'}));
 // Isolate the spreadsheet DOM and auxiliary sales panels from navigation/dirty-state assertions.
 b.onResolve({filter:/excel-table$/},()=>({path:'excel-table',namespace:'synthetic'}));
 b.onResolve({filter:/sales-(color-fields-panel|order-sources-panel)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?jsx:a.path==='@tanstack/react-query'?`export function useQuery(o){globalThis.__departmentQueryOptions=o;return globalThis.__departmentQuery;}`:a.path==='button'?`export const Button='button';`:a.path==='ui'?`export const Input='input',Empty='empty';export async function request(){throw Error('unexpected request');}`:a.path==='lucide-react'?`export const Download='icon',FileImage='icon',Languages='icon',Save='icon',Send='icon',Upload='icon';`:a.path==='excel-table'?`export const ExcelTable='table';const filters={};export function useExcelColumnFilters(rows){return {rows,total:rows.length,filters,clearFilters(){},setFilter(){},values(){return []}};}`:a.path.includes('color-fields-panel')?`export const SalesColorFieldsPanel='sales-color-fields-panel';`:a.path.includes('order-sources-panel')?`export const SalesOrderSourcesPanel='sales-order-sources-panel';`:a.path.includes('drawing-panel')?`export const EngineeringDrawingPanel='drawing-panel';`:a.path.includes('sop-panel')?`export const EngineeringSopPanel='sop-panel';`:`export const EngineeringTaskBoard='task-board';`}));
 }}]});
const {FactoryOrderPanel}=await import(pathToFileURL(path.resolve('test-output/factory-order-ui.mjs')).href);
const {EngineeringDepartmentPanel}=await import(pathToFileURL(path.resolve('test-output/engineering-department-ui.mjs')).href);
globalThis.window={confirm:()=>true,addEventListener(){},removeEventListener(){}};globalThis.confirm=()=>true;
let tree;const tick=()=>new Promise(resolve=>setImmediate(resolve));
function reset(){for(const s of H.slots)s?.cleanup?.();H.slots=[];H.effects=[];H.index=0;H.changed=false;}
function render(component,props){for(let i=0;i<12;i++){H.index=0;H.changed=false;tree=component(props);for(const f of H.effects.splice(0))f();if(!H.changed)return tree;}throw Error('nonconvergent render');}
function nodes(n=tree,out=[]){if(Array.isArray(n)){n.forEach(x=>nodes(x??null,out));return out;}if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out);}return out;}
function text(n=tree){if(n==null||typeof n==='boolean')return '';if(Array.isArray(n))return n.map(v=>text(v??null)).join('');if(typeof n==='string'||typeof n==='number')return String(n);return text(n.props?.children??null);}
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const order=id=>({id,customer:'Synthetic',orderNo:id,customerPO:'PO',drawing:id,color:'C',quantity:2,lens:'',extra:{},ledger:{columns:{}}});
let versions=[{id:'v1',lineId:'o1',version:1,status:'草稿',sourceEnglish:'Original text',chineseProcess:'工艺',materialSpec:'',platingSpec:'',lensSpec:'',materialImageConfirmed:false}],readsFail=false,writes=0,dirty=false;
globalThis.fetch=async url=>{if(String(url).includes('templates'))return Response.json({templates:[]});if(readsFail)return Response.json({error:'authorization changed'},{status:403});return Response.json({items:versions});};
let fp={data:{me:{id:'m1'},revision:1,orders:[order('o1'),order('o2')],attachments:[]},busy:false,initialContext:{orderId:'o1'},onDirtyChange:v=>dirty=v,act:async(_action,p)=>{writes++;return {item:{...versions[0],...p,id:'v3',version:3}};}};
render(FactoryOrderPanel,fp);await tick();render(FactoryOrderPanel,fp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Original text'));assert.equal(dirty,false);
nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Unsaved text'}});render(FactoryOrderPanel,fp);assert.equal(dirty,true);
nodes().filter(n=>n.type==='button'&&text(n)==='编辑转换')[1].props.onClick();render(FactoryOrderPanel,fp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Unsaved text'));assert.ok(text().includes('有未保存内容'));
fp={...fp,initialContext:{orderId:'o2'}};render(FactoryOrderPanel,fp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Unsaved text'));
fp={...fp,initialContext:{orderId:'o1'},data:{...fp.data,revision:2}};versions=[{...versions[0],version:2,sourceEnglish:'New server text'}];render(FactoryOrderPanel,fp);await tick();render(FactoryOrderPanel,fp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='Unsaved text'));assert.equal(nodes().find(n=>n.type==='fieldset').props.disabled,true);await button('保存草稿').props.onClick();assert.equal(writes,0);
button('放弃本次编辑并读取最新版本').props.onClick();render(FactoryOrderPanel,fp);assert.ok(nodes().some(n=>n.type==='textarea'&&n.props.value==='New server text'));assert.equal(dirty,false);
nodes().find(n=>n.type==='textarea').props.onChange({target:{value:'Saved revision'}});render(FactoryOrderPanel,fp);await button('保存草稿').props.onClick();render(FactoryOrderPanel,fp);assert.equal(writes,1);assert.equal(dirty,false);
console.log('PASS factory dirty reporting, row/deep-link protection, stale refresh preservation and save baseline');
fp={...fp,initialContext:{orderId:'hidden'}};render(FactoryOrderPanel,fp);assert.ok(text().includes('指定订单不存在'));assert.ok(!nodes().some(n=>n.type==='textarea'));
fp={...fp,initialContext:{orderId:'o1'}};render(FactoryOrderPanel,fp);readsFail=true;fp={...fp,data:{...fp.data,revision:3}};render(FactoryOrderPanel,fp);await tick();render(FactoryOrderPanel,fp);assert.ok(text().includes('旧内部单内容已隐藏'));assert.ok(!nodes().some(n=>n.type==='textarea'));reset();assert.equal(dirty,false);
console.log('PASS factory unauthorized exact target, read failure concealment and unmount dirty cleanup');
globalThis.__departmentQuery={data:{drawings:[{id:'d1',modelNo:'D1',status:'草稿'}],sops:[{id:'s1',drawingRecordId:'d1',status:'待上传'}]},isError:false,refetch:async()=>{}};
let ep={data:{me:{id:'m1'},revision:1},initialContext:{recordId:'d1',tab:'drawings'},onDirtyChange:v=>dirty=v};
render(EngineeringDepartmentPanel,ep);assert.equal(nodes().find(n=>n.type==='drawing-panel').props.initialRecordId,'d1');
nodes().find(n=>n.type==='drawing-panel').props.onDirtyChange(true);render(EngineeringDepartmentPanel,ep);ep={...ep,initialContext:{recordId:'s1',tab:'sop'},data:{...ep.data,revision:2}};render(EngineeringDepartmentPanel,ep);assert.ok(nodes().some(n=>n.type==='drawing-panel'));assert.ok(text().includes('有未保存内容'));assert.deepEqual(globalThis.__departmentQueryOptions.queryKey,['engineering-department-index','m1']);
nodes().find(n=>n.type==='drawing-panel').props.onDirtyChange(false);render(EngineeringDepartmentPanel,ep);assert.equal(nodes().find(n=>n.type==='sop-panel').props.initialSopId,'s1');
globalThis.__departmentQuery.data={drawings:[],sops:[]};render(EngineeringDepartmentPanel,ep);assert.ok(!nodes().some(n=>n.type==='sop-panel'));assert.ok(text().includes('已不在当前授权列表'));
ep={...ep,initialContext:{recordId:'unknown'}};render(EngineeringDepartmentPanel,ep);assert.ok(text().includes('指定工程资料不存在'));assert.ok(!nodes().some(n=>['sop-panel','drawing-panel'].includes(n.type)));
globalThis.__departmentQuery.isError=true;render(EngineeringDepartmentPanel,ep);assert.ok(!nodes().some(n=>n.type==='task-board'));assert.ok(text().includes('原列表与选定资料已隐藏'));reset();assert.equal(dirty,false);
console.log('PASS engineering exact drawing/SOP deep links, dirty context and poll preservation, revoked/failed scope concealment');
