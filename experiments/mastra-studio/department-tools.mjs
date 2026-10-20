import {createTool} from '@mastra/core/tools';
import {departmentGroups} from './department-contracts.mjs';
import {departmentInputSchema,executeDepartment} from './department-executor.mjs';
import {currentBusinessAccess} from '../agent-server/business-api.mjs';

export function createDepartmentTools(){
 return Object.fromEntries(departmentGroups.map(group=>['department'+group.id[0].toUpperCase()+group.id.slice(1),createTool({
  id:'department-'+group.id,
  description:group.label+'业务工具（'+group.phase+'）。先 list 查看已适配动作及未接通接口，再 inspect 获取该动作参数与当前账号可见的数据对象、字段。query 按契约读取，每页最多20条。prepare 对已适配流程生成新增／修改提案，不直接保存业务。若返回 previewUrl，必须输出 [核对并确认变更](previewUrl)，由本人打开页面核对；模型不能确认、删除或执行。目录分组不授予权限；不能把未接通动作描述成已完成。',
  inputSchema:departmentInputSchema,
  execute:input=>executeDepartment(group.id,input,currentBusinessAccess()),
 })]));
}
