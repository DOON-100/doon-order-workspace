import {AsyncLocalStorage} from 'node:async_hooks';
import {createTool} from '@mastra/core/tools';
import {z} from 'zod';
import {workflowDraftSchema} from './workflow-manager.mjs';
import {defaultTrigger,triggerOperators} from './workflow-triggers.mjs';
import {validateSchedule} from './workflow-schedule.mjs';
const scheduleSchema=z.object({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.literal('Asia/Shanghai'),frequency:z.enum(['daily','weekdays','weekly']),weekdays:z.array(z.number().int().min(1).max(7)).max(7)}).strict();

// Only the authenticated server request can supply this context. Model arguments,
// browser requestContext and workflow node prompts never become an identity.
const context=new AsyncLocalStorage();
export const withWorkflowToolContext=(value,operation)=>context.run(value,operation);
function trusted(){
 const current=context.getStore(),actor=current?.actor;
 if(!actor?.id||!['admin','programmer'].includes(actor.role))throw new Error('创建工作流草稿需要当前有效的 Studio 管理身份。');
 return current;
}
export function createWorkflowTools(getManager){
 return{
  inspectWorkflowSources:createTool({id:'inspect-workflow-sources',description:'创建工作流前读取可用模块和字段。先不传 source 获取模块，再传模块 ID 和 scope 获取当前登录人可见的字段、类型及操作符；只返回元数据，不返回业务记录。不能猜测字段路径。',
   inputSchema:z.object({source:z.string().min(1).max(100).optional(),scope:z.object({customerId:z.string().max(160).optional(),projectId:z.string().max(160).optional(),id:z.string().max(160).optional(),teamId:z.string().max(160).optional()}).strict().optional()}).strict(),
   execute:async({source,scope})=>{const current=trusted(),catalog=await getManager().sourceCatalog(current.workflowAccess,source,scope||{});const {sample,...metadata}=catalog;return{...metadata,agents:getManager().agentCatalog(),operators:triggerOperators,defaults:defaultTrigger(),scheduleOptions:{frequencies:['daily','weekdays','weekly'],timezone:'Asia/Shanghai',weekdays:'周一=1，周日=7；仅 weekly 填写星期数组'}};}}),
  previewWorkflow:createTool({id:'preview-workflow',description:'根据用户描述生成工作流预览，用户在对话卡片点击“确认保存”后才写入 Workflows。此工具不创建工作流草稿、不发布、不运行、不审批。只使用列出的节点。业务触发器须先调用 inspectWorkflowSources 核对当前可见字段；条件不明确先询问。requestId 使用 UUID，重试沿用原值。review 节点完整连接 approved 和 rejected 出口；触发记录使用 record 节点。调用后必须在回复中输出 Markdown 链接 [预览工作流](返回的 previewUrl)，界面会在该处展示图形和确认按钮。不得声称已经保存；让用户查看后点击确认。',
   inputSchema:workflowDraftSchema.extend({schedule:scheduleSchema.describe('可选定时任务：daily 每天；weekdays 每周一至周五（不含法定节假日规则）；weekly 每周指定星期。先选择业务 source 和 dataset，不猜测未说明的运行时间。用户确认后只保存草稿，不自动启用。').optional()}).strict(),
   execute:async input=>{
    const current=trusted(),{schedule,...config}=input;
    if(schedule){const start=config.nodes.find(n=>n.type==='start');if(!start)throw new Error('需要开始节点。');start.params.trigger={...defaultTrigger(),...start.params.trigger,mode:'schedule',schedule:validateSchedule(schedule)};}
    const proposal=await getManager().previewDraft(config,current);
    return{status:proposal.status,id:proposal.id,name:proposal.config.name,versionId:proposal.versionId,saved:proposal.status==='confirmed',published:false,executed:false,previewUrl:'/studio/workflow-preview/?id='+encodeURIComponent(proposal.id)};
   }}),
 };
}
