import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {commands, modules, version} from '../dist/catalog.js';

const file = fileURLToPath(new URL('../docs/commands.md', import.meta.url));
const text = `# CLI 命令目录\n\n由命令登记自动生成，客户端版本 ${version}。所有命令均支持 \`--json\`；帮助支持 \`--help\`。本目录只列实际命令，栏目状态不代表员工授权。\n\n| 用法 | 行为 | 副作用 |\n| --- | --- | --- |\n${commands.map(c => `| \`doon ${c.usage}\` | ${c.description} | ${c.effect} |`).join('\n')}\n\n## 业务栏目\n\n| 栏目 | 标识 | 状态 |\n| --- | --- | --- |\n${modules.map(m => `| ${m.label} | ${m.id} | ${m.status} |`).join('\n')}\n\n查询阶段共接入 83 个业务查询/导出命令；W1 已接入客户主档创建、客户资料更新、跟进排程、项目创建及更新、询价创建及更新、项目款色、轮次、沟通、待办与客户跟进新增及更新写入，其他写入仍待开发。图纸、SOP、样品及既有业务查询支持业务组，IE报价不支持业务组筛选；查询使用客户端分页，列表额外支持搜索。订单/原单使用 customer-code 精确原值，单据使用 customer/order 的明确ID，不能混用。已完成总表导出仅支持业务组和新输出路径。参数见各命令 --help，范围与字段说明见 [业务部说明](sales.md)、[订单/单据说明](orders.md) 、[工程说明](engineering.md) 、[PMC与采购说明](planning.md) 、[生产与交付说明](operations.md) 和 [财务说明](finance.md)。密码只在员工交互终端输入，\`--json\` 不会使登录变为无人值守。\n`;
if (process.argv.includes('--check')) {
  if ((await fs.readFile(file, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== text) throw Error('Command documentation differs; run npm run docs');
} else {
  await fs.mkdir(new URL('../docs/', import.meta.url), {recursive: true});
  await fs.writeFile(file, text);
}
