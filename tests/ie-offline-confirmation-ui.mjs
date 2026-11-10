import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Synthetic hooks exercise form state and submit guards without any real account,
// quote, workbook or network. Browser acceptance covers the actual saved record.
const built=await build({stdin:{contents:"export * from './app/ie-offline-confirmation-panel';export * from './app/ie-quote-confirmation';export * from './app/ie-source-formula-panel';export {startRender,flushEffects,resetHooks} from 'react';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'offline-confirmation-ui-harness',setup(b){
 b.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:'jsx',namespace:'synthetic'}));
 b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'synthetic'}));
 b.onResolve({filter:/components\/ui\/button$/},()=>({path:'button',namespace:'synthetic'}));
 b.onResolve({filter:/^\.\/ui$/},()=>({path:'date',namespace:'synthetic'}));
 b.onResolve({filter:/^\.\/excel-table$/},()=>({path:'table',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='jsx'?"export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;export const Fragment='fragment';":a.path==='hooks'?"let values=[],dependencies=[],cursor=0,effects=[];export const startRender=()=>{cursor=0;effects=[]};export const resetHooks=()=>{values=[];dependencies=[];cursor=0;effects=[]};export const flushEffects=()=>{let pending=effects;effects=[];for(const run of pending)run();return pending.length};export const useState=(initial)=>{let i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]};export const useEffect=(run,deps)=>{let i=cursor++;if(!dependencies[i]||deps.some((v,n)=>v!==dependencies[i][n])){dependencies[i]=deps;effects.push(run)}};":a.path==='date'?"export const dateTime=value=>String(value);":a.path==='button'?"export const Button='button';":"export const ExcelTable='table';"}));
}}]});
const {IeOfflineConfirmationPanel,IeSourceFormulaPanel,isIeOfflineConfirmed,ieQuoteDisplayStatus,ieQuoteFilterStatus,ieQuoteWorkbookDownloadText,IE_OFFLINE_CONFIRMED_LABEL,startRender,flushEffects,resetHooks}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=(node,out=[])=>{if(Array.isArray(node))node.forEach(n=>nodes(n,out));else if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children,out);}return out;};
const content=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(content).join(''):typeof node==='object'?content(node.props?.children):String(node);
const confirmation={id:'confirmation-a',quoteId:'quote-a',quoteVersion:3,contentSha256:'a'.repeat(64),attachmentId:'file-a',attachmentSha256:'b'.repeat(64),confirmedRole:'engineering-supervisor',evidence:'Supervisor confirmed the final workbook offline.',recordedAt:'2026-01-01T00:00:00Z',recordedBy:'Synthetic recorder',recordedById:'recorder-a'};
const quote={id:'quote-a',version:3,status:'draft',canRegisterOfflineConfirmation:true,offlineConfirmationAttachments:[{id:'file-a',originalName:'Synthetic-final.xlsx',size:1024,sha256:'b'.repeat(64)}]};
assert.equal(isIeOfflineConfirmed({...quote,offlineConfirmation:confirmation}),true);
assert.equal(isIeOfflineConfirmed({...quote,offlineConfirmation:confirmation},true),false);
assert.equal(isIeOfflineConfirmed({...quote,version:4,offlineConfirmation:confirmation}),false);
assert.equal(isIeOfflineConfirmed({...quote,id:'quote-b',offlineConfirmation:confirmation}),false);
assert.equal(ieQuoteDisplayStatus({...quote,offlineConfirmation:confirmation}),IE_OFFLINE_CONFIRMED_LABEL);
assert.equal(ieQuoteDisplayStatus({...quote,offlineConfirmation:confirmation},true),'已修改 · 待保存');
assert.equal(ieQuoteFilterStatus({...quote,offlineConfirmation:confirmation}),'offline-confirmed');
assert.equal(ieQuoteFilterStatus({...quote,version:4,offlineConfirmation:confirmation}),'draft');
const confirmedDownload=ieQuoteWorkbookDownloadText({...quote,offlineConfirmation:confirmation});
assert.equal(confirmedDownload.label,'下载已确认报价 Excel');assert.equal(confirmedDownload.suffix,'已确认报价');assert.match(confirmedDownload.notice,/主管线下确认版本/);assert.doesNotMatch(confirmedDownload.notice,/草稿|待审核/);
for(const unconfirmed of [quote,{...quote,version:4,offlineConfirmation:confirmation},{...quote,id:'quote-b',offlineConfirmation:confirmation}]){const draftDownload=ieQuoteWorkbookDownloadText(unconfirmed);assert.equal(draftDownload.label,'下载 Excel 填写草稿');assert.equal(draftDownload.suffix,'填写草稿');assert.match(draftDownload.notice,/填写草稿/);}
let submissions=[],dirtyChanges=[],props={quote,dirty:false,historical:false,disabled:false,onRegister:async values=>{submissions.push(values);},onDirtyChange:value=>dirtyChanges.push(value)},tree;
const render=()=>{for(let i=0;i<8;i++){startRender();tree=IeOfflineConfirmationPanel(props);if(!flushEffects())return tree;}throw new Error('Unexpected unstable effect loop');};
const find=(type,label)=>nodes(tree).find(node=>node.type===type&&node.props['aria-label']===label),button=()=>nodes(tree).find(node=>node.type==='button'&&content(node)==='登记主管已确认');
resetHooks();render();assert.equal(button().props.disabled,true);assert.equal(submissions.length,0);
find('select','线下确认最终Excel原件').props.onChange({target:{value:'file-a'}});find('textarea','主管已确认的依据').props.onChange({target:{value:'Final supervisor confirmation received.'}});render();assert.equal(button().props.disabled,false);assert.equal(dirtyChanges.at(-1),true);
await button().props.onClick();assert.deepEqual(submissions,[{attachmentId:'file-a',evidence:'Final supervisor confirmation received.'}]);
for(const next of [{dirty:true},{historical:true},{disabled:true},{quote:{...quote,canRegisterOfflineConfirmation:false}},{quote:{...quote,offlineConfirmationAttachments:[]}}]){props={...props,quote,dirty:false,historical:false,disabled:false,...next};render();if(button())assert.equal(button().props.disabled,true);const before=submissions.length;if(button())await button().props.onClick();assert.equal(submissions.length,before);}
props={...props,quote:{...quote,offlineConfirmation:confirmation},dirty:false,historical:false,disabled:false};render();assert.match(content(tree),/工程主管已确认（线下）/);assert.match(content(tree),/Synthetic recorder/);assert.match(content(tree),/Supervisor confirmed the final workbook offline/);assert.equal(nodes(tree).some(node=>node.type==='textarea'),false);assert.equal(dirtyChanges.at(-1),false);
const sourceProps={quote:{...quote,offlineConfirmation:confirmation,calculationMode:'source-excel-v1',lines:[{id:'style-a',model:'SYN-A',customerModel:''}]},costs:{lines:[{lineId:'style-a',productionCost:100,sourceMarkupPriceCny:130,factoryPriceUsd:20,factoryPriceCny:130}]},editable:true,dirty:false,onChange:()=>{},onSelectLine:()=>{}};
tree=IeSourceFormulaPanel(sourceProps);assert.match(content(tree),/工程主管已确认（线下）/);assert.doesNotMatch(content(tree),/待 IE 审核/);assert.match(content(tree),/130\.00/);
tree=IeSourceFormulaPanel({...sourceProps,dirty:true});assert.match(content(tree),/待 IE 审核/);assert.doesNotMatch(content(tree),/工程主管已确认（线下）/);
console.log('PASS offline confirmation UI binds the current quote version, displays the actual recorder and evidence, guards registration, clears pending status, and expires confirmation for edits/new versions');
