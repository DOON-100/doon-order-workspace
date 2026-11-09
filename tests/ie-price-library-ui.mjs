// Synthetic component interactions and SSR only; this is not a browser or end-to-end test.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output','ie-price-library-ui-'+process.pid);await fs.mkdir(output,{recursive:true});
const H={slots:[],index:0,effects:[],calls:[],dirty:[],saved:0,errors:[],response:null};
globalThis.__iePriceLibraryUi=H;
const previousWindow=globalThis.window;globalThis.window={confirm:()=>false};
const modules={
 react:`const H=globalThis.__iePriceLibraryUi;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v}]}export function useRef(initial){const i=H.index++;return H.slots[i]||(H.slots[i]={current:initial})}export function useEffect(fn,deps){const i=H.index++,old=H.slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){H.slots[i]={deps,cleanup:old?.cleanup};H.effects.push(()=>{H.slots[i].cleanup?.();H.slots[i].cleanup=fn()})}}export const useMemo=fn=>fn();export const useCallback=fn=>fn;`,
 button:`export const Button='button';`,
 table:`export const ExcelTable='table';`,
 evidence:`export function IeSupplierEvidencePanel(){return null}`,
 team:`export async function businessTeamFetch(url,options){const h=globalThis.__iePriceLibraryUi;h.calls.push({url,options});return {ok:true,json:async()=>h.response}}export async function downloadBusinessTeamFile(){throw Error('No network permitted in synthetic test')}`,
};
const outfile=path.join(output,'ui.mjs');
await build({entryPoints:['app/ie-price-library-panel.tsx'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'synthetic-ui',setup(b){for(const [re,name] of [[/^react$/,'react'],[/components\/ui\/button$/,'button'],[/^\.\/excel-table$/,'table'],[/^\.\/business-team-client$/,'team'],[/^\.\/ie-supplier-evidence-panel$/,'evidence']])b.onResolve({filter:re},()=>({path:name,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:modules[a.path],loader:'jsx'}));}}]});
const {IePriceLibraryPanel}=await import(pathToFileURL(outfile).href);
const catalog=[{id:'synthetic-price',version:1,category:'process',name:'合成工序',supplier:'合成供应商',specification:'合成规格',unit:'副',basePrice:0,standardSeconds:30,priceSource:'合成来源',effectiveDate:'2026-11-09',active:true,currency:'CNY',taxBasis:'exclusive',taxRate:0,frameType:'合成架型',processType:'合成类别',color:'合成颜色',notes:'合成备注'}];
const callbacks={onDirtyChange:v=>H.dirty.push(v),onSaved:async()=>{H.saved++},onError:cause=>H.errors.push(cause)};
let tree,canEdit=false;
function render(){H.index=0;tree=IePriceLibraryPanel({catalog,canEdit,...callbacks});const html=renderToStaticMarkup(tree);H.effects.splice(0).forEach(fn=>fn());return html;}
function nodes(n=tree,out=[]){if(Array.isArray(n)){n.forEach(x=>nodes(x??null,out));return out;}if(n&&typeof n==='object'){out.push(n);if(typeof n.type==='function')nodes(n.type(n.props)??null,out);else nodes(n.props?.children??null,out);}return out;}
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):'';
const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
const field=label=>nodes().find(n=>n.type==='label'&&text(n.props.children?.[0])===label);
const inputFor=label=>nodes(field(label)).find(n=>n.type==='input');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
try{
 let html=render();assert(html.includes('合成供应商'));assert(html.includes('标准秒数'));assert(!button('＋ 新增价格 / 工艺'));assert(!button('修改'));assert(!html.includes('上传供应商报价表 / 标准人工单价表'));assert.equal(H.calls.length,0);
 canEdit=true;html=render();button('＋ 新增价格 / 工艺').props.onClick();html=render();assert(html.includes('新增价格 / 工艺'));assert.equal(H.dirty.at(-1),true);
 const basePrice=nodes().find(n=>n.type==='input'&&n.props['aria-label']==='目录基价');basePrice.props.onChange({target:{value:'0'}});html=render();assert.equal(nodes().find(n=>n.type==='input'&&n.props['aria-label']==='目录基价').props.value,'0');
 button('关闭编辑').props.onClick();html=render();assert(html.includes('新增价格 / 工艺'),'拒绝放弃草稿时应保留编辑');
 globalThis.window.confirm=()=>true;button('关闭编辑').props.onClick();html=render();assert(!html.includes('<h3>新增价格 / 工艺</h3>'));assert.equal(H.dirty.at(-1),false);
 const upload=inputFor('供应商原始 Excel 报价表');assert(upload);assert.equal(upload.props.accept,'.xlsx');const source=new File(['synthetic'],'synthetic.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 upload.props.ref.current={value:'synthetic.xlsx'};upload.props.onChange({target:{files:[source]}});html=render();assert.equal(H.dirty.at(-1),true);
 H.response={id:'synthetic-import',filename:'synthetic.xlsx',sha256:'synthetic-only',issues:[],sheets:['合成表'],rows:[{rowId:1,sheetName:'合成表',sourceRow:2,status:'new',issues:[],entry:catalog[0]},{rowId:2,sheetName:'合成表',sourceRow:3,status:'error',issues:['合成错误'],entry:catalog[0]}]};
 button('读取并预览').props.onClick();await tick();html=render();assert.equal(H.calls.length,1);assert(H.calls[0].url.endsWith('ie-quote-catalog-import-preview'));assert.equal(H.calls[0].options.body.get('file').name,'synthetic.xlsx');assert(button('确认导入选中 1 行'));assert.equal(nodes().find(n=>n.type==='input'&&n.props['aria-label']==='选择原表第3行').props.disabled,true);
 button('取消本次上传').props.onClick();html=render();assert(!button('确认导入选中 1 行'));assert.equal(upload.props.ref.current.value,'');assert.equal(H.dirty.at(-1),false);assert(!H.calls.some(c=>c.url.endsWith('ie-quote-catalog-import-commit')),'取消只清理本次草稿，不提交入库');assert.equal(H.saved,0);
 canEdit=false;render();html=render();assert(!button('修改'));assert(!button('读取并预览'));assert.equal(H.errors.length,0);
 console.log('PASS IE price library component/SSR: read-only controls, typed zero, discard refusal, upload preview selection, cancel without commit, permission removal. Browser/E2E not exercised.');
}finally{delete globalThis.__iePriceLibraryUi;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}

// Use the actual comparison and ExcelTable components for read-only SSR output.
// No hook mocks here; filtering popovers still need separate browser validation.
const comparisonFile=path.join(output,'comparison.mjs');
await build({entryPoints:['app/ie-catalog-comparison.tsx'],outfile:comparisonFile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',loader:{'.css':'empty'}});
const {IeCatalogComparison}=await import(pathToFileURL(comparisonFile).href);
const base={...catalog[0],category:'material',name:'合成材料',specification:'合成规格',unit:'件',basePrice:0};
const offers=[
 {...base,id:'same',supplier:'同口径供应商'},
 {...base,id:'wrong-spec',supplier:'异规格供应商',specification:'其他规格'},
 {...base,id:'wrong-unit',supplier:'异单位供应商',unit:'千件'},
 {...base,id:'wrong-name',supplier:'异物料供应商',name:'其他物料'},
 {...base,id:'inactive',supplier:'停用供应商',active:false},
 {...base,id:'usd',supplier:'外币供应商',currency:'USD'},
 {...base,id:'inclusive',supplier:'含税供应商',taxBasis:'inclusive'},
 {...base,id:'missing-price',supplier:'待填价供应商',basePrice:null},
 {...base,id:'legacy',supplier:'旧目录供应商',currency:undefined,taxBasis:undefined},
];
const props={row:{name:'合成材料',specification:'合成规格',unit:'件',catalogId:'old-version',catalogVersion:2},category:'material',catalog:offers,onChange(){}};
const comparisonHtml=renderToStaticMarkup(React.createElement(IeCatalogComparison,props));
for(const supplier of ['同口径供应商','外币供应商','含税供应商','待填价供应商','旧目录供应商'])assert(comparisonHtml.includes(supplier));
for(const supplier of ['异规格供应商','异单位供应商','异物料供应商','停用供应商'])assert(!comparisonHtml.includes(supplier));
for(const header of ['供应商','名称','规格','单位','基价','币种','税口径','加收税点','架型','工艺类别','颜色','生效日期','版本','价格来源','备注'])assert(comparisonHtml.includes('>'+header+'<'));
assert(comparisonHtml.includes('保留历史价格'));assert(comparisonHtml.includes('未税（旧目录）'));assert(comparisonHtml.includes('>0<'),'明确零报价必须显示为零');
const rows=comparisonHtml.match(/<tr[^>]*>.*?<\/tr>/g)||[];
for(const supplier of ['外币供应商','含税供应商','待填价供应商'])assert(rows.find(row=>row.includes(supplier))?.includes('disabled=""'),'不可直接采用：'+supplier);
for(const supplier of ['同口径供应商','旧目录供应商'])assert(!rows.find(row=>row.includes(supplier))?.includes('disabled=""'),'可选人民币未税报价：'+supplier);
const readonlyHtml=renderToStaticMarkup(React.createElement(IeCatalogComparison,{...props,disabled:true}));
const readonlyRows=readonlyHtml.match(/<tr[^>]*>.*?<\/tr>/g)||[];
assert(readonlyRows.filter(row=>row.includes('<td')).every(row=>row.includes('disabled=""')),'只读时所有选用按钮禁用');
console.log('PASS IE comparison SSR: material/spec/unit identity, inactive exclusion, all comparison fields, zero/legacy prices, foreign/inclusive/missing-price and read-only restrictions, historical reference. Browser/E2E not exercised.');
