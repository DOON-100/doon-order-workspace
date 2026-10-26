export const version = '0.1.0';
export const outputSchema = 'doon-cli-output-v1';
export const commands = [
  {name: 'setup', usage: 'setup --server <origin> [--allow-local-http]', description: '保存公司 HTTPS 地址；HTTP 仅供显式启用的本机测试', effect: 'local-config'},
  {name: 'login', usage: 'login [--username <name>]', description: '交互登录员工账号；有效会话直接复用', effect: 'auth-session-and-audit'},
  {name: 'logout', usage: 'logout [--local-only]', description: '注销服务器会话并清除本机凭据；可显式只清本机', effect: 'auth-session-and-audit'},
  {name: 'whoami', usage: 'whoami', description: '向服务器核对当前身份和初始密码状态', effect: 'session-last-seen'},
  {name: 'doctor', usage: 'doctor', description: '检查连接、服务响应、运行模式和当前会话', effect: 'session-last-seen'},
  {name: 'commands', usage: 'commands', description: '列出实际实现的命令及其作用', effect: 'none'},
  {name: 'modules', usage: 'modules', description: '按中台顺序列出栏目及接入进度', effect: 'none'},
] as const;

// Match the middle-platform navigation; presentation order never grants permission.
export const modules = [
  ['overview', '工作总览'], ['sales', '业务部'], ['service', '客服与单证'],
  ['engineering', '工程部'], ['planning', 'PMC 计划'], ['purchasing', '采购与外协'],
  ['warehouse', '仓储物流'], ['production', '生产车间'], ['quality', '品质部'],
  ['finance', '财务部'], ['management', '系统管理'],
].map(([id, label]) => ({id, label, status: 'pending', commands: [] as string[]}));
