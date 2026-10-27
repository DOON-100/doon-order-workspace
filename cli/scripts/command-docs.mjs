import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {commands, modules, version} from '../dist/catalog.js';

const file = fileURLToPath(new URL('../docs/commands.md', import.meta.url));
const text = `# CLI 命令目录\n\n由命令登记自动生成，客户端版本 ${version}。所有命令均支持 \`--json\`；帮助支持 \`--help\`。本目录只列实际命令，栏目状态不代表员工授权。\n\n| 用法 | 行为 | 副作用 |\n| --- | --- | --- |\n${commands.map(c => `| \`doon ${c.usage}\` | ${c.description} | ${c.effect} |`).join('\n')}\n\n## 业务栏目\n\n| 栏目 | 标识 | 状态 |\n| --- | --- | --- |\n${modules.map(m => `| ${m.label} | ${m.id} | ${m.status} |`).join('\n')}\n\n查询阶段共接入 111 个业务查询/导出命令；W1已接入客户/项目表单、资料、任务、流转及原件；W2已接入工程与客户报价、目录/模具/名称资料、交接、模板/附件、历史价格和已发送事实登记。W1/W2本地成品验收完成；W3已接入订单字段、交接、内部订单、原单、PI等单据及金蝶草稿，本地验收结果见仓库执行记录，W4已接入工程需求、审图/变更、SOP及凭证、项目图纸/样办和交接、签样/工程变更、图号更正，W5已接PMC排期、计划/齐套及有限产能、采购跟进核数存档、供应商报价原件、外协及成品准备，W6—W11待开发。金蝶相关操作按用户指示暂缓、另行安排，既有命令保留，后续业务成品验收继续跳过12条金蝶命令。新增查询及编辑表单不改变查询阶段原111条命令的范围。图纸、SOP、样品及既有业务查询支持业务组，IE报价不支持业务组筛选；查询使用客户端分页，列表额外支持搜索。订单/原单使用 customer-code 精确原值，单据使用 customer/order 的明确ID，不能混用。已完成总表导出仅支持业务组和新输出路径。参数见各命令 --help，范围与字段说明见 [业务部说明](sales.md)、[订单/单据说明](orders.md) 、[工程说明](engineering.md) 、[PMC与采购说明](planning.md) 、[生产与交付说明](operations.md) 和 [财务说明](finance.md)。密码只在员工交互终端输入，\`--json\` 不会使登录变为无人值守。\n`;
if (process.argv.includes('--check')) {
  if ((await fs.readFile(file, 'utf8').catch(() => '')).replaceAll('\r\n', '\n') !== text) throw Error('Command documentation differs; run npm run docs');
} else {
  await fs.mkdir(new URL('../docs/', import.meta.url), {recursive: true});
  await fs.writeFile(file, text);
}
