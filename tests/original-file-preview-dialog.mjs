// Component interaction checks only; actual portal, Escape and focus are browser-verified.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const H={slots:[],index:0,effects:[]};globalThis.__originalPreviewHooks=H;
const result=await build({entryPoints:['app/original-file-preview-dialog.tsx'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'preview-hooks',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:a.path,namespace:'test'}));b.onResolve({filter:/components\/ui\/(button|dialog)$/},a=>({path:a.path.endsWith('button')?'button':'dialog',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='react'?`const H=globalThis.__originalPreviewHooks;export function useState(initial){const i=H.index++;H.slots[i]??={value:initial};return[H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v}]}export function useEffect(fn,deps){const i=H.index++;if(!H.slots[i]||deps.some((d,j)=>d!==H.slots[i].deps[j])){H.slots[i]={deps};H.effects.push(fn)}}`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;`:a.path==='button'?`export const Button='button';`:`export const Dialog='dialog-root',DialogContent='dialog',DialogTitle='h2',DialogDescription='p';`}));
}}]});
const {OriginalFilePreviewDialog}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
let closed=0,focused=0,loaded=0,failed=0,retries=0,downloads=0,tree;
const props={title:'Synthetic original details',preview:{filename:'synthetic.jpg',contentType:'image/jpeg',url:'blob:synthetic',loading:false,mediaLoading:false,error:''},details:[{label:'Synthetic supplier',value:'Synthetic only'}],note:'Synthetic archived original',onClose:()=>closed++,onRetry:()=>retries++,onDownload:()=>downloads++,onMediaLoaded:()=>loaded++,onMediaError:()=>failed++,returnFocus:()=>focused++};
function render(){H.index=0;tree=OriginalFilePreviewDialog(props);H.effects.splice(0).forEach(fn=>fn());return tree;}
function nodes(n=tree,out=[]){if(Array.isArray(n))n.forEach(v=>nodes(v??null,out));else if(n&&typeof n==='object'){out.push(n);nodes(n.props.children??null,out);}return out;}
function text(n){return n==null?'':Array.isArray(n)?n.map(text).join(''):typeof n==='object'?text(n.props.children):String(n);}
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
try{
 render();assert.equal(tree.type,'dialog-root');assert.equal(tree.props.open,true);assert(nodes().some(n=>n.type==='dialog'));assert(nodes().some(n=>n.type==='img'&&n.props.src==='blob:synthetic'));assert(nodes().some(n=>n.type==='dd'&&text(n)==='Synthetic only'));
 button('放大').props.onClick();render();assert(nodes().some(n=>n.props.className==='ieq-original-image-plane'&&n.props.style.width==='150%'));button('适合窗口').props.onClick();render();assert(nodes().some(n=>n.props.className==='ieq-original-image-plane fit'));
 nodes().find(n=>n.type==='img').props.onLoad();nodes().find(n=>n.type==='img').props.onError();assert.equal(loaded,1);assert.equal(failed,1);button('下载原件').props.onClick();assert.equal(downloads,1);
 tree.props.onOpenChange(false);assert.equal(closed,1);let prevented=0;nodes().find(n=>n.type==='dialog').props.onCloseAutoFocus({preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(focused,1);
 props.preview={...props.preview,contentType:'application/pdf',filename:'synthetic.pdf'};render();assert(nodes().some(n=>n.type==='iframe'&&n.props.title==='synthetic.pdf PDF 原件'));assert(!button('放大'));
 props.preview={...props.preview,url:'',loading:true,mediaLoading:true};render();assert(nodes().some(n=>n.props.role==='status'));assert(!nodes().some(n=>n.type==='img'||n.type==='iframe'));
 props.preview={...props.preview,loading:false,mediaLoading:false,error:'Synthetic read failed'};render();assert(nodes().some(n=>n.props.role==='alert'&&text(n).includes('Synthetic read failed')));button('重新加载原件').props.onClick();assert.equal(retries,1);assert(!nodes().some(n=>n.type==='iframe'));
 console.log('PASS shared original dialog: immediate modal, metadata, image zoom/reset, media callbacks, controlled close/focus contract, PDF, loading and retryable error. Actual portal/Escape/focus require browser QA.');
}finally{delete globalThis.__originalPreviewHooks;}
