import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {commands, modules, version} from '../dist/catalog.js';

const file = fileURLToPath(new URL('../docs/commands.md', import.meta.url));
const text = `# CLI 命令目录\n\n由命令登记自动生成，客户端版本 ${version}。所有命令均支持 \`--json\`；帮助支持 \`--help\`。本目录只列实际命令，栏目状态不代表员工授权。\n\n| 用法 | 行为 | 副作用 |\n| --- | --- | --- |\n${commands.map(c => `| \`doon ${c.usage}\` | ${c.description} | ${c.effect} |`).join('\n')}\n\n## 业务栏目\n\n| 栏目 | 标识 | 状态 |\n| --- | --- | --- |\n${modules.map(m => `| ${m.label} | ${m.id} | ${m.status} |`).join('\n')}\n\n批次 0 没有业务数据命令。密码只在员工交互终端输入，\`--json\` 不会使登录变为无人值守。\n`;
if (process.argv.includes('--check')) {
  if ((await fs.readFile(file, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== text) throw Error('Command documentation differs; run npm run docs');
} else {
  await fs.mkdir(new URL('../docs/', import.meta.url), {recursive: true});
  await fs.writeFile(file, text);
}
