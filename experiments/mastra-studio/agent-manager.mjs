import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {resolveInstructionBlocks} from '@mastra/editor';
import {instructionSchema,validInstructions} from './editor.mjs';

const kind='doon-visual-agent-v1';
const idPattern=/^[\w-]{1,160}$/;
const fields={name:z.string().trim().min(1).max(80),description:z.string().trim().max(500).default(''),instructions:instructionSchema,toolKeys:z.array(z.string().regex(idPattern)).max(20).refine(keys=>new Set(keys).size===keys.length)};
const createSchema=z.object({...fields,requestId:z.string().uuid().optional()}).strict();
const saveSchema=z.object({...fields,expectedVersionId:z.string().regex(idPattern)}).strict();
const versionSchema=z.object({versionId:z.string().regex(idPattern),expectedVersionId:z.string().regex(idPattern)}).strict();
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const snapshotKeys=['name','description','instructions','model','tools'];
const snapshotOf=value=>Object.fromEntries(snapshotKeys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));

// A project-owned UI and configuration service on the OSS storage/Agent APIs.
// Neither EE Builder nor third-party plugin/code installation is enabled.
export async function createAgentManager({mastra,storage,agents,tools,buildAgent}){
 const store=await storage.getStore('agents');
 const prompts=await storage.getStore('promptBlocks');
 const builtins=new Set(Object.keys(agents)),limits=new Map();
 for(const [id,agent] of Object.entries(agents))limits.set(id,Object.keys(await agent.listTools()));
 const catalog=Object.entries(tools).map(([key,tool])=>({key,description:tool.description}));
 const model=await agents.supervisor.getModel(),modelConfig={provider:model.provider,name:model.modelId};
 const installed=new Map();
 let queue=Promise.resolve();
 const run=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
 const allowedFor=id=>builtins.has(id)?limits.get(id):catalog.map(tool=>tool.key);
 const isManaged=row=>!!row&&(builtins.has(row.id)||row.metadata?.recordType===kind&&row.id.startsWith('visual-'));
 async function requireRow(id){const row=await store.getById(id);if(!isManaged(row))throw fail('没有找到该 Agent。',404);return row;}
 function validateTools(id,keys){if(keys.some(key=>!allowedFor(id).includes(key)))throw fail('该岗位不能使用所选工具。',403);}
 function validateSnapshot(id,snapshot){
  if(!snapshot||typeof snapshot.name!=='string'||!snapshot.name.trim()||snapshot.instructions===undefined)throw fail('Agent 配置不完整。',409);
  const keys=Object.keys(snapshot.tools||{});validateTools(id,keys);return keys;
 }
 async function refresh(id){
  const row=await requireRow(id);
  const selected=row.activeVersionId?await store.getVersion(row.activeVersionId):await store.getLatestVersion(id);
  if(!selected||selected.agentId!==id)throw fail('Agent 版本不完整。',409);
  if(installed.get(id)===selected.id)return;
  const keys=validateSnapshot(id,selected);
  const chosen=Object.fromEntries(keys.map(key=>[key,tools[key]]));
  const instructions=typeof selected.instructions==='string'?selected.instructions:({requestContext})=>resolveInstructionBlocks(selected.instructions,requestContext?.toJSON()||{},{promptBlocksStorage:prompts});
  const agent=buildAgent({id,...snapshotOf(selected),instructions},chosen,{builtin:builtins.has(id)});
  // Runtime replacement does not delete storage, memory, messages or versions.
  mastra.removeAgent(id);mastra.addAgent(agent,id);agents[id]=agent;
  mastra.getEditor().agent.clearCache(id);installed.set(id,selected.id);
 }
 async function initialize(){
  let page=0;
  while(true){
   const result=await store.list({page,perPage:100});
   for(const row of result.agents)if(isManaged(row))await refresh(row.id);
   if(!(result.hasMore??((page+1)*100<result.total)))break;page++;
  }
 }
 async function detail(id){
  const row=await requireRow(id),latest=await store.getLatestVersion(id);
  if(!latest)throw fail('Agent 版本不完整。',409);
  return{id,name:latest.name,description:latest.description||'',instructions:latest.instructions,toolKeys:validateSnapshot(id,latest),allowedToolKeys:allowedFor(id),builtin:builtins.has(id),versionId:latest.id,versionNumber:latest.versionNumber,publishedVersionId:row.activeVersionId||null,hasDraft:latest.id!==row.activeVersionId};
 }
 async function list(){
  const result=[];let page=0;
  while(true){const rows=await store.list({page,perPage:100});for(const row of rows.agents)if(isManaged(row))result.push(await detail(row.id));if(!(rows.hasMore??((page+1)*100<rows.total)))break;page++;}
  const promptBlocks=[];page=0;
  while(true){const rows=await prompts.list({page,perPage:100});for(const row of rows.promptBlocks)if(row.activeVersionId&&row.status==='published'){const v=await prompts.getVersion(row.activeVersionId);if(v)promptBlocks.push({id:row.id,name:v.name,description:v.description||'',content:v.content,versionNumber:v.versionNumber,rules:v.rules,requestContextSchema:v.requestContextSchema});}if(!(rows.hasMore??((page+1)*100<rows.total)))break;page++;}
  return{agents:result,tools:catalog,prompts:promptBlocks,model:{id:model.modelId,live:!String(model.provider).includes('offline')}};
 }
 async function readBody(request,schema){
  let body;try{const text=await request.text();if(text.length>65536)throw new Error();body=JSON.parse(text);}catch{throw fail('请求内容无效或过长。');}
  const parsed=schema.safeParse(body);if(!parsed.success)throw fail('请检查名称、提示词、工具选择和版本信息。');return parsed.data;
 }
 async function currentVersion(id,expected){
  await requireRow(id);const latest=await store.getLatestVersion(id);
  if(!latest||latest.id!==expected)throw fail('配置已被其他窗口更新，请重新载入后再保存。',409);return latest;
 }
 function config(body,previous){return{name:body.name,description:body.description,instructions:body.instructions,model:modelConfig,tools:Object.fromEntries(body.toolKeys.map(key=>[key,previous?.tools?.[key]??{description:tools[key].description}]))};}
 async function append(id,previous,values,message){
  const versionId=randomUUID();
  await store.createVersion({id:versionId,agentId:id,versionNumber:previous.versionNumber+1,...values,changedFields:snapshotKeys,changeMessage:message});
  mastra.getEditor().agent.clearCache(id);return detail(id);
 }
 async function handle(request){
  const url=new URL(request.url),match=url.pathname.match(/^\/studio\/manage\/api\/agents(?:\/([\w-]+))?(?:\/(publish|restore|versions))?$/);
  if(!match)return json({error:'未找到该入口。'},404);
  const [,id,action]=match;
  try{
   if(['GET','HEAD'].includes(request.method)){
    if(!id)return json(await list());
    await requireRow(id);
    if(action==='versions'){
     const versions=await store.listVersions({agentId:id,perPage:false});
     return json({versions:versions.versions.map(v=>({id:v.id,versionNumber:v.versionNumber,createdAt:v.createdAt,changeMessage:v.changeMessage}))});
    }
    if(action)throw fail('未找到该入口。',404);return json(await detail(id));
   }
   if(request.headers.get('origin')!==url.origin)throw fail('不允许跨站修改 Agent 配置。',403);
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw fail('请求格式不正确。',415);
   return await run(async()=>{
    if(!id&&request.method==='POST'){
     const body=await readBody(request,createSchema),createdId='visual-'+(body.requestId||randomUUID());validateTools(createdId,body.toolKeys);
     if(!await validInstructions(body.instructions,storage))throw fail('引用的公共 Prompt 尚未发布或不存在。',409);
     const createHashValue=createHash('sha256').update(JSON.stringify({name:body.name,description:body.description,instructions:body.instructions,toolKeys:[...body.toolKeys].sort()})).digest('hex');
     const existing=await store.getById(createdId);
     if(existing){if(!isManaged(existing)||existing.metadata?.createHash!==createHashValue)throw fail('此新建请求已使用，且内容不同。请重新载入配置。',409);return json(await detail(createdId));}
     await store.create({agent:{id:createdId,metadata:{recordType:kind,createHash:createHashValue},...config(body)}});
     await refresh(createdId);return json(await detail(createdId),201);
    }
    if(id&&!action&&request.method==='PATCH'){
     const body=await readBody(request,saveSchema),previous=await currentVersion(id,body.expectedVersionId);validateTools(id,body.toolKeys);
     if(!await validInstructions(body.instructions,storage))throw fail('引用的公共 Prompt 尚未发布或不存在。',409);
     const result=await append(id,previous,config(body,previous),'可视化管理：保存草稿');
     // An unpublished new agent can be listed/previewed, but not used as published.
     if(!result.publishedVersionId)await refresh(id);return json(result);
    }
    if(id&&request.method==='POST'&&['publish','restore'].includes(action)){
     const body=await readBody(request,versionSchema),previous=await currentVersion(id,body.expectedVersionId),version=await store.getVersion(body.versionId);
     if(!version||version.agentId!==id)throw fail('没有找到该岗位的版本。',404);validateSnapshot(id,version);
     if(!await validInstructions(version.instructions,storage))throw fail('引用的公共 Prompt 尚未发布或不存在。',409);
     if(action==='restore')return json(await append(id,previous,snapshotOf(version),'可视化管理：从历史版本恢复草稿'));
     if(version.id!==previous.id)throw fail('请先将历史版本恢复为新草稿，再发布。',409);
     await store.update({id,activeVersionId:version.id,status:'published'});await refresh(id);return json(await detail(id));
    }
    throw fail('不支持该操作。',405);
   });
  }catch(error){return json({error:error.status?error.message:'配置服务暂时不可用，请刷新后重试。'},error.status||503);}
 }
 await initialize();
 return{handle,run,refresh,has:id=>Object.hasOwn(agents,id)};
}
