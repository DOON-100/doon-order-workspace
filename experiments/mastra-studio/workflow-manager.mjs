import {randomUUID,createHash} from 'node:crypto';
import {createWorkflow,createStep} from '@mastra/core/workflows';
import {z} from 'zod';

const kind='doon-visual-workflow-ledger-v1',id=z.string().regex(/^[\w-]{1,160}$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const common={id,label:z.string().trim().min(1).max(80),x:z.number().finite().min(0).max(3000),y:z.number().finite().min(0).max(3000)};
const params={start:z.object({}),end:z.object({}),scan:z.object({}),filter:z.object({minMissing:z.number().min(0).max(1e6),supplier:z.string().max(160)}),branch:z.object({metric:z.enum(['count','missing']),operator:z.enum(['gte','gt','eq','lte','lt']),threshold:z.number().min(0).max(1e6)}),draft:z.object({prefix:z.string().max(500)}),summary:z.object({title:z.string().max(160)}),agent:z.object({agentId:id,prompt:z.string().trim().min(1).max(4000)}),review:z.object({title:z.string().trim().min(1).max(160),role:z.enum(['technical','admin','programmer']),reviewerId:z.string().max(160),instructions:z.string().max(2000),maxAgeMinutes:z.number().int().min(1).max(1440)})};
const nodeSchema=z.discriminatedUnion('type',Object.entries(params).map(([type,config])=>z.object({...common,type:z.literal(type),params:config.strict()}).strict()));
const configSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(500),nodes:z.array(nodeSchema).min(2).max(24),edges:z.array(z.object({from:id,to:id,port:z.enum(['next','yes','no','approved','rejected'])}).strict()).max(48)}).strict();
const saveSchema=configSchema.extend({expectedVersionId:id}).strict();
const catalog=[['scan','采购风险检查','读取已接入的合成采购条目'],['filter','筛选条目','按欠数与供应商筛选'],['branch','条件分支','按条目数或欠数判断'],['review','人工审核','暂停，等待真实登录审核人决定'],['draft','内部草稿','为当前条目生成内部草稿'],['agent','调用 Agent','调用所选岗位的已发布配置'],['summary','汇总结果','固定程序整理本次结果']].map(([type,label,description])=>({type,label,description}));
const initialState=()=>({syntheticOnly:true,sent:false,orders:[],drafts:[],messages:[],nodeStates:{}});
const stateSchema=z.object({syntheticOnly:z.literal(true),sent:z.literal(false),orders:z.array(z.any()),drafts:z.array(z.any()),messages:z.array(z.any()),nodeStates:z.record(z.any())});

export function workflowTemplate(reviewed=false){
 const node=(id,type,label,x,y,config={})=>({id,type,label,x,y,params:config});
 const nodes=[node('start','start','开始',160,40),node('scan','scan','采购风险检查',160,170),...(reviewed?[node('review','review','人工审核',160,300,{title:'采购核查审核',role:'technical',reviewerId:'',instructions:'核对证据与未知项；通过后才生成内部草稿。',maxAgeMinutes:30})]:[]),node('draft','draft','生成内部草稿',160,reviewed?460:300,{prefix:''}),node('end','end','结束',160,reviewed?610:440)];
 const edges=reviewed?[{from:'start',to:'scan',port:'next'},{from:'scan',to:'review',port:'next'},{from:'review',to:'draft',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'draft',to:'end',port:'next'}]:[{from:'start',to:'scan',port:'next'},{from:'scan',to:'draft',port:'next'},{from:'draft',to:'end',port:'next'}];
 return{nodes,edges};
}

export function validateWorkflow(config){
 const parsed=configSchema.safeParse(config);if(!parsed.success)throw fail('请检查节点类型、参数、位置和名称；不支持任意代码或外部工具。');
 const {nodes,edges}=parsed.data,map=new Map(nodes.map(n=>[n.id,n]));
 if(map.size!==nodes.length)throw fail('节点 ID 不能重复。');
 const starts=nodes.filter(n=>n.type==='start'),ends=nodes.filter(n=>n.type==='end');
 if(starts.length!==1||ends.length!==1)throw fail('流程必须有且只有一个开始和结束节点。');
 const incoming=new Map(nodes.map(n=>[n.id,[]])),outgoing=new Map(nodes.map(n=>[n.id,[]]));
 for(const edge of edges){if(!map.has(edge.from)||!map.has(edge.to)||edge.from===edge.to)throw fail('连线必须连接两个不同的已有节点。');outgoing.get(edge.from).push(edge);incoming.get(edge.to).push(edge);}
 for(const n of nodes){
  const exits=outgoing.get(n.id),ports=n.type==='end'?[]:n.type==='branch'?['yes','no']:n.type==='review'?['approved','rejected']:['next'];
  if(exits.length!==ports.length||ports.some(p=>exits.filter(e=>e.port===p).length!==1))throw fail(`“${n.label}”的出口需要连接完整：${ports.join(' / ')||'结束节点不能有出口'}。`);
  if(n.type==='start'?incoming.get(n.id).length!==0:incoming.get(n.id).length===0)throw fail(`“${n.label}”没有正确连接到开始节点。`);
 }
 const indegrees=new Map(nodes.map(n=>[n.id,incoming.get(n.id).length])),queue=[starts[0].id],ordered=[];
 while(queue.length){const current=queue.shift();ordered.push(map.get(current));for(const e of outgoing.get(current)){indegrees.set(e.to,indegrees.get(e.to)-1);if(indegrees.get(e.to)===0)queue.push(e.to);}}
 if(ordered.length!==nodes.length)throw fail('流程不能有循环或无法到达的节点。');
 const reachesEnd=new Set([ends[0].id]);for(const n of [...ordered].reverse())if(outgoing.get(n.id).some(e=>reachesEnd.has(e.to)))reachesEnd.add(n.id);
 if(reachesEnd.size!==nodes.length)throw fail('所有分支都必须能走到结束节点。');
 if(nodes.filter(n=>n.type==='agent').length>4)throw fail('一个流程最多配置 4 个 Agent 调用节点。');
 return{config:parsed.data,ordered,incoming};
}

// Archived records keep the project ledger out of Mastra's native graph loader.
// Every configuration, review decision and execution receipt is a new record.
// Only the archival status of newly-created project records is ever updated.
export async function createWorkflowManager({mastra,storage,tools,sourceFingerprint,now=()=>Date.now()}){
 const store=await storage.getStore('workflowDefinitions');
 let queue=Promise.resolve(),activeTests=0,activeAgentCalls=0;const resuming=new Map();
 const serial=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
 async function records(category,entityId){const rows=await store.list();return rows.definitions.filter(row=>row.metadata?.recordType===kind&&row.metadata.category===category&&(!entityId||row.metadata.entityId===entityId)).map(row=>row.metadata).sort((a,b)=>a.revision-b.revision);}
 const latest=async(category,entityId)=>(await records(category,entityId)).at(-1);
 async function append(category,entityId,payload,previous,publish=false){
  const versionId='doon-wfl-'+randomUUID(),record={recordType:kind,category,entityId,versionId,revision:(previous?.revision||0)+1,createdAt:new Date(now()).toISOString(),payload:structuredClone(payload)};
  if(publish)record.payload.publishedVersionId=versionId;
  await store.upsert({id:versionId,description:'DOON visual workflow ledger',metadata:record,inputSchema:{type:'object'},outputSchema:{type:'object'},graph:[]});
  await store.upsert({id:versionId,status:'archived'});return record;
 }
 const requireConfig=async key=>{const row=await latest('config',key);if(!row)throw fail('没有找到该工作流。',404);return row;};
 const requireVersion=async versionId=>{const row=await store.get(versionId);if(row?.metadata?.recordType!==kind||row.metadata.category!=='config')throw fail('没有找到该工作流版本。',404);return row.metadata;};
 const detail=row=>({id:row.entityId,...row.payload.config,versionId:row.versionId,versionNumber:row.revision,publishedVersionId:row.payload.publishedVersionId||null,hasDraft:row.versionId!==row.payload.publishedVersionId,runtimeId:row.payload.runtimeId,createdAt:row.createdAt});
 async function checked(config){const validated=validateWorkflow(config);for(const n of config.nodes)if(n.type==='agent'){try{await mastra.getAgentById(n.params.agentId,{status:'published'});}catch{throw fail('调用 Agent 节点必须选择已发布的岗位。',409);}}return validated;}
 async function ensureReview({row,node,runId,engineId,preview,inputData}){
  return serial(async()=>{
   const taskId='review-'+hash([row.versionId,node.id,runId]).slice(0,40),existing=await latest('review',taskId);if(existing)return existing;
   return append('review',taskId,{taskId,workflowId:row.entityId,configVersionId:row.versionId,workflowName:row.payload.config.name,nodeId:node.id,title:node.params.title,role:node.params.role,reviewerId:node.params.reviewerId,instructions:node.params.instructions,runId,engineId,preview,status:'pending',payload:inputData,payloadHash:hash(inputData),sourceFingerprint:sourceFingerprint(),validUntil:new Date(now()+node.params.maxAgeMinutes*60000).toISOString(),audit:[]},null);
  });
 }
 function compile(row,{preview=false,engineId=row.payload.runtimeId}={}){
  const {ordered,incoming}=validateWorkflow(row.payload.config);
  let workflow=createWorkflow({mastra,id:engineId,description:row.payload.config.description||row.payload.config.name,metadata:{name:row.payload.config.name,doonVersionId:row.versionId},inputSchema:z.object({}).strict(),outputSchema:stateSchema});
  for(const node of ordered){
   const step=createStep({id:node.id,description:node.label,inputSchema:node.type==='start'?z.object({}).strict():stateSchema,outputSchema:stateSchema,resumeSchema:z.object({}).passthrough(),suspendSchema:z.any(),execute:async({inputData,runId,suspend})=>{
    if(node.type==='start'){const state=initialState();state.nodeStates[node.id]={status:'completed',label:node.label};return state;}
    const state=structuredClone(inputData),eligible=incoming.get(node.id).some(e=>state.nodeStates[e.from]?.status==='completed'&&(e.port==='next'||state.nodeStates[e.from].port===e.port));
    if(!eligible){state.nodeStates[node.id]={status:'skipped',label:node.label};return state;}
    let port='next';
    if(node.type==='scan'){const result=await tools.inspectOverdue.execute({});if(result.syntheticOnly!==true)throw new Error('Synthetic source required');state.orders=result.orders;}
    if(node.type==='filter')state.orders=state.orders.filter(r=>r.missing>=node.params.minMissing&&String(r.supplier).includes(node.params.supplier));
    if(node.type==='branch'){const value=node.params.metric==='count'?state.orders.length:state.orders.reduce((sum,r)=>sum+r.missing,0),t=node.params.threshold;port=({gte:value>=t,gt:value>t,eq:value===t,lte:value<=t,lt:value<t})[node.params.operator]?'yes':'no';}
    if(node.type==='draft')for(const order of state.orders){const result=await tools.draftFollowup.execute({orderId:order.orderId});if(result.sent!==false||result.syntheticOnly!==true)throw new Error('Internal draft required');state.drafts.push({...result,text:node.params.prefix+result.text});}
    if(node.type==='agent'){
     if(activeAgentCalls>=2)throw new Error('工作流 Agent 调用并发已满，请稍后重新试运行。');activeAgentCalls++;
     try{const agent=await mastra.getAgentById(node.params.agentId,{status:'published'}),result=await agent.generate(node.params.prompt+'\n\n本次合成流程证据：\n'+JSON.stringify({orders:state.orders,drafts:state.drafts,messages:state.messages}));state.messages.push({nodeId:node.id,agentId:node.params.agentId,text:result.text});}finally{activeAgentCalls--;}
    }
    if(node.type==='summary')state.messages.push({nodeId:node.id,text:`${node.params.title}：本次 ${state.orders.length} 个合成条目，${state.drafts.length} 份内部草稿。未发送消息、未修改业务数据。`});
    if(node.type==='review'){
     const task=await ensureReview({row,node,runId,engineId,preview,inputData:state}),value=task.payload;
     if(!['approved','rejected'].includes(value.status))return suspend({reviewTaskId:value.taskId,title:value.title,payloadHash:value.payloadHash,validUntil:value.validUntil});
     // Browser resumeData is never an approval. Only our authenticated ledger is.
     if(value.payloadHash!==hash(state))throw new Error('Review payload mismatch');
     port=value.status;state.messages.push({nodeId:node.id,reviewTaskId:value.taskId,decision:value.status,reviewer:value.audit.at(-1)?.actor,comment:value.audit.at(-1)?.comment});
    }
    state.nodeStates[node.id]={status:'completed',label:node.label,port};return state;
   }});
   workflow=workflow.then(step);
  }
  return workflow.commit();
 }
 async function install(row){const published=await requireVersion(row.payload.publishedVersionId),workflow=compile(published);mastra.removeWorkflow(row.entityId);mastra.addWorkflow(workflow,row.entityId);}
 async function expected(key,versionId){const row=await requireConfig(key);if(row.versionId!==versionId)throw fail('流程已被其他窗口更新，请重新载入后再保存。',409);return row;}
 async function readBody(request,schema){let body;try{const text=await request.text();if(text.length>131072)throw new Error();body=JSON.parse(text);}catch{throw fail('请求内容无效或过长。');}const parsed=schema.safeParse(body);if(!parsed.success)throw fail('请检查表单内容及版本信息。');return parsed.data;}
 function reviewer(actor,task){
  if(!actor||typeof actor.id!=='string'||!['admin','programmer'].includes(actor.role))throw fail('需要有效的 Studio 登录身份才能审核。',401);
  if(task.role!=='technical'&&task.role!==actor.role||task.reviewerId&&task.reviewerId!==actor.id)throw fail('当前登录人不在此节点的审核范围。',403);
  return{id:actor.id,name:String(actor.name||actor.id).slice(0,100),role:actor.role,synthetic:actor.synthetic===true};
 }
 async function performResume(record){
  const task=record.payload;if(task.execution)return task.execution;
  const row=await requireVersion(task.configVersionId),workflow=compile(row,{preview:task.preview,engineId:task.engineId});
  const saved=await workflow.getWorkflowRunById(task.runId),applied=saved?.steps?.[task.nodeId]?.output?.messages?.some(m=>m.reviewTaskId===task.taskId&&m.decision===task.status);
  if(applied&&saved.status==='running')throw fail('后续步骤仍在执行，请稍后核对运行结果。',409);
  const currentConfig=await requireConfig(task.workflowId),currentVersion=task.preview?currentConfig.versionId:currentConfig.payload.publishedVersionId;
  if(!applied&&(currentVersion!==task.configVersionId||sourceFingerprint()!==task.sourceFingerprint||new Date(task.validUntil).getTime()<=now()))throw fail('流程版本、来源或审核有效期已变化，不能继续旧审批。请重新预览。',409);
  const run=applied?null:await workflow.createRun({runId:task.runId}),result=applied?saved:await run.resume({step:task.nodeId,resumeData:{}}),execution={status:result.status,runId:task.runId,result:result.result||null};
  await serial(async()=>{const current=await latest('review',task.taskId);if(!current.payload.execution)await append('review',task.taskId,{...current.payload,execution},current);});return execution;
 }
 function resumeTask(record){const id=record.entityId;if(resuming.has(id))return resuming.get(id);const promise=performResume(record).finally(()=>resuming.delete(id));resuming.set(id,promise);return promise;}
 async function decide(request,taskId,actor){
  const body=await readBody(request,z.object({action:z.enum(['approve','reject','defer']),comment:z.string().trim().min(1).max(1000),expectedVersionId:id,requestId:z.string().uuid()}).strict());
  const record=await serial(async()=>{
   const current=await latest('review',taskId);if(!current)throw fail('没有找到审核任务。',404);const task=current.payload,person=reviewer(actor,task);
   const previous=task.audit.find(e=>e.requestId===body.requestId);
   if(previous){if(previous.actor.id!==person.id||previous.action!==body.action||previous.comment!==body.comment)throw fail('审核请求标识已用于不同的决定。',409);return current;}
   if(current.versionId!==body.expectedVersionId||['approved','rejected'].includes(task.status))throw fail('审核状态已变化，请刷新后查看。',409);
   if(new Date(task.validUntil).getTime()<=now())throw fail('审核已过期，请重新试运行或发起新流程。',409);
   const config=await requireConfig(task.workflowId),expectedId=task.preview?config.versionId:config.payload.publishedVersionId;
   if(expectedId!==task.configVersionId||sourceFingerprint()!==task.sourceFingerprint)throw fail('流程版本或来源已变化，需要重新预览并审核。',409);
   const status={approve:'approved',reject:'rejected',defer:'deferred'}[body.action],audit=[...task.audit,{action:body.action,comment:body.comment,actor:person,requestId:body.requestId,at:new Date(now()).toISOString(),payloadHash:task.payloadHash,configVersionId:task.configVersionId}];
   return append('review',taskId,{...task,status,audit},current);
  });
  const execution=['approved','rejected'].includes(record.payload.status)?await resumeTask(record):null;
  return json({taskId,status:record.payload.status,execution});
 }
 async function handle(request,{actor}={}){
  const url=new URL(request.url),base='/studio/workflow-manager/api/',route=url.pathname.slice(base.length);
  try{
   if(['GET','HEAD'].includes(request.method)){
    if(route==='workflows'){const all=await records('config'),map=new Map();for(const row of all)map.set(row.entityId,row);return json({workflows:[...map.values()].map(detail),catalog,agents:Object.entries(mastra.listAgents()).map(([id,agent])=>({id,name:agent.name})),actor:actor?{id:actor.id,name:actor.name,role:actor.role,synthetic:actor.synthetic===true}:null});}
    if(route==='reviews'){const all=await records('review'),map=new Map();for(const row of all)map.set(row.entityId,row);return json({reviews:[...map.values()].map(r=>({...r.payload,versionId:r.versionId,createdAt:r.createdAt,expired:new Date(r.payload.validUntil).getTime()<=now()}))});}
    const match=route.match(/^workflows\/([\w-]+)(?:\/(versions))?$/);if(match){const row=await requireConfig(match[1]);return json(match[2]?{versions:(await records('config',match[1])).reverse().map(r=>({id:r.versionId,versionNumber:r.revision,createdAt:r.createdAt,message:r.payload.message}))}:detail(row));}
    throw fail('未找到入口。',404);
   }
   if(request.headers.get('origin')!==url.origin)throw fail('不允许跨站修改工作流或审核。',403);
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw fail('请求格式不正确。',415);
   const decision=route.match(/^reviews\/([\w-]+)\/decision$/);if(decision&&request.method==='POST')return await decide(request,decision[1],actor);
   const match=route.match(/^workflows(?:\/([\w-]+))?(?:\/(publish|restore|test))?$/);if(!match)throw fail('未找到入口。',404);const [,key,action]=match;
   if(key&&action==='test'&&request.method==='POST'){
    const body=await readBody(request,z.object({expectedVersionId:id}).strict()),row=await expected(key,body.expectedVersionId);await checked(row.payload.config);
    if(activeTests>=2)throw fail('当前试运行较多，请稍后重试。',429);activeTests++;
    try{const workflow=compile(row,{preview:true,engineId:'preview-'+row.versionId}),run=await workflow.createRun(),result=await run.start({inputData:{}});return json({status:result.status,runId:run.runId,result:result.result||null,steps:result.steps});}finally{activeTests--;}
   }
   return await serial(async()=>{
    if(!key&&request.method==='POST'){
     const body=await readBody(request,configSchema.extend({requestId:z.string().uuid()}).strict()),{requestId,...config}=body;await checked(config);const key='visual-wf-'+requestId,existing=await latest('config',key);
     if(existing){if(existing.payload.createHash!==hash(config))throw fail('同一新建请求的内容不同。',409);return json(detail(existing));}
     const row=await append('config',key,{config,runtimeId:key,publishedVersionId:null,createHash:hash(config),message:'新建草稿'},null);return json(detail(row),201);
    }
    if(key&&!action&&request.method==='PATCH'){
     const {expectedVersionId,...config}=await readBody(request,saveSchema),previous=await expected(key,expectedVersionId);await checked(config);return json(detail(await append('config',key,{...previous.payload,config,message:'保存草稿'},previous)));
    }
    if(key&&request.method==='POST'&&['publish','restore'].includes(action)){
     const body=await readBody(request,z.object({expectedVersionId:id,versionId:id.optional()}).strict()),previous=await expected(key,body.expectedVersionId);
     const source=action==='restore'?await requireVersion(body.versionId||''):previous;if(source.entityId!==key)throw fail('不能恢复其他流程的版本。',404);await checked(source.payload.config);
     const row=await append('config',key,{...previous.payload,config:source.payload.config,message:action==='publish'?'发布流程':'恢复历史为新草稿'},previous,action==='publish');if(action==='publish')await install(row);return json(detail(row));
    }
    throw fail('不支持该操作。',405);
   });
  }catch(error){return json({error:error.status?error.message:'工作流服务暂时不可用，请刷新后重试。'},error.status||503);}
 }
 const all=await store.list();for(const row of all.definitions)if(row.metadata?.recordType===kind&&row.status!=='archived')await store.upsert({id:row.id,status:'archived'});
 if(!await latest('config','followup'))await append('config','followup',{config:{name:'采购欠料巡检与内部草稿',description:'检查固定合成采购条目，生成内部草稿。',...workflowTemplate()},runtimeId:'synthetic-procurement-followup',message:'登记原流程基线'},null,true);
 const configs=await records('config'),map=new Map();for(const row of configs)map.set(row.entityId,row);for(const row of map.values())if(row.payload.publishedVersionId)await install(row);
 const has=async key=>(await records('config')).some(row=>row.entityId===key||row.payload.runtimeId===key);
 return{handle,has,compile,records};
}
