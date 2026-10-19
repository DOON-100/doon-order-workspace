import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
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
 const receipt=proposal=>({status:proposal.status,id:proposal.id,name:proposal.config.name,versionId:proposal.versionId,saved:proposal.status==='confirmed',published:false,executed:false,previewUrl:'/studio/workflow-preview/?id='+encodeURIComponent(proposal.id)});
 return{
  previewRecordReviewWorkflow:createTool({id:'preview-record-review-workflow',description:'简单流程优先使用此工具：读取记录→人工审核→通过后汇总→结束，拒绝直接连到同一个结束节点。程序负责生成节点与连线，不需要模型构造图。先用 inspectWorkflowSources 核对 source 和 dataset；填写名称和可选定时时间。schedule.frequency=weekdays 表示周一至周五，此时 weekdays 必须为空数组 []；weekly 才填写星期数字。审核按 technical 角色，审核人 ID 可以留空；不会冒充具体员工。此工具只生成预览，回复必须输出 [预览工作流](返回的 previewUrl)，由用户点击确认后保存草稿，不发布、运行或启用调度。复杂条件和其他节点使用 previewWorkflow。',
   inputSchema:z.object({requestId:z.string().uuid().optional(),name:z.string().trim().min(1).max(80),description:z.string().max(500).optional(),source:z.string().min(1).max(100),dataset:z.string().min(1).max(1200),scope:z.object({customerId:z.string().max(160).optional(),teamId:z.string().max(160).optional()}).strict().optional(),mode:z.enum(['manual','change']).default('manual'),schedule:scheduleSchema.optional()}).strict(),
   execute:async({requestId=randomUUID(),name,description='',source,dataset,scope={},mode='manual',schedule})=>{
    const current=trusted(),metadata=await getManager().sourceCatalog(current.workflowAccess,source,scope);
    if(!metadata.datasets?.some(item=>item.path===dataset))throw new Error('数据对象不存在或当前不可见。');
    const trigger={...defaultTrigger(),mode:schedule?'schedule':mode,source,dataset,scope,...(schedule?{schedule:validateSchedule(schedule)}:{})};
    const node=(id,type,label,y,params={})=>({id,type,label,x:180,y,params});
    const config={requestId,name,description,nodes:[node('start','start','开始',40,{trigger}),node('record','record','读取触发记录',170),node('review','review','人工审核',300,{title:'核对本次记录',role:'technical',reviewerId:'',instructions:'查看本次证据后决定通过、拒绝或暂缓；未确认不继续。',maxAgeMinutes:30}),node('summary','summary','审核后汇总',450,{title:'审核后汇总'}),node('end','end','结束',600)],edges:[{from:'start',to:'record',port:'next'},{from:'record',to:'review',port:'next'},{from:'review',to:'summary',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'summary',to:'end',port:'next'}]};
    return receipt(await getManager().previewDraft(config,current));
   }}),
  inspectWorkflowSources:createTool({id:'inspect-workflow-sources',description:'创建工作流前读取可用模块和字段。先不传 source 获取模块，再传模块 ID 和 scope 获取当前登录人可见的字段、类型及操作符；只返回元数据，不返回业务记录。不能猜测字段路径。',
   inputSchema:z.object({source:z.string().min(1).max(100).optional(),scope:z.object({customerId:z.string().max(160).optional(),projectId:z.string().max(160).optional(),id:z.string().max(160).optional(),teamId:z.string().max(160).optional()}).strict().optional()}).strict(),
   execute:async({source,scope})=>{const current=trusted(),catalog=await getManager().sourceCatalog(current.workflowAccess,source,scope||{});const {sample,...metadata}=catalog;return{...metadata,agents:getManager().agentCatalog(),operators:triggerOperators,defaults:defaultTrigger(),scheduleOptions:{frequencies:['daily','weekdays','weekly'],timezone:'Asia/Shanghai',weekdays:'周一=1，周日=7；仅 weekly 填写星期数组'}};}}),
  previewWorkflow:createTool({id:'preview-workflow',description:'根据用户描述生成复杂工作流预览。读取记录→人工审核→汇总的简单场景请优先用 previewRecordReviewWorkflow。用户点击“确认保存”后才写入 Workflows；此工具不保存草稿、不发布、不运行、不审批。整个图只有一个 start 和一个 end，同一 end 允许多个入边；review.approved 连 summary 再连 end，review.rejected 可以直接连同一 end，不需要第二个 end。reviewerId 空字符串合法，按 role 审核。业务触发器先调用 inspectWorkflowSources 核对字段，start.params.trigger 必须填写 source、dataset、scope 和 mode。定时优先使用顶层 schedule 参数；frequency=weekdays 时 weekdays=[]。requestId 使用 UUID，重试沿用原值。只使用列出的节点，review 的 approved/rejected 出口要完整。调用后必须回复 Markdown 链接 [预览工作流](返回的 previewUrl)，界面会显示图形和确认按钮。不得声称已保存。',
   inputSchema:workflowDraftSchema.extend({schedule:scheduleSchema.describe('可选定时任务：daily 每天；weekdays 每周一至周五（不含法定节假日规则）；weekly 每周指定星期。先选择业务 source 和 dataset，不猜测未说明的运行时间。用户确认后只保存草稿，不自动启用。').optional()}).strict(),
   execute:async input=>{
    const current=trusted(),{schedule,...config}=input;
    if(schedule){const start=config.nodes.find(n=>n.type==='start');if(!start)throw new Error('需要开始节点。');start.params.trigger={...defaultTrigger(),...start.params.trigger,mode:'schedule',schedule:validateSchedule(schedule)};}
    const proposal=await getManager().previewDraft(config,current);
    return receipt(proposal);
   }}),
 };
}
