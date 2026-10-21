import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {brandStudioScript} from './branding.mjs';
import {localizeStudioWidgets} from './widgets-zh.mjs';

const studioRoot=path.join(path.dirname(fileURLToPath(import.meta.resolve('mastra/package.json'))),'dist','studio');
const brandStyles=new URL('./brand.css',import.meta.url);
const localizedScripts=new Map();
const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const zip=promisify(gzip),compressed=new Map();
const authStatusScript=await fs.readFile(new URL('./auth-status.js',import.meta.url),'utf8');
async function assetResponse(bytes,type,request){
 // Install before the app starts, without another authenticated script request.
 if(type.startsWith('text/html'))bytes=Buffer.from(bytes.toString().replace(/<head(?:\s[^>]*)?>/i,head=>head+'<script>'+authStatusScript+'</script>'));
 const hash=createHash('sha256').update(bytes).digest('hex');
 const accepts=request.headers.get('accept-encoding')||'';
 const compress=bytes.length>=1024&&(type.startsWith('text/')||type.startsWith('image/svg'))&&accepts.split(',').some(value=>/^\s*gzip\s*(?:;\s*q=(0(?:\.\d+)?|1(?:\.0+)?))?\s*$/.test(value)&&!/[;]\s*q=0(?:\.0*)?\s*$/.test(value));
 const tag='"'+hash+(compress?'-gzip':'-identity')+'"';
 const headers={'Content-Type':type,'Content-Security-Policy':csp,'Cache-Control':'private, no-cache',ETag:tag,Vary:'Accept-Encoding'};
 if(request.headers.get('if-none-match')?.split(',').some(value=>value.trim().replace(/^W\//,'')===tag||value.trim()==='*'))return new Response(null,{status:304,headers});
 let content=bytes;
 if(compress){
  if(!compressed.has(hash)){if(compressed.size>=32)compressed.delete(compressed.keys().next().value);compressed.set(hash,zip(bytes,{level:6}).catch(error=>{compressed.delete(hash);throw error;}));}
  content=await compressed.get(hash);headers['Content-Encoding']='gzip';
 }
 headers['Content-Length']=String(content.length);
 return new Response(request.method==='HEAD'?null:content,{headers});
}

// Packaged UI code contains no user data. The cloud gateway must authenticate
// every request, including conditional 304s, before invoking this static handler.
export function createStudioAssets({cloud=false,businessFacts=false,liveModel=false,liveReadOnly=false,hasManager=false,hasWorkflowManager=false}={}){
 return {
  async warm(){
   // Complete translation and compression before cloud readiness, so the first
   // employee does not pay for parsing the packaged multi-megabyte main script.
   const files=(await fs.readdir(path.join(studioRoot,'assets'))).filter(file=>/^(?:main-.*\.js|index-.*\.js|style-.*\.css)$/.test(file));
   for(const file of files){const response=await this.handle(new Request('https://studio.invalid/studio/assets/'+file,{headers:{'Accept-Encoding':'gzip'}}));await response.arrayBuffer();}
  },
  async handle(request){
  const url=new URL(request.url);
  if(!['GET','HEAD'].includes(request.method)||!/^\/studio(?:\/|$)/.test(url.pathname)||/^\/studio\/(?:api(?:\/|$)|manage\/api(?:\/|$)|workflow-manager\/api(?:\/|$)|(?:process-change|purchase-change)\/api(?:\/|$)|integrations\/|business\/)/.test(url.pathname))return null;
   const changeFiles={'/studio/process-change/':['process-change.html','text/html; charset=utf-8'],'/studio/process-change/app.js':['process-change.js','text/javascript; charset=utf-8'],'/studio/process-change/style.css':['process-change.css','text/css; charset=utf-8']};
   const changePath=url.pathname.replace(/^\/studio\/purchase-change\//,'/studio/process-change/');
   if(Object.hasOwn(changeFiles,changePath)){
    if(!liveReadOnly)return new Response(null,{status:404});
    const [file,type]=changeFiles[changePath];return assetResponse(await fs.readFile(new URL('./'+file,import.meta.url)),type,request);
   }
   if(url.pathname==='/studio')return new Response(null,{status:302,headers:{Location:'/studio/'}});
   if(url.pathname==='/studio/manage')return new Response(null,{status:302,headers:{Location:'/studio/manage/'}});
   if(url.pathname==='/studio/workflow-manager')return new Response(null,{status:302,headers:{Location:'/studio/workflow-manager/'}});
   if(url.pathname==='/studio/workflows/schedules')return new Response(null,{status:302,headers:{Location:'/studio/workflow-schedules/'}});
   const workflowFiles={'/studio/workflow-manager/':['workflow-manager.html','text/html; charset=utf-8'],'/studio/workflow-manager/app.js':['workflow-manager.js','text/javascript; charset=utf-8'],'/studio/workflow-manager/style.css':['workflow-manager.css','text/css; charset=utf-8'],'/studio/workflow-preview/':['workflow-preview.html','text/html; charset=utf-8'],'/studio/workflow-preview/app.js':['workflow-preview.js','text/javascript; charset=utf-8'],'/studio/workflow-preview/style.css':['workflow-preview.css','text/css; charset=utf-8'],'/studio/workflow-schedule.js':['workflow-schedule.mjs','text/javascript; charset=utf-8'],'/studio/workflow-schedule-form.js':['workflow-schedule-form.js','text/javascript; charset=utf-8'],'/studio/workflow-schedules/':['workflow-schedules.html','text/html; charset=utf-8'],'/studio/workflow-schedules/app.js':['workflow-schedules.js','text/javascript; charset=utf-8'],'/studio/workflow-schedules/style.css':['workflow-schedules.css','text/css; charset=utf-8']};
   if(Object.hasOwn(workflowFiles,url.pathname)){
    if(!hasWorkflowManager)return new Response(null,{status:404});if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const [file,type]=workflowFiles[url.pathname];let content=await fs.readFile(new URL('./'+file,import.meta.url));
    if(liveReadOnly&&file==='workflow-manager.html'&&content)content=Buffer.from(content.toString().replace('agent 工作台 · 合成演练','agent 工作台 · 真实业务只读').replace('试运行使用保存后的草稿和合成工具。','试运行使用保存后的草稿，只读取当前账号可见的数据。').replace('<option value="reviewed">采购合成巡检 → 人工审核 → 内部草稿</option>',''));
    return assetResponse(content,type,request);
   }
   const managerFiles={'/studio/manage/':['agent-manager.html','text/html; charset=utf-8'],'/studio/manage/app.js':['agent-manager.js','text/javascript; charset=utf-8'],'/studio/manage/style.css':['agent-manager.css','text/css; charset=utf-8'],'/studio/agent-manager-entry.js':['agent-manager-entry.js','text/javascript; charset=utf-8']};
   if(Object.hasOwn(managerFiles,url.pathname)){
    if(!hasManager)return new Response('Not found',{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const [file,type]=managerFiles[url.pathname];
    return assetResponse(await fs.readFile(new URL('./'+file,import.meta.url)),type,request);
   }
   if(url.pathname==='/studio/auth-status.js')return assetResponse(await fs.readFile(new URL('./auth-status.js',import.meta.url)),'text/javascript; charset=utf-8',request);
   if(url.pathname==='/studio/provider-status.js')return assetResponse(await fs.readFile(new URL('./provider-status.js',import.meta.url)),'text/javascript; charset=utf-8',request);
   if(url.pathname==='/studio/deepseek.svg')return assetResponse(await fs.readFile(new URL('./assets/deepseek.svg',import.meta.url)),'image/svg+xml',request);
   if(url.pathname==='/studio/brand.css')return assetResponse(await fs.readFile(brandStyles),'text/css; charset=utf-8',request);
   // Static, packaged upstream Studio. No dev hot-reload service is needed.
   if(url.pathname==='/studio/refresh-events')return new Response(null,{status:204});
   let relative;
   try{relative=decodeURIComponent(url.pathname.slice('/studio/'.length));}catch{return new Response('Not found',{status:404});}
   if(relative.includes('\\')||relative.split('/').some(part=>part.startsWith('.')))return new Response('Not found',{status:404});
   if(!relative||!path.extname(relative))relative='index.html';
   const target=path.resolve(studioRoot,relative);
   if(!target.startsWith(studioRoot+path.sep))return new Response('Not found',{status:404});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.ico':'image/x-icon'}[path.extname(relative)];
   if(!type)return new Response('Not found',{status:404});
   let bytes;
   try{bytes=await fs.readFile(target);}catch(error){if(error.code==='ENOENT')return new Response('Not found',{status:404});throw error;}
   if(relative==='index.html'){
    const values={MASTRA_STUDIO_BASE_PATH:'/studio',MASTRA_API_PREFIX:'/studio/api',MASTRA_SERVER_HOST:url.hostname,MASTRA_SERVER_PORT:url.port,MASTRA_SERVER_PROTOCOL:url.protocol.slice(0,-1),MASTRA_AUTO_DETECT_URL:'true',MASTRA_TELEMETRY_DISABLED:'true',MASTRA_HIDE_CLOUD_CTA:'true',MASTRA_EXPERIMENTAL_FEATURES:'false',MASTRA_TEMPLATES:'false',MASTRA_EXPERIMENTAL_UI:'false',MASTRA_THEME_TOGGLE:'true'};
    const html=bytes.toString().replace(/%%(\w+)%%/g,(_,key)=>values[key]||'').replace('<html lang="en">','<html lang="zh-CN">').replace('<title>Mastra Studio</title>','<title>agent 工作台</title>').replace('<link rel="icon" type="image/svg+xml" href="./mastra-dark-tile.svg" />','<link rel="icon" type="image/jpeg" href="/brand/doon-eyewear-manufacturing.jpg" />').replace('</head>','<link rel="stylesheet" href="/studio/brand.css" /></head>');
    bytes=Buffer.from(html.replace('<div id="root"></div>',`<div class="doon-studio-banner"><a href="/personal-tasks">← 返回数据台</a><span>${cloud?'云端 agent 工作台':'本地 agent 工作台'} · ${liveReadOnly?'真实业务只读 · 按当前账号权限':businessFacts?'岗位协作 · '+(liveModel?'DeepSeek':'连接诊断'):liveModel?'DeepSeek 实模验证 · 仅使用合成数据':'离线合成演练 · 不连接正式业务'}</span></div><div id="root"></div><script type="module" src="/studio/provider-status.js"></script>${hasManager?'<link rel="stylesheet" href="/studio/workflow-preview/style.css"><link rel="stylesheet" href="/studio/workflow-schedules/style.css"><script type="module" src="/studio/agent-manager-entry.js"></script>':''}`));
   }else if(relative.endsWith('.js')){
    if(!localizedScripts.has(target))localizedScripts.set(target,Buffer.from(localizeStudioWidgets(brandStudioScript(bytes.toString()))));
    bytes=localizedScripts.get(target);
   }
   return assetResponse(bytes,type,request);
 }};
}
