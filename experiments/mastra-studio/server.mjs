import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Hono} from 'hono';
import {MastraServer} from '@mastra/hono';
import {createAgents} from './agents.mjs';
import {brandStudioScript} from './branding.mjs';
import {createDeepSeekStatus,loadDeepSeekFileKey} from './deepseek.mjs';
import {guardBusinessRequest} from './business-request.mjs';
import {guardEditorRequest} from './editor.mjs';

const studioRoot=path.join(path.dirname(fileURLToPath(import.meta.resolve('mastra/package.json'))),'dist','studio');
const brandStyles=new URL('./brand.css',import.meta.url);
const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export async function createStudio({dataDir,deepseekOptions,storage,cloud=false,businessFacts,createRuntime}){
 await fs.mkdir(dataDir,{recursive:true});
 await loadDeepSeekFileKey(deepseekOptions?.env||process.env);
 const deepseek=createDeepSeekStatus(deepseekOptions),liveModel=await deepseek.model();
 if(businessFacts&&cloud)throw new Error('真实快照模式仅供本机隔离验证');
 if(createRuntime&&cloud)throw new Error('闭环验证运行时仅供本机隔离环境');
 const lab=createRuntime?await createRuntime({dataDir,liveModel}):businessFacts?(await import('./business-agents.mjs')).createBusinessAgents(dataDir,{facts:businessFacts,liveModel,storage}):createAgents(dataDir,{liveModel,storage,...(cloud?{serviceName:'doon-agent-studio-cloud'}:{})}),app=new Hono();
 const server=new MastraServer({app,mastra:lab.mastra,tools:lab.tools,prefix:'/studio/api'});
 await lab.editorReady;
 await server.init();
 return{
  ...lab,
  async handle(request){
   const url=new URL(request.url);
   if(url.pathname==='/studio')return new Response(null,{status:302,headers:{Location:'/studio/'}});
   if(url.pathname==='/studio/manage')return new Response(null,{status:302,headers:{Location:'/studio/manage/'}});
   if(url.pathname.startsWith('/studio/manage/api/'))return lab.manager?lab.manager.handle(request):Response.json({error:'此环境暂不开放 Agent 配置管理。'},{status:403});
   const managerFiles={'/studio/manage/':['agent-manager.html','text/html; charset=utf-8'],'/studio/manage/app.js':['agent-manager.js','text/javascript; charset=utf-8'],'/studio/manage/style.css':['agent-manager.css','text/css; charset=utf-8'],'/studio/agent-manager-entry.js':['agent-manager-entry.js','text/javascript; charset=utf-8']};
   if(Object.hasOwn(managerFiles,url.pathname)){
    if(!lab.manager)return new Response('Not found',{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const [file,type]=managerFiles[url.pathname];
    return new Response(request.method==='HEAD'?null:await fs.readFile(new URL('./'+file,import.meta.url)),{headers:{'Content-Type':type,'Content-Security-Policy':csp,'Cache-Control':'no-store'}});
   }
   if(url.pathname.startsWith('/studio/integrations/deepseek/')){
    const refresh=url.pathname==='/studio/integrations/deepseek/refresh';
    if(url.pathname!=='/studio/integrations/deepseek/status'&&!refresh)return new Response(null,{status:404});
    if(request.method!==(refresh?'POST':'GET'))return new Response(null,{status:405});
    if(refresh&&request.headers.get('origin')!==url.origin)return new Response(null,{status:403});
    const selected=lab.agents[url.searchParams.get('agent')||'supervisor'];
    if(!selected)return new Response(null,{status:404});
    const actual=await selected.getModel(),provider=String(actual.provider||'');
    const model={provider:provider.startsWith('deepseek')?'DeepSeek':provider.includes('offline')?'合成脚本':provider,id:actual.modelId,live:!provider.includes('offline')};
    return Response.json({...await deepseek.get({refresh}),model},{headers:{'Cache-Control':'no-store'}});
   }
   if(url.pathname==='/studio/business/profiles')return Response.json({mode:businessFacts?'real-snapshot':'synthetic',...(businessFacts?{coverage:businessFacts.coverage()}:{}),profiles:(await import('./profiles.mjs')).profiles},{headers:{'Cache-Control':'no-store'}});
   if(url.pathname==='/studio/api'||url.pathname.startsWith('/studio/api/')){
    // Studio is a debug UI, not a policy editor. Real-data model/tool overrides are forbidden.
    if(businessFacts){const guarded=await guardBusinessRequest(request);if(guarded instanceof Response)return guarded;request=guarded;}
    else if(lab.mastra.getEditor()){const guarded=await guardEditorRequest(request,lab.agents,lab.storage);if(guarded instanceof Response)return guarded;request=guarded;}
    const fetch=async()=>{
     const response=await app.fetch(request);
     const edited=url.pathname.match(/^\/studio\/api\/stored\/agents\/([\w-]+)(?:\/versions\/[^/]+\/(?:activate|restore))?$/);
     if(response.ok&&edited&&lab.manager?.has(edited[1])&&!['GET','HEAD'].includes(request.method))await lab.manager.refresh(edited[1]);
     return response;
    };
    return lab.manager&&!['GET','HEAD'].includes(request.method)?lab.manager.run(fetch):fetch();
   }
   if(url.pathname==='/studio/provider-status.js')return new Response(request.method==='HEAD'?null:await fs.readFile(new URL('./provider-status.js',import.meta.url)),{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
   if(url.pathname==='/studio/deepseek.svg')return new Response(request.method==='HEAD'?null:await fs.readFile(new URL('./assets/deepseek.svg',import.meta.url)),{headers:{'Content-Type':'image/svg+xml'}});
   if(url.pathname==='/studio/brand.css')return new Response(request.method==='HEAD'?null:await fs.readFile(brandStyles),{headers:{'Content-Type':'text/css; charset=utf-8'}});
   // Static, packaged upstream Studio. No dev hot-reload service is needed.
   if(url.pathname==='/studio/refresh-events')return new Response(null,{status:204});
   let relative;
   try{relative=decodeURIComponent(url.pathname.slice('/studio/'.length));}catch{return new Response('Not found',{status:404});}
   if(relative.includes('\\')||relative.split('/').some(part=>part.startsWith('.')))return new Response('Not found',{status:404});
   if(!relative||!path.extname(relative))relative='index.html';
   const target=path.resolve(studioRoot,relative);
   if(!target.startsWith(studioRoot+path.sep))return new Response('Not found',{status:404});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'}[path.extname(relative)];
   if(!type)return new Response('Not found',{status:404});
   let bytes;
   try{bytes=await fs.readFile(target);}catch(error){if(error.code==='ENOENT')return new Response('Not found',{status:404});throw error;}
   if(relative==='index.html'){
    const values={MASTRA_STUDIO_BASE_PATH:'/studio',MASTRA_API_PREFIX:'/studio/api',MASTRA_SERVER_HOST:url.hostname,MASTRA_SERVER_PORT:url.port,MASTRA_SERVER_PROTOCOL:url.protocol.slice(0,-1),MASTRA_AUTO_DETECT_URL:'true',MASTRA_TELEMETRY_DISABLED:'true',MASTRA_HIDE_CLOUD_CTA:'true',MASTRA_EXPERIMENTAL_FEATURES:'false',MASTRA_TEMPLATES:'false',MASTRA_EXPERIMENTAL_UI:'false',MASTRA_THEME_TOGGLE:'true'};
    const html=bytes.toString().replace(/%%(\w+)%%/g,(_,key)=>values[key]||'').replace('<title>Mastra Studio</title>','<title>Agent Studio</title>').replace('<link rel="icon" type="image/svg+xml" href="./mastra-dark-tile.svg" />','<link rel="icon" type="image/jpeg" href="/brand/doon-eyewear-manufacturing.jpg" />').replace('</head>','<link rel="stylesheet" href="/studio/brand.css" /></head>');
    bytes=Buffer.from(html.replace('<div id="root"></div>',`<div class="doon-studio-banner"><a href="/personal-tasks">← 返回数据台</a><span>${cloud?'云端 Agent Studio':'本地 Studio'} · ${businessFacts?'岗位协作 · '+(liveModel?'DeepSeek':'连接诊断'):liveModel?'DeepSeek 实模验证 · 仅使用合成数据':'离线合成演练 · 不连接正式业务'}</span></div><div id="root"></div><script type="module" src="/studio/provider-status.js"></script>${lab.manager?'<script type="module" src="/studio/agent-manager-entry.js"></script>':''}`));
   }else if(relative.endsWith('.js'))bytes=Buffer.from(brandStudioScript(bytes.toString()));
   return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':type,'Content-Security-Policy':csp}});
  },
 };
}
