import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Exercise the actual form callbacks with a synthetic React element tree. Real
// browser checks still verify field editing, table navigation and saved versions.
const built=await build({entryPoints:['app/ie-source-formula-panel.tsx'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'source-formula-ui-harness',setup(b){
 b.onResolve({filter:/^react\/jsx-runtime$/},()=>({path:'jsx',namespace:'synthetic'}));
 b.onResolve({filter:/^\.\/excel-table$/},()=>({path:'table',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='jsx'?"export const jsx=(type,props)=>({type,props:props||{}});export const jsxs=jsx;export const Fragment='fragment';":"export const ExcelTable='table';"}));
}}]});
const {IeSourceFormulaPanel}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=(node,out=[])=>{if(Array.isArray(node))node.forEach(n=>nodes(n,out));else if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children,out);}return out;};
const content=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(content).join(''):typeof node==='object'?content(node.props?.children):String(node);
let patches=[],selected='',props={quote:{id:'synthetic-quote',version:2,status:'draft',calculationMode:'standard',lines:[{id:'style-a',model:'SYN-A',customerModel:'SYN-A-CUSTOMER'},{id:'style-b',model:'SYN-B',customerModel:''}],attachmentRefs:[{attachmentId:'synthetic-original'}]},costs:{lines:[{lineId:'style-a',productionCost:100,sourceMarkupPriceCny:130,factoryPriceUsd:20,factoryPriceCny:130},{lineId:'style-b',productionCost:200,sourceMarkupPriceCny:260,factoryPriceUsd:40,factoryPriceCny:260}]},editable:true,dirty:false,selectedLineId:'style-a',onChange:patch=>{patches.push(patch);props={...props,quote:{...props.quote,...patch},dirty:true};},onSelectLine:id=>{selected=id;}};
let tree;const render=()=>tree=IeSourceFormulaPanel(props),find=(type,label)=>nodes(tree).find(node=>node.type===type&&node.props['aria-label']===label);
render();assert.equal(nodes(tree).some(node=>node.type==='table'),false);
find('select','报价计算方式').props.onChange({target:{value:'source-excel-v1'}});render();
assert.equal(props.quote.calculationMode,'source-excel-v1');assert.equal(props.quote.status,'draft');assert.equal(props.quote.sourceFormula.factoryMarkupRate,.3);
for(const key of ['costExchangeRateCnyPerUsd','quoteExchangeRateCnyPerUsd','finalExchangeRateCnyPerUsd'])assert.equal(props.quote.sourceFormula[key],6.5);
assert.equal(props.quote.exchangeRateCnyPerUsd,6.5);assert.deepEqual(props.quote.attachmentRefs,[{attachmentId:'synthetic-original'}]);assert.equal(props.quote.costs,undefined);
assert.match(content(tree),/最终工厂报价（待 IE 审核）/);assert.match(content(tree),/汇率已统一/);assert.match(content(tree),/130\.00/);assert.match(content(tree),/20\.00/);
assert.equal(find('input','统一汇率 · 1 USD = x CNY').props.value,6.5);assert.equal(nodes(tree).filter(node=>node.type==='input'&&node.props.min==='0.000001').length,1);
console.log('PASS source formula UI opts in without releasing the quote, defaults to one 6.5 exchange rate, preserves original references and displays generated final quotes');

props={...props,quote:{...props.quote,sourceFormula:{...props.quote.sourceFormula,costExchangeRateCnyPerUsd:7,quoteExchangeRateCnyPerUsd:6.5,finalExchangeRateCnyPerUsd:7}}};render();
assert.equal(find('input','统一汇率 · 1 USD = x CNY').props.value,'');assert.match(content(tree),/尚未统一/);
find('input','统一汇率 · 1 USD = x CNY').props.onChange({target:{value:'6.5'}});render();
for(const key of ['costExchangeRateCnyPerUsd','quoteExchangeRateCnyPerUsd','finalExchangeRateCnyPerUsd'])assert.equal(props.quote.sourceFormula[key],'6.5');
assert.equal(props.quote.exchangeRateCnyPerUsd,'6.5');assert.equal(find('input','统一汇率 · 1 USD = x CNY').props.value,6.5);
find('input','成本加价率（%）').props.onChange({target:{value:'35'}});render();assert.equal(props.quote.sourceFormula.factoryMarkupRate,.35);
find('input','成本加价率（%）').props.onChange({target:{value:''}});render();assert.equal(props.quote.sourceFormula.factoryMarkupRate,null);
const style=nodes(tree).find(node=>node.type==='button'&&content(node)==='SYN-B');style.props.onClick();assert.equal(selected,'style-b');
find('select','报价计算方式').props.onChange({target:{value:'standard'}});assert.equal(patches.at(-1).calculationMode,'standard');assert.equal(Object.hasOwn(patches.at(-1),'sourceFormula'),false);
props={...props,editable:false,quote:{...props.quote,calculationMode:'source-excel-v1'}};render();assert(nodes(tree).filter(node=>node.type==='fieldset').every(node=>node.props.disabled===true));
assert.match(content(tree),/来源引用/);assert.match(content(tree),/未表示中台已验证该工作簿/);
console.log('PASS source formula UI unifies all saved formula paths, keeps blank markup editable, supports per-style detail navigation and preserves history/source references in read-only mode');
