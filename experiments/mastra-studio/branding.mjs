import {parse} from 'acorn';
import {translateStudioText} from './locale-zh.mjs';

// Translate static display expressions, never object keys, enum values, URLs,
// form values, IDs, code examples, stored configuration or API/user content.
const displayProperties=new Set(['children','label','title','placeholder','aria-label','aria-description','alt','header','tooltip','emptyText','emptyMessage','loadingText','helperText','buttonText','confirmText','cancelText','searchPlaceholder','description','containerAriaLabel']);
const notificationMethods=new Set(['success','error','warning','info','message']);
const propertyName=node=>node?.type==='Identifier'?node.name:node?.value;
// Reviewed display-only helpers/tables in mastra 1.34.2's pinned main bundle.
// Regression tests fail on an upstream shape change, rather than touching enums.
const displayHelpers=new Set(['Zcr','Zrt','F4s']);
const displayTables=new Set(['lXe','OHe','f5r']);

export function studioDisplayLiterals(source){
 const root=parse(source,{ecmaVersion:'latest',sourceType:'module'}),literals=new Map();
 const capture=node=>{
  if(!node)return;
  if(node.type==='Literal'&&typeof node.value==='string')literals.set(node.start,node);
  else if(node.type==='ConditionalExpression'){capture(node.consequent);capture(node.alternate);}
  else if(node.type==='LogicalExpression'){capture(node.left);capture(node.right);}
  else if(node.type==='ArrayExpression')node.elements.forEach(capture);
  else if(node.type==='ArrowFunctionExpression')capture(node.body);
  else if(node.type==='AssignmentPattern')capture(node.right);
  else if(node.type==='TemplateLiteral'){node.quasis.forEach(part=>{if(part.value.cooked)literals.set(part.start,{...part,value:part.value.cooked});});node.expressions.forEach(capture);}
 };
 const walk=(node,inDisplayHelper=false)=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='FunctionDeclaration')inDisplayHelper=displayHelpers.has(node.id?.name);
  const codeCompletion=node.type==='ObjectExpression'&&node.properties.some(p=>propertyName(p.key)==='type'&&p.value?.value==='keyword');
  if(codeCompletion)return;
  if(node.type==='Property'&&!node.computed&&(displayProperties.has(propertyName(node.key))||/(?:Label|Title|Text|Message|Placeholder|Description)$/.test(propertyName(node.key)||'')))capture(node.value);
  if(inDisplayHelper&&node.type==='ReturnStatement')capture(node.argument);
  if(inDisplayHelper&&node.type==='Property'&&propertyName(node.key)==='value')capture(node.value);
  if(node.type==='VariableDeclarator'&&displayTables.has(node.id?.name)&&node.init?.type==='ObjectExpression')node.init.properties.forEach(p=>capture(p.value));
  if(node.type==='VariableDeclarator'&&node.init?.type==='ConditionalExpression'&&['Not started','not sorted','未开始','未排序'].some(text=>source.slice(node.init.start,node.init.end).includes(JSON.stringify(text))))capture(node.init);
  if(node.type==='VariableDeclarator'&&node.init?.type==='TemplateLiteral'&&node.init.quasis.some(q=>q.value.cooked===' – ')&&node.init.expressions.some(e=>e.type==='ConditionalExpression'&&['Start','开始'].includes(e.alternate?.value)))capture(node.init);
  // Native navigation entries use name, while route/url remains the stable key.
  if(node.type==='ObjectExpression'&&node.properties.some(p=>['route','url'].includes(propertyName(p.key))))for(const p of node.properties)if(propertyName(p.key)==='name')capture(p.value);
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.type==='Identifier'&&node.callee.object.name==='Xe'&&!node.callee.computed&&notificationMethods.has(propertyName(node.callee.property)))capture(node.arguments[0]);
  for(const [key,value] of Object.entries(node)){
   if(['start','end','loc','range'].includes(key))continue;
   if(Array.isArray(value))value.forEach(child=>walk(child,inDisplayHelper));else if(value&&typeof value==='object')walk(value,inDisplayHelper);
  }
 };
 walk(root);return [...literals.values()];
}

export function brandStudioScript(source){
 const edits=studioDisplayLiterals(source).flatMap(node=>{
  const translated=translateStudioText(node.value);
  const text=node.type==='TemplateElement'?translated.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${'):JSON.stringify(translated);
  return translated===node.value?[]:[{start:node.start,end:node.end,text}];
 });
 const pieces=[];let cursor=0;
 for(const edit of edits.sort((a,b)=>a.start-b.start)){pieces.push(source.slice(cursor,edit.start),edit.text);cursor=edit.end;}
 pieces.push(source.slice(cursor));return pieces.join('');
}
