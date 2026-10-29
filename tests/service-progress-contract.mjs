// Source contract for the service workspace fixes: a cheap progress read, an
// in-app discard prompt, and a customer field that shows a hint instead of a
// selectable "请选择客户" row.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const route = await fs.readFile('app/api/workspace/[action]/route.ts', 'utf8');
const panel = await fs.readFile('app/service-workspace-panel.tsx', 'utf8');
const picker = await fs.readFile('app/service-search-select.tsx', 'utf8');

assert.match(route, /'service-history':\['member','service_record','service_revision','customer_account','customer_quote_access'\]/,
  '跟进进度只读取本页需要的记录种类，不再整库快照');
assert.match(route, /snapshot\(scopedReadKinds\[action\]\)/, '读取入口必须使用按动作限定的种类');

assert.doesNotMatch(panel, /window\.confirm/, '客服工作台不得使用浏览器原生确认框');
assert.match(panel, /setSavedDraft\(JSON\.stringify\(next\)\)/, '新建记录以初始内容为基线，未修改时不提示');
assert.match(panel, /className="sw-confirm"/, '需要提示时使用应用内弹窗');
assert.match(panel, /if\(!dirty\)\{run\(\);return;\}/, '无改动时直接执行离开动作');

assert.doesNotMatch(panel, /<option value="">请选择客户<\/option>/, '客户提示不得作为可选项渲染');
assert.match(panel, /placeholder="请选择客户"/, '客户字段使用占位提示');
assert.match(picker, /placeholder\?options\.filter\(option=>option\.value!==''\):options/, '有占位提示时排除空值选项');
assert.match(picker, /items=\{selectable\}/, '列表与匹配只使用真实可选项');

// A business team carries the people list and the visibility scope, so every
// active team is listed but only the customer's own teams stay selectable.
assert.match(panel, /const customerTeamIds=draft\?\.customerId\?new Set/, '按客户计算所属业务组');
assert.match(panel, /disabled=\{!owns\}/, '非所属业务组灰显不可选');
assert.match(panel, /该客户未归入此组/, '灰显选项说明不可选原因');
assert.match(panel, /next\.teamId=own\.length===1\?own\[0\]\.id:''/, '客户唯一归属组时自动填入');
assert.match(panel, /title:'业务组未选择'/, '客户有归属组却存为未分组时先提示');
assert.match(panel, /confirmLabel:'仍然保存'/, '提示需确认后才以未分组落库');

console.log('PASS service progress contract');
