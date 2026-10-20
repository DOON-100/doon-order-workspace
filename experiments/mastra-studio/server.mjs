import {createStudioAssets} from './assets.mjs';
import fs from 'node:fs/promises';
import {Hono} from 'hono';
import {MastraServer} from '@mastra/hono';
import {createAgents} from './agents.mjs';
import {createDeepSeekStatus,loadDeepSeekFileKey} from './deepseek.mjs';
import {guardBusinessRequest} from './business-request.mjs';
import {guardEditorRequest} from './editor.mjs';
import {withWorkflowToolContext} from './workflow-tools.mjs';

// These pinned SDK endpoints use POST for structured read filters. Keep this
// list explicit: observability also exposes destructive POST/DELETE routes.
const observabilityReadPosts=new Set([
 'traces/query','traces/aggregate','traces/query/fields','traces/query/values','threads/query','spans/query',
 ...['metrics','scores','feedback'].flatMap(kind=>['aggregate','breakdown','timeseries','percentiles'].map(operation=>kind+'/'+operation)),
].map(route=>'/studio/api/observability/'+route));

export async function createStudio({dataDir,deepseekOptions,storage,cloud=false,businessFacts,createRuntime,liveReadOnly=false,scopeId}){
 await fs.mkdir(dataDir,{recursive:true});
 await loadDeepSeekFileKey(deepseekOptions?.env||process.env);
 const deepseek=createDeepSeekStatus({...deepseekOptions,modelOwner:scopeId||'local',requireModelAccess:cloud&&liveReadOnly}),liveModel=await deepseek.model();
 if(businessFacts&&cloud)throw new Error('真实快照模式仅供本机隔离验证');
 if(createRuntime&&cloud)throw new Error('闭环验证运行时仅供本机隔离环境');
 if(liveReadOnly&&(!cloud||!storage||!scopeId))throw new Error('Live API mode requires isolated cloud storage');
 const lab=liveReadOnly?(await import('./live-agents.mjs')).createLiveAgents({storage,liveModel,scopeId}):createRuntime?await createRuntime({dataDir,liveModel}):businessFacts?(await import('./business-agents.mjs')).createBusinessAgents(dataDir,{facts:businessFacts,liveModel,storage}):createAgents(dataDir,{liveModel,storage,...(cloud?{serviceName:'doon-agent-studio-cloud'}:{})}),app=new Hono();
 const server=new MastraServer({app,mastra:lab.mastra,tools:lab.tools,prefix:'/studio/api'});
 await lab.editorReady;
 await server.init();
 const assets=createStudioAssets({cloud,businessFacts:!!businessFacts,liveModel:!!liveModel,liveReadOnly,hasManager:!!lab.manager,hasWorkflowManager:!!lab.workflowManager});
 return{
  ...lab,assets,
  // send-message acknowledges before its background stream ends. An absent
  // HTTP lease does not make that runtime safe to evict.
  isBusy:()=>Object.values(lab.agents).some(agent=>agent.listActiveThreadRuns().length>0),
  async handle(request,{actor,workflowAccess,processChanges,purchaseChanges}={}){
   const asset=await assets.handle(request);if(asset)return asset;
   const url=new URL(request.url);
   if(url.pathname==='/studio/purchase-change/api')return purchaseChanges?purchaseChanges.handle(request,{actor}):Response.json({error:'当前实例未启用采购人工确认。'},{status:403});
   if(url.pathname==='/studio/process-change/api')return processChanges?processChanges.handle(request,{actor}):Response.json({error:'当前实例未启用流程人工确认。'},{status:403});
   if(url.pathname.startsWith('/studio/workflow-manager/api/')){
    if(!lab.workflowManager)return Response.json({error:'此环境不开放可视化工作流管理。'},{status:403});
    const trusted=actor&&request.method==='POST'&&request.headers.get('origin')===url.origin?{actor:{id:actor.id,name:actor.name,role:actor.role,synthetic:actor.synthetic===true},workflowAccess}:undefined;
    return withWorkflowToolContext(trusted,()=>lab.workflowManager.handle(request,{actor,workflowAccess}));
   }
   if(url.pathname.startsWith('/studio/manage/api/'))return lab.manager?lab.manager.handle(request):Response.json({error:'此环境暂不开放 Agent 配置管理。'},{status:403});
   if(url.pathname.startsWith('/studio/integrations/deepseek/')){
    const refresh=url.pathname==='/studio/integrations/deepseek/refresh';
    if(url.pathname!=='/studio/integrations/deepseek/status'&&!refresh)return new Response(null,{status:404});
    if(request.method!==(refresh?'POST':'GET'))return new Response(null,{status:405});
    if(refresh&&request.headers.get('origin')!==url.origin)return new Response(null,{status:403});
    const selected=lab.agents[url.searchParams.get('agent')||'supervisor'];
    if(!selected)return new Response(null,{status:404});
    const actual=await selected.getModel(),provider=String(actual.provider||'');
    const model={provider:provider.startsWith('deepseek')?'DeepSeek':provider.includes('offline')?'合成脚本':provider,id:actual.modelId,live:!provider.includes('offline')};
    return Response.json({...await deepseek.get({refresh}),model,modelQueue:deepseek.schedulerStatus()},{headers:{'Cache-Control':'no-store'}});
   }
   if(url.pathname==='/studio/business/profiles')return Response.json({mode:liveReadOnly?'live-readonly':businessFacts?'real-snapshot':'synthetic',...(businessFacts?{coverage:businessFacts.coverage()}:{}),profiles:(await import('./profiles.mjs')).profiles},{headers:{'Cache-Control':'no-store'}});
   if(url.pathname==='/studio/api'||url.pathname.startsWith('/studio/api/')){
    if(lab.workflowManager&&!['GET','HEAD'].includes(request.method)){
     const managed=url.pathname.match(/^\/studio\/api\/workflows\/([\w-]+)(?:\/|$)/);
     if(managed&&await lab.workflowManager.has(managed[1])&&(/\/(resume[^/]*|restart[^/]*|time-travel[^/]*)(\/|$)/.test(url.pathname)||url.pathname.endsWith('/steps/execute')||request.method==='DELETE'))return Response.json({error:'请通过工作流管理中的人工审核与运行入口操作；不允许跳过审核或删除运行历史。'},{status:403});
    }
    // Studio is a debug UI, not a policy editor. Real-data model/tool overrides are forbidden.
    if(liveReadOnly&&request.method!=='GET'&&request.method!=='HEAD'){
     if(/^\/studio\/api\/agents\/[^/]+\/(?:generate|stream|send-message|threads\/subscribe|threads\/abort)$/.test(url.pathname)){
      const guarded=await guardBusinessRequest(request,{agents:lab.agents});if(guarded instanceof Response)return guarded;request=guarded;
     }else if(!(request.method==='POST'&&observabilityReadPosts.has(url.pathname))&&!url.pathname.startsWith('/studio/api/stored/')&&!url.pathname.startsWith('/studio/api/editor/'))return Response.json({error:'当前云端入口只开放受控配置和只读查询；请通过工作流管理入口运行流程。'},{status:403});
    }
    if(businessFacts){const guarded=await guardBusinessRequest(request);if(guarded instanceof Response)return guarded;request=guarded;}
    else if(lab.mastra.getEditor()){const guarded=await guardEditorRequest(request,lab.agents,lab.storage);if(guarded instanceof Response)return guarded;request=guarded;}
    const fetch=async()=>{
     const trusted=actor&&request.method==='POST'&&request.headers.get('origin')===url.origin?{actor:{id:actor.id,name:actor.name,role:actor.role,synthetic:actor.synthetic===true},workflowAccess}:undefined;
     const response=await withWorkflowToolContext(trusted,()=>app.fetch(request));
     const edited=url.pathname.match(/^\/studio\/api\/stored\/agents\/([\w-]+)(?:\/versions\/[^/]+\/(?:activate|restore))?$/);
     if(response.ok&&edited&&lab.manager?.has(edited[1])&&!['GET','HEAD'].includes(request.method))await lab.manager.refresh(edited[1]);
     return response;
    };
    return lab.manager&&!['GET','HEAD'].includes(request.method)?lab.manager.run(fetch):fetch();
   }
   return new Response('Not found',{status:404});
  },
 };
}
