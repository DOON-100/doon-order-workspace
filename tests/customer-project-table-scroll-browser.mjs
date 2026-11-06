// Synthetic React/CPTable fixture on an ephemeral port; no workspace data or service is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const built=await build({stdin:{contents:`import React,{StrictMode,useState} from 'react';import {createRoot} from 'react-dom/client';import {CPTable} from './app/customer-project-ui';import {CustomerProjectTableScroll} from './app/customer-project-table-scroll';import './app/customer-projects.css';import './app/customer-project-responsibility.css';
const headers=Array.from({length:10},(_,i)=>'字段'+(i+1));const rows=Array.from({length:40},(_,i)=>headers.map((_,j)=>j===0?(i%2?'组乙':'组甲'):'合成内容 '+i+' / '+j));function Fixture(){const [version,setVersion]=useState(0);return <main className="cp-workspace"><button onClick={()=>setVersion(v=>v+1)}>重新渲染 {version}</button><section className="scp-board"><CustomerProjectTableScroll storageKey="synthetic-a" label="项目清单" defaultWidths={headers.map(()=>160)}><CPTable headers={headers} rows={rows}/></CustomerProjectTableScroll></section><section className="cp-section"><CustomerProjectTableScroll storageKey="synthetic-b" label="关联客户跟进" defaultWidths={[220,220]}><CPTable headers={headers.slice(0,2)} rows={rows.slice(0,2).map(row=>row.slice(0,2))}/></CustomerProjectTableScroll></section></main>}createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false,outdir:'test-output/project-scroll-fixture',alias:{'@':process.cwd()},plugins:[{name:'synthetic-followup',setup(b){b.onResolve({filter:/business-followup-panel$/},()=>({path:'slot',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export function BusinessFollowupSlot(){return null;}'}));}}]});
const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text,css=built.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:12px;box-sizing:border-box}*{box-sizing:border-box}main{max-width:100%;min-width:0}.cp-section{margin-top:18px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;assert(![8787,8797].includes(port));
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:process.env.DOON_BROWSER_CHANNEL||'msedge'})});
 const page=await browser.newPage({viewport:{width:760,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+port);const wrapper=page.locator('[aria-label="项目清单滚动与列宽"]'),view=wrapper.locator(':scope > .cp-table-scroll'),rail=wrapper.locator('.cp-project-scroll-rail'),other=page.locator('[aria-label="关联客户跟进滚动与列宽"]');
 await wrapper.getByRole('separator').first().waitFor();
 const width=()=>wrapper.getByRole('separator').first().getAttribute('aria-valuenow');
 const original=Number(await width()),otherOriginal=await other.getByRole('separator').first().getAttribute('aria-valuenow');
 assert.equal(original,160,'Initial widths use the supplied readable defaults');assert.equal(otherOriginal,'220');
 const eventually=async check=>{let last;for(let i=0;i<80;i++){try{return await check();}catch(e){last=e;await new Promise(resolve=>setTimeout(resolve,25));}}throw last;};
 assert.equal(await other.locator('.cp-project-scroll-tools').isVisible(),false,'No overflow hides the scrollbar controls');
 await wrapper.getByRole('button',{name:'项目清单向右移动'}).click();await eventually(async()=>{assert((await view.evaluate(node=>node.scrollLeft))>0);assert.equal(await rail.evaluate(node=>node.scrollLeft),await view.evaluate(node=>node.scrollLeft));});
 await rail.evaluate(node=>node.scrollLeft=1e6);await eventually(async()=>{const value=await view.evaluate(node=>({left:node.scrollLeft,max:node.scrollWidth-node.clientWidth}));assert(Math.abs(value.left-value.max)<=1,JSON.stringify({value,rail:await rail.evaluate(node=>({left:node.scrollLeft,max:node.scrollWidth-node.clientWidth}))}));assert(await wrapper.getByRole('button',{name:'项目清单向右移动'}).isDisabled());});
 await view.evaluate(node=>node.scrollLeft=0);await eventually(async()=>{assert.equal(await rail.evaluate(node=>node.scrollLeft),0);assert(await wrapper.getByRole('button',{name:'项目清单向左移动'}).isDisabled());});
 const handle=wrapper.getByRole('separator').first(),box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+125,box.y+box.height/2,{steps:6});await page.mouse.up();
 await eventually(async()=>assert.equal(Number(await width()),original+125));assert.equal(await other.getByRole('separator').first().getAttribute('aria-valuenow'),otherOriginal);
 assert.equal(await page.locator('.excel-filter-popover').count(),0,'Column drag must not open filtering');
 await page.getByRole('button',{name:'重新渲染 0'}).click();assert.equal(Number(await width()),original+125,'React rerender keeps widths');
 assert.equal(await wrapper.getByRole('separator').count(),10,'Rerender must not duplicate column handles');
 await wrapper.getByRole('button',{name:'筛选字段1',exact:true}).click();const popover=page.getByRole('dialog',{name:'筛选字段1'});await page.getByRole('button',{name:'按条件筛选'}).click();await page.getByLabel('筛选字段1条件',{exact:true}).selectOption('equals');await page.getByLabel('筛选字段1起始值',{exact:true}).fill('组甲');await page.getByRole('button',{name:'确定',exact:true}).click();
 await eventually(async()=>assert.equal(await wrapper.locator('tbody:not([data-excel-ui]) tr:visible').count(),20));assert.equal(Number(await width()),original+125,'Excel filter rerender keeps widths and handles');
 await view.evaluate(node=>node.scrollTop=180);const sticky=await view.evaluate(node=>({top:node.getBoundingClientRect().top,header:node.querySelector('thead').getBoundingClientRect().top,height:node.clientHeight}));assert(Math.abs(sticky.top-sticky.header)<2);assert(sticky.height<=510);
 assert.equal(await wrapper.locator('tbody:not([data-excel-ui]) tr:visible').first().locator('td').last().evaluate(node=>getComputedStyle(node).position),'static','No pinned final column covers other columns');
 await page.reload();await wrapper.getByRole('separator').first().waitFor();assert.equal(Number(await width()),original+125,'Persisted widths are isolated by table key');
 await handle.focus();await page.keyboard.press('Home');await eventually(async()=>assert.equal(Number(await width()),original));
 await page.keyboard.press('ArrowRight');assert.equal(Number(await width()),original+10);await handle.dblclick();assert.equal(Number(await width()),original);
 await page.setViewportSize({width:420,height:780});await eventually(async()=>{assert(await wrapper.locator('.cp-project-scroll-tools').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
 await view.evaluate(node=>node.scrollLeft=1e6);await eventually(async()=>assert(Math.abs(await rail.evaluate(node=>node.scrollLeft)-await view.evaluate(node=>node.scrollLeft))<=1));
 assert.deepEqual(errors,[]);console.log('PASS top/table scrollbar synchronization, boundary buttons, responsive containment and sticky headers');console.log('PASS pointer/keyboard column resizing, per-table persistence, default restoration and unchanged Excel filtering');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
