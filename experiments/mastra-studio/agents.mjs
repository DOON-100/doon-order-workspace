import {randomUUID,createHash} from 'node:crypto';
import {Mastra} from '@mastra/core';
import {createEditor,editorPermissions,prepareEditor} from './editor.mjs';
import {createAgentManager} from './agent-manager.mjs';
import {createWorkflowManager} from './workflow-manager.mjs';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {createStep,createWorkflow} from '@mastra/core/workflows';
import {Memory} from '@mastra/memory';
import {LibSQLStore} from '@mastra/libsql';
import {Observability,MastraStorageExporter} from '@mastra/observability';
import {z} from 'zod';
import {localModel} from './offline-model.mjs';
import {instructionsFor,profiles} from './profiles.mjs';
import {createWorkflowTools} from './workflow-tools.mjs';

export const syntheticOrders=Object.freeze([
 {orderId:'SYN-STUDIO-001',material:'合成镜腿',quantity:120,missing:30,supplier:'合成供应商甲',promisedDate:'2026-10-14',received:0,version:1},
 {orderId:'SYN-STUDIO-002',material:'合成镜框',quantity:80,missing:0,supplier:'合成供应商乙',promisedDate:'2026-10-25',received:80,version:1},
]);
const asOf='2026-10-17';
export function createAgents(dataDir,{liveModel,storage:providedStorage,serviceName='doon-studio-synthetic'}={}){
 let workflowManager;
 const workflowTools=createWorkflowTools(()=>workflowManager);
 const storage=providedStorage||new LibSQLStore({id:'doon-studio-synthetic',url:`file:${dataDir.replaceAll('\\','/')}/mastra.sqlite`});
 const listOverdue=createTool({id:'inspect-overdue',description:'读取固定合成采购场景，检查欠料与供应商复期；不访问数据台订单。',
  inputSchema:z.object({}).strict(),outputSchema:z.object({syntheticOnly:z.literal(true),asOf:z.string(),orders:z.array(z.object({orderId:z.string(),material:z.string(),missing:z.number(),supplier:z.string(),promisedDate:z.string(),version:z.number()}))}),
  execute:async()=>({syntheticOnly:true,asOf,orders:syntheticOrders.filter(row=>row.missing>0&&row.promisedDate<asOf).map(({orderId,material,missing,supplier,promisedDate,version})=>({orderId,material,missing,supplier,promisedDate,version}))})});
 const draftFollowup=createTool({id:'draft-followup',description:'为指定合成单生成催交草稿；不发企业微信、不创建正式任务。',
  inputSchema:z.object({orderId:z.enum(['SYN-STUDIO-001','SYN-STUDIO-002'])}).strict(),
  execute:async({orderId})=>{const row=syntheticOrders.find(item=>item.orderId===orderId);return{syntheticOnly:true,sent:false,orderId,assignee:'采购 Agent',text:`【测试草稿】${row.supplier}：${row.orderId} ${row.material} 尚欠 ${row.missing}，原复期 ${row.promisedDate}，请核实新交期。`};}});
 const model=(role,delegate=false)=>localModel(async({prompt})=>{
  const lastUser=prompt.findLastIndex(message=>message.role==='user'),recent=prompt.slice(lastUser+1);
  const results=recent.filter(message=>message.role==='tool').flatMap(message=>message.content||[]);
  const userText=JSON.stringify(prompt[lastUser]?.content||'');
  if(delegate&&userText.includes('/工作流工具演练')){
   const receipt=results.find(result=>result.toolName==='previewWorkflow');
   if(receipt){const output=receipt.output?.value??receipt.output;return[{type:'text',text:output?.previewUrl?'【离线固定模板工具演练】\n[预览工作流]('+output.previewUrl+')\n请在下方查看流程并点击“确认保存”。确认前不会出现在 Workflows。本次仅验证工具与确认链路，不代表真实模型理解了自然语言。':'预览工具未成功返回，请核对当前登录身份和工具状态。'}];}
   return[{type:'tool-call',toolCallId:randomUUID(),toolName:'previewWorkflow',input:JSON.stringify(workflowToolDemo())}];
  }
  if(delegate&&/工作流|workflow/i.test(userText))return[{type:'text',text:'当前是离线脚本，不能理解任意自然语言来设计工作流。输入 /工作流工具演练 可预览固定的“读取记录→人工审核→汇总”模板，再由你点击确认保存。启用真实模型后，由模型根据你的描述生成预览。'}];
  if(!results.length)return[{type:'tool-call',toolCallId:randomUUID(),toolName:'inspectOverdue',input:'{}'}];
  if(delegate&&!results.some(result=>result.toolName==='delegateProcurement'))return[{type:'tool-call',toolCallId:randomUUID(),toolName:'delegateProcurement',input:JSON.stringify({orderId:'SYN-STUDIO-001'})}];
  if(!delegate&&!results.some(result=>result.toolName==='draftFollowup'))return[{type:'tool-call',toolCallId:randomUUID(),toolName:'draftFollowup',input:JSON.stringify({orderId:'SYN-STUDIO-001'})}];
  return[{type:'text',text:`【离线合成演练 · ${role}】\n检查基准日：${asOf}。SYN-STUDIO-001 尚欠合成镜腿 30，供应商原复期 2026-10-14，已逾期。\n${delegate?'已委派采购 Agent 核对合成供应商复期并生成催交草稿。':'已核对合成供应商复期并生成催交草稿。'}\n未发送企业微信、未修改正式订单。此模型按固定脚本演示工具调用，不代表真实模型的理解与决策能力。`}];
 });
 const memory=()=>new Memory({storage,options:{lastMessages:12,generateTitle:false,semanticRecall:false,workingMemory:{enabled:false}}});
 const create=(id,name,tools,delegate=false)=>new Agent({id,name:profiles[id].name,editor:editorPermissions,instructions:instructionsFor(id,{asOf})+`\n本模式保留合成采购工具演练，与真实快照工具不同。所有业务演练输出明确注明合成测试。${liveModel?'采购演练先调用 inspectOverdue；'+(delegate?'再调用 delegateProcurement 演练查询。创建工作流时改用工作流预览工具，返回预览链接，用户点击确认后才保存草稿，不执行采购演练。':'再调用 draftFollowup 演练草稿。'):''}`,model:liveModel||model(name,delegate),tools,memory:memory(),defaultOptions:{maxSteps:5,...(liveModel?{modelSettings:{maxOutputTokens:delegate?4096:768,maxRetries:0},providerOptions:{deepseek:{thinking:{type:'disabled'}}}}:{})}});
 const procurement=create('procurement','采购 Agent（离线合成）',{inspectOverdue:listOverdue,draftFollowup});
 const delegateProcurement=createTool({id:'delegate-procurement',description:'在合成场景内委派采购 Agent 核对供应商复期并返回草稿。',inputSchema:z.object({orderId:z.literal('SYN-STUDIO-001')}).strict(),
  execute:async({orderId})=>({syntheticOnly:true,assignee:'procurement',result:(await (await mastra.getAgentById('procurement',{status:'published'})).generate(`核对 ${orderId} 逾期欠料，生成催交草稿。`)).text})});
 const agents={
  supervisor:create('supervisor','总管 Agent（离线合成）',{inspectOverdue:listOverdue,delegateProcurement,...workflowTools},true),
  pmc:create('pmc','PMC Agent（离线合成）',{inspectOverdue:listOverdue,draftFollowup}),
  procurement,
  service:create('service','客服 Agent（离线合成）',{inspectOverdue:listOverdue,draftFollowup}),
 };
 const scan=createStep({id:'scan-overdue',description:'检查固定合成欠料与复期',inputSchema:z.object({}).strict(),outputSchema:listOverdue.outputSchema,execute:async()=>listOverdue.execute({})});
 const draft=createStep({id:'prepare-draft',description:'生成合成催交草稿，不执行发送',inputSchema:listOverdue.outputSchema,outputSchema:z.object({syntheticOnly:z.literal(true),sent:z.literal(false),drafts:z.array(z.any())}),execute:async({inputData})=>({syntheticOnly:true,sent:false,drafts:await Promise.all(inputData.orders.map(row=>draftFollowup.execute({orderId:row.orderId})))})});
 const followup=createWorkflow({id:'synthetic-procurement-followup',description:'离线合成采购欠料巡检 → 催交草稿；只使用测试夹具',inputSchema:z.object({}).strict(),outputSchema:draft.outputSchema}).then(scan).then(draft).commit();
 const observability=new Observability({configs:{local:{serviceName,exporters:[new MastraStorageExporter({maxBatchWaitMs:200})]}}});
 const mastra=new Mastra({agents,workflows:{followup},storage,logger:false,observability,editor:createEditor()});
 const tools={inspectOverdue:listOverdue,draftFollowup,delegateProcurement,...workflowTools};
 const lab={mastra,storage,agents,observability,tools,async close(){await observability.shutdown();await mastra.shutdown();await storage.close();}};
 const diagnostic=localModel(async()=>[{type:'text',text:'当前为离线配置验证，尚未启用真实语言模型。Agent 配置已读取；本次没有理解或执行你的业务请求，也没有修改业务数据或发送消息。'}]);
 const buildAgent=(snapshot,selected,{builtin})=>{
  // Add the bounded draft capability without rewriting any existing prompt,
  // saved tool selection, version, publication or conversation.
  if(snapshot.id==='supervisor')selected={...selected,...workflowTools};
  const scripted=builtin&&selected.inspectOverdue&&(snapshot.id==='supervisor'?selected.delegateProcurement:selected.draftFollowup);
  return new Agent({id:snapshot.id,name:snapshot.name,description:snapshot.description||'',instructions:snapshot.instructions,tools:selected,model:liveModel||(scripted?model(snapshot.name,snapshot.id==='supervisor'):diagnostic),editor:editorPermissions,memory:memory(),defaultOptions:{maxSteps:5,...(liveModel?{modelSettings:{maxOutputTokens:snapshot.id==='supervisor'?4096:768,maxRetries:0},providerOptions:{deepseek:{thinking:{type:'disabled'}}}}:{})}});
 };
 lab.editorReady=prepareEditor(mastra,storage,agents).then(async()=>{
  lab.manager=await createAgentManager({mastra,storage,agents,tools,buildAgent,requiredToolKeys:{supervisor:Object.keys(workflowTools)}});
  lab.workflowManager=workflowManager=await createWorkflowManager({mastra,storage,tools,sourceFingerprint:()=>createHash('sha256').update(JSON.stringify(syntheticOrders)).digest('hex')});
 });
 return lab;
}

// Explicit, fixed fixture for exercising the real Tool pipeline offline.
// This is never presented as free-form language understanding.
export function workflowToolDemo(){
 const node=(id,type,label,y,params={})=>({id,type,label,x:180,y,params});
 return{requestId:randomUUID(),name:'SYN Agent Tool 创建与人工审核演练',description:'离线固定模板；只保存草稿，不发布或运行。',nodes:[node('start','start','开始',40),node('record','record','读取触发记录',170),node('review','review','人工审核',300,{title:'核对本次记录',role:'technical',reviewerId:'',instructions:'核对依据后决定通过或拒绝。',maxAgeMinutes:30}),node('summary','summary','汇总结果',450,{title:'审核后汇总'}),node('end','end','结束',600)],edges:[{from:'start',to:'record',port:'next'},{from:'record',to:'review',port:'next'},{from:'review',to:'summary',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'summary',to:'end',port:'next'}]};
}
