import assert from 'node:assert/strict';
import {build} from 'esbuild';
const H={slots:[],effects:[],index:0,changed:false};globalThis.__ieEvidenceHooks=H;
const react=`const H=globalThis.__ieEvidenceHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:initial};return[H.slots[i].value,value=>{const next=typeof value==='function'?value(H.slots[i].value):value;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
const result=await build({entryPoints:['app/ie-supplier-evidence-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'synthetic-evidence-ui',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:a.path,namespace:'test'}));b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'test'}));b.onResolve({filter:/excel-table$/},()=>({path:'table',namespace:'test'}));b.onResolve({filter:/business-team-client$/},()=>({path:'client',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`:a.path==='button'?`export const Button='button';`:a.path==='table'?`export const ExcelTable='table';`:`export const businessTeamFetch=(...args)=>globalThis.__ieEvidenceFetch(...args);export const getBusinessTeamScope=()=>globalThis.__ieEvidenceTeam||'';`}));
}}]});
const {IeSupplierEvidencePanel}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
let props,tree,handler,requests,changed,dirty,errors;const revoked=[],created=[];
const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
URL.createObjectURL=()=>{const url='blob:synthetic-'+created.length;created.push(url);return url;};URL.revokeObjectURL=url=>revoked.push(url);
const item={id:'synthetic-evidence',supplier:'SYN',drawingNo:'SYN-1',quoteDate:'',notes:'',category:'material',filename:'synthetic.png',contentType:'image/png',size:10,sha256:'0'.repeat(64),createdAt:'2026-11-09',createdBy:'SYN',url:'/api/workspace/ie-supplier-evidence?id=synthetic-evidence'};
const response=(data,status=200)=>Response.json(data,{status});
globalThis.__ieEvidenceFetch=(url,options)=>{requests.push({url,options});return handler(url,options);};
function cleanup(){for(const s of H.slots)s?.cleanup?.();H.slots=[];H.effects=[];}
function render(){for(let i=0;i<20;i++){H.index=0;H.changed=false;tree=IeSupplierEvidencePanel(props);for(const effect of H.effects.splice(0))effect();if(!H.changed)return;}throw Error('Unsettled render');}
async function flush(){for(let i=0;i<30;i++){await new Promise(resolve=>setImmediate(resolve));render();}}
function nodes(n=tree,out=[]){if(Array.isArray(n))n.forEach(v=>nodes(v??null,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out);}return out;}
function text(n=tree){return n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children??null):String(n);}
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const field=label=>nodes().find(n=>n.type==='label'&&text(n).startsWith(label))?.props.children.find(n=>n.type==='input'||n.type==='select');
const select=(...files)=>{nodes().find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files}});render();};
function mount(){cleanup();requests=[];changed=[];dirty=[];errors=[];globalThis.__ieEvidenceTeam='';handler=async url=>response(url.includes('-list')?{evidence:[item]}:{ok:true});props={canEdit:true,onChanged:items=>changed.push(items),onDirtyChange:value=>dirty.push(value),onError:cause=>errors.push(cause)};render();}
const first=new File(['synthetic A'],'first.png',{type:'image/png'}),second=new File(['synthetic B'],'second.png',{type:'image/png'});
try{
 mount();await flush();let resolveOld;handler=()=>new Promise(resolve=>{resolveOld=resolve;});button('重新读取档案').props.onClick();handler=async()=>response({evidence:[]});button('重新读取档案').props.onClick();await flush();resolveOld(response({evidence:[item]}));await flush();assert.equal(changed.at(-1).length,0);
 console.log('PASS late list response cannot restore stale supplier originals');

 mount();await flush();handler=async()=>new Response(new Blob(['synthetic image'],{type:'image/png'}));button('预览').props.onClick();await flush();assert.ok(nodes().some(n=>n.type==='img'));const preview=created.at(-1);props={...props,canEdit:false};render();assert.equal(tree,null);assert.ok(revoked.includes(preview));assert.deepEqual(changed.at(-1),[]);props={...props,canEdit:true};handler=async()=>response({evidence:[]});render();await flush();assert.ok(!nodes().some(n=>n.type==='img'));
 console.log('PASS permission loss revokes preview blob and clears archived rows before regrant');

 mount();await flush();select(first,second);let resolveUpload;handler=()=>new Promise(resolve=>{resolveUpload=resolve;});button('上传并留底').props.onClick();render();const inFlight=requests.at(-1);props={...props,canEdit:false};render();assert.equal(inFlight.options.signal.aborted,true);resolveUpload(response({ok:true}));await flush();assert.equal(requests.filter(r=>r.url.includes('-upload')).length,1);assert.deepEqual(changed.at(-1),[]);assert.equal(dirty.at(-1),false);
 console.log('PASS forced revoke aborts in-flight batch and never sends remaining files');

 mount();await flush();field('供应商（').props.onChange({target:{value:'Original supplier'}});render();select(first,second);let failed=false;handler=async(url,options)=>{if(url.includes('-list'))return response({evidence:[item]});if(options.body.get('file').name==='second.png'&&!failed){failed=true;throw Error('Synthetic ambiguous network reply');}return response({ok:true});};button('上传并留底').props.onClick();await flush();assert.equal(dirty.at(-1),true);assert.equal(field('供应商（').props.disabled,true);assert.equal(nodes().find(n=>n.type==='input'&&n.props.type==='file').props.disabled,true);assert.ok(text().includes('未收到成功确认'));field('供应商（').props.onChange({target:{value:'Changed after failure'}});render();button('上传并留底').props.onClick();await flush();const sent=requests.filter(r=>r.url.includes('-upload'));assert.equal(sent.length,3);assert.equal(sent.filter(r=>r.options.body.get('file').name==='first.png').length,1);assert.equal(sent.at(-1).options.body.get('supplier'),'Original supplier');assert.equal(dirty.at(-1),false);
 console.log('PASS partial retry keeps batch metadata and pending file while successful originals are not resent');

 mount();await flush();select(first);handler=async url=>{if(url.includes('-list'))throw Error('Synthetic list failure');return response({ok:true});};button('上传并留底').props.onClick();await flush();assert.equal(dirty.at(-1),false);assert.ok(text().includes('原件已留底，但档案清单刷新失败'));assert.equal(button('上传并留底').props.disabled,true);
 console.log('PASS failed refresh never converts acknowledged upload into a pending duplicate');

 mount();await flush();handler=async()=>new Response(new Blob(['private'],{type:'image/png'}));button('预览').props.onClick();await flush();const sensitive=created.at(-1);handler=async()=>response({error:'Synthetic permission revoked'},403);button('重新读取档案').props.onClick();await flush();assert.equal(tree,null);assert.ok(revoked.includes(sensitive));assert.equal(errors.length,1);assert.deepEqual(changed.at(-1),[]);
 console.log('PASS server authorization rejection removes retained private preview immediately');
}finally{cleanup();URL.createObjectURL=create;URL.revokeObjectURL=revoke;delete globalThis.__ieEvidenceHooks;delete globalThis.__ieEvidenceFetch;delete globalThis.__ieEvidenceTeam;}
