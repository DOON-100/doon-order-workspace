// Synthetic React/CPTable fixture on an ephemeral port; no workspace data or service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const headers=['客户','项目','最新记录 / 日期与进展','下一步事项','事项跟进人','截止日期','所属组','开发阶段','业务负责人','客服负责人','操作'];
const defaults=[140,180,210,160,145,130,175,155,170,160,200];
const built=await build({stdin:{contents:`
import React,{StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CPTable} from './app/customer-project-ui';
import {CustomerProjectTableScroll} from './app/customer-project-table-scroll';
import './app/customer-projects.css';
import './app/customer-project-responsibility.css';
const headers=${JSON.stringify(headers)}, widths=${JSON.stringify(defaults)};
const rows=Array.from({length:40},(_,i)=>headers.map((_,j)=>j===0?(i%2?'组乙':'组甲'):j===1?(i%3?'短项目 '+i:'项目名称明显长于表头，含型号 SYNTHETIC-PROJECT-'+i):j===2?(i%2?'简短记录':'合成进展内容需要自动换行，验证长短内容使用同一套列宽和框线，不能使表头单独扩张。'):j===10?<button>末列操作 {i}</button>:'合成 '+i+' / '+j));
const targets=rows.map((_,i)=>i===0?{collection:'synthetic',recordId:'synthetic-0'}:null);
function Fixture(){const [version,setVersion]=useState(0);return <main className="cp-workspace">
 <button onClick={()=>setVersion(v=>v+1)}>重新渲染 {version}</button>
 <section className="scp-board"><CustomerProjectTableScroll storageKey="synthetic-frozen" label="项目清单" defaultWidths={widths} frozenColumns={2}><CPTable headers={headers} rows={rows} recordTargets={targets}/></CustomerProjectTableScroll></section>
 <section className="cp-section"><CustomerProjectTableScroll storageKey="synthetic-plain" label="项目进展记录" defaultWidths={widths}><CPTable headers={headers} rows={rows}/></CustomerProjectTableScroll></section>
 <section className="cp-section"><CustomerProjectTableScroll storageKey="synthetic-small" label="关联客户跟进" defaultWidths={[220,220]}><CPTable headers={headers.slice(0,2)} rows={rows.slice(0,2).map(row=>row.slice(0,2))}/></CustomerProjectTableScroll></section>
 <section className="scp-board"><CustomerProjectTableScroll storageKey="synthetic-empty" label="空清单" defaultWidths={widths} frozenColumns={2}><CPTable headers={headers} rows={[]} empty="合成空清单"/></CustomerProjectTableScroll></section>
</main>}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false,outdir:'test-output/project-scroll-fixture',alias:{'@':process.cwd()},plugins:[{name:'synthetic-followup',setup(b){b.onResolve({filter:/business-followup-panel$/},()=>({path:'slot',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export function BusinessFollowupSlot(){return "合成附件关联行";}'}));}}]});
const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text,css=built.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:12px;box-sizing:border-box}*{box-sizing:border-box}main{max-width:100%;min-width:0}.cp-section{margin-top:18px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;assert(![8787,8797].includes(port));
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const eventually=async check=>{let last;for(let i=0;i<100;i++){try{return await check();}catch(e){last=e;await new Promise(resolve=>setTimeout(resolve,25));}}throw last;};
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<=1,`${message}: ${actual} != ${expected}`);
const viewport=wrapper=>wrapper.locator(':scope > .cp-table-scroll');
const width=(wrapper,index)=>wrapper.getByRole('separator').nth(index).getAttribute('aria-valuenow').then(Number);
async function geometry(wrapper){return wrapper.locator('table').evaluate(table=>{
 const rect=cell=>{const r=cell.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,top:r.top,bottom:r.bottom,position:getComputedStyle(cell).position};};
 const header=Array.from(table.tHead.rows[0].cells).map(rect);
 const rows=Array.from(table.querySelectorAll('tbody:not([data-excel-ui]) > tr')).filter(row=>row.cells.length===header.length&&!row.hidden&&getComputedStyle(row).display!=='none');
 return {header,rows:rows.filter((_,i)=>i===0||i===7||i===rows.length-1).map(row=>Array.from(row.cells).map(rect))};
});}
async function assertAligned(wrapper){
 const value=await geometry(wrapper);assert(value.rows.length,'Alignment fixture must include actual data rows');
 for(const row of value.rows)for(let i=0;i<value.header.length;i++)for(const edge of ['x','right','width'])near(row[i][edge],value.header[i][edge],`Column ${i+1} header/body ${edge}`);
 for(let i=0;i<value.header.length;i++)near(value.header[i].width,await width(wrapper,i),`Column ${i+1} rendered and saved width`);
 return value;
}
async function scrollTo(wrapper,left,top=0){
 await viewport(wrapper).evaluate((node,value)=>{node.scrollLeft=value.left;node.scrollTop=value.top;},{left,top});
 await eventually(async()=>near(await wrapper.locator('.cp-project-scroll-rail').evaluate(node=>node.scrollLeft),await viewport(wrapper).evaluate(node=>node.scrollLeft),'Native scrollbar synchronization'));
}
async function drag(page,wrapper,index,distance){
 // Reveal the wrapper, not the unscrolled layout position of a sticky cell.
 await wrapper.scrollIntoViewIfNeeded();await viewport(wrapper).evaluate(node=>node.scrollTop=0);
 const handle=wrapper.getByRole('separator').nth(index),before=await width(wrapper,index),box=await handle.boundingBox();assert(box);
 assert(await handle.evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node;}),'Column handle must be actually reachable');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+distance,box.y+box.height/2,{steps:6});await page.mouse.up();
 await eventually(async()=>assert.equal(await width(wrapper,index),before+distance));
 assert.equal(await page.locator('.excel-filter-popover').count(),0,'Column drag must not open filtering');
 await assertAligned(wrapper);return before+distance;
}
async function assertLayers(wrapper){
 const result=await viewport(wrapper).evaluate(view=>{
  const table=view.querySelector('table'),heads=Array.from(table.tHead.rows[0].cells),vr=view.getBoundingClientRect(),hr=table.tHead.getBoundingClientRect();
  const dataRows=Array.from(table.querySelectorAll('tbody:not([data-excel-ui]) > tr')).filter(row=>row.cells.length===heads.length);
  const row=dataRows.find(row=>{const r=row.getBoundingClientRect();return r.top>=hr.bottom+2&&r.bottom<vr.bottom-2;});
  const sample=cell=>{const r=cell.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {covered:hit?.closest('th,td')!==cell,background:getComputedStyle(cell).backgroundColor};};
  const secondRight=heads[1].getBoundingClientRect().right;
  const movingHead=heads.find((cell,index)=>{const r=cell.getBoundingClientRect();return index>=2&&r.right>secondRight+25&&r.left<vr.right-25;});
  const moving=()=>{const r=movingHead.getBoundingClientRect(),x=Math.max(r.x+5,secondRight+10),y=r.y+r.height/2;return document.elementFromPoint(x,y)?.closest('th')===movingHead;};
  return {top:vr.top,headerTop:hr.top,heads:heads.slice(0,2).map(sample),body:row?Array.from(row.cells).slice(0,2).map(sample):[],movingHeaderVisible:!!movingHead&&moving()};
 });
 near(result.top,result.headerTop,'Header stays vertically pinned');assert.equal(result.body.length,2,'Layer test must have fully visible body cells');
 for(const sample of [...result.heads,...result.body]){assert.equal(sample.covered,false,'Frozen header/body cell must be above sliding content');assert(!['transparent','rgba(0, 0, 0, 0)'].includes(sample.background),'Frozen cells require an opaque background');}
 assert(result.movingHeaderVisible,'Nonfrozen visible header must remain above vertically scrolling cells');
}
async function filterCustomer(page,wrapper,value){
 await wrapper.getByRole('button',{name:'筛选客户',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'筛选客户',exact:true});
 await popup.getByRole('button',{name:'按条件筛选',exact:true}).click();
 await popup.getByLabel('筛选客户条件',{exact:true}).selectOption('equals');
 await popup.getByLabel('筛选客户起始值',{exact:true}).fill(value);
 await popup.getByRole('button',{name:'确定',exact:true}).click();
}
let browser,page,artifacts;
try{
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:process.env.DOON_BROWSER_CHANNEL||'msedge'})});
 page=await browser.newPage({viewport:{width:900,height:950}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+port);
 const wrapper=page.locator('[aria-label="项目清单滚动与列宽"]'),plain=page.locator('[aria-label="项目进展记录滚动与列宽"]'),small=page.locator('[aria-label="关联客户跟进滚动与列宽"]'),empty=page.locator('[aria-label="空清单滚动与列宽"]');
 await wrapper.getByRole('separator').first().waitFor();
 assert.equal(await width(wrapper,0),defaults[0]);assert.equal(await width(small,0),220);
 assert.equal(await small.locator('.cp-project-scroll-tools').isVisible(),false,'No overflow hides the scrollbar controls');
 for(const [current,frozen] of [[wrapper,2],[plain,0]]){
  await current.scrollIntoViewIfNeeded();await scrollTo(current,0);const before=await assertAligned(current);
  await current.getByRole('button',{name:/向右移动/}).click();
  await eventually(async()=>assert((await viewport(current).evaluate(node=>node.scrollLeft))>0));
  const left=await viewport(current).evaluate(node=>node.scrollLeft),after=await assertAligned(current);
  for(let i=0;i<headers.length;i++){
   near(after.header[i].x,before.header[i].x-(i<frozen?0:left),`Frozen ${frozen}: header ${i+1} horizontal movement`);
   near(after.rows[0][i].x,before.rows[0][i].x-(i<frozen?0:left),`Frozen ${frozen}: body ${i+1} horizontal movement`);
   assert.equal(after.rows[0][i].position,i<frozen?'sticky':'static');
  }
  await current.locator('.cp-project-scroll-rail').evaluate(node=>node.scrollLeft=1e6);
  await eventually(async()=>{const value=await viewport(current).evaluate(node=>({left:node.scrollLeft,max:node.scrollWidth-node.clientWidth}));near(value.left,value.max,'Top rail reaches actual final column');assert(await current.getByRole('button',{name:/向右移动/}).isDisabled());});
  const last=await viewport(current).evaluate(node=>{const view=node.getBoundingClientRect(),cells=node.querySelector('thead tr').cells,last=cells[cells.length-1].getBoundingClientRect();return {right:last.right,viewRight:view.left+node.clientWidth,left:last.left,frozenRight:cells[1].getBoundingClientRect().right};});
  near(last.right,last.viewRight,'Last column right border is fully reachable');assert(last.left>=last.frozenRight-1,'Last column is not covered by frozen columns');
  await assertAligned(current);await scrollTo(current,0);
 }
 console.log('PASS different-length headers and content share actual column boundaries; frozenColumns=0/2 and final-column reachability');

 await wrapper.scrollIntoViewIfNeeded();await scrollTo(wrapper,260);
 const frozenBefore=await geometry(wrapper),first=await drag(page,wrapper,0,75),afterFirst=await geometry(wrapper);
 near(afterFirst.header[0].x,frozenBefore.header[0].x,'First frozen column anchor after resize');
 near(afterFirst.header[1].x,afterFirst.header[0].right,'Second frozen offset updates immediately after first-column drag');
 near(afterFirst.rows[0][1].x,afterFirst.rows[0][0].right,'Body second frozen offset updates immediately');
 const second=await drag(page,wrapper,1,55),afterSecond=await geometry(wrapper);
 near(afterSecond.header[1].x,afterSecond.header[0].right,'Second frozen anchor after its own drag');
 near(afterSecond.header[1].width,second,'Second frozen width after drag');
 assert.equal(await width(plain,0),defaults[0]);assert.equal(await width(plain,1),defaults[1]);
 await page.getByRole('button',{name:'重新渲染 0'}).click();
 await eventually(async()=>assert.equal(await wrapper.getByRole('separator').count(),headers.length));
 assert.equal(await width(wrapper,0),first);assert.equal(await width(wrapper,1),second);await assertAligned(wrapper);
 await scrollTo(wrapper,240,220);await assertLayers(wrapper);
 assert.equal(await viewport(wrapper).evaluate(node=>node.clientHeight<=570),true);
 const companions=await wrapper.locator('.business-followup-record-row td').evaluateAll(cells=>cells.map(cell=>({span:cell.colSpan,position:getComputedStyle(cell).position})));
 assert.deepEqual(companions,[{span:headers.length,position:'static'}],'Associated full-width rows must not be frozen');
 await empty.scrollIntoViewIfNeeded();await scrollTo(empty,250);
 assert.equal(await empty.locator('tbody td[colspan]').evaluate(cell=>getComputedStyle(cell).position),'static','Initial empty table spanning cell must not be frozen');
 console.log('PASS dragging either frozen column updates offsets; vertical/horizontal intersections stay opaque and clickable; spanning rows are not frozen');

 await wrapper.scrollIntoViewIfNeeded();await scrollTo(wrapper,240);
 await filterCustomer(page,wrapper,'组甲');
 await eventually(async()=>assert.equal(await wrapper.locator('tbody:not([data-excel-ui]) tr:not(.business-followup-record-row):visible').count(),20));
 assert.equal(await width(wrapper,0),first);assert.equal(await width(wrapper,1),second);await assertAligned(wrapper);
 await filterCustomer(page,wrapper,'不存在的合成客户');
 await eventually(async()=>assert.equal(await wrapper.locator('tbody:not([data-excel-ui]) tr:visible').count(),0));
 const emptyStatus=await wrapper.locator('.excel-filter-status td').evaluate(cell=>({span:cell.colSpan,position:getComputedStyle(cell).position}));
 assert.deepEqual(emptyStatus,{span:headers.length,position:'static'},'Zero-result filter status must remain a normal full-width row');
 await wrapper.getByRole('button',{name:'清除全部筛选',exact:true}).click();
 await eventually(async()=>assert.equal(await wrapper.locator('tbody:not([data-excel-ui]) tr:not(.business-followup-record-row):visible').count(),40));
 await assertAligned(wrapper);
 await page.reload();await wrapper.getByRole('separator').first().waitFor();
 assert.equal(await width(wrapper,0),first);assert.equal(await width(wrapper,1),second);await assertAligned(wrapper);
 await scrollTo(wrapper,250,220);await assertLayers(wrapper);await scrollTo(wrapper,250);
 const firstHandle=wrapper.getByRole('separator').nth(0),secondHandle=wrapper.getByRole('separator').nth(1);
 await firstHandle.focus();await page.keyboard.press('Home');await eventually(async()=>assert.equal(await width(wrapper,0),defaults[0]));
 near((await geometry(wrapper)).header[1].x,(await geometry(wrapper)).header[0].right,'Reset first width updates frozen offsets');
 await firstHandle.focus();await page.keyboard.press('ArrowRight');assert.equal(await width(wrapper,0),defaults[0]+10);await firstHandle.dblclick();assert.equal(await width(wrapper,0),defaults[0]);
 await secondHandle.dblclick();assert.equal(await width(wrapper,1),defaults[1]);await assertAligned(wrapper);
 await page.reload();await wrapper.getByRole('separator').first().waitFor();assert.equal(await width(wrapper,0),defaults[0]);assert.equal(await width(wrapper,1),defaults[1]);
 await page.setViewportSize({width:420,height:780});await wrapper.scrollIntoViewIfNeeded();
 await eventually(async()=>{assert(await wrapper.locator('.cp-project-scroll-tools').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
 await scrollTo(wrapper,1e6);await assertAligned(wrapper);
 await page.setViewportSize({width:900,height:950});await wrapper.scrollIntoViewIfNeeded();await scrollTo(wrapper,420,180);await assertLayers(wrapper);
 await fs.mkdir('test-output',{recursive:true});artifacts=await fs.mkdtemp(path.resolve('test-output/customer-project-scroll-'));
 await page.screenshot({path:path.join(artifacts,'frozen-columns.png'),fullPage:false});
 assert.deepEqual(errors,[]);
 console.log('PASS Excel filtering and zero results, per-table saved widths, keyboard/default reset, responsive containment and sticky-header layering');
 console.log(JSON.stringify({passed:3,port,syntheticOnly:true,artifacts}));
}catch(error){
 if(page){await fs.mkdir('test-output',{recursive:true});artifacts||=await fs.mkdtemp(path.resolve('test-output/customer-project-scroll-'));await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});console.error('Synthetic screenshots: '+artifacts);}
 throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
