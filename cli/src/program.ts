import {Command, CommanderError} from 'commander';
import {commands, foundationCommands, salesCommands, orderCommands, modules, outputSchema, version} from './catalog.js';
import type {Action, Resource} from './sales.js';
import type {OrderResource, OrderAction} from './orders.js';
import {FoundationService} from './service.js';
import {CliError, publicError} from './errors.js';
import {ask} from './prompt.js';

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
      else if (command === 'modules') for (const row of modules) process.stdout.write(`${row.label}\t${row.id}\t${row.status === 'partial' ? '已接部分查询' : '待接入'}\n`);
      else if (command.startsWith('sales ') || command.startsWith('service ')) {
        const value = data as any;
        process.stdout.write(`业务组: ${clean(value.scope.teamId || '全部获授权范围')}  客户: ${clean(value.scope.customerId || value.scope.customerCode || '全部获授权客户')}\n`);
        if (value.page) {
          process.stdout.write(`匹配 ${value.page.total} 条，本页 ${value.page.rows.length} 条；下一偏移 ${value.page.nextOffset ?? '无'}（客户端分页）\n`);
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
  for (const resource of ['teams','customers','projects','inquiries','quotes'] as const) {
    const group = sales.command(resource).description({teams:'业务组目录',customers:'客户资料',projects:'客户项目',inquiries:'询价评估',quotes:'客户报价'}[resource]);
    for (const spec of salesCommands.filter(c => c.resource === resource)) {
      const command = group.command(spec.action).description(spec.description).option('--team <id>', '业务组编号；不填表示全部获授权范围');
      if (spec.action === 'export-completed') command.requiredOption('--output <file.xlsx>', '新输出文件，已有文件拒绝覆盖');
      else {
        command.option('--customer <id>', '精确客户编号').option('--limit <number>', '客户端每页 1–100 条', '20').option('--offset <number>', '客户端起始偏移', '0');
        if (spec.action === 'list') command.option('--search <text>', '按当前资源的摘要字段搜索');
        else command.argument('<id>', '记录编号');
        if (spec.action === 'version') command.argument('<version>', '报价正整数版本号');
      }
      command.action(async (...args: any[]) => {
        const options = command.opts();
        const id = spec.action !== 'list' && spec.action !== 'export-completed' ? args[0] : undefined;
        const quoteVersion = spec.action === 'version' ? args[1] : undefined;
        result(spec.name, await foundation().sales().execute(resource as Resource, spec.action as Action, options, id, quoteVersion));
      });
    }
  }
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
  try {
    await program.parseAsync(argv, {from: 'user'});
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
