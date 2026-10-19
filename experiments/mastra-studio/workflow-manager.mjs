import {randomUUID,createHash} from 'node:crypto';
import {createWorkflow,createStep} from '@mastra/core/workflows';
import {z} from 'zod';
import {defaultTrigger,validateTrigger,evaluateTrigger,projectedDatasets,triggerOperators} from './workflow-triggers.mjs';
import {workflowSources,syntheticSource} from './workflow-sources.mjs';
import {validateSchedule,describeSchedule,nextScheduleRuns,scheduleSlot} from './workflow-schedule.mjs';

const kind='doon-visual-workflow-ledger-v1',id=z.string().regex(/^[\w-]{1,160}$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const common={id,label:z.string().trim().min(1).max(80),x:z.number().finite().min(0).max(3000),y:z.number().finite().min(0).max(3000)};
const params={start:z.object({trigger:z.any().optional()}),end:z.object({}),record:z.object({}),scan:z.object({}),filter:z.object({minMissing:z.number().min(0).max(1e6),supplier:z.string().max(160)}),branch:z.object({metric:z.enum(['count','missing']),operator:z.enum(['gte','gt','eq','lte','lt']),threshold:z.number().min(0).max(1e6)}),draft:z.object({prefix:z.string().max(500)}),summary:z.object({title:z.string().max(160)}),agent:z.object({agentId:id,prompt:z.string().trim().min(1).max(4000)}),review:z.object({title:z.string().trim().min(1).max(160),role:z.enum(['technical','admin','programmer']),reviewerId:z.string().max(160),instructions:z.string().max(2000),maxAgeMinutes:z.number().int().min(1).max(1440)})};
const nodeSchema=z.discriminatedUnion('type',Object.entries(params).map(([type,config])=>z.object({...common,type:z.literal(type),params:config.strict()}).strict()));
const configSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(500),nodes:z.array(nodeSchema).min(2).max(24),edges:z.array(z.object({from:id,to:id,port:z.enum(['next','yes','no','approved','rejected'])}).strict()).max(48)}).strict();
export const workflowDraftSchema=configSchema.extend({requestId:z.string().uuid()}).strict();
const saveSchema=configSchema.extend({expectedVersionId:id}).strict();
const catalog=[['scan','采购风险检查','读取已接入的合成采购条目'],['filter','筛选条目','按欠数与供应商筛选'],['branch','条件分支','按条目数或欠数判断'],['review','人工审核','暂停，等待真实登录审核人决定'],['draft','内部草稿','为当前条目生成内部草稿'],['agent','调用 Agent','调用所选岗位的已发布配置'],['summary','汇总结果','固定程序整理本次结果']].map(([type,label,description])=>({type,label,description}));
const initialState=()=>({syntheticOnly:true,sent:false,orders:[],drafts:[],messages:[],nodeStates:{}});
const stateSchema=z.object({syntheticOnly:z.boolean(),sent:z.literal(false),orders:z.array(z.any()),drafts:z.array(z.any()),messages:z.array(z.any()),nodeStates:z.record(z.any()),trigger:z.any().optional(),records:z.array(z.any()).optional()});
catalog.unshift({type:'record',label:'读取触发记录',description:'读取触发器已经授权、匹配的当前业务记录'});

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
 if(starts[0].params.trigger)try{validateTrigger(starts[0].params.trigger);}catch(error){throw fail(error.message);}
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
export async function createWorkflowManager({mastra,storage,tools,sourceFingerprint,realData=false,now=()=>Date.now()}){
 const availableCatalog=realData?catalog.filter(node=>!['scan','filter','draft'].includes(node.type)):catalog;
 const store=await storage.getStore('workflowDefinitions');
 let queue=Promise.resolve(),activeTests=0,activeAgentCalls=0,processingTriggers=false;const resuming=new Map();
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
 const canReadConfig=(row,actor)=>!row.payload.ownerId||row.payload.ownerId===actor?.id;
 async function sourceCatalog(access,source,scope={}){
  if(access)return access.catalog(source,scope);
  if(!source)return{modules:workflowSources,mode:'synthetic',eventsEnabled:false};
  if(!workflowSources.some(s=>s.id===source))throw fail('未找到业务模块。',404);
  const sample=syntheticSource(source);return{source,scope,datasets:projectedDatasets(sample),mode:'synthetic',eventsEnabled:false,revision:0,sample:sample.records[0]};
 }
 async function checkedTrigger(config,access){const trigger=config.nodes.find(n=>n.type==='start')?.params.trigger;if(!trigger||trigger.mode==='manual')return;const source=await sourceCatalog(access,trigger.source,trigger.scope),dataset=source.datasets.find(d=>d.path===trigger.dataset);if(!dataset)throw fail('数据对象不存在或不在当前可见范围内。',403);if(dataset.triggerable===false)throw fail('明细缺少唯一稳定 ID，请选择上层记录或页面概览中的字段。');try{validateTrigger(trigger,dataset);}catch(error){throw fail(error.message,403);}return source;}
 async function checked(config){const validated=validateWorkflow(config);if(realData&&config.nodes.some(node=>['scan','filter','draft'].includes(node.type)))throw fail('合成采购节点不能用于真实业务；请使用读取触发记录、人工审核或只读 Agent 节点。');for(const n of config.nodes)if(n.type==='agent'){try{await mastra.getAgentById(n.params.agentId,{status:'published'});}catch{throw fail('调用 Agent 节点必须选择已发布的岗位。',409);}}return validated;}
 async function saveNewDraft(body,{actor,workflowAccess,proposalId}={}){
  const {requestId,...config}=workflowDraftSchema.parse(body);await checked(config);await checkedTrigger(config,workflowAccess);
  const key='visual-wf-'+requestId,existing=await latest('config',key);
  if(existing){if(!canReadConfig(existing,actor)||existing.payload.createHash!==hash(config)||hash(existing.payload.config)!==hash(config)||(existing.payload.proposalId||null)!==(proposalId||null))throw fail('同一新建请求已被使用或内容不同。',409);return{workflow:detail(existing),created:false};}
  const row=await append('config',key,{config,runtimeId:key,publishedVersionId:null,createHash:hash(config),ownerId:actor?.id||null,proposalId:proposalId||null,message:'新建草稿'},null);
  return{workflow:detail(row),created:true};
 }
 const proposalDetail=row=>({id:row.entityId,versionId:row.versionId,...row.payload});
 async function requireProposal(key,actor){
  const row=await latest('proposal',key);
  if(!row||!actor?.id||row.payload.ownerId!==actor.id)throw fail('没有找到本人待确认的流程预览。',404);
  return row;
 }
 const previewDraft=(input,{actor,workflowAccess}={})=>serial(async()=>{
  if(!actor?.id||!['admin','programmer'].includes(actor.role))throw fail('需要有效的 Studio 管理身份。',403);
  const {requestId,...config}=workflowDraftSchema.parse(input);await checked(config);const source=await checkedTrigger(config,workflowAccess),trigger=config.nodes.find(n=>n.type==='start')?.params.trigger,dataset=source?.datasets?.find(d=>d.path===trigger.dataset);
  const key='proposal-'+requestId,existing=await latest('proposal',key);
  if(existing){if(existing.payload.ownerId!==actor.id||existing.payload.configHash!==hash(config))throw fail('预览请求标识已被使用。',409);return proposalDetail(existing);}
  const row=await append('proposal',key,{ownerId:actor.id,config,configHash:hash(config),requestId,status:'pending',sourceLabel:workflowSources.find(s=>s.id===trigger?.source)?.label||'',fieldLabels:Object.fromEntries((dataset?.fields||[]).map(f=>[f.path,f.label])),validUntil:new Date(now()+30*60000).toISOString()},null);
  return proposalDetail(row);
 });
 async function scheduleList(actor,access){
  const metadata=access?.scheduleStatus?await access.scheduleStatus():await sourceCatalog(access),runtimeReady=access?.scheduleStatus?metadata.ready===true:metadata.mode==='authorized'&&metadata.eventsEnabled===true&&access?.syntheticOnly===true,configs=new Map();for(const row of await records('config'))configs.set(row.entityId,row);
  const schedules=[];
  for(const saved of configs.values()){
   if(!canReadConfig(saved,actor))continue;
   const published=saved.payload.publishedVersionId?await requireVersion(saved.payload.publishedVersionId):null,activeTrigger=published?.payload.config.nodes.find(n=>n.type==='start')?.params.trigger,draftTrigger=saved.payload.config.nodes.find(n=>n.type==='start')?.params.trigger;
   if(activeTrigger?.mode!=='schedule'&&draftTrigger?.mode!=='schedule')continue;
   const row=activeTrigger?.mode==='schedule'?published:saved,trigger=activeTrigger?.mode==='schedule'?activeTrigger:draftTrigger,control=await latest('schedule-control',saved.entityId),isPublished=row.versionId===saved.payload.publishedVersionId,expired=!!control?.payload.expiresAt&&control.payload.expiresAt<=now(),enabled=isPublished&&!expired&&(!control?!realData:control.payload.enabled&&control.payload.configVersionId===row.versionId&&(!realData||!!control.payload.grantId)),slot=scheduleSlot(trigger.schedule,now()),receipt=await latest('schedule-slot','schedule-slot-'+hash([row.versionId,slot.day])),attempt=await latest('schedule-attempt',saved.entityId);
   let readable=true,sourceDetails;if(access)try{sourceDetails=await checkedTrigger(row.payload.config,access);}catch{readable=false;}
   const state=!isPublished?'draft':control&&control.payload.configVersionId!==row.versionId?'version-changed':expired?'expired':!runtimeReady?'unavailable':!enabled?'paused':!readable?'blocked':'active';
   const runs=nextScheduleRuns(trigger.schedule,now()),activated=Math.max(Date.parse(row.payload.activatedAt||row.createdAt),Date.parse(control?.payload.at||row.createdAt));
   if(state==='active'&&slot.due&&!receipt&&Date.parse(slot.dueAt)>activated)runs.unshift(slot.dueAt);
   schedules.push({id:saved.entityId,name:row.payload.config.name,versionId:row.versionId,hasDraft:saved.versionId!==row.versionId,requiresGrant:realData,sourceLabel:workflowSources.find(s=>s.id===trigger.source)?.label||trigger.source,datasetLabel:sourceDetails?.datasets.find(d=>d.path===trigger.dataset)?.label||trigger.dataset,schedule:validateSchedule(trigger.schedule),summary:describeSchedule(trigger.schedule),nextRuns:runs.slice(0,3),state,enabled:!!enabled,controlVersionId:control?.versionId||null,canEnable:isPublished&&runtimeReady&&readable&&row.payload.ownerId===actor?.id,expiresAt:control?.payload.expiresAt||null,lastCheck:receipt?.payload||null,lastAttempt:attempt?.payload||null,resultsUrl:'/studio/workflow-manager/?edit='+encodeURIComponent(saved.entityId)+'&view=results',editUrl:'/studio/workflow-manager/?edit='+encodeURIComponent(saved.entityId)});
  }
  return{schedules,runtimeReady,worker:metadata.worker||null,message:runtimeReady?(metadata.worker?.state==='blocked'?'后台最近一次检查失败，请核对任务状态与运行记录；已保存的计划仍保留。':'后台调度已接通；执行时仍会核对当前权限。'):'当前实例未接通自动调度。可设置并保存时间，不能宣称任务已经在运行。'};
 }
 async function runRecords(actor,access,{workflowId,runId}={}){
  const rows=new Map();for(const r of [...await records('run'),...await records('delivery')])if(r.payload.ownerId===actor?.id){const p=r.payload,execution=p.execution||{},runId=execution.runId||p.runId;if(runId)rows.set(runId,{...p,...execution,runId,createdAt:r.createdAt});}
  for(const review of await records('review')){const p=review.payload,run=rows.get(p.runId);if(run&&p.execution)Object.assign(run,p.execution);}
  const visible=[];for(const row of [...rows.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
   if(workflowId&&row.workflowId!==workflowId||runId&&row.runId!==runId)continue;
   // A free-form manual Agent can read several sources without a single bound
   // trigger. Preserve the stored run, but do not expose unproven historical
   // business output through this new results API after permissions may change.
   if(realData&&row.preview){row.result=null;if(row.execution)row.execution={...row.execution,result:null};row.resultNote='手动试运行的详细输出在当次页面查看；历史列表保留状态。自动运行的结果按触发来源重新鉴权后展示。';}
   if(row.triggerEvent&&!row.triggerEvent.simulation){try{if(!(access?.visible?await access.visible(row.triggerEvent):await access?.verify?.(row.triggerEvent)))continue;}catch{continue;}}
   visible.push(row);
   if(visible.length>=100)break;
  }
  return visible.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 async function startPreview(row,actor,workflow,triggerEvent){
  const run=await workflow.createRun(),receipt=await serial(()=>append('run',run.runId,{workflowId:row.entityId,workflowName:row.payload.config.name,configVersionId:row.versionId,ownerId:actor?.id,runId:run.runId,preview:true,status:'starting',...(triggerEvent?{triggerEvent}:{})},null));
  try{const result=await run.start({inputData:{}}),execution={status:result.status,runId:run.runId,result:result.result||null};await serial(()=>append('run',run.runId,{...receipt.payload,...execution},receipt));return{...execution,steps:result.steps};}
  catch(error){await serial(()=>append('run',run.runId,{...receipt.payload,status:'needs-attention'},receipt));throw error;}
 }
 async function ensureReview({row,node,runId,engineId,preview,inputData}){
  return serial(async()=>{
   const taskId='review-'+hash([row.versionId,node.id,runId]).slice(0,40),existing=await latest('review',taskId);if(existing)return existing;
   return append('review',taskId,{taskId,ownerId:row.payload.ownerId||null,workflowId:row.entityId,configVersionId:row.versionId,workflowName:row.payload.config.name,nodeId:node.id,title:node.params.title,role:node.params.role,reviewerId:node.params.reviewerId,instructions:node.params.instructions,runId,engineId,preview,status:'pending',payload:inputData,payloadHash:hash(inputData),sourceFingerprint:sourceFingerprint(),validUntil:new Date(now()+node.params.maxAgeMinutes*60000).toISOString(),audit:[]},null);
  });
 }
 function compile(row,{preview=false,engineId=row.payload.runtimeId,triggerEvent}={}){
  const {ordered,incoming}=validateWorkflow(row.payload.config);
  let workflow=createWorkflow({mastra,id:engineId,description:row.payload.config.description||row.payload.config.name,metadata:{name:row.payload.config.name,doonVersionId:row.versionId},inputSchema:z.object({}).strict(),outputSchema:stateSchema});
  for(const node of ordered){
   const step=createStep({id:node.id,description:node.label,inputSchema:node.type==='start'?z.object({}).strict():stateSchema,outputSchema:stateSchema,resumeSchema:z.object({}).passthrough(),suspendSchema:z.any(),execute:async({inputData,runId,suspend})=>{
    if(node.type==='start'){const state=initialState();state.syntheticOnly=!realData||triggerEvent?.syntheticOnly===true;if(triggerEvent){state.trigger=structuredClone(triggerEvent);state.records=[structuredClone(triggerEvent.after)];}state.nodeStates[node.id]={status:'completed',label:node.label};return state;}
    const state=structuredClone(inputData),eligible=incoming.get(node.id).some(e=>state.nodeStates[e.from]?.status==='completed'&&(e.port==='next'||state.nodeStates[e.from].port===e.port));
    if(!eligible){state.nodeStates[node.id]={status:'skipped',label:node.label};return state;}
    let port='next';
    if(node.type==='record'){if(!state.trigger)state.messages.push({nodeId:node.id,text:'当前是手动试运行，没有触发记录。请使用触发条件测试。'});}
    if(node.type==='scan'){if(state.trigger)throw new Error('采购合成巡检节点不消费业务事件，请使用“读取触发记录”节点。');const result=await tools.inspectOverdue.execute({});if(result.syntheticOnly!==true)throw new Error('Synthetic source required');state.orders=result.orders;}
    if(node.type==='filter')state.orders=state.orders.filter(r=>r.missing>=node.params.minMissing&&String(r.supplier).includes(node.params.supplier));
    if(node.type==='branch'){if(realData&&node.params.metric==='missing')throw new Error('真实记录未接入统一欠数口径，请使用触发条件筛选。');const value=node.params.metric==='count'?(state.records?.length||state.orders.length):state.orders.reduce((sum,r)=>sum+r.missing,0),t=node.params.threshold;port=({gte:value>=t,gt:value>t,eq:value===t,lte:value<=t,lt:value<t})[node.params.operator]?'yes':'no';}
    if(node.type==='draft')for(const order of state.orders){const result=await tools.draftFollowup.execute({orderId:order.orderId});if(result.sent!==false||result.syntheticOnly!==true)throw new Error('Internal draft required');state.drafts.push({...result,text:node.params.prefix+result.text});}
    if(node.type==='agent'){
     if(activeAgentCalls>=2)throw new Error('工作流 Agent 调用并发已满，请稍后重新试运行。');activeAgentCalls++;
     try{const agent=await mastra.getAgentById(node.params.agentId,{status:'published'}),result=await agent.generate(node.params.prompt+(state.syntheticOnly?'\n\n本次合成流程证据：\n':'\n\n本次只读流程证据（需核对实时来源）：\n')+JSON.stringify({orders:state.orders,records:state.records,trigger:state.trigger,drafts:state.drafts,messages:state.messages}));state.messages.push({nodeId:node.id,agentId:node.params.agentId,text:result.text});}finally{activeAgentCalls--;}
    }
    if(node.type==='summary')state.messages.push({nodeId:node.id,text:`${node.params.title}：本次 ${state.records?.length||state.orders.length} 个${state.syntheticOnly?'合成':'只读业务'}条目，${state.drafts.length} 份内部草稿。未发送消息、未修改业务数据。`});
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
 async function performResume(record,access){
  const task=record.payload;if(task.execution)return task.execution;
  const row=await requireVersion(task.configVersionId),workflow=compile(row,{preview:task.preview,engineId:task.engineId});
  const saved=await workflow.getWorkflowRunById(task.runId),applied=saved?.steps?.[task.nodeId]?.output?.messages?.some(m=>m.reviewTaskId===task.taskId&&m.decision===task.status);
  if(applied&&saved.status==='running')throw fail('后续步骤仍在执行，请稍后核对运行结果。',409);
  const currentConfig=await requireConfig(task.workflowId),currentVersion=task.preview?currentConfig.versionId:currentConfig.payload.publishedVersionId;
  if(!applied&&(currentVersion!==task.configVersionId||sourceFingerprint()!==task.sourceFingerprint||new Date(task.validUntil).getTime()<=now()))throw fail('流程版本、来源或审核有效期已变化，不能继续旧审批。请重新预览。',409);
  if(!applied&&task.payload.trigger&&!task.payload.trigger.simulation&&(!access?.verify||!await access.verify(task.payload.trigger)))throw fail('执行前来源或读取权限已变化，不能继续旧审批。',409);
  const run=applied?null:await workflow.createRun({runId:task.runId}),resume=()=>run.resume({step:task.nodeId,resumeData:{}}),result=applied?saved:task.payload.trigger&&!task.payload.trigger.simulation&&access?.withEvent?await access.withEvent(task.payload.trigger,resume):await resume(),execution={status:result.status,runId:task.runId,result:result.result||null};
  await serial(async()=>{const current=await latest('review',task.taskId);if(!current.payload.execution)await append('review',task.taskId,{...current.payload,execution},current);});return execution;
 }
 function resumeTask(record,access){const id=record.entityId;if(resuming.has(id))return resuming.get(id);const promise=performResume(record,access).finally(()=>resuming.delete(id));resuming.set(id,promise);return promise;}
 async function decide(request,taskId,actor,access){
  const body=await readBody(request,z.object({action:z.enum(['approve','reject','defer']),comment:z.string().trim().min(1).max(1000),expectedVersionId:id,requestId:z.string().uuid()}).strict());
  const record=await serial(async()=>{
   const current=await latest('review',taskId);if(!current)throw fail('没有找到审核任务。',404);const task=current.payload,person=reviewer(actor,task);
   if(task.payload.trigger&&!task.payload.trigger.simulation){if(!access?.verify||!await access.verify(task.payload.trigger))throw fail('触发来源或当前读取权限已变化，需要重新核对。',409);}
   const previous=task.audit.find(e=>e.requestId===body.requestId);
   if(previous){if(previous.actor.id!==person.id||previous.action!==body.action||previous.comment!==body.comment)throw fail('审核请求标识已用于不同的决定。',409);return current;}
   if(current.versionId!==body.expectedVersionId||['approved','rejected'].includes(task.status))throw fail('审核状态已变化，请刷新后查看。',409);
   if(new Date(task.validUntil).getTime()<=now())throw fail('审核已过期，请重新试运行或发起新流程。',409);
   const config=await requireConfig(task.workflowId),expectedId=task.preview?config.versionId:config.payload.publishedVersionId;
   if(expectedId!==task.configVersionId||sourceFingerprint()!==task.sourceFingerprint)throw fail('流程版本或来源已变化，需要重新预览并审核。',409);
   const status={approve:'approved',reject:'rejected',defer:'deferred'}[body.action],audit=[...task.audit,{action:body.action,comment:body.comment,actor:person,requestId:body.requestId,at:new Date(now()).toISOString(),payloadHash:task.payloadHash,configVersionId:task.configVersionId}];
   return append('review',taskId,{...task,status,audit},current);
  });
  const execution=['approved','rejected'].includes(record.payload.status)?await resumeTask(record,access):null;
  return json({taskId,status:record.payload.status,execution});
 }
 async function handle(request,{actor,workflowAccess}={}){
  const url=new URL(request.url),base='/studio/workflow-manager/api/',route=url.pathname.slice(base.length);
  try{
   if(['GET','HEAD'].includes(request.method)){
    if(route==='schedules')return json(await scheduleList(actor,workflowAccess));
    if(route==='runs'){const rows=await runRecords(actor,workflowAccess,{workflowId:url.searchParams.get('workflowId')});return json({runs:rows.map(({result,triggerEvent,execution,...r})=>r)});}
    const runDetail=route.match(/^runs\/([\w-]+)$/);if(runDetail){const row=(await runRecords(actor,workflowAccess,{runId:runDetail[1]}))[0];if(!row)throw fail('运行记录不存在或当前不可见。',404);return json(row);}
    const proposal=route.match(/^proposals\/(proposal-[\w-]+)$/);if(proposal)return json(proposalDetail(await requireProposal(proposal[1],actor)));
    if(route==='sources')return json({...await sourceCatalog(workflowAccess,url.searchParams.get('source')||undefined,Object.fromEntries([...url.searchParams].filter(([k])=>['customerId','projectId','id','teamId'].includes(k)))),operators:triggerOperators,defaults:defaultTrigger()});
    if(route==='deliveries')return json({deliveries:(await records('delivery')).filter(r=>r.payload.ownerId===actor?.id).map(r=>({id:r.entityId,workflowId:r.payload.workflowId,eventId:r.payload.eventId,recordId:r.payload.recordId,runId:r.payload.execution?.runId||r.payload.runId,status:r.payload.execution?.status||r.payload.status})).slice(-100).reverse()});
    if(route==='workflows'){const all=await records('config'),map=new Map();for(const row of all)map.set(row.entityId,row);return json({workflows:[...map.values()].filter(r=>canReadConfig(r,actor)).map(r=>{const {nodes,edges,...summary}=detail(r);return summary;}),catalog:availableCatalog,agents:Object.entries(mastra.listAgents()).map(([id,agent])=>({id,name:agent.name})),actor:actor?{id:actor.id,name:actor.name,role:actor.role,synthetic:actor.synthetic===true}:null});}
    if(route==='reviews'){const all=await records('review'),map=new Map();for(const row of all)map.set(row.entityId,row);const visible=[];for(const r of map.values()){const event=r.payload.payload.trigger;if(event&&(event.simulation?r.payload.ownerId!==actor?.id:!workflowAccess?.verify||!await workflowAccess.verify(event)))continue;visible.push({...r.payload,versionId:r.versionId,createdAt:r.createdAt,expired:new Date(r.payload.validUntil).getTime()<=now()});}return json({reviews:visible});}
    const match=route.match(/^workflows\/([\w-]+)(?:\/(versions))?$/);if(match){const row=await requireConfig(match[1]);if(!canReadConfig(row,actor))throw fail('该触发规则属于其他配置人。',403);return json(match[2]?{versions:(await records('config',match[1])).reverse().map(r=>({id:r.versionId,versionNumber:r.revision,createdAt:r.createdAt,message:r.payload.message}))}:detail(row));}
    throw fail('未找到入口。',404);
   }
   if(request.headers.get('origin')!==url.origin)throw fail('不允许跨站修改工作流或审核。',403);
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw fail('请求格式不正确。',415);
   const scheduleAction=route.match(/^schedules\/([\w-]+)\/state$/);
   if(scheduleAction&&request.method==='POST')return await serial(async()=>{
    if(!actor?.id||!['admin','programmer'].includes(actor.role))throw fail('需要有效的 Studio 管理身份。',403);
    const body=await readBody(request,z.object({expectedVersionId:id,expectedControlVersionId:id.nullable(),enabled:z.boolean()}).strict()),saved=await requireConfig(scheduleAction[1]);
    if(saved.payload.ownerId!==actor.id||!saved.payload.publishedVersionId)throw fail('只能管理本人已发布的定时工作流。',403);
    const row=await requireVersion(saved.payload.publishedVersionId),control=await latest('schedule-control',saved.entityId),trigger=row.payload.config.nodes.find(n=>n.type==='start')?.params.trigger;
    if(row.versionId!==body.expectedVersionId||(control?.versionId||null)!==body.expectedControlVersionId)throw fail('定时任务版本或状态已变化，请刷新后重试。',409);
    if(trigger?.mode!=='schedule')throw fail('当前发布版本不是定时工作流。',409);
    let grant={};if(body.enabled){const metadata=await checkedTrigger(row.payload.config,workflowAccess);if(realData){if(!workflowAccess?.authorizeSchedule||!(await workflowAccess.scheduleStatus()).ready)throw fail('此实例尚未接通后台调度，暂不能启用。',409);grant=await workflowAccess.authorizeSchedule({workflowId:saved.entityId,configVersionId:row.versionId,trigger});}else if(!workflowAccess?.syntheticOnly||metadata?.mode!=='authorized'||!metadata.eventsEnabled)throw fail('此实例尚未接通后台调度，暂不能启用。',409);}
    await append('schedule-control',saved.entityId,{ownerId:actor.id,configVersionId:row.versionId,enabled:body.enabled,...grant,at:new Date(now()).toISOString(),actor:{id:actor.id,name:actor.name}},control);
    if(!body.enabled&&control?.payload.grantId)await workflowAccess?.revokeSchedule?.({workflowId:saved.entityId,grantId:control.payload.grantId});
    return json({id:saved.entityId,enabled:body.enabled});
   });
   const proposalAction=route.match(/^proposals\/(proposal-[\w-]+)\/(confirm|cancel)$/);
   if(proposalAction&&request.method==='POST')return await serial(async()=>{
    if(!actor?.id||!['admin','programmer'].includes(actor.role))throw fail('需要有效的 Studio 管理身份。',403);
    const body=await readBody(request,z.object({expectedVersionId:id}).strict()),current=await requireProposal(proposalAction[1],actor),p=current.payload;
    if(p.status==='confirmed'&&proposalAction[2]==='confirm')return json(proposalDetail(current));
    if(current.versionId!==body.expectedVersionId||p.status!=='pending')throw fail('预览状态已变化，请重新查看。',409);
    if(new Date(p.validUntil).getTime()<=now())throw fail('流程预览已过期，请让 Agent 重新生成。',409);
    if(proposalAction[2]==='cancel')return json(proposalDetail(await append('proposal',current.entityId,{...p,status:'cancelled'},current)));
    // The browser confirms a stored, version-bound proposal, never a new graph
    // supplied in the confirmation request. Recheck current field permissions.
    const {workflow}=await saveNewDraft({...p.config,requestId:p.requestId},{actor,workflowAccess,proposalId:current.entityId});
    return json(proposalDetail(await append('proposal',current.entityId,{...p,status:'confirmed',workflowId:workflow.id,workflowVersionId:workflow.versionId,confirmedAt:new Date(now()).toISOString()},current)));
   });
   const proposalSchedule=route.match(/^proposals\/(proposal-[\w-]+)\/schedule$/);
   if(proposalSchedule&&request.method==='PATCH')return await serial(async()=>{
    if(!actor?.id||!['admin','programmer'].includes(actor.role))throw fail('需要有效的 Studio 管理身份。',403);
    const body=await readBody(request,z.object({expectedVersionId:id,schedule:z.any()}).strict()),current=await requireProposal(proposalSchedule[1],actor),p=current.payload;
    if(current.versionId!==body.expectedVersionId||p.status!=='pending'||new Date(p.validUntil).getTime()<=now())throw fail('预览状态已变化或过期，请重新生成。',409);
    const config=structuredClone(p.config),start=config.nodes.find(n=>n.type==='start');if(start.params.trigger?.mode!=='schedule')throw fail('此预览不是定时工作流。',409);
    try{start.params.trigger.schedule=validateSchedule(body.schedule);}catch(error){throw fail(error.message);}
    await checked(config);await checkedTrigger(config,workflowAccess);
    return json(proposalDetail(await append('proposal',current.entityId,{...p,config,configHash:hash(config)},current)));
   });
   const target=route.match(/^workflows\/([\w-]+)/);if(target&&!canReadConfig(await requireConfig(target[1]),actor))throw fail('该触发规则属于其他配置人。',403);
   const triggerCheck=route.match(/^workflows\/([\w-]+)\/trigger-check$/);
   if(triggerCheck&&request.method==='POST'){
    const body=await readBody(request,z.object({expectedVersionId:id,trigger:z.any(),sample:z.object({type:z.enum(['created','updated','schedule']),before:z.any(),after:z.any()}).strict().optional(),run:z.boolean().optional(),recorded:z.boolean().optional()}).strict()),row=await expected(triggerCheck[1],body.expectedVersionId);
    let trigger;try{trigger=validateTrigger(body.trigger);}catch(error){throw fail(error.message);}
    const source=await sourceCatalog(workflowAccess,trigger.source,trigger.scope),dataset=source.datasets?.find(d=>d.path===trigger.dataset);if(!dataset)throw fail('数据对象不可见。',403);
    if(body.recorded){if(!workflowAccess)return json({enabled:false,events:[],message:'当前是合成预览，没有连接业务变更日志。'});return json(await workflowAccess.poll(trigger,source.revision));}
    if(!body.sample)throw fail('请填写修改前后的测试值。');
    const event={id:'simulation-'+randomUUID(),recordId:typeof body.sample.after?.id==='string'?body.sample.after.id:'SYN-TRIGGER-RECORD',source:trigger.source,dataset:trigger.dataset,type:body.sample.type,before:body.sample.before,after:body.sample.after,fieldLabels:Object.fromEntries(dataset.fields.map(f=>[f.path,f.label])),syntheticOnly:true,simulation:true,origin:'manual-test',scope:trigger.scope};
    let result;try{result=evaluateTrigger(trigger,event,dataset);}catch(error){throw fail(error.message);}
    if(!body.run||!result.matched)return json({...result,simulation:true,mode:source.mode});
    // A simulation can carry only synthetic/user-entered test values. It never
    // enables the business event bridge or changes the published rule.
    const temporary={...row,payload:{...row.payload,config:{...row.payload.config,nodes:row.payload.config.nodes.map(n=>n.type==='start'?{...n,params:{trigger}}:n)}}};
    if(activeTests>=2)throw fail('当前试运行较多，请稍后重试。',429);activeTests++;
    try{const workflow=compile(temporary,{preview:true,engineId:'preview-'+row.versionId,triggerEvent:event}),execution=await startPreview(row,actor,workflow,event);return json({...result,simulation:true,execution});}finally{activeTests--;}
   }
   const decision=route.match(/^reviews\/([\w-]+)\/decision$/);if(decision&&request.method==='POST')return await decide(request,decision[1],actor,workflowAccess);
   const match=route.match(/^workflows(?:\/([\w-]+))?(?:\/(publish|restore|test))?$/);if(!match)throw fail('未找到入口。',404);const [,key,action]=match;
   if(key&&action==='test'&&request.method==='POST'){
    const body=await readBody(request,z.object({expectedVersionId:id}).strict()),row=await expected(key,body.expectedVersionId);await checked(row.payload.config);
    if(activeTests>=2)throw fail('当前试运行较多，请稍后重试。',429);activeTests++;
    try{return json(await startPreview(row,actor,compile(row,{preview:true,engineId:'preview-'+row.versionId})));}finally{activeTests--;}
   }
   return await serial(async()=>{
    if(!key&&request.method==='POST'){
     const body=await readBody(request,workflowDraftSchema),result=await saveNewDraft(body,{actor,workflowAccess});return json(result.workflow,result.created?201:200);
    }
    if(key&&!action&&request.method==='PATCH'){
     const {expectedVersionId,...config}=await readBody(request,saveSchema),previous=await expected(key,expectedVersionId);await checked(config);await checkedTrigger(config,workflowAccess);return json(detail(await append('config',key,{...previous.payload,config,ownerId:previous.payload.ownerId||actor?.id||null,message:'保存草稿'},previous)));
    }
    if(key&&request.method==='POST'&&['publish','restore'].includes(action)){
     const body=await readBody(request,z.object({expectedVersionId:id,versionId:id.optional()}).strict()),previous=await expected(key,body.expectedVersionId);
     const source=action==='restore'?await requireVersion(body.versionId||''):previous;if(source.entityId!==key)throw fail('不能恢复其他流程的版本。',404);await checked(source.payload.config);const catalog=await checkedTrigger(source.payload.config,workflowAccess);
     const row=await append('config',key,{...previous.payload,config:source.payload.config,...(action==='publish'?{ownerId:actor?.id||null,activationCursor:catalog?.revision||0,activatedAt:new Date(now()).toISOString(),triggerMode:catalog?.mode||'manual'}:{}),message:action==='publish'?'发布流程':'恢复历史为新草稿'},previous,action==='publish');if(action==='publish')await install(row);return json(detail(row));
    }
    throw fail('不支持该操作。',405);
   });
  }catch(error){return json({error:error.status?error.message:'工作流服务暂时不可用，请刷新后重试。'},error.status||503);}
 }
 const all=await store.list();for(const row of all.definitions)if(row.metadata?.recordType===kind&&row.status!=='archived')await store.upsert({id:row.id,status:'archived'});
 if(!realData&&!await latest('config','followup'))await append('config','followup',{config:{name:'采购欠料巡检与内部草稿',description:'检查固定合成采购条目，生成内部草稿。',...workflowTemplate()},runtimeId:'synthetic-procurement-followup',message:'登记原流程基线'},null,true);
 const configs=await records('config'),map=new Map();for(const row of configs)map.set(row.entityId,row);for(const row of map.values())if(row.payload.publishedVersionId)await install(row);
 const has=async key=>(await records('config')).some(row=>row.entityId===key||row.payload.runtimeId===key);
 async function processTriggers(accessForOwner,{runWithAccess=(_,operation)=>operation()}={}){
  if(processingTriggers)return[];processingTriggers=true;const results=[];
  try{
   const latestConfigs=new Map();for(const row of await records('config'))latestConfigs.set(row.entityId,row);
   for(const saved of latestConfigs.values()){
    if(!saved.payload.publishedVersionId)continue;const row=await requireVersion(saved.payload.publishedVersionId),trigger=row.payload.config.nodes.find(n=>n.type==='start')?.params.trigger;
    if(!trigger||trigger.mode==='manual'||!row.payload.ownerId||row.payload.triggerMode!=='authorized')continue;
    try{
     const control=trigger.mode==='schedule'?await latest('schedule-control',row.entityId):null,slot=trigger.mode==='schedule'?scheduleSlot(trigger.schedule,now()):null,slotId=slot?'schedule-slot-'+hash([row.versionId,slot.day]):null;
     if(slot&&(!slot.due||realData&&(!control?.payload.enabled||!control.payload.grantId||control.payload.expiresAt<=now())||control&&(!control.payload.enabled||control.payload.configVersionId!==row.versionId)||await latest('schedule-slot',slotId)))continue;
     const access=await accessForOwner(row.payload.ownerId,{row,control,trigger});if(!access?.syntheticOnly&&!(realData&&slot&&access?.scheduledReadOnly===true))continue;
     await runWithAccess(access,async()=>{
     await checkedTrigger(row.payload.config,access);
     const cursorId='trigger-cursor-'+hash(row.versionId),cursor=await latest('cursor',cursorId),batch=slot?await latest('schedule-batch',slotId):null;
     if(slot&&Date.parse(slot.dueAt)<=Math.max(Date.parse(row.payload.activatedAt),Date.parse(control?.payload.at||row.payload.activatedAt)))return;
     const page=batch?.payload.page||(trigger.mode==='schedule'?await access.schedule(trigger):await access.poll(trigger,cursor?.payload.cursor??row.payload.activationCursor));
     if(!page.enabled)return;
     if(slot&&page.day!==slot.day)return;
     if(slot&&!batch)await serial(()=>append('schedule-batch',slotId,{workflowId:row.entityId,ownerId:row.payload.ownerId,page},null));
     let complete=true;for(const candidate of page.events.filter(e=>e.matched)){
      const deliveryId='trigger-delivery-'+hash([row.versionId,candidate.id,candidate.recordId]),previous=await latest('delivery',deliveryId);if(previous?.payload.execution)continue;
      const event={...candidate,scope:trigger.scope,syntheticOnly:access.syntheticOnly===true,triggerConfig:validateTrigger(trigger)},runId='trigger-'+hash(deliveryId).slice(0,40),workflow=compile(row,{engineId:'trigger-'+row.versionId,triggerEvent:event});
      if(previous){const known=await workflow.getWorkflowRunById(runId);if(known&&['success','suspended','failed','canceled'].includes(known.status)){await serial(()=>append('delivery',deliveryId,{...previous.payload,execution:{status:known.status,runId,result:known.result||null}},previous));continue;}complete=false;results.push({workflowId:row.entityId,status:'needs-attention',deliveryId});continue;}
      if(!await access.verify(event)){await serial(()=>append('delivery',deliveryId,{workflowId:row.entityId,ownerId:row.payload.ownerId,eventId:candidate.id,recordId:candidate.recordId,execution:{status:'source-changed',runId:null}},null));results.push({workflowId:row.entityId,status:'source-changed',eventId:candidate.id});continue;}
      const receipt=await serial(async()=>{const current=await requireConfig(row.entityId),currentControl=slot?await latest('schedule-control',row.entityId):null;if(current.payload.publishedVersionId!==row.versionId||slot&&(currentControl?.versionId||null)!==(control?.versionId||null)||await latest('delivery',deliveryId))return null;return append('delivery',deliveryId,{workflowId:row.entityId,workflowName:row.payload.config.name,configVersionId:row.versionId,ownerId:row.payload.ownerId,eventId:candidate.id,recordId:candidate.recordId,triggerEvent:event,runId,preview:false,status:'starting'},null);});
      if(!receipt){complete=false;break;}
      try{const run=await workflow.createRun({runId}),output=await runWithAccess(access.forEvent?.(event)||access,()=>run.start({inputData:{}})),execution={status:output.status,runId,result:output.result||null};await serial(()=>append('delivery',deliveryId,{...receipt.payload,execution},receipt));results.push({workflowId:row.entityId,status:output.status,deliveryId});}catch{complete=false;results.push({workflowId:row.entityId,status:'needs-attention',deliveryId});}
     }
     if(complete&&trigger.mode==='change'&&page.cursor>(cursor?.payload.cursor??row.payload.activationCursor))await serial(()=>append('cursor',cursorId,{cursor:page.cursor},cursor));
     if(complete&&slot)await serial(()=>append('schedule-slot',slotId,{ownerId:row.payload.ownerId,workflowId:row.entityId,configVersionId:row.versionId,day:slot.day,dueAt:slot.dueAt,checkedAt:new Date(now()).toISOString(),matched:page.events.filter(e=>e.matched).length},null));
     if(slot)await attempt(row,complete?'checked':'needs-attention');
     });
    }catch(error){results.push({workflowId:row.entityId,status:'blocked'});if(trigger.mode==='schedule')await attempt(row,'blocked',error.status===413?'limit-exceeded':[401,403].includes(error.status)?'authorization-unavailable':'source-unavailable');}
   }
   return results;
  }finally{processingTriggers=false;}
 }
 async function attempt(row,status,error=null){await serial(async()=>{const old=await latest('schedule-attempt',row.entityId),day=scheduleSlot(row.payload.config.nodes.find(n=>n.type==='start').params.trigger.schedule,now()).day;if(old?.payload.status===status&&old.payload.error===error&&old.payload.day===day&&old.payload.configVersionId===row.versionId)return;await append('schedule-attempt',row.entityId,{ownerId:row.payload.ownerId,configVersionId:row.versionId,status,error,day,checkedAt:new Date(now()).toISOString()},old);});}
 return{handle,has,compile,records,processTriggers,previewDraft,sourceCatalog,agentCatalog:()=>Object.entries(mastra.listAgents()).map(([id,agent])=>({id,name:agent.name}))};
}
