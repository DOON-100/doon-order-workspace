import {registerPurchaseWrites} from './purchase-write-program.js';
import {registerPlanningWrites} from './planning-write-program.js';
import {registerSupplierWrites} from './supplier-write-program.js';
import {registerEngineeringWrites} from './engineering-write-program.js';
import {registerOrderWrites} from './order-write-program.js';
import {Command, CommanderError} from 'commander';
import {commands, foundationCommands, salesCommands, salesWriteCommands, orderCommands, engineeringCommands, planningCommands, operationsCommands, financeCommands, modules, outputSchema, version} from './catalog.js';
import type {Action, Resource} from './sales.js';
import type {OrderResource, OrderAction} from './orders.js';
import type {EngineeringResource, EngineeringAction} from './engineering.js';
import type {PlanningResource, PlanningAction} from './planning.js';
import type {OperationResource, OperationAction} from './operations.js';
import type {FinanceResource, FinanceAction} from './finance.js';
import {FoundationService} from './service.js';
import {CliError, publicError} from './errors.js';
import {ask} from './prompt.js';
import type {CustomerTransferAction} from './project-child-write.js';

const clean = (text: unknown) => String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
// ASCII JSON survives legacy Windows PowerShell's native-process code page.
const machineJson = (value: unknown) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
export async function main(argv = process.argv.slice(2), service?: FoundationService) {
  const json = argv.includes('--json');
  const foundation = () => service ||= new FoundationService();
  let emitted = false;
  function result(command: string, data: unknown) {
    if (Buffer.byteLength(machineJson({schema: outputSchema, ok: true, command, data}), 'utf8') > 512 * 1024) throw new CliError('OUTPUT_TOO_LARGE', '输出超过 512 KiB，请缩小 limit 或查询范围。', 2);
    emitted = true;
    if (json) process.stdout.write(machineJson({schema: outputSchema, ok: true, command, data}));
    else {
      if (command === 'commands') for (const row of commands) process.stdout.write(`doon ${row.usage}\n  ${row.description}\n`);
      else if (command === 'modules') for (const row of modules) process.stdout.write(`${row.label}\t${row.id}\t${row.status === 'partial' ? '已接部分功能' : '待接入'}\n`);
      else if (['sales ','service ','engineering ','planning ','purchasing ','operations ','finance '].some(prefix=>command.startsWith(prefix))) {
        const value = data as any;
        process.stdout.write(`业务组: ${clean(value.scope?.teamId || '全部获授权范围')}  客户: ${clean(value.scope?.customerId || value.scope?.customerCode || '全部获授权客户')}\n`);
        if (value.page) {
          process.stdout.write(`匹配 ${value.page.total} 条，本页 ${value.page.rows.length} 条；下一偏移 ${value.page.nextOffset ?? '无'}（${value.scope.pagination==='server'?'服务器':'客户端'}分页）\n`);
          for (const row of value.page.rows) process.stdout.write(Object.entries(row).map(([k,v]) => `${k}: ${clean(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)}`).join('  ') + '\n');
        } else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
      }
      else {
        const labels: Record<string, string> = {origin: '服务器', localTest: '本机测试', username: '账号', role: '角色', mustChange: '需在网页改初始密码', personnelType: '人员类型', id: '成员编号', name: '姓名', email: '登录身份邮箱', reused: '复用已有登录', reachable: '连接成功', readOnly: '只读验收环境', syntheticOnly: '合成环境', authenticated: '已登录', credentialStorage: '凭据存储', serverBuild: '服务器版本', compatibility: '接口探测', businessCommandsAvailable: '业务接口可用性', installedBusinessCommands: '本机业务命令数', localCleared: '本机会话已清除', serverRevoked: '服务器会话已撤销', alreadySignedOut: '此前已退出'};
        function rows(value: any) {
          for (const [key, item] of Object.entries(value || {})) {
            if (item && typeof item === 'object' && !Array.isArray(item)) rows(item);
            else process.stdout.write(`${labels[key] || key}\t${clean(item === null ? '未知' : typeof item === 'boolean' ? item ? '是' : '否' : item)}\n`);
          }
        }
        rows(data);
      }
    }
  }
  const program = new Command().name('doon').description('度昂员工 CLI；业务部与客服单据查询').version(version)
    .enablePositionalOptions()
    .option('--json', '输出稳定 JSON；日志与提示写入 stderr')
    .showHelpAfterError().exitOverride()
    .configureOutput({writeOut: text => { if (!json) process.stdout.write(text); }, writeErr: text => { if (!json) process.stderr.write(text); }});
  const describe = (name: string) => foundationCommands.find(c => c.name === name)!.description;
  program.command('setup').description(describe('setup')).requiredOption('--server <origin>', '公司 HTTPS Origin')
    .option('--allow-local-http', '仅允许本机 HTTP 合成测试').action(async options => result('setup', await foundation().store.setup(options.server, !!options.allowLocalHttp)));
  program.command('login').description(describe('login')).option('--username <name>', '员工登录名；密码由本人交互输入')
    .action(async options => result('login', await foundation().login(async origin => {
      process.stderr.write('员工入口：' + clean(origin) + '\n');
      return {username: String(options.username || await ask('员工账号：')).trim().toLowerCase(), password: await ask('密码（不显示）：', true)};
    })));
  program.command('logout').description(describe('logout')).option('--local-only', '只清本机；服务器会话将按原规则失效')
    .action(async options => result('logout', await foundation().logout(!!options.localOnly)));
  program.command('whoami').description(describe('whoami')).action(async () => result('whoami', await foundation().whoami()));
  program.command('doctor').description(describe('doctor')).action(async () => result('doctor', await foundation().doctor()));
  program.command('commands').description(describe('commands')).action(() => result('commands', commands));
  program.command('modules').description(describe('modules')).action(() => result('modules', modules));
  const sales = program.command('sales').description('业务部：客户、项目、询价、报价、订单与原单查询');
  function registerQuoteWrites(group:Command,kind:'ie'|'customer',prefix:string){
    group.command('schema').description('查询报价表单与业务动作字段').action(()=>result(prefix+' schema',foundation().quoteWrite().schema(kind)));
    group.command('form <id>').description('读取授权报价字段或指定历史版本').option('--version <number>','指定历史版本').action(async(id,options)=>result(prefix+' form',await foundation().quoteWrite().form(kind,id,options.version)));
    group.command('save').description('新增报价或更新指定字段').requiredOption('--input <file>','JSON输入文件').option('--version <number>','修改的当前版本，新增0','0').action(async options=>result(prefix+' save',await foundation().quoteWrite().save(kind,options.input,options.version)));
    group.command('action').description('执行既有报价业务动作').requiredOption('--type <type>',kind==='ie'?'submit|review|revise':'confirm|revise|adopt-ie').requiredOption('--input <file>','JSON输入文件').requiredOption('--version <number>','报价当前版本').action(async options=>result(prefix+' action',await foundation().quoteWrite().action(kind,options.type,options.input,options.version)));
  }
  const prices=sales.command('prices').description('客户历史价格档案与发票价格规则');
  prices.command('schema').description('查询价格档案表单字段').requiredOption('--type <type>','dataset|selection|source').action(options=>result('sales prices schema',foundation().priceArchives().schema(options.type)));
  for(const action of ['list','export'] as const){const command=prices.command(action).description(action==='list'?'查询权限内历史价格与发票依据':'导出授权历史价格摘录').option('--customer <id>','客户ID').option('--view <view>','sku|history','sku').option('--search <text>','摘要搜索').option('--state <state>','状态筛选').option('--currency <code>','币种');if(action==='list')command.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0');else command.option('--team <id>','导出业务组').requiredOption('--output <file.xlsx>','新输出文件');command.action(async options=>result('sales prices '+action,action==='list'?await foundation().priceArchives().list(options):await foundation().priceArchives().export(options,options.output)));}
  prices.command('archive <id>').description('管理员核对原始档案摘要与来源目录').option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0').action(async(id,options)=>result('sales prices archive',await foundation().priceArchives().archive(id,options)));
  prices.command('import').description('管理员迁入新历史价格档案，不覆盖原档案').requiredOption('--input <file>','资料JSON').action(async options=>result('sales prices import',await foundation().priceArchives().import(options.input)));
  prices.command('selection-save').description('维护发票价格规则').requiredOption('--input <file>','规则JSON').requiredOption('--version <number>','当前规则版本，首次0').action(async options=>result('sales prices selection-save',await foundation().priceArchives().selection(options.input,options.version)));
  prices.command('source-upload').description('管理员按已登记摘要归档原件').requiredOption('--input <file>','档案和来源ID的JSON').requiredOption('--file <file>','原件路径').action(async options=>result('sales prices source-upload',await foundation().priceArchives().upload(options.input,options.file)));
  prices.command('source-download <archiveId> <fileId>').description('管理员核验并下载价格原件').requiredOption('--output <file>','新输出文件').action(async(archiveId,fileId,options)=>result('sales prices source-download',await foundation().priceArchives().download(archiveId,fileId,options.output)));
  function registerQuoteFiles(group:Command,kind:'ie'|'customer',prefix:string){
    group.command('file-schema').description('查询报价文件上传字段').requiredOption('--type <type>',kind==='ie'?'drawing|template':'source|media|template|archive').action(options=>result(prefix+' file-schema',foundation().quoteFiles().schema(kind,options.type)));
    group.command('file-list <quoteId>').description('查询指定版本文件与模板状态').requiredOption('--version <number>','报价版本').action(async(id,options)=>result(prefix+' file-list',await foundation().quoteFiles().list(kind,id,options.version)));
    group.command('file-upload').description('上传报价原件、图纸、模板或归档文件').requiredOption('--type <type>',kind==='ie'?'drawing|template':'source|media|template|archive').requiredOption('--input <file>','文件资料JSON').requiredOption('--file <file>','原件路径').option('--version <number>','报价版本，客户模板登记不提供').action(async options=>result(prefix+' file-upload',await foundation().quoteFiles().upload(kind,options.type,options.input,options.file,options.version||'')));
    group.command('file-action').description('维护附件引用或应用客户模板').requiredOption('--action <action>',kind==='ie'?'remove|bind':'apply-template').requiredOption('--input <file>','JSON输入文件').requiredOption('--version <number>','当前报价版本').action(async options=>result(prefix+' file-action',await foundation().quoteFiles().action(kind,options.action,options.input,options.version)));
    group.command('file-download <quoteId>').description('核验并下载报价文件').requiredOption('--type <type>',kind==='ie'?'drawing':'source|media|output').option('--id <id>','附件或成品文件ID，原报价不填').requiredOption('--version <number>','报价版本').requiredOption('--output <file>','新输出文件').action(async(id,options)=>result(prefix+' file-download',await foundation().quoteFiles().download(kind,options.type,id,options.version,options.id||'',options.output)));
    group.command('file-export <quoteId>').description(kind==='ie'?'导出指定版本内部报价':'导出客户模板并按原权限归档成品').requiredOption('--type <type>',kind==='ie'?'draft|released':'template').requiredOption('--version <number>','报价版本').requiredOption('--output <file>','新输出文件').action(async(id,options)=>result(prefix+' file-export',await foundation().quoteFiles().export(kind,options.type,id,options.version,options.output)));
    if(kind==='customer')group.command('templates').description('查询授权客户的报价模板').requiredOption('--customer <id>','客户档案ID').action(async options=>result('sales quotes templates',await foundation().quoteFiles().templates(options.customer)));
    if(kind==='customer')group.command('record-sent').description('登记已发送事实，不发送邮件或消息').requiredOption('--input <file>','发送登记JSON').requiredOption('--version <number>','已确认报价版本').requiredOption('--request-id <uuid>','登记请求UUID').action(async options=>result('sales quotes record-sent',await foundation().quoteFiles().recordSent(options.input,options.version,options.requestId)));
  }
  for (const resource of ['teams','customers','projects','followups','inquiries','quotes'] as const) {
    const group = sales.command(resource).description({teams:'业务组目录',customers:'客户资料',projects:'客户项目',followups:'客户跟进',inquiries:'询价评估',quotes:'客户报价'}[resource]);
    if(resource==='quotes')registerQuoteWrites(group,'customer','sales quotes');
    if(resource==='quotes')registerQuoteFiles(group,'customer','sales quotes');
    if(resource==='followups'){
      group.command('action').description('跟进转项目或邮件归属登记').requiredOption('--type <type>','promote|classify').requiredOption('--input <file>','JSON输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','操作UUID').action(async options=>result('sales followups action',await foundation().followupActions().execute(options.type,options.input,options.version,options.requestId)));
      group.command('mailbox [id]').description('查询邮件档案目录或指定正文').action(async id=>result('sales followups mailbox',await foundation().followupActions().mailbox(id)));
      group.command('history <id>').description('查询跟进或邮件归属历史').action(async id=>result('sales followups history',await foundation().followupActions().history(id)));
    }
    if(resource==='projects'){
      group.command('file-upload').description('上传项目原件，服务器按内容去重').requiredOption('--input <file>','项目和分类JSON').requiredOption('--file <file>','原件路径').action(async options=>result('sales projects file-upload',await foundation().projectEntries().upload(options.input,options.file)));
      group.command('file-download <id>').description('校验并下载项目原件').requiredOption('--project <id>','项目编号').requiredOption('--output <file>','新输出文件').action(async(id,options)=>result('sales projects file-download',await foundation().projectEntries().download(options.project,id,options.output)));
      group.command('entry-schema').description('查询普通项目表单字段').requiredOption('--type <type>','item|round|communication|task|attachment').action(async options=>result('sales projects entry-schema',foundation().projectEntries().schema(options.type)));
      group.command('entry-save').description('按类型新增或修改普通项目表单').requiredOption('--type <type>','item|round|communication|task|attachment').requiredOption('--input <file>','JSON输入文件').option('--version <number>','修改时的当前版本，新增为0','0').requiredOption('--request-id <uuid>','操作UUID').action(async options=>result('sales projects entry-save',await foundation().projectEntries().save(options.type,options.input,options.version,options.requestId)));
    }
    if(resource==='followups'){const spec=salesWriteCommands.find(c=>c.name==='sales followups create')!;group.command('create').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('followup-create',options.input,'',options.requestId)));}
    if(resource==='followups'){const spec=salesWriteCommands.find(c=>c.name==='sales followups update')!;group.command('update').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('followup-update',options.input,options.version,options.requestId)));}
    if(resource==='projects'){const spec=salesWriteCommands.find(c=>c.name==='sales projects update')!;group.command('update').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('project-update',options.input,options.version,options.requestId)));}
    if(resource==='inquiries'){const spec=salesWriteCommands.find(c=>c.name==='sales inquiries update')!;group.command('update').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('inquiry-update',options.input,options.version,options.requestId)));}
    if(resource==='customers'){const spec=salesWriteCommands.find(c=>c.name==='sales customers create')!;group.command('create').description(spec.description).requiredOption('--input <file>','JSON 输入文件').action(async options=>result(spec.name,await foundation().salesWrite().execute('customer-create',options.input,'','')));}
    if(resource==='customers'){const spec=salesWriteCommands.find(c=>c.name==='sales customers master-update')!;group.command('master-update').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').action(async options=>result(spec.name,await foundation().salesWrite().execute('customer-master-update',options.input,options.version,'')));}
    if(resource==='customers'){const spec=salesWriteCommands.find(c=>c.name==='sales customers followup-add')!;group.command('followup-add').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','跟进状态当前版本，可为 0').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('customer-followup-add',options.input,options.version,options.requestId)));}
    if(resource==='customers'){const spec=salesWriteCommands.find(c=>c.name==='sales customers sensitive-update')!;group.command('sensitive-update').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','资料当前版本，可为0').requiredOption('--request-id <uuid>','操作UUID').action(async options=>result(spec.name,await foundation().salesWrite().execute('profile-sensitive-update',options.input,options.version,options.requestId)));}
    if(resource==='customers'){group.command('transfers').description('查询客户流转与公海工作台').action(async()=>result('sales customers transfers',await foundation().customerTransfers().list()));group.command('transfer').description('客户交接、公海申请与领取').requiredOption('--action <action>','业务动作').requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','状态当前版本，可为 0').requiredOption('--request-id <uuid>','操作 UUID').action(async options=>result('sales customers transfer',await foundation().customerTransfers().execute(options.action as CustomerTransferAction,options.input,options.version,options.requestId)));}
    if (resource === 'customers') for (const spec of salesWriteCommands.filter(c=>['sales customers profile-update','sales customers schedule-set'].includes(c.name))) {
      const action=spec.name.endsWith('profile-update')?'profile-update':'schedule-set';
      group.command(action).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本，可为 0').requiredOption('--request-id <uuid>','本次操作 UUID，结果不明时保留').action(async options=>result(spec.name,await foundation().salesWrite().execute(action,options.input,options.version,options.requestId)));
    }
    if(resource==='projects')for(const spec of salesWriteCommands.filter(c=>['sales projects item-add','sales projects communication-add','sales projects round-add'].includes(c.name))){const action=spec.name.endsWith('item-add')?'item-add':spec.name.endsWith('round-add')?'round-add':'communication-add';group.command(action).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().projectChildWrite().execute(action,options.input,options.requestId)));}
    if(resource==='projects')for(const action of ['item-update','round-update'] as const){const spec=salesWriteCommands.find(c=>c.name===`sales projects ${action}`)!;group.command(action).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().projectChildWrite().execute(action,options.input,options.requestId,options.version)));}
    if(resource==='projects')for(const action of ['create','update','submit','review'] as const){const spec=salesWriteCommands.find(c=>c.name===`sales projects task-${action}`)!;const command=group.command(`task-${action}`).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--request-id <uuid>','本次操作 UUID');if(action!=='create')command.requiredOption('--version <number>','当前版本');command.action(async options=>result(spec.name,await foundation().projectTaskWrite().execute(action,options.input,options.version||'',options.requestId)));}
    if(resource==='projects')for(const action of ['trash','restore'] as const){const spec=salesWriteCommands.find(c=>c.name===`sales projects ${action}`)!;group.command(action).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().projectRecycle().execute(action,options.input,options.version,options.requestId)));}
    if(resource==='projects'){group.command('development-show <id>').description('查询项目开发阶段与进展').requiredOption('--customer <id>','客户编号').action(async (id,options)=>result('sales projects development-show',await foundation().projectDevelopment().show(options.customer,id)));for(const action of ['save','log'] as const){const spec=salesWriteCommands.find(c=>c.name===`sales projects development-${action}`)!;group.command(`development-${action}`).description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','开发资料当前版本，可为 0').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result(spec.name,await foundation().projectDevelopment().execute(action,options.input,options.version,options.requestId)));}}
    if(resource==='projects'){group.command('document-show <id>').description('查询项目资料文档与历史').requiredOption('--customer <id>','客户编号').action(async (id,options)=>result('sales projects document-show',await foundation().projectDevelopment().documentShow(options.customer,id)));group.command('document-save').description('保存项目资料文档并回读').requiredOption('--input <file>','JSON 输入文件').requiredOption('--version <number>','文档当前版本，可为 0').requiredOption('--request-id <uuid>','本次操作 UUID').action(async options=>result('sales projects document-save',await foundation().projectDevelopment().documentSave(options.input,options.version,options.requestId)));}
    if(resource==='projects'||resource==='inquiries'){const action=resource==='projects'?'project-create':'inquiry-create';const spec=salesWriteCommands.find(c=>c.name===`sales ${resource} create`)!;group.command('create').description(spec.description).requiredOption('--input <file>','JSON 输入文件').requiredOption('--request-id <uuid>','本次操作 UUID，结果不明时保留').action(async options=>result(spec.name,await foundation().salesWrite().execute(action,options.input,'',options.requestId)));}
    for (const spec of salesCommands.filter(c => c.resource === resource)) {
      const command = group.command(spec.action).description(spec.description).option('--team <id>', '业务组编号；不填表示全部获授权范围');
      if (spec.action === 'export-completed') command.requiredOption('--output <file.xlsx>', '新输出文件，已有文件拒绝覆盖');
      else {
        command.option('--customer <id>', '精确客户编号').option('--limit <number>', '客户端每页 1–100 条', '20').option('--offset <number>', '客户端起始偏移', '0');
        if (spec.action === 'list' || spec.action === 'recycle') command.option('--search <text>', '按当前资源的摘要字段搜索');
        else command.argument('<id>', '记录编号');
        if (spec.action === 'version') command.argument('<version>', '报价正整数版本号');
      }
      command.action(async (...args: any[]) => {
        const options = command.opts();
        const id = spec.action !== 'list' && spec.action !== 'recycle' && spec.action !== 'export-completed' ? args[0] : undefined;
        const quoteVersion = spec.action === 'version' ? args[1] : undefined;
        result(spec.name, await foundation().sales().execute(resource as Resource, spec.action as Action, options, id, quoteVersion));
      });
    }
  }
  const attachments=sales.command('attachments').description('客户与项目附件');
  const customerTasks=sales.command('customer-tasks').description('独立客户任务');
  customerTasks.command('list').option('--customer <id>','客户编号').action(async options=>result('sales customer-tasks list',await foundation().customerTasks().list(options.customer||'')));
  customerTasks.command('history <id>').action(async id=>result('sales customer-tasks history',await foundation().customerTasks().history(id)));
  customerTasks.command('save').requiredOption('--input <file>','完整任务JSON').requiredOption('--version <number>','新增为0，修改为当前版本').requiredOption('--request-id <uuid>','操作UUID').action(async options=>result('sales customer-tasks save',await foundation().customerTasks().save(options.input,options.version,options.requestId)));
  attachments.command('list').requiredOption('--customer <id>','客户编号').option('--project <id>','项目编号').action(async options=>result('sales attachments list',await foundation().customerAttachments().list(options.customer,options.project||'')));
  attachments.command('download <id>').requiredOption('--customer <id>','客户编号').option('--project <id>','项目编号').requiredOption('--output <file>','新输出文件').action(async(id,options)=>result('sales attachments download',await foundation().customerAttachments().download(options.customer,options.project||'',id,options.output)));
  attachments.command('upload').requiredOption('--input <file>','附件资料 JSON 文件').requiredOption('--file <file>','附件原件').requiredOption('--request-id <uuid>','操作 UUID').action(async options=>result('sales attachments upload',await foundation().customerAttachments().upload(options.input,options.file,options.requestId)));
  attachments.command('update').requiredOption('--input <file>','附件资料 JSON 文件').requiredOption('--version <number>','当前版本').requiredOption('--request-id <uuid>','操作 UUID').action(async options=>result('sales attachments update',await foundation().customerAttachments().update(options.input,options.version,options.requestId)));
  const namespaces = {sales, service: program.command('service').description('客服与单证：PI、业务单据、生产交接资料查询')};
  for (const namespace of ['sales','service'] as const) {
    for (const resource of [...new Set(orderCommands.filter(c => c.namespace === namespace).map(c => c.resource))]) {
      const group = namespaces[namespace].command(resource);
      for (const spec of orderCommands.filter(c => c.namespace === namespace && c.resource === resource)) {
        const command = group.command(spec.action).description(spec.description).option('--team <id>', '业务组编号；不填表示全部获授权范围');
        if (namespace === 'sales') command.option('--customer-code <value>', '精确匹配原记录 customer 原值；不推测客户ID');
        else {
          command.option('--customer <id>', '精确客户档案编号').option('--order <id>', '精确关联订单明细编号');
          if (resource === 'documents') command.option('--type <type>', 'pi/invoice/packing/waybill/paymentrequest');
        }
        if (spec.action === 'export') command.requiredOption('--output <file.xlsx>', '新输出文件，已有文件拒绝覆盖');
        else {
          command.option('--limit <number>', '客户端每页 1–100 条', '20').option('--offset <number>', '客户端起始偏移', '0');
          if (spec.action === 'list') command.option('--search <text>', '按摘要字段搜索');
        }
        if (spec.action !== 'list') command.argument('<id>', '记录编号');
        if (spec.action === 'version') command.argument('<version>', '正整数版本号');
        command.action(async (...args: any[]) => result(spec.name, await foundation().orders().execute(resource as OrderResource, spec.action as OrderAction, command.opts(), spec.action === 'list' ? undefined : args[0], spec.action === 'version' ? args[1] : undefined)));
      }
    }
  }
  const engineering=program.command('engineering').description('工程：图纸、SOP、样品和IE报价查询');
  for(const resource of ['drawings','sops','samples','ie-quotes'] as const){
    const group=engineering.command(resource);
    if(resource==='ie-quotes')registerQuoteWrites(group,'ie','engineering ie-quotes');
    if(resource==='ie-quotes')registerQuoteFiles(group,'ie','engineering ie-quotes');
    if(resource==='ie-quotes'){
      group.command('handoffs [id]').description('查询工程报价交接目录或详情').option('--quote <id>','按工程报价筛选').action(async(id,options)=>result('engineering ie-quotes handoffs',await foundation().quoteHandoffs().list(id,options.quote)));
      group.command('handoff').description('下推已复核工程报价或本人接收').requiredOption('--action <action>','push|accept').requiredOption('--input <file>','JSON输入文件').requiredOption('--version <number>','工程报价或交接记录版本').action(async options=>result('engineering ie-quotes handoff',await foundation().quoteHandoffs().execute(options.action,options.input,options.version)));
      group.command('names-schema').description('查询材料名称资料导入字段').action(()=>result('engineering ie-quotes names-schema',foundation().quoteHandoffs().namesSchema()));
      group.command('names').description('查询材料名称与来源行').option('--kind <kind>','raw原始名称或part物料名称','raw').option('--search <text>','名称或编码').option('--limit <number>','每页1至100条','20').option('--offset <number>','起始偏移0至2000','0').action(async options=>result('engineering ie-quotes names',await foundation().quoteHandoffs().names(options)));
      group.command('names-import').description('管理员迁入独立材料名称资料').requiredOption('--input <file>','来源与名称资料JSON').requiredOption('--version <number>','当前资料版本，首次0').requiredOption('--request-id <uuid>','操作UUID').action(async options=>result('engineering ie-quotes names-import',await foundation().quoteHandoffs().importNames(options.input,options.version,options.requestId)));
      group.command('reference-schema').description('查询基价、工艺预设或模具登记字段').requiredOption('--type <type>','catalog|preset|tooling').action(options=>result('engineering ie-quotes reference-schema',foundation().quoteResources().schema(options.type)));
      group.command('reference-list').description('查询报价参考资料').requiredOption('--type <type>','catalog|preset|tooling').option('--include-inactive','包含停用目录，须工程维护权限').option('--search <text>','摘要搜索').option('--limit <number>','每页1至100条','20').option('--offset <number>','起始偏移','0').action(async options=>result('engineering ie-quotes reference-list',await foundation().quoteResources().list(options.type,options)));
      group.command('reference-save').description('新增或修改报价参考资料').requiredOption('--type <type>','catalog|preset|tooling').requiredOption('--input <file>','JSON输入文件').option('--version <number>','修改的当前版本，新增0','0').action(async options=>result('engineering ie-quotes reference-save',await foundation().quoteResources().save(options.type,options.input,options.version)));
    }
    for(const spec of engineeringCommands.filter(c=>c.resource===resource)){
      const command=group.command(spec.action).description(spec.description).option('--customer <id>','精确客户档案编号').option('--limit <number>','客户端每页1–100条','20').option('--offset <number>','客户端起始偏移','0');
      if(resource!=='ie-quotes')command.option('--team <id>','业务组编号');
      if(resource==='samples')command.option('--project <id>','精确项目编号');
      if(spec.action==='list')command.option('--search <text>','按摘要字段搜索');else command.argument('<id>','记录编号');
      if(spec.action==='version')command.argument('<version>','正整数版本号');
      command.action(async(...args:any[])=>result(spec.name,await foundation().engineering().execute(resource as EngineeringResource,spec.action as EngineeringAction,command.opts(),spec.action==='list'?undefined:args[0],spec.action==='version'?args[1]:undefined)));
    }
  }
  for(const namespace of ['planning','purchasing'] as const){
    const group=program.command(namespace).description(namespace==='planning'?'PMC核对轮次':'采购、外协与工厂内部订单');
    for(const resource of [...new Set(planningCommands.filter(c=>c.namespace===namespace).map(c=>c.resource))]){
      const subgroup=group.command(resource);
      for(const spec of planningCommands.filter(c=>c.namespace===namespace&&c.resource===resource)){
        const command=subgroup.command(spec.action).description(spec.description).option('--team <id>','业务组编号').option('--limit <number>','客户端每页1–100条','20').option('--offset <number>','客户端起始偏移','0');
        if(resource==='rounds')command.option('--scope <scope>','internal 或 external，默认internal');
        if(['outsource','factory-orders'].includes(resource))command.option('--order <id>','精确订单明细ID');
        if(spec.action==='list')command.option('--search <text>','按摘要字段搜索');else command.argument('<id>','记录编号');
        command.action(async(...args:any[])=>result(spec.name,await foundation().planning().execute(resource as PlanningResource,spec.action as PlanningAction,command.opts(),spec.action==='list'?undefined:args[0])));
      }
    }
  }
  const operations=program.command('operations').description('生产、品质、包装和发货查询');
  for(const resource of ['reports','finished','quality','packaging','releases','shipments'] as const){
    const group=operations.command(resource);
    for(const spec of operationsCommands.filter(c=>c.resource===resource)){
      const command=group.command(spec.action).description(spec.description).option('--team <id>','业务组编号').option('--order <id>','订单明细编号').option('--limit <number>','客户端每页1–100条','20').option('--offset <number>','客户端起始偏移','0');
      if(!['reports','finished'].includes(resource))command.option('--customer <id>','客户档案编号');
      if(resource==='quality')command.requiredOption('--type <type>','iqc、first-article、process-quality、outsourcing-quality 或 oqc');
      if(spec.action==='list')command.option('--search <text>','按摘要字段搜索');else command.argument('<id>','记录编号');
      command.action(async(...args:any[])=>result(spec.name,await foundation().operations().execute(resource as OperationResource,spec.action as OperationAction,command.opts(),spec.action==='list'?undefined:args[0])));
    }
  }
  const finance=program.command('finance').description('财务、对账及售后查询');
  for(const resource of ['records','receivables','reconciliations','complaints'] as const){
    const group=finance.command(resource);
    for(const spec of financeCommands.filter(c=>c.resource===resource)){
      const command=group.command(spec.action).description(spec.description).option('--team <id>','业务组编号').option('--customer <id>','客户档案编号').option('--limit <number>','客户端每页1–100条','20').option('--offset <number>','客户端起始偏移','0');
      if(resource==='records')command.requiredOption('--kind <kind>','财务记录类型').option('--project <id>','项目编号');
      if(spec.action==='list')command.option('--search <text>','按摘要字段搜索');else command.argument('<id>','记录编号');
      command.action(async(...args:any[])=>result(spec.name,await foundation().finance().execute(resource as FinanceResource,spec.action as FinanceAction,command.opts(),spec.action==='list'?undefined:args[0])));
    }
  }
  registerOrderWrites(program,foundation,result);
  registerEngineeringWrites(program,foundation,result);
  registerPurchaseWrites(program,foundation,result);
  registerPlanningWrites(program,foundation,result);
  registerSupplierWrites(program,foundation,result);
  try {
    await program.parseAsync(argv.filter(arg=>arg!=='--json'), {from: 'user'});
    if (json && !emitted) result('help', {version, commands});
    else if (!argv.length) program.outputHelp();
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) { if (json && !emitted) result(error.code === 'commander.version' ? 'version' : 'help', {version, commands}); return 0; }
    const failure = error instanceof CommanderError ? new CliError('INVALID_ARGUMENT', '命令或参数无效，请运行 doon --help。', 2) : error;
    const data = publicError(failure);
    if (json) process.stdout.write(machineJson({schema: outputSchema, ok: false, error: data}));
    else process.stderr.write(`${data.code}: ${data.message}\n`);
    return failure instanceof CliError ? failure.exitCode : 1;
  }
}
