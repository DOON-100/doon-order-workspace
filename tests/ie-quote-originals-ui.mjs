// Synthetic component event checks only. Browser downloads and real historic
// files still require authenticated, read-only acceptance in the test copy.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const H={slots:[],effects:[],index:0,changed:false};globalThis.__ieOriginalHooks=H;
const react=`const H=globalThis.__ieOriginalHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:initial};return[H.slots[i].value,value=>{const next=typeof value==='function'?value(H.slots[i].value):value;if(!Object.is(next,H.slots[i].value)){H.slots[i].value=next;H.changed=true;}}];}export function useRef(value){const i=H.index++;return H.slots[i]||(H.slots[i]={current:value});}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||!deps||deps.some((v,j)=>v!==old.deps?.[j])){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{old?.cleanup?.();H.slots[i].cleanup=fn();});}}`;
const built=await build({entryPoints:['app/ie-quote-originals-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'synthetic-ie-originals',setup(b){
 for(const [filter,path]of [[/^(react|react\/jsx-runtime)$/,'react'],[/components\/ui\/button$/,'button'],[/components\/ui\/dialog$/,'dialog'],[/business-team-client$/,'client'],[/business-team-context$/,'context'],[/^\.\/ui$/,'ui']])b.onResolve({filter},a=>({path:path==='react'?a.path:path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='react'?react:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;export const Fragment='fragment';`:a.path==='button'?`export const Button='button';`:a.path==='dialog'?`export const Dialog='dialog-root',DialogContent='dialog',DialogTitle='h2',DialogDescription='p';`:a.path==='context'?`export const useBusinessTeamScope=()=>({teamId:globalThis.__ieOriginalTeam||''});`:a.path==='ui'?`export const dateTime=value=>value;`:`export const businessTeamFetch=(...args)=>globalThis.__ieOriginalFetch(...args);export const getBusinessTeamScope=()=>globalThis.__ieOriginalTeam||'';`}));
}}]});
const {IeQuoteOriginalsPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
let props,tree,handler,requests;const downloads=[],created=[],revoked=[];
const oldDocument=globalThis.document,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
globalThis.document={createElement:()=>({click(){downloads.push({href:this.href,name:this.download});}})};
URL.createObjectURL=()=>{const url='blob:synthetic-original-'+created.length;created.push(url);return url;};URL.revokeObjectURL=url=>revoked.push(url);
const attachment={id:'synthetic-original',originalName:'SYN-ORIGINAL.xlsx',size:9,sha256:'0'.repeat(64)};
function feed(quoteId='synthetic-quote',name=attachment.originalName){return {target:{module:'ie-quotes',collection:'quotes',recordId:quoteId,sectionKey:'record'},entries:[{id:'synthetic-entry',note:'SYNTHETIC original source note',createdByName:'SYNTHETIC',createdAt:'2026-11-01',attachments:[{...attachment,originalName:name}]}]};}
const template={templateStatus:{configured:true,filename:'SYN-TEMPLATE.xlsx',templateVersion:2,registeredQuoteVersion:1,registeredAt:'2026-11-01',canDownloadPrepared:true,canDownloadSource:false,message:'SYNTHETIC verified template'}};
function normal(url){if(url.includes('business-followup-data'))return Promise.resolve(Response.json(feed(new URL(url,'https://synthetic.test').searchParams.get('recordId'))));if(url.includes('template-status'))return Promise.resolve(Response.json(template));return Promise.resolve(new Response(new Blob(['SYNTHETIC'],{type:'application/octet-stream'})));}
globalThis.__ieOriginalFetch=(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');requests.push({url,options});return handler(url,options);};
function cleanup(){for(const slot of H.slots)slot?.cleanup?.();H.slots=[];H.effects=[];}
function render(){for(let i=0;i<30;i++){H.index=0;H.changed=false;tree=IeQuoteOriginalsPanel(props);for(const effect of H.effects.splice(0))effect();if(!H.changed)return;}throw Error('Component did not settle');}
async function flush(){for(let i=0;i<12;i++){await new Promise(resolve=>setImmediate(resolve));render();}}
function nodes(n=tree,out=[]){if(Array.isArray(n))n.forEach(v=>nodes(v??null,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out);}return out;}
const text=n=>n==null||typeof n==='boolean'?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props?.children):String(n);
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label),dialog=()=>nodes().find(n=>n.type==='dialog-root'&&n.props.open);
function mount(changes={}){cleanup();requests=[];globalThis.__ieOriginalTeam='';handler=normal;props={quote:{id:'synthetic-quote',version:3,customerAccountId:'synthetic-customer'},identityKey:'synthetic-member',...changes};render();}
const click=async label=>{const found=button(label);assert(found,label);found.props.onClick();render();await flush();};
try{
 mount();await flush();assert.equal(requests.length,2);assert.match(requests[0].url,/module=ie-quotes&collection=quotes&recordId=synthetic-quote&sectionKey=record/);assert.match(requests[1].url,/id=synthetic-quote&version=3/);assert(!nodes().some(n=>n.type==='input'&&n.props.type==='file'));assert(text(tree).includes('不是所选历史版本已采用资料'));assert(button('SYN-ORIGINAL.xlsx'));assert(button('已整理打印副本_SYN-TEMPLATE.xlsx'));
 await click('SYN-ORIGINAL.xlsx');assert(dialog());assert(text(dialog()).includes('记录级资料'));assert(text(dialog()).includes(attachment.sha256));
 await click('下载此原件');assert.equal(downloads.length,1);assert.equal(downloads.at(-1).name,'SYN-ORIGINAL.xlsx');assert.match(requests.at(-1).url,/business-followup-download\?id=synthetic-original/);
 console.log('PASS record originals use exact read-only IE target, show full provenance and a visible details contract, download through authorized original endpoint without upload controls');

 mount();await flush();const count=requests.length;assert.equal(button('下载源 Excel').props.disabled,true);await click('下载源 Excel');assert.equal(requests.length,count);await click('下载打印副本');assert.match(requests.at(-1).url,/ie-quote-template-file\?id=synthetic-quote&version=3&kind=prepared/);
 console.log('PASS full source Excel stays unavailable without admin capability; prepared file retains exact quote version');

 mount();await flush();handler=async url=>url.includes('business-followup-data')?Response.json({error:'SYNTHETIC revoked'},{status:403}):Response.json(template);await click('重新读取原件');assert(!button('SYN-ORIGINAL.xlsx'));assert(!button('下载打印副本'));assert(text(tree).includes('SYNTHETIC revoked'));
 console.log('PASS failed/unauthorized reload withdraws former record and template lists');

 mount();await flush();let resolveOld;handler=()=>new Promise(resolve=>{resolveOld=resolve;});button('下载原件').props.onClick();render();const pendingFile=requests.at(-1),downloadCount=downloads.length;props={...props,identityKey:'different-synthetic-member'};handler=normal;render();await flush();assert(pendingFile.options.signal.aborted);resolveOld(new Response(new Blob(['OLD MEMBER'])));await flush();assert.equal(downloads.length,downloadCount);
 console.log('PASS identity changes abort pending original downloads and prevent a late response from initiating a download');

 mount();await flush();const pending=[];handler=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));button('重新读取原件').props.onClick();render();assert.equal(pending.length,2);props={...props,quote:{...props.quote,id:'new-synthetic-quote',version:1}};handler=url=>url.includes('business-followup-data')?Promise.resolve(Response.json(feed('new-synthetic-quote','NEW-ORIGINAL.xlsx'))):Promise.resolve(Response.json(template));render();await flush();for(const row of pending)row.resolve(Response.json(row.url.includes('business-followup-data')?feed():template));await flush();assert(pending.every(row=>row.options.signal.aborted));assert(!button('SYN-ORIGINAL.xlsx'));assert(button('NEW-ORIGINAL.xlsx'));
 console.log('PASS quote/version changes cancel old lists; a late former feed cannot replace the selected quote');

 mount();await flush();handler=async url=>url.includes('business-followup-data')?Response.json(feed('wrong-synthetic-quote')):Response.json(template);await click('重新读取原件');assert(!button('SYN-ORIGINAL.xlsx'));assert(text(tree).includes('关联与所选报价不一致'));
 console.log('PASS mismatched record targets do not get admitted as the selected quote originals');

 mount();await flush();handler=async()=>Response.json({error:'SYNTHETIC file lost'},{status:404});await click('SYN-ORIGINAL.xlsx');await click('下载此原件');assert(!dialog());assert(!button('SYN-ORIGINAL.xlsx'));assert(text(tree).includes('SYNTHETIC file lost'));
 console.log('PASS failed original reads close details and revoke previous lists instead of keeping stale files');

 mount({quote:{id:'synthetic-quote',version:1,customerAccountId:'synthetic-customer'}});await flush();assert(requests.some(r=>r.url.includes('version=1')));globalThis.__ieOriginalTeam='different-synthetic-team';render();await flush();assert(requests.slice(0,2).every(r=>r.options.signal.aborted));
 console.log('PASS historical versions are explicit and business-team changes invalidate old read scopes');

 mount({active:false});await flush();assert.equal(requests.length,0);assert.equal(tree,null);
 props={...props,active:true};render();await flush();assert(button('SYN-ORIGINAL.xlsx'));await click('SYN-ORIGINAL.xlsx');assert(dialog());let resolveHidden;handler=()=>new Promise(resolve=>{resolveHidden=resolve;});button('下载此原件').props.onClick();render();const hiddenDownload=requests.at(-1),beforeHidden=downloads.length;props={...props,active:false};render();assert.equal(tree,null);assert(hiddenDownload.options.signal.aborted);resolveHidden(new Response(new Blob(['HIDDEN ORIGINAL'])));await flush();assert.equal(downloads.length,beforeHidden);assert.equal(tree,null);
 const oldReadCount=requests.length;props={...props,active:true};handler=normal;render();assert(!button('SYN-ORIGINAL.xlsx'));await flush();assert.equal(requests.length,oldReadCount+2);assert(button('SYN-ORIGINAL.xlsx'));assert(!dialog());
 console.log('PASS inactive work areas remove their portal and all original controls, abort pending downloads, and reread authorization when activated');
}finally{cleanup();globalThis.document=oldDocument;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;delete globalThis.__ieOriginalHooks;delete globalThis.__ieOriginalFetch;delete globalThis.__ieOriginalTeam;}
