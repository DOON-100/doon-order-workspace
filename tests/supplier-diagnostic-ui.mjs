// Synthetic component interaction; no network or business data.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output','supplier-diagnostic-ui-'+process.pid);
await fs.mkdir(output,{recursive:true});
const hooks={slots:[],index:0,calls:[],response:null};
globalThis.__supplierDiagnosticUi=hooks;
const modules={
 react:`const H=globalThis.__supplierDiagnosticUi;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v}];}`,
 query:`export function useQueryClient(){return {invalidateQueries:async()=>{}}}export function useQuery(){return {}}`,
 icons:`export const Upload='svg';`,
 button:`export const Button='button';`,
 dialog:`export function Dialog(){return null}export const DialogContent='div',DialogHeader='div',DialogTitle='h2',DialogDescription='p';`,
 ui:`export const dateTime=v=>v;export async function request(action,body){const H=globalThis.__supplierDiagnosticUi;H.calls.push({action,body});return H.response;}`
};
const outfile=path.join(output,'ui.mjs');
await build({entryPoints:['app/supplier-import-panel.tsx'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',plugins:[{name:'supplier-ui-test',setup(b){
 for(const [pattern,name] of [[/^react$/,'react'],[/^@tanstack\/react-query$/,'query'],[/^lucide-react$/,'icons'],[/components\/ui\/button$/,'button'],[/components\/ui\/dialog$/,'dialog'],[/^\.\/ui$/,'ui']])b.onResolve({filter:pattern},()=>({path:name,namespace:'test-ui'}));
 b.onLoad({filter:/.*/,namespace:'test-ui'},a=>({contents:modules[a.path],loader:'jsx'}));
}}]});
const {SupplierImportPanel}=await import(pathToFileURL(outfile).href);
let tree;
function render(){hooks.index=0;tree=SupplierImportPanel();return renderToStaticMarkup(tree);}
function nodes(n=tree,out=[]){if(Array.isArray(n)){n.forEach(x=>nodes(x??null,out));return out}if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out)}return out}
const button=label=>nodes().find(n=>n.type==='button'&&n.props.children===label);
let html=render();assert.ok(html.includes('测试金蝶供应商连接'));assert.equal(hooks.calls.length,0);
hooks.response={readOnly:true,rows:[{name:'SYNTHETIC-PRIVATE-NAME'}],checkedAt:'2026-10-30T00:00:00Z'};
button('测试金蝶供应商连接').props.onClick();await new Promise(resolve=>setTimeout(resolve,0));
html=render();assert.deepEqual(hooks.calls,[{action:'kingdee-supplier-diagnostic',body:undefined}]);assert.ok(html.includes('首批返回 1 条'));assert.ok(html.includes('本次检查未导入档案'));assert.ok(!html.includes('SYNTHETIC-PRIVATE-NAME'));
hooks.response=Promise.reject(new Error('尚未配置'));
button('测试金蝶供应商连接').props.onClick();await new Promise(resolve=>setTimeout(resolve,0));html=render();assert.ok(html.includes('尚未配置'));assert.ok(!html.includes('首批返回 1 条'));
delete globalThis.__supplierDiagnosticUi;
console.log('PASS supplier read-only diagnostic UI requires a click, hides source rows and reports errors without claiming sync');
