// Actual component event regression with synthetic React hooks; no server, files or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const hooks={slots:[],effects:[],index:0,changed:false};
globalThis.__cpaHooks=hooks;
const react=`const H=globalThis.__cpaHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{const next=typeof v==='function'?v(H.slots[i].value):v;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
const bundled=await build({entryPoints:['app/customer-price-archive-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'synthetic-hooks',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|lucide-react)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));
 // Keep this business-rule harness independent of the separately tested table DOM and filtering hooks.
 b.onResolve({filter:/excel-table$/},()=>({path:'excel',namespace:'synthetic'}));
 b.onResolve({filter:/business-team-client$/},()=>({path:'client',namespace:'synthetic'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const Fragment='fragment';export function jsx(type,props){return {type,props:props||{}}}export const jsxs=jsx;`:a.path==='button'?`export const Button='button';`:a.path==='excel'?`export const ExcelTable='table';export function useExcelColumnFilters(rows){return {rows,filters:{},clearFilters(){}};}`:a.path==='client'?`export const businessTeamFetch=(...args)=>globalThis.__cpaFetch(...args);export const downloadBusinessTeamFile=async()=>{};`:a.path==='lucide-react'?`export const Download='icon',FileText='icon',RefreshCw='icon',Search='icon';`:''}));
 }}]});
const {CustomerPriceArchivePanel}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const originals=Object.fromEntries(['window','location','setTimeout','clearTimeout','setInterval','clearInterval','addEventListener','removeEventListener'].map(k=>[k,globalThis[k]]));
let timerId=0,tree,reportedDirty=false;
const timers=new Map(),intervals=new Map(),listeners=new Map();
globalThis.window={};globalThis.location={search:'?customerId=synthetic-a'};
globalThis.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
globalThis.setInterval=fn=>{intervals.set(++timerId,fn);return timerId;};globalThis.clearInterval=id=>intervals.delete(id);
globalThis.addEventListener=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);};
globalThis.removeEventListener=(name,fn)=>listeners.get(name)?.delete(fn);
const props={data:{me:{id:'synthetic-admin'},revision:1,customerQuoteAccess:true},onDirtyChange:value=>{reportedDirty=value;}};
let selection={customerAccountId:'synthetic-a',invoicePreference:'both',configurationNotes:{rx:'Original RX',solar:'Original SOLAR'},version:1,sha256:'a'.repeat(64)};
const feed=()=>({view:'sku',selections:[structuredClone(selection)],canManageSelection:true,customers:[{id:'synthetic-a',customer:'Synthetic A',customerCode:'A'},{id:'synthetic-b',customer:'Synthetic B',customerCode:'B'}],rows:[],summary:{products:0,skus:0,verified:0,needsReview:0,missingPrice:0},canSeeInternal:false});
let readFailure=false,requests=[],post=async()=>Response.json({ok:true});
globalThis.__cpaFetch=async(url,options={})=>{if(options.method==='POST'){requests.push(JSON.parse(options.body));return post();}return readFailure?Response.json({error:'Synthetic scope revoked'},{status:403}):Response.json(feed());};
function render(){for(let n=0;n<12;n++){hooks.index=0;hooks.changed=false;tree=CustomerPriceArchivePanel(props);for(const fn of hooks.effects.splice(0))fn();if(!hooks.changed)return tree;}throw Error('Render failed to settle');}
function nodes(node=tree,out=[]){if(Array.isArray(node)){for(const child of node)nodes(child??null,out);}else if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children??null,out);}return out;}
function text(node=tree){return node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(value=>text(value??null)).join(''):typeof node==='object'?text(node.props?.children??null):String(node);}
const input=label=>nodes().find(n=>n.props?.['aria-label']===label),button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const change=(label,value)=>{input(label).props.onChange({target:{value}});render();};
async function read(){for(const [id,fn] of [...timers]){timers.delete(id);await fn();}render();}
function unloadBlocked(){let prevented=false;for(const fn of listeners.get('beforeunload')||[])fn({preventDefault(){prevented=true;},returnValue:null});return prevented;}
try{
 render();await read();assert.equal(input('RX 商用说明').props.value,'Original RX');assert.equal(reportedDirty,false);
 change('RX 商用说明','Unsaved A');assert.equal(reportedDirty,true);assert.equal(unloadBlocked(),true);
 change('报价档案客户','synthetic-b');assert.equal(input('报价档案客户').props.value,'synthetic-a');assert.equal(input('RX 商用说明').props.value,'Unsaved A');
 change('报价档案搜索','Synthetic SKU');assert.equal(reportedDirty,true);assert.equal(input('RX 商用说明'),undefined);await read();assert.equal(input('RX 商用说明').props.value,'Unsaved A');assert.equal(reportedDirty,true);
 button('刷新').props.onClick();render();await read();assert.equal(input('RX 商用说明').props.value,'Unsaved A');
 console.log('PASS unsaved customer notes protect workspace navigation and unload, reject customer switch, and survive search and manual refresh');

 selection={...selection,version:2,sha256:'b'.repeat(64),configurationNotes:{rx:'Server revision two',solar:'Original SOLAR'}};
 button('刷新').props.onClick();render();await read();assert.equal(input('RX 商用说明').props.value,'Unsaved A');assert.equal(button('保存客户规则').props.disabled,true);assert.ok(text().includes('当前客户规则已更新'));assert.equal(reportedDirty,true);
 button('放弃本次修改').props.onClick();render();assert.equal(input('RX 商用说明').props.value,'Server revision two');assert.equal(reportedDirty,false);
 change('RX 商用说明','Version two draft');post=async()=>Response.json({error:'Synthetic version conflict'},{status:409});await button('保存客户规则').props.onClick();render();assert.equal(requests.at(-1).expectedVersion,2);assert.equal(requests.at(-1).expectedSelectionSha256,'b'.repeat(64));assert.equal(requests.at(-1).customerAccountId,'synthetic-a');assert.equal(reportedDirty,true);assert.equal(input('RX 商用说明').props.value,'Version two draft');assert.ok(text().includes('Synthetic version conflict'));
 console.log('PASS changed source preserves draft, explicit discard adopts current version, and POST conflict keeps expected version and notes');

 let complete;post=()=>new Promise(resolve=>{complete=resolve;});const pending=button('保存客户规则').props.onClick();render();assert.equal(reportedDirty,true);for(const label of ['报价档案客户','报价档案搜索','客户发票价格规则','RX 商用说明','SOLAR 商用说明'])assert.equal(input(label).props.disabled,true);assert.equal(button('历史明细').props.disabled,true);assert.equal(unloadBlocked(),true);
 change('报价档案客户','synthetic-b');assert.equal(input('报价档案客户').props.value,'synthetic-a');
 selection={...selection,version:3,sha256:'c'.repeat(64),configurationNotes:{rx:'Version two draft',solar:'Original SOLAR'}};complete(Response.json({ok:true}));await pending;render();assert.equal(reportedDirty,false);assert.equal(unloadBlocked(),false);
 readFailure=true;await read();assert.ok(text().includes('Synthetic scope revoked'));assert.equal(input('RX 商用说明'),undefined);assert.equal(reportedDirty,false);
 readFailure=false;button('刷新').props.onClick();render();await read();assert.equal(input('RX 商用说明').props.value,'Version two draft');assert.equal(reportedDirty,false);
 console.log('PASS saving freezes editable scope, confirmed save clears dirty independently of refresh failure, and failed read conceals old editor');

 change('RX 商用说明','Network-failure draft');post=async()=>{throw Error('Synthetic network failure');};await button('保存客户规则').props.onClick();render();assert.equal(reportedDirty,true);assert.equal(input('RX 商用说明').props.value,'Network-failure draft');assert.equal(unloadBlocked(),true);
 readFailure=true;button('刷新').props.onClick();render();await read();assert.equal(input('RX 商用说明'),undefined);assert.equal(reportedDirty,true);button('放弃本次修改').props.onClick();render();assert.equal(reportedDirty,false);
 readFailure=false;selection={customerAccountId:'synthetic-b',invoicePreference:null,configurationNotes:{rx:'B only',solar:''},version:0,sha256:null};change('报价档案客户','synthetic-b');await read();assert.equal(input('RX 商用说明').props.value,'B only');assert.equal(reportedDirty,false);change('RX 商用说明','B edited');post=async()=>Response.json({ok:true});await button('保存客户规则').props.onClick();render();assert.equal(requests.at(-1).customerAccountId,'synthetic-b');assert.equal(requests.at(-1).expectedVersion,0);assert.equal(requests.at(-1).configurationNotes.rx,'B edited');assert.equal(requests.at(-1).configurationNotes.solar,'');
 for(const slot of hooks.slots)slot?.cleanup?.();assert.equal(reportedDirty,false);assert.equal(unloadBlocked(),false);assert.equal(timers.size,0);assert.equal(intervals.size,0);
 console.log('PASS network error and permission refresh preserve guarded draft, explicit discard and unmount release navigation protection');
 console.log('PASS clean customer switch installs only the new customer baseline and saves its own version and notes');
}finally{
 for(const slot of hooks.slots)slot?.cleanup?.();for(const [name,original] of Object.entries(originals)){if(original===undefined)delete globalThis[name];else globalThis[name]=original;}
 delete globalThis.__cpaHooks;delete globalThis.__cpaFetch;
}
