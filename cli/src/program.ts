import {Command, CommanderError} from 'commander';
import {commands, modules, outputSchema, version} from './catalog.js';
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
    emitted = true;
    if (json) process.stdout.write(machineJson({schema: outputSchema, ok: true, command, data}));
    else {
      if (command === 'commands') for (const row of commands) process.stdout.write(`doon ${row.usage}\n  ${row.description}\n`);
      else if (command === 'modules') for (const row of modules) process.stdout.write(`${row.label}\t${row.id}\t待接入\n`);
      else {
        const labels: Record<string, string> = {origin: '服务器', localTest: '本机测试', username: '账号', role: '角色', mustChange: '需在网页改初始密码', personnelType: '人员类型', id: '成员编号', name: '姓名', email: '登录身份邮箱', reused: '复用已有登录', reachable: '连接成功', readOnly: '只读验收环境', syntheticOnly: '合成环境', authenticated: '已登录', credentialStorage: '凭据存储', serverBuild: '服务器版本', compatibility: '接口探测', businessCommandsAvailable: '已接业务命令', localCleared: '本机会话已清除', serverRevoked: '服务器会话已撤销', alreadySignedOut: '此前已退出'};
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
  const program = new Command().name('doon').description('度昂员工 CLI；批次 0 基础命令').version(version)
    .option('--json', '输出稳定 JSON；日志与提示写入 stderr')
    .showHelpAfterError().exitOverride()
    .configureOutput({writeOut: text => { if (!json) process.stdout.write(text); }, writeErr: text => { if (!json) process.stderr.write(text); }});
  const describe = (name: string) => commands.find(c => c.name === name)!.description;
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
