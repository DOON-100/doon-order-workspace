export const version = '0.2.0';
export const outputSchema = 'doon-cli-output-v1';
export const foundationCommands = [
  {name: 'setup', usage: 'setup --server <origin> [--allow-local-http]', description: '保存公司 HTTPS 地址；HTTP 仅供显式启用的本机测试', effect: 'local-config'},
  {name: 'login', usage: 'login [--username <name>]', description: '交互登录员工账号；有效会话直接复用', effect: 'auth-session-and-audit'},
  {name: 'logout', usage: 'logout [--local-only]', description: '注销服务器会话并清除本机凭据；可显式只清本机', effect: 'auth-session-and-audit'},
  {name: 'whoami', usage: 'whoami', description: '向服务器核对当前身份和初始密码状态', effect: 'session-last-seen'},
  {name: 'doctor', usage: 'doctor', description: '检查连接、服务响应、运行模式和当前会话', effect: 'session-last-seen'},
  {name: 'commands', usage: 'commands', description: '列出实际实现的命令及其作用', effect: 'none'},
  {name: 'modules', usage: 'modules', description: '按中台顺序列出栏目及接入进度', effect: 'none'},
] as const;

export const salesCommands = [
  ['teams','list','list','查询本人可见业务组'],
  ['customers','list','list','查询客户清单'], ['customers','show','show <id>','查看客户资料与跟进'], ['customers','history','history <id>','查询客户历史摘要'],
  ['projects','list','list','查询开发项目'], ['projects','show','show <id>','查看项目与款色、轮次、任务'], ['projects','history','history <id>','查询项目历史摘要'],
  ['inquiries','list','list','查询询价与需求评估'], ['inquiries','show','show <id>','查看询价依据与未知项'], ['inquiries','history','history <id>','查询询价历史版本'],
  ['quotes','list','list','查询客户报价'], ['quotes','show','show <id>','查看报价商业字段'], ['quotes','history','history <id>','查询报价版本目录'],
  ['quotes','version','version <id> <version>','读取指定报价历史版本'], ['quotes','export-completed','export-completed --output <file.xlsx>','导出当前业务组或全部有权查看的已完成报价总表'],
].map(([resource, action, usage, description]) => ({name: `sales ${resource} ${action}`, resource, action, usage: `sales ${resource} ${usage}`,
  description, effect: action === 'export-completed' ? 'local-file-and-session-last-seen' : 'business-read-and-session-last-seen'}));
export const commands = [...foundationCommands, ...salesCommands];

// Match the middle-platform navigation; presentation order never grants permission.
export const modules = [
  ['overview', '工作总览'], ['sales', '业务部'], ['service', '客服与单证'],
  ['engineering', '工程部'], ['planning', 'PMC 计划'], ['purchasing', '采购与外协'],
  ['warehouse', '仓储物流'], ['production', '生产车间'], ['quality', '品质部'],
  ['finance', '财务部'], ['management', '系统管理'],
].map(([id, label]) => ({id, label, status: id === 'sales' ? 'partial' : 'pending', commands: id === 'sales' ? salesCommands.map(c => c.name) : [] as string[]}));
