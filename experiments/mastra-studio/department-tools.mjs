import {createTool} from '@mastra/core/tools';
import {departmentGroups} from './department-contracts.mjs';
import {executeDepartment} from './department-executor.mjs';
import {currentBusinessAccess} from '../agent-server/business-api.mjs';
import {z} from 'zod';

// DeepSeek requires a root object, not the executor's root discriminated union.
// The dispatcher still parses departmentInputSchema before accessing business APIs.
const modelInputSchema=z.object({
 operation:z.enum(['list','inspect','query','prepare']),
 action:z.string().min(1).max(100).optional().describe('inspect/query/prepare 必填；list 不传。先从 list 返回的目录选择。'),
 arguments:z.record(z.unknown()).optional().describe('query/prepare 必填；inspect 可省略为空对象；list 不传。字段以 inspect 契约为准。'),
}).strict();

export function createDepartmentTools(){
 return Object.fromEntries(departmentGroups.map(group=>['department'+group.id[0].toUpperCase()+group.id.slice(1),createTool({
  id:'department-'+group.id,
  description:group.label+'业务工具（'+group.phase+'）。先 list 查看已适配动作及未接通接口，再 inspect 获取该动作参数与当前账号可见的数据对象、字段。query 按契约读取，每页最多20条。prepare 对已适配流程及采购动作生成提案，不直接保存业务。若返回 previewUrl，必须输出 [核对并确认变更](previewUrl)，由本人打开页面核对；模型不能确认、删除或执行。目录分组不授予权限；不能把未接通动作描述成已完成。',
  inputSchema:modelInputSchema,
  execute:input=>executeDepartment(group.id,input,currentBusinessAccess()),
 })]));
}
