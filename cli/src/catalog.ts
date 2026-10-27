import {projectFinanceWriteCommands} from './project-finance-write-catalog.js';
import {arWriteCommands} from './ar-write-catalog.js';
import {collectionWriteCommands} from './collection-write-catalog.js';
export {projectFinanceWriteCommands,arWriteCommands,collectionWriteCommands};
import {purchaseWriteCommands} from './purchase-write-catalog.js';
import {deliveryWriteCommands} from './delivery-write-catalog.js';
export {deliveryWriteCommands} from './delivery-write-catalog.js';
import {processWriteCommands} from './process-write-catalog.js';
export {processWriteCommands} from './process-write-catalog.js';
import {productionWriteCommands} from './production-write-catalog.js';
export {productionWriteCommands} from './production-write-catalog.js';
export {purchaseWriteCommands} from './purchase-write-catalog.js';
import {planningWriteCommands} from './planning-write-catalog.js';
export {planningWriteCommands} from './planning-write-catalog.js';
import {supplierWriteCommands} from './supplier-write-catalog.js';
export {supplierWriteCommands} from './supplier-write-catalog.js';
import {engineeringWriteCommands} from './engineering-write-catalog.js';
export {engineeringWriteCommands} from './engineering-write-catalog.js';
import {orderWriteCommands} from './order-write-catalog.js';
export {orderWriteCommands} from './order-write-catalog.js';
export const version = '0.37.0';
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
  ['customers','master','master <id>','查看可维护的客户主档'],
  ['customers','sensitive','sensitive <id>','按权限查看客户付款和快递账号资料'],
  ['projects','list','list','查询开发项目'], ['projects','show','show <id>','查看项目与款色、轮次、任务'], ['projects','history','history <id>','查询项目历史摘要'],
  ['projects','recycle','recycle','查询授权项目回收站'],
  ['followups','list','list','查询客户跟进'], ['followups','show','show <id>','查看客户跟进'],
  ['inquiries','list','list','查询询价与需求评估'], ['inquiries','show','show <id>','查看询价依据与未知项'], ['inquiries','history','history <id>','查询询价历史版本'],
  ['quotes','list','list','查询客户报价'], ['quotes','show','show <id>','查看报价商业字段'], ['quotes','history','history <id>','查询报价版本目录'],
  ['quotes','version','version <id> <version>','读取指定报价历史版本'], ['quotes','export-completed','export-completed --output <file.xlsx>','导出当前业务组或全部有权查看的已完成报价总表'],
].map(([resource, action, usage, description]) => ({name: `sales ${resource} ${action}`, resource, action, usage: `sales ${resource} ${usage}`,
  description, effect: action === 'export-completed' ? 'local-file-and-session-last-seen' : 'business-read-and-session-last-seen'}));
export const salesWriteCommands = [
  {name:'sales followups action',usage:'sales followups action --type promote|classify --input <file> --version <number> --request-id <uuid>',description:'跟进转项目或邮件归属登记并回读',effect:'business-write'},
  {name:'sales followups mailbox',usage:'sales followups mailbox [id]',description:'查询授权邮件档案目录或指定正文',effect:'business-read-and-session-last-seen'},
  {name:'sales followups history',usage:'sales followups history <id>',description:'查询跟进或邮件归属历史',effect:'business-read-and-session-last-seen'},
  {name:'sales projects file-upload',usage:'sales projects file-upload --input <file> --file <file>',description:'上传项目原件并回读，按内容去重',effect:'business-write'},
  {name:'sales projects file-download',usage:'sales projects file-download <id> --project <id> --output <file>',description:'按摘要校验并下载项目原件',effect:'local-file-and-session-last-seen'},
  {name:'sales projects entry-schema',usage:'sales projects entry-schema --type <type>',description:'查询普通项目表单的字段与规则',effect:'local-read'},
  {name:'sales projects entry-save',usage:'sales projects entry-save --type <type> --input <file> [--version <number>] --request-id <uuid>',description:'按类型新增或修改普通项目表单并回读',effect:'business-write'},
  {name:'sales customers sensitive-update', usage:'sales customers sensitive-update --input <file> --version <number> --request-id <uuid>', description:'按服务器权限更新客户付款或快递资料', effect:'business-write'},
  {name:'sales projects document-save', usage:'sales projects document-save --input <file> --version <number> --request-id <uuid>', description:'保存项目资料文档并回读', effect:'business-write'},
  {name:'sales projects development-save', usage:'sales projects development-save --input <file> --version <number> --request-id <uuid>', description:'维护项目开发阶段并回读', effect:'business-write'},
  {name:'sales projects development-log', usage:'sales projects development-log --input <file> --version <number> --request-id <uuid>', description:'登记项目开发进展并回读', effect:'business-write'},
  {name:'sales projects item-update', usage:'sales projects item-update --input <file> --version <number> --request-id <uuid>', description:'修改项目款色并回读', effect:'business-write'},
  {name:'sales projects round-update', usage:'sales projects round-update --input <file> --version <number> --request-id <uuid>', description:'修改项目轮次并回读', effect:'business-write'},
  {name:'sales customers followup-add', usage:'sales customers followup-add --input <file> --version <number> --request-id <uuid>', description:'登记客户沟通与跟进并回读', effect:'business-write'},
  {name:'sales projects trash', usage:'sales projects trash --input <file> --version <number> --request-id <uuid>', description:'将项目移入回收站并回读', effect:'business-write'},
  {name:'sales projects restore', usage:'sales projects restore --input <file> --version <number> --request-id <uuid>', description:'恢复项目并回读', effect:'business-write'},
  {name:'sales customers master-update', usage:'sales customers master-update --input <file> --version <number>', description:'更新客户主档指定字段并回读', effect:'business-write'},
  {name:'sales customers create', usage:'sales customers create --input <file>', description:'创建客户主档并回读', effect:'business-write'},
  {name:'sales projects task-update', usage:'sales projects task-update --input <file> --version <number> --request-id <uuid>', description:'调整或取消项目待办并回读', effect:'business-write'},
  {name:'sales inquiries update', usage:'sales inquiries update --input <file> --version <number> --request-id <uuid>', description:'更新询价需求并回读', effect:'business-write'},
  {name:'sales projects update', usage:'sales projects update --input <file> --version <number> --request-id <uuid>', description:'更新客户项目并回读', effect:'business-write'},
  {name:'sales followups update', usage:'sales followups update --input <file> --version <number> --request-id <uuid>', description:'更新客户跟进并回读', effect:'business-write'},
  {name:'sales projects task-create', usage:'sales projects task-create --input <file> --request-id <uuid>', description:'新增项目待办并回读', effect:'business-write'},
  {name:'sales projects task-submit', usage:'sales projects task-submit --input <file> --version <number> --request-id <uuid>', description:'提交项目待办结果并回读', effect:'business-write'},
  {name:'sales projects task-review', usage:'sales projects task-review --input <file> --version <number> --request-id <uuid>', description:'审核项目待办并回读', effect:'business-write'},
  {name:'sales followups create', usage:'sales followups create --input <file> --request-id <uuid>', description:'新增客户跟进并回读', effect:'business-write'},
  {name:'sales projects round-add', usage:'sales projects round-add --input <file> --request-id <uuid>', description:'新增项目轮次并回读', effect:'business-write'},
  {name:'sales projects item-add', usage:'sales projects item-add --input <file> --request-id <uuid>', description:'新增项目款色并回读', effect:'business-write'},
  {name:'sales projects communication-add', usage:'sales projects communication-add --input <file> --request-id <uuid>', description:'新增项目沟通记录并回读', effect:'business-write'},
  {name:'sales inquiries create', usage:'sales inquiries create --input <file> --request-id <uuid>', description:'创建询价需求记录并回读', effect:'business-write'},
  {name:'sales projects create', usage:'sales projects create --input <file> --request-id <uuid>', description:'创建客户开发项目并回读', effect:'business-write'},
  {name:'sales customers profile-update', usage:'sales customers profile-update --input <file> --version <number> --request-id <uuid>', description:'更新客户通用资料的指定字段并回读', effect:'business-write'},
  {name:'sales customers schedule-set', usage:'sales customers schedule-set --input <file> --version <number> --request-id <uuid>', description:'安排客户下次跟进并回读', effect:'business-write'},
] as const;
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
export const developmentReadCommands=[{name:'sales projects development-show',usage:'sales projects development-show <id> --customer <id>',description:'查询项目开发阶段与进展',effect:'business-read-and-session-last-seen'},{name:'sales projects document-show',usage:'sales projects document-show <id> --customer <id>',description:'查询项目资料文档与历史',effect:'business-read-and-session-last-seen'}] as const;
export const attachmentCommands=[{name:'sales attachments list',usage:'sales attachments list --customer <id> [--project <id>]',description:'查询客户或项目附件',effect:'business-read-and-session-last-seen'},{name:'sales attachments download',usage:'sales attachments download <id> --customer <id> [--project <id>] --output <file>',description:'校验并下载授权附件',effect:'local-file-and-session-last-seen'},{name:'sales attachments upload',usage:'sales attachments upload --input <file> --file <file> --request-id <uuid>',description:'上传客户或项目附件并回读',effect:'business-write'},{name:'sales attachments update',usage:'sales attachments update --input <file> --version <number> --request-id <uuid>',description:'修改或归档附件资料并回读',effect:'business-write'}] as const;
export const transferCommands=[{name:'sales customers transfers',usage:'sales customers transfers',description:'查询客户流转与公海工作台',effect:'business-read-and-session-last-seen'},{name:'sales customers transfer',usage:'sales customers transfer --action <action> --input <file> --version <number> --request-id <uuid>',description:'执行客户流转的指定业务动作并回读',effect:'business-write'}] as const;
export const customerTaskCommands=[{name:'sales customer-tasks list',usage:'sales customer-tasks list [--customer <id>]',description:'查询客户任务与负责人',effect:'business-read-and-session-last-seen'},{name:'sales customer-tasks history',usage:'sales customer-tasks history <id>',description:'查询客户任务历史',effect:'business-read-and-session-last-seen'},{name:'sales customer-tasks save',usage:'sales customer-tasks save --input <file> --version <number> --request-id <uuid>',description:'新增或修改客户任务并回读',effect:'business-write'}] as const;
export const priceArchiveCommands=[
{name:'sales prices schema',usage:'sales prices schema --type dataset|selection|source',description:'查询价格档案表单字段',effect:'local-read'},
{name:'sales prices list',usage:'sales prices list [--customer <id>] [--view sku|history]',description:'查询授权历史价格及发票依据',effect:'business-read-and-session-last-seen'},
{name:'sales prices archive',usage:'sales prices archive <id>',description:'管理员核对档案摘要与来源目录',effect:'business-read-and-session-last-seen'},
{name:'sales prices import',usage:'sales prices import --input <file>',description:'迁入新价格档案并核对摘要',effect:'business-write'},
{name:'sales prices selection-save',usage:'sales prices selection-save --input <file> --version <number>',description:'保存发票价格规则并回读',effect:'business-write'},
{name:'sales prices source-upload',usage:'sales prices source-upload --input <file> --file <file>',description:'按来源摘要归档价格原件',effect:'business-write'},
{name:'sales prices source-download',usage:'sales prices source-download <archiveId> <fileId> --output <file>',description:'管理员核验并下载价格原件',effect:'local-file-and-session-last-seen'},
{name:'sales prices export',usage:'sales prices export [--customer <id>] [--view sku|history] --output <file.xlsx>',description:'导出授权价格摘录',effect:'local-file-and-session-last-seen'}
];
export const quoteFileCommands=['sales quotes','engineering ie-quotes'].flatMap(prefix=>[
{name:prefix+' file-schema',namespace:prefix.split(' ')[0],usage:prefix+' file-schema --type <type>',description:'查询文件上传字段',effect:'local-read'},
{name:prefix+' file-list',namespace:prefix.split(' ')[0],usage:prefix+' file-list <quoteId> --version <number>',description:'查询指定报价版本的文件与模板状态',effect:'business-read-and-session-last-seen'},
{name:prefix+' file-upload',namespace:prefix.split(' ')[0],usage:prefix+' file-upload --type <type> --input <file> --file <file> [--version <number>]',description:'上传指定类别报价文件并回读',effect:'business-write'},
{name:prefix+' file-action',namespace:prefix.split(' ')[0],usage:prefix+' file-action --action <action> --input <file> --version <number>',description:'维护文件引用或应用模板并回读',effect:'business-write'},
{name:prefix+' file-download',namespace:prefix.split(' ')[0],usage:prefix+' file-download <quoteId> --type <type> [--id <id>] --version <number> --output <file>',description:'核验并下载报价文件',effect:'local-file-and-session-last-seen'},
{name:prefix+' file-export',namespace:prefix.split(' ')[0],usage:prefix+' file-export <quoteId> --type <type> --version <number> --output <file>',description:prefix.startsWith('sales')?'导出客户模板并按原权限归档成品':'导出内部报价文件',effect:prefix.startsWith('sales')?'business-write':'local-file-and-session-last-seen'},
...(prefix.startsWith('sales')?[{name:'sales quotes record-sent',namespace:'sales',usage:'sales quotes record-sent --input <file> --version <number> --request-id <uuid>',description:'登记已发送事实，不发送消息',effect:'business-write'},{name:'sales quotes templates',namespace:'sales',usage:'sales quotes templates --customer <id>',description:'查询客户报价模板',effect:'business-read-and-session-last-seen'}]:[])
]);
export const quoteReferenceCommands=[
{name:'engineering ie-quotes handoffs',usage:'engineering ie-quotes handoffs [id] [--quote <id>]',description:'查询工程交接目录或详情',effect:'business-read-and-session-last-seen'},
{name:'engineering ie-quotes handoff',usage:'engineering ie-quotes handoff --action push|accept --input <file> --version <number>',description:'下推工程报价或本人接收并回读',effect:'business-write'},
{name:'engineering ie-quotes names-schema',usage:'engineering ie-quotes names-schema',description:'查询材料名称资料导入字段',effect:'local-read'},
{name:'engineering ie-quotes names',usage:'engineering ie-quotes names [--kind <kind>] [--search <text>] [--limit <number>] [--offset <number>]',description:'查询授权材料名称和来源行',effect:'business-read-and-session-last-seen'},
{name:'engineering ie-quotes names-import',usage:'engineering ie-quotes names-import --input <file> --version <number> --request-id <uuid>',description:'迁入独立材料名称资料并回读',effect:'business-write'},
{name:'engineering ie-quotes reference-schema',usage:'engineering ie-quotes reference-schema --type catalog|preset|tooling',description:'查询基价、预设或模具表单字段',effect:'local-read'},
{name:'engineering ie-quotes reference-list',usage:'engineering ie-quotes reference-list --type catalog|preset|tooling [--include-inactive]',description:'查询授权报价参考资料',effect:'business-read-and-session-last-seen'},
{name:'engineering ie-quotes reference-save',usage:'engineering ie-quotes reference-save --type catalog|preset|tooling --input <file> [--version <number>]',description:'新增或修改报价参考资料并回读',effect:'business-write'}
];
export const quoteWriteCommands=['sales quotes','engineering ie-quotes'].flatMap(prefix=>[
 {name:prefix+' schema',namespace:prefix.split(' ')[0],usage:prefix+' schema',description:'查询报价表单与动作字段',effect:'local-read'},
 {name:prefix+' form',namespace:prefix.split(' ')[0],usage:prefix+' form <id> [--version <number>]',description:'读取授权的可编辑报价字段',effect:'business-read-and-session-last-seen'},
 {name:prefix+' save',namespace:prefix.split(' ')[0],usage:prefix+' save --input <file> [--version <number>]',description:'新增报价或更新指定字段并回读',effect:'business-write'},
 {name:prefix+' action',namespace:prefix.split(' ')[0],usage:prefix+' action --type <type> --input <file> --version <number>',description:'执行既有报价业务动作并回读',effect:'business-write'}
]);
export const commands = [...foundationCommands,...projectFinanceWriteCommands,...arWriteCommands,...collectionWriteCommands, ...deliveryWriteCommands, ...processWriteCommands, ...productionWriteCommands, ...supplierWriteCommands, ...planningWriteCommands, ...purchaseWriteCommands, ...engineeringWriteCommands, ...orderWriteCommands, ...priceArchiveCommands, ...quoteFileCommands, ...quoteReferenceCommands, ...quoteWriteCommands, ...salesCommands, ...salesWriteCommands, ...developmentReadCommands, ...attachmentCommands, ...transferCommands, ...customerTaskCommands, ...orderCommands, ...engineeringCommands, ...planningCommands, ...operationsCommands, ...financeCommands];

// Match the middle-platform navigation; presentation order never grants permission.
export const modules = [
  ['overview', '工作总览'], ['sales', '业务部'], ['service', '客服与单证'],
  ['engineering', '工程部'], ['planning', 'PMC 计划'], ['purchasing', '采购与外协'],
  ['warehouse', '仓储物流'], ['production', '生产车间'], ['quality', '品质部'],
  ['finance', '财务部'], ['management', '系统管理'],
].map(([id, label]) => ({id, label, status: ['sales','service','engineering','planning','purchasing','production','quality','warehouse','finance'].includes(id) ? 'partial' : 'pending', commands: [...deliveryWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...processWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...productionWriteCommands.map(c=>c.name).filter(name=>id==='production'||id==='warehouse'&&name.startsWith('operations receipts ')),...supplierWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...planningWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...purchaseWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...engineeringWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...orderWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...(id==='sales'?priceArchiveCommands.map(c=>c.name):[]),...quoteFileCommands.filter(c=>c.namespace===id).map(c=>c.name),...(id==='engineering'?quoteReferenceCommands.map(c=>c.name):[]),...quoteWriteCommands.filter(c=>c.namespace===id).map(c=>c.name),...(id === 'sales' ? [...salesCommands.map(c => c.name),...salesWriteCommands.map(c => c.name),...developmentReadCommands.map(c=>c.name),...attachmentCommands.map(c=>c.name),...transferCommands.map(c=>c.name),...customerTaskCommands.map(c=>c.name)] : []), ...orderCommands.filter(c => c.namespace === id).map(c => c.name),...(id==='engineering'?engineeringCommands.map(c=>c.name):[]),...planningCommands.filter(c=>c.namespace===id).map(c=>c.name),...operationsCommands.filter(c=>id==='production'&&['reports','finished'].includes(c.resource)||id==='quality'&&c.resource==='quality'||id==='warehouse'&&['packaging','releases','shipments'].includes(c.resource)).map(c=>c.name),...(id==='finance'?[...projectFinanceWriteCommands,...arWriteCommands,...collectionWriteCommands,...financeCommands].map(c=>c.name):[])]}));
