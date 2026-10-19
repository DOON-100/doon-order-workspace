import {parse} from 'acorn';

// Calendar formatting is display-only: selection dates, time values and callback
// arguments stay in their original types and formats. No date parsing is changed.
export const calendarChineseProps=`formatters:{formatCaption:date=>date.toLocaleDateString('zh-CN',{year:'numeric',month:'long'}),formatMonthCaption:date=>date.toLocaleDateString('zh-CN',{month:'long'}),formatWeekdayName:date=>date.toLocaleDateString('zh-CN',{weekday:'narrow'})},labels:{labelNext:()=>'下个月',labelPrevious:()=>'上个月',labelMonthDropdown:()=>'选择月份',labelYearDropdown:()=>'选择年份',labelWeekNumber:number=>'第'+number+'周',labelWeekday:date=>date.toLocaleDateString('zh-CN',{weekday:'long'}),labelDay:date=>date.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})},`;

export function localizeStudioWidgets(source){
 // Other lazy-loaded language bundles have no calendar/time widget to adapt.
 if(!source.includes('function Kpe(')&&!source.includes('function Zae('))return source;
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
 const visit=(node,widget)=>{
  if(!node||typeof node!=='object')return;
  if(widget==='Kpe'&&node.type==='CallExpression'&&node.arguments[0]?.name==='gor'&&node.arguments[1]?.type==='ObjectExpression'){
   const props=node.arguments[1];if(props.properties.some(p=>p.key?.name==='showOutsideDays'))edits.push({start:props.start+1,end:props.start+1,text:calendarChineseProps});
  }
  if(widget==='Zae'&&node.type==='Property'&&node.key?.name==='children'&&node.value?.type==='Identifier'&&node.value.name==='s')edits.push({start:node.value.start,end:node.value.end,text:'({AM:"上午",PM:"下午"})[s]??s'});
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(child=>visit(child,widget));else if(value&&typeof value==='object')visit(value,widget);}
 };
 for(const node of ast.body)if(node.type==='FunctionDeclaration'&&['Kpe','Zae'].includes(node.id?.name))visit(node,node.id.name);
 const parts=[];let cursor=0;for(const edit of edits.sort((a,b)=>a.start-b.start)){parts.push(source.slice(cursor,edit.start),edit.text);cursor=edit.end;}parts.push(source.slice(cursor));return parts.join('');
}
