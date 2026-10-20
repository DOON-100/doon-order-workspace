// Planning artifacts only: reads source AST and inventory, never imports business
// modules, registers tools, starts services, or calls business APIs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const json=file=>JSON.parse(read(file));
execFileSync(process.execPath,['scripts/audit-api-inventory.mjs','--check'],{cwd:root,stdio:'pipe'});
const inventory=json('docs/api-inventory/workspace-endpoints.json');
const config=json('docs/api-inventory/department-mapping.json');
assert.equal(config.status,'planning-only');
const navigationFile='lib/department-workspace-navigation.ts',processFile='lib/process-workspace.ts';
function source(file){
 const sf=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true),variables=new Map();
 for(const statement of sf.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name))variables.set(d.name.text,d);
 return{sf,variables};
}
function unwrap(node){while(node&&(ts.isAsExpression(node)||ts.isParenthesizedExpression(node)||ts.isSatisfiesExpression(node)))node=node.expression;return node;}
// Evaluate declarative navigation/field metadata only, not arbitrary TypeScript.
function literal(node,src){
 node=unwrap(node);
 if(ts.isStringLiteralLike(node))return node.text;
 if(ts.isNumericLiteral(node))return Number(node.text);
 if(ts.isIdentifier(node)){assert(src.variables.has(node.text),'Unknown metadata identifier '+node.text);return literal(src.variables.get(node.text).initializer,src);}
 if(ts.isArrayLiteralExpression(node))return node.elements.flatMap(n=>ts.isSpreadElement(n)?literal(n.expression,src):[literal(n,src)]);
 if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.map(p=>{
  assert(ts.isPropertyAssignment(p),'Only static metadata properties are supported');
  return[p.name.text,literal(p.initializer,src)];
 }));
 if(ts.isCallExpression(node)&&node.expression.getText()==='detail'){
  const [key,label,type='text']=node.arguments.map(n=>literal(n,src));return{key,label,type};
 }
 throw new Error('Unsupported metadata syntax: '+node.getText().slice(0,100));
}
const nav=source(navigationFile),proc=source(processFile);
const groups=literal(nav.variables.get('departmentWorkspaceGroups').initializer,nav).filter(g=>g.id!=='overview').map(({id,label,phase})=>({id,label,phase}));
assert.equal(groups.length,10);
const ids=new Set(groups.map(g=>g.id));
const routeOrder=literal(nav.variables.get('departmentRouteOrder').initializer,nav);
const processKinds=literal(proc.variables.get('processKinds').initializer,proc);
const details=literal(proc.variables.get('processDetailFields').initializer,proc);
const processLabels=literal(proc.variables.get('processKindLabels').initializer,proc);
assert.deepEqual(Object.keys(config.processGroups).sort(),[...processKinds].sort());
for(const group of groups)group.views=routeOrder[group.id];
for(const [file,members] of Object.entries(config.modules)){
 assert(inventory.endpoints.some(e=>e.owner===file),'Stale module '+file);
 assert(members.length&&members.every(g=>ids.has(g)),'Invalid module grouping '+file);
}
const overrides=new Map();
for(const rule of config.overrides){
 assert(rule.groups.length&&rule.groups.every(g=>ids.has(g)));
 for(const action of rule.actions){
  assert(inventory.endpoints.some(e=>e.action===action),'Unknown action '+action);
  assert(!overrides.has(action),'Duplicate action override '+action);
  overrides.set(action,rule);
 }
}
const schemaCache=new Map();
function schemaReferences(file){
 if(schemaCache.has(file))return schemaCache.get(file);
 const src=source(file),refs=[];
 for(const statement of src.sf.statements){
  if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name)&&/schema/i.test(d.name.text))refs.push({file,symbol:d.name.text});
  if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings)){
   const spec=statement.moduleSpecifier.text;
   for(const n of statement.importClause.namedBindings.elements)if(/schema/i.test(n.name.text)&&(spec.startsWith('.')||spec.startsWith('@/'))){
    const target=spec.startsWith('@/')?spec.slice(2)+'.ts':path.posix.join(path.posix.dirname(file),spec)+'.ts';
    assert(fs.existsSync(path.join(root,target)),'Schema source absent '+target);
    refs.push({file:target,symbol:n.propertyName?.text||n.name.text});
   }
  }
 }
 // Inline z.object/formData/query contracts stay in their action handler.
 const result=[{file,symbol:'处理器内 JSON/query/formData 校验'},...refs];
 schemaCache.set(file,result);return result;
}
const endpoints=inventory.endpoints.map(row=>{
 const rule=overrides.get(row.action),members=rule?.groups||config.modules[row.owner];
 assert(members?.length,'Unmapped endpoint '+row.method+' '+row.action);
 const proof=row.evidence.find(p=>p.file===row.owner);
 return{
  method:row.method,path:row.path,action:row.action,groups:members,
  object:rule?.object||row.module,actionIndex:row.actionIndex,
  boundary:rule?.boundary||(row.method==='POST'?'confirmed-business-action':'read-contract-review'),
  contractStatus:'source-located-not-adapted',
  handler:{file:proof.file,symbol:proof.handler,line:proof.line},
  ...(rule?.note?{note:rule.note}:{}),
 };
});
for(const row of config.infrastructure){
 assert(['GET','POST'].includes(row.method));
 assert(['/api/auth/','/api/agent-schedules/'].some(p=>row.path.startsWith(p))||['/health','/api/review-mode'].includes(row.path));
 endpoints.push({...row,groups:['management'],contractStatus:'source-located-not-adapted',handler:{file:row.path.startsWith('/api/agent-schedules/')?'standalone/agent-schedules.mjs':'standalone/server.mjs',symbol:'handle'}});
}
assert.equal(config.infrastructure.length,23);
assert.equal(new Set(endpoints.map(e=>e.method+' '+e.path)).size,endpoints.length,'Duplicate method/path');
assert.equal(endpoints.length,inventory.endpointCount+23);
const commonSchema=unwrap(proc.variables.get('processSaveSchema').initializer);
// .strict() wraps z.object({...}); do not execute the schema.
const objectCall=commonSchema.expression.expression;
assert(ts.isCallExpression(objectCall)&&objectCall.expression.getText()==='z.object');
const commonFields=objectCall.arguments[0].properties.map(p=>p.name.text);
const processContracts=processKinds.map(type=>{
 const group=config.processGroups[type];assert(ids.has(group));
 assert(endpoints.filter(e=>['process-data','process-history','process-save'].includes(e.action)).every(e=>e.groups.includes(group)));
 return{
  type,label:processLabels[type],group,
  read:{method:'GET',path:'/api/workspace/process-data',fixedQuery:{type}},
  history:{method:'GET',path:'/api/workspace/process-history',requiredQuery:['id'],typeCheck:'resolve-record-and-verify-type'},
  save:{method:'POST',path:'/api/workspace/process-save',fixedBody:{type}},
  commonFields,businessDetailFields:details[type],
  executorBoundFields:['id','version','token','type'],
  contractSources:[{file:processFile,symbol:'processSaveSchema'},{file:processFile,symbol:'processDetailsSchema'},{file:processFile,symbol:'canReadProcessRecord'},{file:processFile,symbol:'canEditProcessRecord'},{file:processFile,symbol:'assertProcessCompletion'}],
  status:'planning-only',
 };
});
for(const family of config.typedFamilies){
 const src=source(family.enumSource);
 const types=family.enumNames.flatMap(name=>literal(src.variables.get(name).initializer,src));
 assert.deepEqual(Object.keys(family.typeGroups).sort(),types.sort(),'Typed family drift '+family.id);
 assert(fs.existsSync(path.join(root,family.schemaSource)));
 for(const members of Object.values(family.typeGroups)){
  assert(members.length&&members.every(g=>ids.has(g)));
  assert(members.every(g=>config.modules[family.handler].includes(g)),'Typed family missing department '+family.id);
 }
}
const result={
 format:'doon-department-tool-plan-v1',status:'planning-only',authorization:'none',
 sourceInventory:'workspace-endpoints.json',mapping:'department-mapping.json',
 groups,counts:{uniqueEndpoints:endpoints.length,workspace:inventory.endpointCount,infrastructure:23,processTypes:processContracts.length},
 contractSources:Object.fromEntries([...schemaCache]),typedFamilies:config.typedFamilies,processContracts,endpoints,
};
// Populate per-file source index after endpoint mapping; input/output schema
// adaptation remains a separate, explicitly unfinished step.
for(const file of Object.keys(config.modules))schemaReferences(file);
result.contractSources=Object.fromEntries(schemaCache);
function output(file,text){
 if(process.argv.includes('--check'))assert.equal(read(file),text,'Generated artifact drift: '+file);
 else fs.writeFileSync(path.join(root,file),text);
}
const compact=[
 '{',
 ...Object.entries(result).filter(([key])=>!['endpoints','processContracts'].includes(key)).map(([key,value])=>'  '+JSON.stringify(key)+': '+JSON.stringify(value)+','),
 '  "processContracts": [',processContracts.map(row=>'    '+JSON.stringify(row)).join(',\n'),'  ],',
 '  "endpoints": [',endpoints.map(row=>'    '+JSON.stringify(row)).join(',\n'),'  ]','}','',
].join('\n');
output('docs/api-inventory/department-tools.json',compact);
const sourceLink=(file,label=file,line)=>`[${label}](../../${file.replaceAll('[','%5B').replaceAll(']','%5D')}${line?'#L'+line:''})`;
const boundaryLabels={
 'application-only':'应用内流程，不交模型凭据',
 'service-only':'后台专用，不交模型服务身份',
 'human-admin-flow':'管理/敏感入口，保留原授权及人工操作',
 'artifact-generation':'文件生成/归档，非纯读取',
 'confirmed-business-action':'业务动作，按具体内容确认后执行',
 'read-contract-review':'读取候选，待核验返回字段及副作用',
};
const md=[
 '# 按 10 个部门分组的工具适配表','',
 '由 `node scripts/group-api-inventory.mjs` 根据导航、接口清单与人工分组配置生成。当前是接入配置方案，未注册运行工具或开放业务写入。','',
 '源清单：[接口清点报告](../api-inventory.md)；分组配置：[department-mapping.json](department-mapping.json)；机器可读结果：[department-tools.json](department-tools.json)。','',
 '## 范围与组织方式','',
 `共 ${endpoints.length} 个去重接口，其中工作区 ${inventory.endpointCount} 个、基础接口 23 个。严格使用左侧除“工作总览”之外的 10 组。共用接口只登记一次，通过 groups 在多组展示，各组数量不可相加当作接口总数。`,'',
 '- 分组帮助 Agent 找到业务能力，不是角色或授权列表。账号能否操作，由原中台逐请求、逐记录、逐字段校验。',
 '- 同一 Agent 可以使用多个分组；进入某组、创建 Agent 或勾选工具都不增加权限。',
 `- 按业务对象生成具体动作工具，共用执行层；不会将 ${inventory.endpointCount} 个接口全部作为独立工具一次塞给模型。`,
 '- 通用流程按 14 种 type 固定各自字段与规则；模型不能任意切换 type、直接更新状态绕过专用动作。',
 '- 账号、密码、会话、服务身份和调度属于系统管理清点范围，其中应用内/后台专用入口不能作为普通模型工具。',
 '- 管理组只是目录归属：human-admin-flow 不表示所有动作都必须是 admin，仍采用原角色/负责人规则。',
 '- 工作总览继续由授权查询汇总，不新增第 11 个工具分组。','',
 '| 分组 | 接口关联数（含共用） | 所含业务流程类型 |','| --- | ---: | --- |',
 ...groups.map(g=>`| [${g.label}](#${g.id}) | ${endpoints.filter(e=>e.groups.includes(g.id)).length} | ${processContracts.filter(p=>p.group===g.id).map(p=>p.label).join('、')||'使用已有专用业务动作'} |`),
 ];
for(const group of groups){
 const rows=endpoints.filter(e=>e.groups.includes(group.id));
 md.push('',`<a id="${group.id}"></a>`,'',`## ${group.label}`,'',group.phase+'。','',`导航范围：${group.views.map(v=>'`'+v+'`').join('、')}。`,'',
 '| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |','| --- | --- | --- | --- |');
 for(const object of [...new Set(rows.map(e=>e.object))]){
  const items=rows.filter(e=>e.object===object);
  const display=row=>'`'+(row.action||row.path)+'`';
  const refs=[...new Set(items.map(e=>e.handler.file))];
  md.push(`| ${object} | ${items.filter(e=>e.method==='GET').map(display).join('、')||'由关联视图/专用入口读取，未另造查询'} | ${items.filter(e=>e.method==='POST').map(display).join('、')||'此对象未登记 POST 动作'} | ${refs.map(f=>sourceLink(f,path.posix.basename(f))).join('、')} |`);
 }
 md.push('','本组接入边界：','');
 for(const boundary of [...new Set(rows.map(e=>e.boundary))])md.push(`- ${boundaryLabels[boundary]}：${rows.filter(e=>e.boundary===boundary).length} 项。`);
 const types=processContracts.filter(p=>p.group===group.id);
 if(types.length){
  md.push('','本组流程字段（以下仅列 details；公共字段见后文）：','',
   '| 流程 | 固定 type | 业务明细字段 |','| --- | --- | --- |');
  for(const p of types)md.push(`| ${p.label} | \`${p.type}\` | ${p.businessDetailFields.map(f=>`${f.label} \`${f.key}\`（${f.type==='number'?'数值':'文本'}）`).join('、')} |`);
 }
 const families=config.typedFamilies.filter(f=>Object.values(f.typeGroups).some(members=>members.includes(group.id)));
 if(families.length){
  md.push('','跨部门共用接口在本组的具体对象类型：','',
   '| 共用业务 | 本组类型 | 字段与规则 |','| --- | --- | --- |');
  for(const family of families)md.push(`| ${family.label} | ${Object.entries(family.typeGroups).filter(([,members])=>members.includes(group.id)).map(([type])=>'`'+type+'`').join('、')} | ${sourceLink(family.schemaSource)}；${family.note} |`);
 }
}
md.push('','## 共用逻辑与字段边界','',
 '| 层次 | 做什么 | 不代替什么 |','| --- | --- | --- |',
 '| 部门目录 | 展示当前账号可用的对象与动作 | 不依据部门名称直接授予权限 |',
 '| 动作契约 | 指定现有接口、入参 schema、返回投影及固定流程类型 | 不开放任意 URL、SQL、字段补丁 |',
 '| 公共执行层 | 绑定身份、目标与版本；预览、确认、调用、回读和错误处理 | 不复制或绕过中台业务校验 |',
 '| 中台原接口 | 执行原有角色/数据/字段权限及数量、金额、状态规则 | 不把模型判断当成授权或审核决定 |','',
 '14 类流程共用 `process-data`、`process-history`、`process-save`。工具的 type 由注册配置固定；历史查询仅接收 id，必须读取并核验该记录实际类型和权限，不能假设它支持 type 参数。','',
 '公共字段：'+commonFields.map(k=>'`'+k+'`').join('、')+'。','',
 '其中 id 从授权查询绑定，version 从已读版本绑定，token 由执行程序生成并在重试时保留，type 由具体工具固定。用户可以提出客户、订单、负责人等业务选择，仍须服务端校验关联与可见范围；这些字段不代表调用身份。业务操作者来自会话，模型不能填写。','',
 '流程保存继续复用 `canReadProcessRecord`、`canWriteProcessKind`、`canEditProcessRecord`、`assertProcessCompletion`，包括检验数量平衡、齐料数量、完成证据、责任人、阻塞和各类型必要依据。模型不得自行判定检验通过、签样、放行或关闭。','',
 '## 当前交付与待实施项','',
 `- 已完成：10 组与页面导航对应；${endpoints.length} 项接口全部有组别；跨部门共用关系；14 类流程及其业务明细字段；12 类业务资料/单据与 6 类客服记录的分组；字段/schema 来源索引；应用内/后台专用边界。`,
 '- 字段来源索引是文件级导航，不是已完成的每个动作输入/输出契约。JSON 的 contractStatus 明确为 source-located-not-adapted。',
 '- 下一步实施：从原 schema 提取动作精确入参和返回投影，建立公共执行层及变更确认入口，再逐组接入 Studio 并做权限/业务回归。',
 '- 原表导入预览、固定工具结果和报价模板导出可能落盘，不能仅用 GET/POST 或名称决定副作用。',
 '- 通用管理表、聚合数据和接口数量不表示存在通用物理删除；保留原归档、取消、作废、回收和历史规则。',
 '- 这是与业务清点配套的静态资料，保存在主线文档；Agent 运行代码仍按项目规则在测试分支实现、独立发布。','',
 '## 复核命令','',
 '```powershell','node scripts/audit-api-inventory.mjs --check','node scripts/group-api-inventory.mjs --check','```','',
 '生成器只读取源码与清单，不导入业务模块或调用服务；会拒绝遗漏接口、未知组名、重复覆盖、失效动作、流程类型不一致和过期清单。','',
);
output('docs/api-inventory/department-tools.md',md.join('\n'));
console.log(JSON.stringify({...result.counts,groups:groups.map(g=>({id:g.id,label:g.label,endpointAssociations:endpoints.filter(e=>e.groups.includes(g.id)).length}))},null,2));
