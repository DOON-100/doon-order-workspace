// Component event checks for document identity and asynchronous reads; browser
// visibility, native downloads and PDF rendering need separate browser checks.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const H={slots:[],effects:[],index:0,changed:false};globalThis.__ieDocumentHooks=H;
const react=`const H=globalThis.__ieDocumentHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:initial};return[H.slots[i].value,value=>{const next=typeof value==='function'?value(H.slots[i].value):value;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||!deps||deps.some((v,j)=>v!==old.deps?.[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
const built=await build({entryPoints:['app/ie-quote-documents-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'synthetic-ie-documents',setup(b){
 for(const [filter,path]of [[/^(react|react\/jsx-runtime)$/,'react'],[/components\/ui\/button$/,'button'],[/ie-document-thumbnail$/,'thumbnail'],[/original-file-preview-dialog$/,'preview'],[/business-team-client$/,'client'],[/^\.\/ui$/,'ui']])b.onResolve({filter},a=>({path:path==='react'?a.path:path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;export const Fragment='fragment';`:a.path==='button'?`export const Button='button';`:a.path==='thumbnail'?`export const IeDocumentThumbnail='thumbnail';`:a.path==='preview'?`export const OriginalFilePreviewDialog='original-file-preview';`:a.path==='ui'?`export const dateTime=value=>value;`:`export const businessTeamFetch=(...args)=>globalThis.__ieDocumentFetch(...args);export const getBusinessTeamScope=()=>globalThis.__ieDocumentTeam||'';`}));
}}]});
const {IeQuoteDocumentsPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
let props,tree,handler,requests,errors,dirty;const revoked=[],created=[];const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
URL.createObjectURL=()=>{const url='blob:synthetic-document-'+created.length;created.push(url);return url;};URL.revokeObjectURL=url=>revoked.push(url);
const original={id:'synthetic-original',lineId:'synthetic-line',drawingNo:'SYN-DRAW',drawingRevision:'R1',filename:'synthetic.png',contentType:'image/png',size:8,sha256:'0'.repeat(64),uploadedAt:'2026-11-09',uploadedBy:'SYN',quoteVersion:1,matchesDrawingRevision:true,url:'unused'};
const quote={id:'synthetic-quote',version:2,status:'draft',canEdit:true,lines:[{id:original.lineId,model:'SYNTHETIC',drawingNo:original.drawingNo,drawingRevision:original.drawingRevision}],attachments:[original]};
globalThis.__ieDocumentFetch=(url,options)=>{requests.push({url,options});return handler(url,options);};
function cleanup(){for(const s of H.slots)s?.cleanup?.();H.slots=[];H.effects=[];}
function render(){for(let i=0;i<20;i++){H.index=0;H.changed=false;tree=IeQuoteDocumentsPanel(props);for(const effect of H.effects.splice(0))effect();if(!H.changed)return;}throw Error('Unsettled component');}
async function flush(){for(let i=0;i<10;i++){await new Promise(resolve=>setImmediate(resolve));render();}}
function nodes(n=tree,out=[]){if(Array.isArray(n))n.forEach(v=>nodes(v??null,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out);}return out;}
const text=n=>n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children):String(n);
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const dialog=()=>nodes().find(n=>n.type==='original-file-preview');
const trigger={isConnected:true,focused:0,focus(){this.focused++;}};
function mount(changes={}){cleanup();requests=[];errors=[];dirty=[];globalThis.__ieDocumentTeam='';handler=async()=>new Response(new Blob(['SYNTHETIC'],{type:'image/png'}));props={quote:structuredClone(quote),dirty:false,historical:false,busy:false,onUpload:async()=>{},onSaved:async()=>{},onError:e=>errors.push(e),onDirtyChange:value=>dirty.push(value),...changes};render();}
function open(){button('查看详情 / 预览').props.onClick({currentTarget:trigger});render();}
try{
 mount();let complete;handler=()=>new Promise(resolve=>{complete=resolve;});open();assert.equal(dialog().props.preview.loading,true);assert.equal(dialog().props.preview.filename,original.filename);assert.ok(requests[0].url.includes('id=synthetic-quote&version=2&attachmentId=synthetic-original'));complete(new Response(new Blob(['SYNTHETIC'],{type:'image/png'})));await flush();assert.equal(dialog().props.preview.loading,false);assert.equal(dialog().props.preview.mediaLoading,true);assert.ok(dialog().props.details.some(row=>row.label==='报价版本'&&row.value==='V2 · 首次关联 V1'));dialog().props.onMediaLoaded();render();assert.equal(dialog().props.preview.mediaLoading,false);dialog().props.onMediaError();render();assert.ok(dialog().props.preview.error.includes('图纸预览未能显示'));dialog().props.returnFocus();assert.equal(trigger.focused,1);const oldUrl=dialog().props.preview.url;dialog().props.onClose();render();assert.equal(dialog(),undefined);assert.ok(revoked.includes(oldUrl));
 console.log('PASS IE drawings open a visible-dialog contract before fetching, retain exact quote/version and metadata, expose media failure and return-focus callbacks, revoke on close');

 mount();handler=()=>new Promise(resolve=>{complete=resolve;});open();const request=requests.at(-1);props={...props,quote:{...props.quote,version:3,attachments:[]}};render();assert.equal(dialog(),undefined);assert.equal(request.options.signal.aborted,true);const count=created.length;complete(new Response(new Blob(['OLD VERSION'],{type:'image/png'})));await flush();assert.equal(created.length,count);assert.equal(dialog(),undefined);
 console.log('PASS quote version changes hide and abort the old original without admitting a late file response');

 mount();handler=()=>new Promise(resolve=>{complete=resolve;});open();const pending=requests.at(-1);dialog().props.onClose();render();assert.equal(pending.options.signal.aborted,true);complete(new Response(new Blob(['CLOSED'],{type:'image/png'})));await flush();assert.equal(dialog(),undefined);
 console.log('PASS closing during loading aborts the read and never reopens from its late response');

 mount();handler=async()=>Response.json({error:'SYNTHETIC revoked'},{status:403});open();await flush();assert.equal(dialog(),undefined);assert.equal(errors.length,1);
 mount();handler=async()=>Response.json({ok:true});open();await flush();assert.ok(dialog().props.preview.error.includes('匹配的图纸原件'));assert.equal(dialog().props.preview.url,'');
 console.log('PASS authorization failures clear details; unexpected JSON cannot masquerade as a diagram preview');

 mount({historical:true,quote:{...quote,canEdit:false}});assert.equal(nodes().some(n=>n.type==='input'&&n.props.type==='file'),false);open();await flush();assert.ok(dialog());assert.equal(errors.length,0);
 console.log('PASS authorized historical diagrams stay readable while upload controls remain absent');

 mount();const selectedFile=new File(['synthetic original'],'synthetic-selected.png',{type:'image/png'});
 nodes().find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[selectedFile]}});render();assert.equal(dirty.at(-1),true);
 handler=()=>new Promise(resolve=>{complete=resolve;});open();const inactiveRequest=requests.at(-1),inactiveCreated=created.length;
 props={...props,active:false};render();assert.equal(dialog(),undefined);assert.equal(inactiveRequest.options.signal.aborted,true);assert.equal(dirty.at(-1),true);assert.equal(nodes().find(n=>n.type==='fieldset'&&n.props.className==='ieq-document-upload').props.disabled,true);
 complete(new Response(new Blob(['LATE HIDDEN ORIGINAL'],{type:'image/png'})));await flush();assert.equal(created.length,inactiveCreated);assert.equal(dialog(),undefined);
 props={...props,active:true};render();assert.equal(dirty.at(-1),true);assert.equal(button('上传并保存').props.disabled,false);assert.equal(errors.length,0);
 console.log('PASS inactive quote tabs withdraw and abort portals while preserving the pending upload selection for return');

}finally{cleanup();URL.createObjectURL=create;URL.revokeObjectURL=revoke;delete globalThis.__ieDocumentHooks;delete globalThis.__ieDocumentFetch;delete globalThis.__ieDocumentTeam;}
