import type {KeyboardEvent} from 'react';
import type {Line,Material,Outsource,Process} from './ie-quote-panel';

export type IeGridKind='material'|'plating'|'general'|'process';
type GridField={key:string;label:string;numeric?:boolean;max?:number;integer?:boolean};
const name={key:'name',label:'名称'},source={key:'priceSource',label:'价格来源'};
const columns:Record<IeGridKind,(GridField|null)[]>={
 material:[null,name,{key:'usage',label:'单耗',numeric:true},{key:'basePrice',label:'基价',numeric:true},{key:'coefficient',label:'系数',numeric:true},{key:'lossRate',label:'额外损耗百分点',numeric:true,max:990},null,source],
 plating:[null,name,{key:'part',label:'部位'},{key:'unitPrice',label:'单价',numeric:true},{key:'usage',label:'每副用量',numeric:true},null,source],
 general:[null,name,{key:'part',label:'部位'},{key:'unitPrice',label:'单价',numeric:true},{key:'usage',label:'每副用量',numeric:true},null,source],
 process:[{key:'sequence',label:'顺序',numeric:true,max:10000,integer:true},name,{key:'standardSeconds',label:'标准秒',numeric:true},{key:'basePrice',label:'基价',numeric:true},{key:'difficulty',label:'难度',numeric:true},{key:'usage',label:'每副用量',numeric:true},null,source],
};

/** Parse the tab/newline clipboard format emitted by Excel, including quoted cells. */
export function parseIeGridClipboard(text:string):string[][]{
 if(text.length>250000)throw new Error('粘贴内容过大，请分批填写。');
 const rows:string[][]=[],row:string[]= [];let value='',quoted=false,closed=false;
 const cell=()=>{row.push(value);value='';closed=false;};
 const record=()=>{cell();rows.push(row.splice(0));};
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
  if(ch==='"'&&!value&&!closed){quoted=true;continue;}
  if(ch==='\t'){cell();continue;}
  if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;record();continue;}
  if(closed)throw new Error('粘贴格式不完整，请重新从 Excel 复制连续的单元格。');
  value+=ch;
 }
 if(quoted)throw new Error('粘贴内容的引号未闭合，请重新从 Excel 复制。');
 if(value||row.length||!rows.length)record();
 if(rows.length>300||rows.some(r=>r.length!==rows[0].length))throw new Error('请复制完整的矩形区域，每行列数必须一致，最多 300 行。');
 return rows;
}

function fieldValue(field:GridField,raw:string,row:number):string|number|null{
 const value=raw.trim(),prefix=`粘贴第 ${row+1} 行“${field.label}”：`;
 if(!field.numeric){if(value.length>(field.key==='priceSource'?1000:240))throw new Error(prefix+'文字过长。');return value;}
 if(!value){if(field.integer)throw new Error(prefix+'须填写正整数。');return field.key==='lossRate'?0.1:null;}
 const normalized=/^\+?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)?value.replaceAll(',',''):value;
 if(!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized))throw new Error(prefix+'须填写非负数字，暂不接收 Excel 公式。');
 const number=Number(normalized),rounded=Math.round(number*1e6)/1e6;
 if(!Number.isFinite(number)||number>(field.max??100000000)||Math.abs(number-rounded)>Number.EPSILON*Math.max(1,Math.abs(number))*2||(field.integer&&(!Number.isInteger(number)||number<1)))throw new Error(prefix+`数值超出范围或精度（最多 6 位小数${field.integer?'，须为正整数':''}）。`);
 return field.key==='lossRate'?Math.round((0.1+number/100)*1e6)/1e6:number;
}

/** One immutable patch: a bad cell rejects the entire paste, including appended rows. */
export function applyIeGridPaste({line,kind,rowId,column,text,idFactory}:{line:Line;kind:IeGridKind;rowId:string;column:number;text:string;idFactory:()=>string}):{patch:Partial<Line>;rowCount:number;columnCount:number;added:number}{
 const matrix=parseIeGridClipboard(text),fields=columns[kind],width=matrix[0].length;
 if(column<0||column+width>fields.length)throw new Error('粘贴超出当前表格列，请缩小复制范围。');
 const selected=fields.slice(column,column+width);
 if(selected.some(field=>!field))throw new Error('整块未粘贴：范围包含行号或人工金额列。请仅复制连续的基础填写列；金额格可单独改价并填写原因。');
 const parsed=matrix.map((row,i)=>Object.fromEntries(row.map((value,j)=>[selected[j]!.key,fieldValue(selected[j]!,value,i)])));
 const original=kind==='material'?line.materials:kind==='process'?line.processes:line.outsourcing.filter(row=>row.category===kind),start=original.findIndex(row=>row.id===rowId);
 if(start<0)throw new Error('当前行已变化，请重新选择粘贴起点。');
 const added=Math.max(0,start+matrix.length-original.length),limit=kind==='material'?200:kind==='process'?300:100,total=kind==='plating'||kind==='general'?line.outsourcing.length:original.length;
 if(total+added>limit)throw new Error(`整块未粘贴：当前类目最多 ${limit} 行，请减少行数。`);
 const rows:(Material|Process|Outsource)[]=original.map(row=>({...row}));
 let sequence=Math.max(0,...line.processes.map(row=>row.sequence));
 while(rows.length<start+matrix.length){
  const common={id:idFactory(),name:'',priceSource:'',notes:'',notApplicable:false};
  rows.push(kind==='material'?{...common,specification:'',unit:'',basePrice:null,usage:1,coefficient:1,lossRate:0.1,lossAdjustmentReason:''}:kind==='process'?{...common,parentId:'',sequence:++sequence,usage:1,standardSeconds:null,basePrice:null,difficulty:1}:{...common,category:kind,part:'',usage:1,unitPrice:null});
 }
 parsed.forEach((values,i)=>{
  const clearsCatalog=(kind==='material'?['name','basePrice','priceSource']:kind==='process'?['name','basePrice','standardSeconds','priceSource']:['name','unitPrice','priceSource']).some(key=>key in values);
  rows[start+i]={...rows[start+i],...values,...(clearsCatalog?{catalogId:'',catalogVersion:null}:{}),...(kind==='material'&&'name' in values?{nameReference:null}:{})} as Material|Process|Outsource;
 });
 if(kind==='process'&&rows.some(row=>(row as Process).sequence>10000))throw new Error('工序顺序不能超过 10000，请一并粘贴或调整顺序。');
 let patch:Partial<Line>;
 if(kind==='material')patch={materials:rows as Material[]};
 else if(kind==='process')patch={processes:rows as Process[]};
 else {const byId=new Map(rows.map(row=>[row.id,row as Outsource]));patch={outsourcing:[...line.outsourcing.map(row=>byId.get(row.id)||row),...rows.slice(original.length) as Outsource[]]};}
 return {patch,rowCount:matrix.length,columnCount:width,added};
}

export function ieGridInputTarget(target:EventTarget|null):{input:HTMLInputElement;cell:HTMLTableCellElement;row:HTMLTableRowElement;table:HTMLTableElement}|null{
 if(!(target instanceof HTMLInputElement)||target.disabled||target.readOnly||target.closest('[data-ieq-grid-popover]'))return null;
 const cell=target.closest<HTMLTableCellElement>('td'),row=cell?.closest<HTMLTableRowElement>('tr[data-ieq-grid-row]'),table=row?.closest<HTMLTableElement>('table[data-ieq-grid-kind]');
 if(!cell||!row||!table||table.closest('[hidden]'))return null;
 return {input:target,cell,row,table};
}

export function handleIeGridKeyDown(event:KeyboardEvent<HTMLElement>){
 if(event.defaultPrevented||event.nativeEvent.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||!['Enter','Tab'].includes(event.key))return;
 const current=ieGridInputTarget(event.target);if(!current)return;
 const {row,cell,table}=current,rows=Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-ieq-grid-row]')).filter(item=>!item.closest('[hidden]'));
 const primary=(td:Element|undefined)=>td?.querySelector<HTMLInputElement>('input:not(:disabled):not([readonly])')||null;
 let next:HTMLInputElement|null=null;
 if(event.key==='Enter')next=primary(rows[rows.indexOf(row)+(event.shiftKey?-1:1)]?.cells[cell.cellIndex]);
 else {const inputs=rows.flatMap(item=>Array.from(item.cells).map(primary).filter((input):input is HTMLInputElement=>!!input));next=inputs[inputs.indexOf(current.input)+(event.shiftKey?-1:1)]||null;}
 if(next){event.preventDefault();next.focus();try{next.select();}catch{/* Some browser number inputs do not expose a text selection. */}}
 else if(event.key==='Enter')event.preventDefault();
}
