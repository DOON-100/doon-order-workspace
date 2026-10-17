import {randomUUID} from 'node:crypto';
import {Mastra} from '@mastra/core';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {Memory} from '@mastra/memory';
import {LibSQLStore} from '@mastra/libsql';
import {Observability,MastraStorageExporter} from '@mastra/observability';
import {z} from 'zod';
import {profiles,instructionsFor,profileVersion} from './profiles.mjs';
import {localModel} from './offline-model.mjs';

const query=z.object({id:z.string().max(160).optional(),query:z.string().max(160).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20),onlyRisk:z.boolean().default(false)}).strict();
export function createBusinessAgents(dataDir,{facts,liveModel,storage:providedStorage}={}){
 const coverage=facts.coverage();
 const storage=providedStorage||new LibSQLStore({id:'doon-studio-real-snapshot',url:`file:${dataDir.replaceAll('\\','/')}/mastra.sqlite`});
 const readCoverage=createTool({id:'read-coverage',description:'先读取当前只读快照的时间、真实授权成员、数据覆盖、全量行数和能力缺口。不是实时生产状态。',inputSchema:z.object({}).strict(),execute:async()=>facts.coverage()});
 const read=(id,dataset,description)=>createTool({id,description,inputSchema:query,execute:async input=>facts.list(dataset,input)});
 const allTools={readCoverage,
  readPurchases:read('read-purchases','purchases','只读当前成员获授权采购行。按行返回净未交量、收货未知、来源截至日、各类交期和证据；分页最多50条。onlyRisk 包含待核查行，不代表已经失约。'),
  readOrders:read('read-orders','orders','只读获授权订单及要求交期、计划、可出货日、对客复期；没有订单时返回空，不从采购或项目编造。'),
  readProjects:read('read-projects','projects','按实际项目权限读取未回收项目和所属任务。项目交期不等于量产订单交期。'),
  readFollowups:read('read-followups','followups','按实际跟进权限读取跟进事项；事项数与关联项目数不同，已回收项目不会出现在结果。'),
  readServiceRecords:read('read-service-records','service','按实际客服权限读取客服记录的状态和跟进日期，不读取财务明细或联系方式。'),
  draftPurchaseFollowup:createTool({id:'draft-purchase-followup',description:'对精确采购行生成不发送、不保存的内部核查草稿。历史快照不能直接用于对外催交。',inputSchema:z.object({id:z.string().min(1).max(160)}).strict(),execute:async({id})=>facts.draftPurchase(id)}),
 };
 const agents=Object.fromEntries(Object.entries(profiles).map(([id,p])=>{
  const tools=Object.fromEntries(p.tools.map(key=>[key,allTools[key]]));
  // Offline mode is an honest connection diagnostic; it never invents business conclusions.
  const diagnostic=localModel(async({prompt})=>{
   const recent=prompt.slice(prompt.findLastIndex(m=>m.role==='user')+1);
   if(!recent.some(m=>m.role==='tool'))return[{type:'tool-call',toolCallId:randomUUID(),toolName:'readCoverage',input:'{}'}];
   return[{type:'text',text:`【${p.name} · 连接诊断】\n快照 ${coverage.snapshotId}，生成于 ${coverage.capturedAt}，观察日 ${coverage.asOf}。\n当前授权范围：采购 ${coverage.counts.purchases} 行、订单 ${coverage.counts.orders} 行、项目 ${coverage.counts.projects} 个、跟进 ${coverage.counts.followups} 项、客服记录 ${coverage.counts.service} 条。\n当前未启用真实语言模型，只验证连接和数据覆盖，未理解或分析本轮问题。${coverage.counts.orders?'':'缺少订单记录，无法核对量产排期及齐料。'}未派单、未发送、未修改业务记录。`}];
  });
  return[id,new Agent({id,name:p.name,description:p.position,instructions:instructionsFor(id,{mode:'real-snapshot',asOf:coverage.asOf,capturedAt:coverage.capturedAt}),model:liveModel||diagnostic,tools,memory:new Memory({storage,options:{lastMessages:12,generateTitle:false,semanticRecall:false,workingMemory:{enabled:false}}}),defaultOptions:{maxSteps:8,...(liveModel?{modelSettings:{maxOutputTokens:1800,maxRetries:0},providerOptions:{deepseek:{thinking:{type:'disabled'}}}}:{})}})];
 }));
 const observability=new Observability({configs:{local:{serviceName:'doon-agent-readonly-snapshot',exporters:[new MastraStorageExporter({maxBatchWaitMs:200})]}}});
 const mastra=new Mastra({agents,storage,logger:false,observability});
 return{mastra,storage,agents,observability,tools:allTools,profileVersion,dataMode:'real-snapshot',coverage,async close(){await observability.shutdown();await mastra.shutdown();await storage.close();}};
}
