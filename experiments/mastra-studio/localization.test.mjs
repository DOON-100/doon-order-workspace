import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {brandStudioScript,studioDisplayLiterals} from './branding.mjs';
import {translateStudioText} from './locale-zh.mjs';
import {localizeStudioWidgets} from './widgets-zh.mjs';

test('界面汉化保留协议、表单值、用户内容、模板参数与代码补全',()=>{
 const source='const name="Workflows",state="success"; const result={id:"Run",status:state,value:"Run",text:name,instructions:"System Prompt",url:"/workflows",name:"Workflows",items:[{type:"keyword",label:"for"}],view:{children:["Workflows",name],title:"System Prompt",placeholder:"Search...","aria-label":`Show ${2} ${true?"tools":"tool"} for ${name}`},input:{value:"Run"}}; result;';
 const result=vm.runInNewContext(brandStudioScript(source));
 assert.equal(result.id,'Run');assert.equal(result.status,'success');assert.equal(result.value,'Run');assert.equal(result.text,'Workflows');assert.equal(result.instructions,'System Prompt');assert.equal(result.url,'/workflows');assert.equal(result.input.value,'Run');
 assert.equal(result.name,'工作流');assert.equal(result.items[0].label,'for');
 assert.equal(result.view.children[0],'工作流');assert.equal(result.view.children[1],'Workflows');assert.equal(result.view.title,'系统 prompt');assert.equal(result.view.placeholder,'搜索…');
 assert.equal(result.view['aria-label'],'显示 2 工具 用于 Workflows');
 assert.equal(translateStudioText('agent'),'agent');assert.equal(translateStudioText('prompt'),'prompt');
});

test('当前官方主资源可解析，导航、默认标签及通知已汉化，非界面字面量保持原样',async()=>{
 const assets=path.join(path.dirname(fileURLToPath(import.meta.resolve('mastra/package.json'))),'dist/studio/assets');
 const main=(await fs.readdir(assets)).find(file=>/^main-.*\.js$/.test(file));
 const source=await fs.readFile(path.join(assets,main),'utf8'),localized=brandStudioScript(source);
 parse(localized,{ecmaVersion:'latest',sourceType:'module'});
 const originalNodes=studioDisplayLiterals(source),translatedNodes=studioDisplayLiterals(localized);
 const values=new Set(translatedNodes.map(n=>n.value));
 for(const expected of ['工作流','运行轨迹','指标','日志','模型设置','打开配置','打开导航菜单','系统 prompt','数据集','评分器','工作空间','定时任务','主题','通知','未开始','下次运行输入','默认','选择选项','升序','安全拦截已阻止'])assert(values.has(expected),expected);
 for(const english of ['Workflows','Traces','Metrics','Logs','System Prompt','Open configuration','Open navigation menu','Select option','Notifications'])assert(!values.has(english),english);
 assert(originalNodes.some(n=>n.value==='Agent deleted'),'核对固定版本的通知文案');assert.match(source,/Xe\.success\("Agent deleted"\)/);assert.match(localized,/Xe\.success\("agent 已删除"\)/);
 for(const helper of ['Zcr','Zrt','F4s'])assert.match(source,new RegExp('function '+helper+'\\('),'核对当前版本的界面格式化函数');
 assert.match(localized,/lXe=\{running:"运行中",success:"已完成",failed:"失败"/,'只改显示表的值，状态键保留');
 // Translation only changes the identified source ranges. All surrounding
 // executable code, including enum comparisons and API request values, survives.
 let before=0,after=0;
 for(let i=0;i<originalNodes.length;i++){
  const left=originalNodes[i],right=translatedNodes[i];
  // Traversal order is stable even though offsets change with Chinese text.
  assert.equal(right.value,translateStudioText(left.value));
 }
 const sortedOriginal=[...originalNodes].sort((a,b)=>a.start-b.start),sortedTranslated=[...translatedNodes].sort((a,b)=>a.start-b.start);
 assert.equal(sortedOriginal.length,sortedTranslated.length);
 for(let i=0;i<sortedOriginal.length;i++){
  const left=sortedOriginal[i],right=sortedTranslated[i];assert.equal(source.slice(before,left.start),localized.slice(after,right.start));before=left.end;after=right.end;
 }
 assert.equal(source.slice(before),localized.slice(after));
});

test('发布包包含翻译模块，自有页面没有遗留 Studio 或 Editor 标签',async()=>{
 const docker=await fs.readFile(new URL('../agent-server/Dockerfile.dockerignore',import.meta.url),'utf8');assert.match(docker,/!mastra-studio\/locale-zh\.mjs/);
 for(const file of ['agent-manager.html','workflow-manager.html','workflow-preview.html','workflow-schedules.html']){
  const html=await fs.readFile(new URL(file,import.meta.url),'utf8');assert.match(html,/<html lang="zh-CN">/);assert(!/Agent Studio|System Prompt|Studio Editor/.test(html));
  for(const [,text] of html.matchAll(/>([^<>]+)</g))assert(!/[A-Za-z]/.test(text.replace(/\b(?:agent|prompt|DOON)\b/g,'')),`${file}: ${text.trim()}`);
 }
});

test('中文日历和上午下午只改变显示，日期对象、选项索引及回调保持原样',async()=>{
 const assets=path.join(path.dirname(fileURLToPath(import.meta.resolve('mastra/package.json'))),'dist/studio/assets');
 const main=(await fs.readdir(assets)).find(file=>/^main-.*\.js$/.test(file)),source=await fs.readFile(path.join(assets,main),'utf8');
 const localized=localizeStudioWidgets(source),ast=parse(localized,{ecmaVersion:'latest',sourceType:'module'});
 const functions=Object.fromEntries(ast.body.filter(n=>n.type==='FunctionDeclaration'&&['Kpe','Zae'].includes(n.id?.name)).map(n=>[n.id.name,localized.slice(n.start,n.end)]));assert.equal(Object.keys(functions).length,2,'核对固定版本的日历和时间控件');
 const jsx=(type,props)=>({type,...props}),scope={a:{jsx,jsxs:jsx},gor:'calendar',Z:(...args)=>args.filter(Boolean).join(' '),Zn:'',ps:'select',gs:'trigger',ms:'value',vs:'menu',hr:'option'};
 const calendar=vm.runInNewContext('('+functions.Kpe+')({onSelect:selected})',{...scope,selected:value=>value});
 const date=new Date(2026,9,19);assert.equal(calendar.formatters.formatCaption(date),'2026年10月');assert.equal(calendar.formatters.formatWeekdayName(date),'一');assert.equal(calendar.labels.labelNext(),'下个月');assert.equal(calendar.onSelect(date),date);assert.equal(calendar.showOutsideDays,true);
 const changes=[];const time=vm.runInNewContext('('+functions.Zae+')({label:"上午或下午",options:["AM","PM"],value:"PM",onValueChange:change})',{...scope,change:index=>changes.push(index)});
 assert.equal(time.value,'1');assert.deepEqual(Array.from(time.children[1].children,row=>row.children),['上午','下午']);assert.deepEqual(Array.from(time.children[1].children,row=>row.value),['0','1']);time.onValueChange('0');assert.deepEqual(changes,['0']);
});
