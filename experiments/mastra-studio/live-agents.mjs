import {Mastra} from '@mastra/core';
import {Agent} from '@mastra/core/agent';
import {createTool} from '@mastra/core/tools';
import {Memory} from '@mastra/memory';
import {Observability,MastraStorageExporter} from '@mastra/observability';
import {z} from 'zod';
import {createEditor,editorPermissions,prepareEditor} from './editor.mjs';
import {createAgentManager} from './agent-manager.mjs';
import {createWorkflowManager} from './workflow-manager.mjs';
import {createWorkflowTools} from './workflow-tools.mjs';
import {localModel} from './offline-model.mjs';
import {profiles,instructionsFor} from './profiles.mjs';
import {currentBusinessAccess} from '../agent-server/business-api.mjs';
import {createDepartmentTools} from './department-tools.mjs';

export function createLiveAgents({storage,liveModel,scopeId}){
 let workflowManager;
 const workflowTools=createWorkflowTools(()=>workflowManager);
 const departmentTools=createDepartmentTools();
 const readCoverage=createTool({id:'read-coverage',description:'读取当前登录人有权查看的业务模块与实时读取时间；只返回元数据，不包含业务记录。',inputSchema:z.object({}).strict(),execute:async()=>currentBusinessAccess().catalog()});
 const readBusinessRecords=createTool({id:'read-business-records',description:'通过数据台原有只读接口读取当前账号权限内的记录。先用 inspectWorkflowSources(source) 确认 dataset 和字段路径；不要猜字段。每页最多20条，建议 fields 只选本次问题需要的字段。total 是当前筛选匹配数，不能把样本外推到全部记录；所有结果仅供核查，不执行业务写入或外发。',inputSchema:z.object({source:z.string().min(1).max(100),dataset:z.string().min(1).max(1200),scope:z.object({customerId:z.string().max(160).optional(),teamId:z.string().max(160).optional()}).strict().optional(),id:z.string().max(160).optional(),query:z.string().max(160).optional(),offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(20).default(10),fields:z.array(z.string().max(1200)).min(1).max(40).optional()}).strict(),execute:async input=>currentBusinessAccess().query(input)});
 const tools={readCoverage,readBusinessRecords,...workflowTools,...departmentTools};
 const diagnostic=localModel(async()=>[{type:'text',text:'语言模型暂不可用。请检查模型连接；没有读取或修改业务数据。'}]);
 const memory=()=>new Memory({storage,options:{lastMessages:12,generateTitle:false,semanticRecall:false,workingMemory:{enabled:false}}});
 const boundary='\n当前使用实时、只读业务 API。优先按侧栏部门选择 departmentSales/Service/Engineering/Planning/Purchasing/Warehouse/Production/Quality/Finance/Management 工具，依次 list→inspect→query；字段以 inspect 返回契约为准，不猜数据集或字段。prepare 不直接修改业务，必须明确告诉用户尚未保存。若返回 previewUrl，必须输出 [核对并确认变更](previewUrl)，由当前登录人在预览页核对后明确确认；模型没有确认或执行工具。未知项和冲突不能当作已核实。未适配接口只能报告尚未接通。分组不是权限，跨组动作仍由原接口逐次校验。数据日期与抓取时间以每次工具结果为准；readCoverage 只提供可见模块元数据，不提供状态统计。兼容旧岗位的 readPurchases/readOrders 查询可使用 readBusinessRecords。没有已计算口径的统计保持未知。不得猜测数据、冒充用户或执行业务写入、外发。历史对话不是本轮事实，重新读取。创建工作流先调用 inspectWorkflowSources，预览仅使用 start/record/review/agent/summary/end 节点，必须输出 [预览工作流](previewUrl)，待用户点击确认保存草稿。定时配置保存不代表后台自动任务已启用。';
 const make=(snapshot,selected)=>new Agent({id:snapshot.id,name:snapshot.name,instructions:snapshot.instructions,description:snapshot.description||'',tools:selected,model:liveModel||diagnostic,editor:editorPermissions,memory:memory(),defaultOptions:{maxSteps:8,modelSettings:{maxOutputTokens:4096,maxRetries:0},providerOptions:{deepseek:{thinking:{type:'disabled'}}}}});
 const templateHelp='\n简单的“读取记录→人工审核→汇总”工作流优先使用 previewRecordReviewWorkflow，程序生成正确连线。只需要当前授权 source、dataset、名称及用户已说明的 schedule；不要求用户编写节点或连线参数。';
 const agents=Object.fromEntries(Object.entries(profiles).map(([id,profile])=>[id,make({id,name:profile.name,instructions:instructionsFor(id,{mode:'live-readonly'})+boundary+templateHelp},tools)]));
 const observability=new Observability({configs:{cloud:{serviceName:'doon-live-'+scopeId,exporters:[new MastraStorageExporter({maxBatchWaitMs:200})]}}});
 const mastra=new Mastra({agents,storage,logger:false,observability,editor:createEditor()});
 const lab={mastra,storage,agents,tools,observability,async close(){await observability.shutdown();await mastra.shutdown();await storage.close();}};
 lab.editorReady=prepareEditor(mastra,storage,agents).then(async()=>{
  lab.manager=await createAgentManager({mastra,storage,agents,tools,buildAgent:(snapshot,selected)=>make({...snapshot,instructions:typeof snapshot.instructions==='string'?snapshot.instructions+boundary+templateHelp:async args=>String(await snapshot.instructions(args))+boundary+templateHelp},snapshot.id==='supervisor'?{...selected,...workflowTools,...departmentTools}:selected),requiredToolKeys:{supervisor:[...Object.keys(workflowTools),...Object.keys(departmentTools)]}});
  lab.workflowManager=workflowManager=await createWorkflowManager({mastra,storage,tools,sourceFingerprint:()=>scopeId,realData:true});
 });return lab;
}
