export const version = '0.7.0';
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
export const orderCommands = [
  ['sales','orders','list','list','查询获授权的订单明细'], ['sales','orders','show','show <id>','查看订单明细、跟进和附件目录'],
  ['sales','sources','list','list','查询销售原单证据'], ['sales','sources','show','show <id>','查看原单逐行字段与来源位置'], ['sales','sources','export','export <id> --output <file.xlsx>','导出单张获授权销售原单 XLSX'],
  ['service','pi','list','list','查询 PI 草稿和已核对记录'], ['service','pi','show','show <id>','查看 PI 当前字段与来源变化标记'], ['service','pi','history','history <id>','查询 PI 历史版本目录'], ['service','pi','version','version <id> <version>','查看 PI 指定历史版本'],
  ['service','documents','list','list','查询现有业务单据'], ['service','documents','show','show <id>','查看业务单据内容'], ['service','documents','history','history <id>','查询业务单据版本目录'], ['service','documents','version','version <id> <version>','查看业务单据指定版本'],
  ['service','production-orders','list','list','查询生产交接资料（不代表已下达生产）'], ['service','production-orders','show','show <id>','查看生产交接字段和原订单行引用'], ['service','production-orders','history','history <id>','查询生产交接资料历史摘要'],
].map(([namespace,resource,action,usage,description]) => ({name:`${namespace} ${resource} ${action}`,namespace,resource,action,usage:`${namespace} ${resource} ${usage}`,description,effect:action==='export'?'local-file-and-session-last-seen':'business-read-and-session-last-seen'}));
export const engineeringCommands = [
  ['drawings','list','list','查询工程画图需求'],['drawings','show','show <id>','查看画图需求'],['drawings','history','history <id>','查询画图历史摘要'],
  ['sops','list','list','查询SOP与MES跟进'],['sops','show','show <id>','查看SOP任务'],['sops','history','history <id>','查询SOP历史摘要'],
  ['samples','list','list','查询授权样品'],['samples','show','show <id>','查看样品详情'],
  ['ie-quotes','list','list','查询授权IE报价'],['ie-quotes','show','show <id>','查看工程报价与成本'],['ie-quotes','history','history <id>','查询工程报价历史目录'],['ie-quotes','version','version <id> <version>','查看指定工程报价版本'],
].map(([resource,action,usage,description])=>({name:`engineering ${resource} ${action}`,resource,action,usage:`engineering ${resource} ${usage}`,description,effect:'business-read-and-session-last-seen'}));
export const planningCommands=[
 ['planning','rounds','list','list','查询PMC核对轮次'],['planning','rounds','show','show <id>','查看核对轮次及明细状态'],
 ['purchasing','purchases','list','list','查询获授权采购明细'],['purchasing','purchases','show','show <id>','查看采购跟单及收货状态'],['purchasing','purchases','history','history <id>','查询采购事件及最近编辑摘要'],
 ['purchasing','outsource','list','list','查询获授权外协单'],['purchasing','outsource','show','show <id>','查看外协单'],
 ['purchasing','factory-orders','list','list','查询工厂内部订单版本'],['purchasing','factory-orders','show','show <id>','查看工厂内部订单版本'],
].map(([namespace,resource,action,usage,description])=>({name:`${namespace} ${resource} ${action}`,namespace,resource,action,usage:`${namespace} ${resource} ${usage}`,description,effect:'business-read-and-session-last-seen'}));
export const operationsCommands=[
 ['reports','list','list','查询生产报工'],['reports','show','show <id>','查看生产报工明细'],
 ['finished','list','list','查询成品外发任务'],['finished','show','show <id>','查看成品任务、在途与入仓状态'],['finished','history','history <id>','查询成品任务事件摘要'],
 ['quality','list','list --type <type>','查询指定质检类型'],['quality','show','show <id> --type <type>','查看指定质检记录'],['quality','history','history <id> --type <type>','查看指定质检历史'],
 ['packaging','list','list','查询包装核对记录'],['packaging','show','show <id>','查看包装核对'],['packaging','history','history <id>','查看包装历史'],
 ['releases','list','list','查询出货放行记录'],['releases','show','show <id>','查看出货放行'],['releases','history','history <id>','查看出货放行历史'],
 ['shipments','list','list','查询客服发货记录'],['shipments','show','show <id>','查看客服发货记录'],['shipments','history','history <id>','查看客服发货历史'],
].map(([resource,action,usage,description])=>({name:`operations ${resource} ${action}`,resource,action,usage:`operations ${resource} ${usage}`,description,effect:'business-read-and-session-last-seen'}));
export const financeCommands=[
 ['records','list','list --kind <kind>','查询指定项目财务记录'],['records','show','show <id> --kind <kind>','查看项目财务记录'],['records','history','history <id> --kind <kind>','查看项目财务历史摘要'],
 ['receivables','list','list','查询客服应收记录'],['receivables','show','show <id>','查看应收及已收余额'],['receivables','history','history <id>','查看应收历史摘要'],
 ['reconciliations','list','list','查询供应商对账记录'],['reconciliations','show','show <id>','查看供应商对账'],['reconciliations','history','history <id>','查看供应商对账历史'],
 ['complaints','list','list','查询客户投诉记录'],['complaints','show','show <id>','查看客户投诉'],['complaints','history','history <id>','查看客户投诉历史'],
].map(([resource,action,usage,description])=>({name:`finance ${resource} ${action}`,resource,action,usage:`finance ${resource} ${usage}`,description,effect:'business-read-and-session-last-seen'}));
export const commands = [...foundationCommands, ...salesCommands, ...orderCommands, ...engineeringCommands, ...planningCommands, ...operationsCommands, ...financeCommands];

// Match the middle-platform navigation; presentation order never grants permission.
export const modules = [
  ['overview', '工作总览'], ['sales', '业务部'], ['service', '客服与单证'],
  ['engineering', '工程部'], ['planning', 'PMC 计划'], ['purchasing', '采购与外协'],
  ['warehouse', '仓储物流'], ['production', '生产车间'], ['quality', '品质部'],
  ['finance', '财务部'], ['management', '系统管理'],
].map(([id, label]) => ({id, label, status: ['sales','service','engineering','planning','purchasing','production','quality','warehouse','finance'].includes(id) ? 'partial' : 'pending', commands: [...(id === 'sales' ? salesCommands.map(c => c.name) : []), ...orderCommands.filter(c => c.namespace === id).map(c => c.name),...(id==='engineering'?engineeringCommands.map(c=>c.name):[]),...planningCommands.filter(c=>c.namespace===id).map(c=>c.name),...operationsCommands.filter(c=>id==='production'&&['reports','finished'].includes(c.resource)||id==='quality'&&c.resource==='quality'||id==='warehouse'&&['packaging','releases','shipments'].includes(c.resource)).map(c=>c.name),...(id==='finance'?financeCommands.map(c=>c.name):[])]}));
