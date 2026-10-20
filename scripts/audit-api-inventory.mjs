// Static source inventory only. Never imports application modules or calls an API.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry='app/api/workspace/[action]/route.ts';
const files=new Map(), endpoints=new Map(), visited=new Set(), unresolved=[];
const slash=value=>value.replaceAll('\\','/');
const lf=value=>value.replaceAll('\r\n','\n');
const walk=(node,visit)=>{visit(node);ts.forEachChild(node,child=>walk(child,visit));};
const line=node=>node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1;
function unwrap(node){while(node&&(ts.isAsExpression(node)||ts.isParenthesizedExpression(node)||ts.isNonNullExpression(node)||ts.isSatisfiesExpression(node)))node=node.expression;return node;}
function load(relative){
 relative=slash(relative);if(files.has(relative))return files.get(relative);
 const text=lf(fs.readFileSync(path.join(root,relative),'utf8')),sf=ts.createSourceFile(relative,text,ts.ScriptTarget.Latest,true);
 const file={relative,text,sf,functions:new Map(),imports:new Map(),variables:new Map()};files.set(relative,file);
 for(const statement of sf.statements){
  if(ts.isImportDeclaration(statement)&&statement.importClause?.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings)){
   const spec=statement.moduleSpecifier.text;
   if(spec.startsWith('.')||spec.startsWith('@/')){
    const base=spec.startsWith('@/')?spec.slice(2):slash(path.posix.join(path.posix.dirname(relative),spec));
    const target=['.ts','.mjs','.tsx','/index.ts'].map(ext=>base+ext).find(p=>fs.existsSync(path.join(root,p)));
    if(target)for(const item of statement.importClause.namedBindings.elements)file.imports.set(item.name.text,{file:target,name:item.propertyName?.text||item.name.text});
   }
  }
  if(ts.isFunctionDeclaration(statement)&&statement.name)file.functions.set(statement.name.text,statement);
  if(ts.isVariableStatement(statement))for(const decl of statement.declarationList.declarations)if(ts.isIdentifier(decl.name)){
   file.variables.set(decl.name.text,decl.initializer);
   if(decl.initializer&&(ts.isArrowFunction(decl.initializer)||ts.isFunctionExpression(decl.initializer)))file.functions.set(decl.name.text,decl.initializer);
  }
 }
 return file;
}
function evaluate(node,file,locals=new Map(),seen=new Set()){
 node=unwrap(node);if(!node)return undefined;
 if(ts.isStringLiteralLike(node))return node.text;
 if(ts.isNumericLiteral(node))return Number(node.text);
 if(ts.isArrayLiteralExpression(node)){
  const values=node.elements.map(item=>ts.isSpreadElement(item)?evaluate(item.expression,file,locals,seen):evaluate(item,file,locals,seen));
  return values.some(value=>value===undefined)?undefined:values.flat();
 }
 if(ts.isIdentifier(node)){
  if(seen.has(node.text))return undefined;
  const next=new Set(seen).add(node.text);
  const declaration=locals.get(node.text)||file.variables.get(node.text);
  if(declaration)return evaluate(declaration,file,locals,next);
  const imported=file.imports.get(node.text);
  if(imported){const target=load(imported.file);return evaluate(target.variables.get(imported.name),target,new Map(),new Set());}
  return undefined;
 }
 if(ts.isObjectLiteralExpression(node)){
  const result={};
  for(const property of node.properties){
   if(ts.isSpreadAssignment(property)){const spread=evaluate(property.expression,file,locals,seen);if(!spread)return undefined;Object.assign(result,spread);continue;}
   if(!property.name)continue;
   const key=ts.isComputedPropertyName(property.name)?evaluate(property.name.expression,file,locals,seen):property.name.text;
   if(key===undefined)return undefined;
   result[key]=property.initializer?evaluate(property.initializer,file,locals,seen):null;
  }
  return result;
 }
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
  const target=node.expression.expression,method=node.expression.name.text;
  if(target.getText()==='Object'&&method==='keys'){const object=evaluate(node.arguments[0],file,locals,seen);return object?Object.keys(object):undefined;}
  if(method==='map'){
   const array=evaluate(target,file,locals,seen),fn=node.arguments[0];
   if(Array.isArray(array)&&fn&&ts.isArrowFunction(fn)&&ts.isIdentifier(fn.parameters[0]?.name)){
    return array.map(value=>evaluate(fn.body,file,new Map(locals).set(fn.parameters[0].name.text,ts.factory.createStringLiteral(value)),seen));
   }
  }
 }
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){
  const a=evaluate(node.left,file,locals,seen),b=evaluate(node.right,file,locals,seen);
  if(a!==undefined&&b!==undefined)return a+b;
 }
 if(ts.isPropertyAccessExpression(node)&&node.name.text==='length'){const value=evaluate(node.expression,file,locals,seen);return value?.length;}
 if(ts.isConditionalExpression(node)){
  const a=evaluate(node.whenTrue,file,locals,seen),b=evaluate(node.whenFalse,file,locals,seen);
  return a!==undefined&&b!==undefined?[a,b].flat():undefined;
 }
 return undefined;
}
function resolveFunction(file,name){
 if(file.functions.has(name))return{file,fn:file.functions.get(name),name};
 const imported=file.imports.get(name);
 if(imported){const target=load(imported.file);if(target.functions.has(imported.name))return{file:target,fn:target.functions.get(imported.name),name:imported.name};}
 return null;
}
function scan(file,name,method,param='action',prefix='',chain=[]){
 const resolved=resolveFunction(file,name);if(!resolved)return;
 ({file,name}=resolved);const {fn}=resolved,key=[file.relative,name,method,param,prefix].join(':');
 if(visited.has(key))return;visited.add(key);
 const locals=new Map(),aliases=new Map([[param,prefix]]),nextChain=[...chain,`${file.relative}#${name}`],prefixes=[];
 walk(fn.body,node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer)locals.set(node.name.text,node.initializer);});
 walk(fn.body,node=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='startsWith'&&node.expression.expression.getText()===param){const value=evaluate(node.arguments[0],file,locals);if(typeof value==='string')prefixes.push(value);}});
 // Recognize action suffix dispatch, e.g. name=action.slice('customer-project-'.length).
 for(const [variable,raw] of locals){
  const value=unwrap(raw);
  if(ts.isCallExpression(value)&&ts.isPropertyAccessExpression(value.expression)&&value.expression.name.text==='slice'&&ts.isIdentifier(value.expression.expression)&&aliases.has(value.expression.expression.text)){
   const arg=unwrap(value.arguments[0]);
   if(ts.isPropertyAccessExpression(arg)&&arg.name.text==='length'){
    const base=evaluate(arg.expression,file,locals);if(typeof base==='string')aliases.set(variable,aliases.get(value.expression.expression.text)+base);
   }else{const count=evaluate(arg,file,locals),base=prefixes.find(p=>p.length===count);if(base)aliases.set(variable,aliases.get(value.expression.expression.text)+base);}
  }
  if(ts.isCallExpression(value)&&ts.isPropertyAccessExpression(value.expression)&&value.expression.name.text==='replace'&&value.expression.expression.getText()===param&&value.arguments[0]?.kind===ts.SyntaxKind.RegularExpressionLiteral&&evaluate(value.arguments[1],file,locals)===''){
   const match=value.arguments[0].getText().match(/^\/\^([a-z-]+)\/$/);if(match)aliases.set(variable,prefix+match[1]);
  }
 }
 const alias=node=>ts.isIdentifier(unwrap(node))?aliases.get(unwrap(node).text):undefined;
 function add(value,node,kind){
  for(const action of [value].flat()){
   if(typeof action!=='string'||!/^[a-z][a-z0-9-]*$/.test(action)){unresolved.push({file:file.relative,line:line(node),expression:node.getText().slice(0,180)});continue;}
   const id=method+' '+action,row=endpoints.get(id)||{method,action,path:'/api/workspace/'+action,evidence:[]};
   const proof={file:file.relative,line:line(node),handler:name,kind,chain:nextChain};
   if(!row.evidence.some(p=>p.file===proof.file&&p.line===proof.line&&p.kind===kind))row.evidence.push(proof);
   endpoints.set(id,row);
  }
 }
 walk(fn.body,node=>{
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.InKeyword){
   const pre=alias(node.left),object=evaluate(node.right,file,locals);
   if(pre!==undefined&&object)add(Object.keys(object).map(key=>pre+key),node,'schema-keys');
  }
  if(ts.isElementAccessExpression(node)){
   const pre=alias(node.argumentExpression);
   if(pre!==undefined){
    const object=evaluate(node.expression,file,locals);
    if(object&&typeof object==='object'&&!Array.isArray(object))add(Object.keys(object).map(key=>pre+key),node,'dispatch-map');
   }
  }
  if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)){
   for(const [a,b] of [[node.left,node.right],[node.right,node.left]]){
    const pre=alias(a);if(pre===undefined)continue;
    const value=evaluate(b,file,locals);if(value!==undefined)add([value].flat().map(v=>pre+v),node,'comparison');
   }
  }
  if(ts.isCallExpression(node)){
   const callee=node.expression;
   if(callee.getText()==='Object.prototype.hasOwnProperty.call'){
    const pre=alias(node.arguments[1]),object=evaluate(node.arguments[0],file,locals);
    if(pre!==undefined&&object)add(Object.keys(object).map(key=>pre+key),node,'schema-keys');
   }
   if(ts.isPropertyAccessExpression(callee)&&['includes','has'].includes(callee.name.text)&&node.arguments.length){
    const pre=alias(node.arguments[0]);
    if(pre!==undefined){
     const values=evaluate(callee.expression,file,locals);
     if(Array.isArray(values))add(values.map(v=>pre+v),node,'allowlist');
     else unresolved.push({file:file.relative,line:line(node),expression:node.getText().slice(0,180)});
    }
   }
   if(ts.isIdentifier(callee)){
    node.arguments.forEach((arg,index)=>{
     const pre=alias(arg);if(pre===undefined)return;
     const child=resolveFunction(file,callee.text);
     if(child&&(/(?:Get|Post)$/.test(child.name)||['post','workspaceRead'].includes(child.name))&&child.fn.parameters[index]&&ts.isIdentifier(child.fn.parameters[index].name))scan(child.file,child.name,method,child.fn.parameters[index].name.text,pre,nextChain);
    });
   }
  }
  if(ts.isSwitchStatement(node)){
   const pre=alias(node.expression);if(pre!==undefined)for(const clause of node.caseBlock.clauses)if(ts.isCaseClause(clause)){const value=evaluate(clause.expression,file,locals);if(value!==undefined)add(pre+value,clause.expression,'case');}
  }
 });
}
const main=load(entry);
scan(main,'GET','GET');scan(main,'POST','POST');
// workspaceGet obtains action from ctx.params rather than a direct parameter.
scan(main,'workspaceGet','GET','action','',[`${entry}#GET`,`${entry}#workspaceRead`]);
const rows=[...endpoints.values()].sort((a,b)=>a.action.localeCompare(b.action)||a.method.localeCompare(b.method));

// References are exact string occurrences (including wrapper calls), not proof
// that the page renders or that the HTTP method is reachable at runtime.
function sourceFiles(dir){
 return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(item=>{
  const relative=dir+'/'+item.name;return item.isDirectory()?sourceFiles(relative):/\.(tsx?|mjs)$/.test(item.name)?[relative]:[];
 });
}
const clientFiles=[...sourceFiles('app'),...sourceFiles('components'),...sourceFiles('standalone')].filter(p=>!p.includes('/api/')&&!/test|server\.mjs|auth\.mjs|agent-schedules\.mjs|runtime\.mjs/.test(p));
const directClientPaths=new Map();
for(const row of rows){
 row.evidence.sort((a,b)=>b.chain.length-a.chain.length||a.line-b.line);
 row.owner=row.evidence[0].file;
 row.references=[];
}
for(const relative of clientFiles){
 const sf=ts.createSourceFile(relative,fs.readFileSync(path.join(root,relative),'utf8'),ts.ScriptTarget.Latest,true);
 walk(sf,node=>{
  if(!ts.isStringLiteralLike(node)&&!ts.isTemplateHead(node))return;
  const direct=node.text.match(/^\/api\/workspace\/([a-z][a-z-]*)(?:\?|$)/);
  if(direct){const refs=directClientPaths.get(direct[1])||[];refs.push({file:relative,line:line(node)});directClientPaths.set(direct[1],refs);}
  for(const row of rows)if(node.text.split('?')[0]===row.action||node.text.startsWith(row.path)&&['','?','/'].includes(node.text.slice(row.path.length,row.path.length+1))){
   const ref={file:relative,line:line(node)};
   if(!row.references.some(r=>r.file===ref.file&&r.line===ref.line))row.references.push(ref);
  }
 });
}
const dynamicClientPrefixes=[...directClientPaths].filter(([action])=>action.endsWith('-')).map(([prefix,references])=>({prefix,references,matchingActions:rows.filter(row=>row.action.startsWith(prefix)).map(row=>row.method+' '+row.action)}));
const unmatchedClientPaths=[...directClientPaths].filter(([action])=>!action.endsWith('-')&&!rows.some(row=>row.action===action)).map(([action,references])=>({action,references}));
// Human-reviewed module labels and permission entry points. These descriptions
// are navigation aids, not a replacement for action/record/field authorization.
const modules=[
 ['订单总表、导入、附件与成员','app/api/workspace/[action]/route.ts','actor、canRead、allowedFields、requireAdmin/requirePMC；原生 member 新增另有限制'],
 ['订单工序、外发收货与原表','lib/operations.ts','canRead、departmentColumns、mayReceive、canCreateOutsource、PMC 范围及生产闸门'],
 ['客户主档、工厂订单与金蝶模板','lib/collaboration-api.ts','客户主档能力、客户责任、roles、订单/工厂范围和模板权限'],
 ['供应商与外协','lib/supplier-api.ts','managesSuppliers、canSeeSupplierPrice、订单/工序权限及审批责任'],
 ['损耗','lib/loss-api.ts','订单可见性、部门损耗确认权限及来源版本'],
 ['采购跟单','lib/purchase-api.ts','visiblePurchases；维护 manage/broad；来源、数量、归档条件校验'],
 ['PMC 核单','lib/pmc-api.ts','access、订单/生产范围；核对轮次与版本'],
 ['成品供应商协作','lib/finished-supplier-api.ts','authenticated、employee、供应商身份及任务分配；阶段分别校验'],
 ['金蝶待核对','lib/kingdee-pending-api.ts','读取范围与维护角色；原表下载和导入权限'],
 ['部门流程记录','lib/process-workspace-api.ts','requestTeam、canWriteProcessKind、canEditProcessRecord；客户/订单关联'],
 ['计划与产能','lib/planning-control-api.ts','currentMember、visible、planningManager、ownerProgress；业务组范围'],
 ['工程画图','lib/engineering-drawing-api.ts','画图读取/维护、客户范围、事件审核及字段权限'],
 ['图号更正','lib/drawing-correction-api.ts','canCorrectDrawing；订单范围、版本与历史关联保护'],
 ['工程 SOP','lib/engineering-sop-api.ts','canReadSop、manage、canInstructDrawing；图纸/客户关联'],
 ['客服业务','lib/service-workspace-api.ts','canReadServiceRecord、客户责任、维护/收款及附件权限'],
 ['客户报价','lib/customer-quote-api.ts','报价授权、客户范围、内部核价字段隔离、版本确认'],
 ['客户报价授权配置','lib/customer-quote-policy-api.ts','管理员配置授权；不能由普通报价查询权限推导'],
 ['报价模板','lib/customer-quote-template-api.ts','报价客户授权、模板归属、确认状态及原件访问'],
 ['历史价格原件','lib/customer-price-archive-api.ts','allowed/customer 范围；导入及来源选择需 admin'],
 ['客户档案与跟进','lib/customer-workflow-api.ts','workflowCustomer、workflowCapabilities、policyConfirmed；银行字段独立写权限'],
 ['客户文件与轻量项目','lib/customer-workflow-files.ts','客户/项目授权、原件访问与维护能力'],
 ['客户待办','lib/customer-workflow-tasks.ts','customerTaskOwnerEligible、customerTaskCanEdit；本人/负责人范围'],
 ['客户公海与交接','lib/customer-workflow-transfers.ts','客户责任、主负责人、管理员审批；指定销售本人接收'],
 ['客户项目、样办与回收站','lib/customer-project-api.ts','projectAccess、任务/审核名单、canManageProjectAssignments；客户范围和回收站保护'],
 ['项目跨部门协作','lib/project-collaboration-api.ts','canReadProjectCollaboration、项目写权限、任务责任与版本'],
 ['项目跟进与历史邮件','lib/customer-project-followup-api.ts','assertAccess、客户/负责人范围；历史迁入仅管理员'],
 ['项目财务','lib/customer-project-finance-api.ts','access(read/write/verify)、financialDto；授权、资金状态、来源版本'],
 ['应收工作台与授权','lib/ar-workspace-api.ts','arAccess、canConfigure；公司/业务组/客户范围'],
 ['发票原件与对账','lib/ar-invoice-ledger-api.ts','应收读取/维护范围、原件归属、对账及请求幂等'],
 ['应收客户模板','lib/ar-customer-profiles-api.ts','writer、customer 授权；核心账务字段禁止重定义'],
 ['正式财务单据','lib/ar-document-issue.ts','审核、签发及里程碑分别按财务/业务组/来源权限校验'],
 ['付款条件','lib/payment-terms-api.ts','requireRead/requireWrite；只读取数账号禁止写、管理员指定授权负责人'],
 ['业务交接与单据','lib/handoff-business-api.ts','业务角色、来源/单据/客户范围；提交、审核、附件和打印'],
 ['交接定金与例外','lib/handoff-payment-actions.ts','来源业务权限、定金声明与财务例外授权'],
 ['交接服务配置','lib/handoff-business-settings.ts','配置管理权限；不等同于业务单据读写'],
 ['生产审核规则与采纳','lib/handoff-production-review.ts','审核规则配置与采纳签署权限；原生产闸门保留'],
 ['沟通渠道、规则文档与通知','lib/handoff-framework-api.ts','actorAllowed、渠道/消息上下文和客户范围；配置与通知签收分别限制'],
 ['财务协作任务','lib/framework-finance-task.ts','内部身份、business/work、指定财务与当前阶段'],
 ['离职交接','lib/framework-offboarding.ts','内部人员、requireManager、指定接收人；完成前逐项检查责任转移'],
 ['人工沟通草稿','lib/unified-communication-api.ts','活跃业务角色、客户/来源范围；仅人工沟通草稿，不是发送接口'],
 ['固定数据工具','lib/fixed-data-tools-api.ts','assertFixedToolOwner、assertFixedToolJobAccess；客户/任务归属'],
 ['固定报价费用工具','lib/fixed-tool-fees.ts','任务归属、报价授权、预览/决定及来源版本'],
];
const moduleByFile=new Map(modules.map(([label,file,permission])=>[file,{label,permission}]));
function actionIndex(row){
 if(row.method==='GET')return /file|export|print|template/.test(row.action)?'读取/文件/导出':'查询/历史/能力';
 if(/(?:cancel|trash|archive|disable|withdraw|reverse|restore|lifecycle)$/.test(row.action))return '取消/回收/归档/恢复等状态动作';
 if(/(?:save)$/.test(row.action)||row.action==='member')return '保存（具体新增/修改见实现）';
 if(/(?:create|add|register|comment|followup|attachment|upload|photo)$/.test(row.action))return '新增/登记/上传';
 if(/edit|update|correction|match|assign/.test(row.action))return '修改/关联/指派';
 if(/preview|inspect|import|commit/.test(row.action))return '解析/预览/导入（不能假定无副作用）';
 return '专用业务动作';
}
for(const row of rows){row.module=moduleByFile.get(row.owner)?.label||row.owner;row.actionIndex=actionIndex(row);}
const inventory={
 format:'doon-api-inventory-v1',
 scope:'Static workspace GET/POST dispatch inventory; not a runtime authorization certification or tool registry.',
 sourceHashEncoding:'UTF-8, CRLF normalized to LF',
 sourceFiles:[...files.values()].sort((a,b)=>a.relative.localeCompare(b.relative)).map(file=>({path:file.relative,sha256:createHash('sha256').update(file.text).digest('hex')})),
 handlerCount:visited.size,endpointCount:rows.length,unresolved,unmatchedClientPaths,dynamicClientPrefixes,endpoints:rows,
};
const output=JSON.stringify(inventory,null,2)+'\n',destination=path.join(root,'docs/api-inventory/workspace-endpoints.json');
function save(filename,content){
 if(process.argv.includes('--check')){
  if(!fs.existsSync(filename)||lf(fs.readFileSync(filename,'utf8'))!==content){console.error('API inventory differs: '+slash(path.relative(root,filename)));process.exitCode=1;}
 }else{fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,content);}
}
save(destination,output);
const link=(file,at,label=file)=>`[${label}](../../${file.replaceAll('[','%5B').replaceAll(']','%5D')}#L${at})`;
const md=[
 '# 中台工作区接口逐项清单','',
 '由 `node scripts/audit-api-inventory.mjs` 静态生成；不要手改。总体结论、原生认证/调度接口和范围说明见[清点报告](../api-inventory.md)。','',
 `按 HTTP 方法 + action 去重，共 **${rows.length} 项**，其中 GET ${rows.filter(r=>r.method==='GET').length}、POST ${rows.filter(r=>r.method==='POST').length}。所有 action 的路径前缀为 \`/api/workspace/\`。`,'',
 '“动作索引”仅帮助检索，不是 CRUD 授权声明；保存可能仅更新或兼有新增，取消/退回/退货不是物理删除。GET 不自动证明零副作用。权限说明为模块入口摘要，完整判定仍需沿处理器及其调用的规则函数核对。页面引用仅证明存在字符串引用，不证明请求方法、页面可见性或执行成功。','',
 '## 模块索引','',
 '| 模块 | GET | POST | 总计 |','| --- | ---: | ---: | ---: |',
 ...modules.map(([label,file],index)=>{const items=rows.filter(r=>r.owner===file);return `| [${label}](#module-${index+1}) | ${items.filter(r=>r.method==='GET').length} | ${items.filter(r=>r.method==='POST').length} | ${items.length} |`;}),
 ];
for(const [index,[label,file,permission]] of modules.entries()){
 const items=rows.filter(row=>row.owner===file);
 md.push('',`<a id="module-${index+1}"></a>`,'',`## ${label}`,'',`权限入口：${permission}。`,'',
 '| 方法 | action | 动作索引 | 处理器证据 | 页面引用示例 |','| --- | --- | --- | --- | --- |');
 for(const row of items){
  const proof=row.evidence.find(p=>p.file===file),reference=row.references[0];
  md.push(`| ${row.method} | \`${row.action}\` | ${row.actionIndex} | ${link(proof.file,proof.line,proof.handler+':'+proof.line)} | ${reference?link(reference.file,reference.line,reference.file+':'+reference.line):'未找到精确静态引用；不能据此认定未使用'} |`);
 }
}
md.push('','## 静态核对','',`- 追踪 ${visited.size} 个方法/处理器组合；支持字面量、允许列表、前缀拼接、后缀分发、schema 键和动作映射。`,
 `- 无法解析的允许列表：${unresolved.length}；页面直接工作区 URL 未匹配项：${unmatchedClientPaths.length}。`,
 `- 另有 ${dynamicClientPrefixes.length} 组页面动态拼接前缀，已单列到 JSON 的 dynamicClientPrefixes；它们不计为未匹配完整路径，也不构成逐参数运行验收。`,
 '- 完整分发链、全部证据和引用位置、参与扫描文件的 SHA-256 见同目录 JSON。源码按 UTF-8、CRLF 统一为 LF 后计算哈希，不含业务记录。',
 '- 不是通用 TypeScript 控制流证明器；新增分发写法、动态调用及运行环境差异仍需人工核对。本次未调用业务接口或运行旧维护脚本。','');
save(path.join(root,'docs/api-inventory/workspace-endpoints.md'),md.join('\n'));
if(unresolved.length||unmatchedClientPaths.length||rows.some(row=>!moduleByFile.has(row.owner)))process.exitCode=1;
console.log(JSON.stringify({endpoints:rows.length,get:rows.filter(r=>r.method==='GET').length,post:rows.filter(r=>r.method==='POST').length,handlers:visited.size,modules:modules.length,unresolved,unmatchedClientPaths},null,2));
