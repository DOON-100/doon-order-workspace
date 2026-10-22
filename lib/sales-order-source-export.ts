import * as XLSX from 'xlsx';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';
import {AppError} from './store';
import {parseSalesOrderSource,SalesOrderSourceError,type SalesOrderSource,type SalesOrderSourceLine,type SalesOrderSourceColorField,type SalesOrderSourceRecord} from './sales-order-sources';
import type {SalesOrderDisplayLabel,SalesOrderDisplayLabels} from './sales-order-field-labels';

type CellValue=string|number|null;
type Group='basic'|'color'|'quantity';
export type SalesOrderSourceExportColumn={key:string;label:string;group:Group;width:number;values:CellValue[];colorField?:SalesOrderSourceColorField};
export const salesOrderSourceExportLimits={inputBytes:8*1024*1024,columns:512,cellText:32767,notesRows:110000} as const;
const blank=(value:CellValue|undefined)=>value===null||value===undefined||typeof value==='string'&&value.trim()==='';
const numberText=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:8});
const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const fallback:SalesOrderDisplayLabels={sourceRow:{zh:'原表行',en:'Source Row'},orderNo:{zh:'订单号',en:'Order No.'},customer:{zh:'客户号',en:'Customer No.'},customerPO:{zh:'客户订单号',en:'Customer PO'},drawing:{zh:'图纸编号',en:'Drawing No.'},model:{zh:'原款号',en:'Original Model'},sku:{zh:'SKU',en:'Source SKU'},color:{zh:'色号',en:'Color No.'},deliveryText:{zh:'原交期',en:'Original Delivery'},quantity:{zh:'数量',en:'Quantity'},unit:{zh:'单位',en:'Unit'},sampleQuantity:{zh:'样办数量',en:'Sample Quantity'},unitPrice:{zh:'原单价',en:'Original Unit Price'},sourceAmount:{zh:'原单金额',en:'Source Amount'}};
const title=(label:SalesOrderDisplayLabel)=>[label.zh,label.en].filter(Boolean).join('\n');
const labelFor=(key:string,labels:SalesOrderDisplayLabels)=>Object.hasOwn(labels,key)?labels[key]:fallback[key];
function displayWidth(value:string){return Array.from(value).reduce((width,char)=>width+(/[\p{Mark}\u200D\uFE0F]/u.test(char)?0:char==='\t'?4:char.codePointAt(0)!>255?2:1),0);}
function rowHeight(value:CellValue,width:number,lineHeight=15,padding=10){
 const lines=String(value??'').split(/\r\n|\r|\n/).reduce((count,line)=>count+Math.max(1,Math.ceil(displayWidth(line)/Math.max(1,width-2))),0);
 return Math.min(409,Math.max(30,lines*lineHeight+padding));
}
function exactDecimal(value:CellValue):{value:number;places:number}|null{
 if(typeof value!=='string'||! /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))return null;
 const places=value.includes('.')?value.length-value.indexOf('.')-1:0,significant=value.replace(/[-.]/g,'').replace(/^0+/,'').length;
 if(places>15||significant>15)return null;
 const number=Number(value);return Number.isFinite(number)&&number.toFixed(places)===value?{value:number,places}:null;
}

function sourceAmount(line:SalesOrderSourceLine):{value:CellValue;note?:string}{
 const matches=line.rawFields.filter(field=>['item net','total','amount','金额'].includes(normalized(field.label)));
 if(matches.length!==1)return {value:null,note:matches.length?'多个原金额栏，未选取或合并':'原单未提供金额栏目'};
 const field=matches[0],formula=!!field.formula||!!field.value?.startsWith('='),value=formula?field.cachedValue:field.value;
 if(formula&&blank(value))return {value:null,note:'原金额公式无缓存，未重新计算'};
 return {value:value??null,...(formula?{note:'原金额为原文件缓存，未重新计算'}:{})};
}
function colorEntries(line:SalesOrderSourceLine){
 const occurrences=new Map<string,number>();
 return line.colorFields.map(field=>{
  // Match the grid's physical slot identity, never a translated-name join.
  const identity=JSON.stringify([field.sourceColumn,field.sourceLabel,field.standardZh,field.standardEn,field.qualifier,field.status]);
  const occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
  return {key:identity+':'+occurrence,field};
 });
}

/** All source rows, in source order. Only whole-order empty columns are omitted. */
export function salesOrderSourceExportColumns(source:SalesOrderSource,labels:SalesOrderDisplayLabels={}):SalesOrderSourceExportColumn[]{
 const lines=source.lines,columns:SalesOrderSourceExportColumn[]=[];
 const add=(key:string,width:number,group:Group,value:(line:SalesOrderSourceLine)=>CellValue)=>columns.push({key,label:title(labelFor(key,labels)),group,width,values:lines.map(value)});
 add('sourceRow',10,'basic',line=>line.sourceRow);add('drawing',20,'basic',line=>line.drawing);add('color',14,'basic',line=>line.color);
 add('orderNo',25,'basic',()=>source.orderNo);add('customer',16,'basic',()=>source.customer);add('customerPO',32,'basic',()=>source.customerPO);
 add('model',22,'basic',line=>line.model);add('sku',25,'basic',line=>line.sku);add('deliveryText',32,'basic',line=>line.deliveryText);
 const slots=new Map<string,SalesOrderSourceExportColumn>();
 for(const [row,line] of lines.entries())for(const {key,field} of colorEntries(line)){
  let column=slots.get(key);
  if(!column){
   if(slots.size+14>=salesOrderSourceExportLimits.columns)throw new AppError('销售原单颜色来源栏目过多，请先核对栏目结构后再导出。',422);
   const label=field.standardZh&&!Object.hasOwn(fallback,field.standardZh)&&Object.hasOwn(labels,field.standardZh)?labels[field.standardZh]:{zh:field.standardZh||field.sourceLabel,en:field.standardEn};
   column={key:'color:'+key,label:[title(label),field.qualifier,`来源 ${field.sourceColumn} 列`].filter(Boolean).join('\n'),group:'color',width:27,values:Array(lines.length).fill(null),colorField:field};
   slots.set(key,column);
  }
  column.values[row]=field.value;
 }
 columns.push(...slots.values());
 add('quantity',16,'quantity',line=>line.quantity);add('unit',12,'quantity',line=>line.unit);add('sampleQuantity',18,'quantity',line=>line.sampleQuantity);
 add('unitPrice',20,'quantity',line=>line.unitPrice);add('sourceAmount',22,'quantity',line=>sourceAmount(line).value);
 return columns.filter(column=>column.values.some(value=>!blank(value)));
}

function quantitySummary(source:SalesOrderSource,field:'quantity'|'sampleQuantity'){
 const totals=new Map<string,number>();let missing=0;
 for(const line of source.lines){const value=line[field];if(value===null){missing++;continue;}totals.set(line.unit,(totals.get(line.unit)||0)+value);}
 return [...totals].map(([unit,value])=>`${numberText(value)} ${unit}`).join('；')+(missing?`（${missing} 行未填写）`:'');
}
function checkedText(value:string){
 if(value.length>salesOrderSourceExportLimits.cellText)throw new AppError('销售原单有超过 Excel 单元格长度上限的内容，已停止导出，请先核对来源。',422);
 // Refuse unsupported XML characters instead of silently corrupting source text.
 if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw new AppError('销售原单含有 Excel 无法保留的控制字符，请先核对来源。',422);
 return value;
}
function xml(value:string){
 return checkedText(value).replace(/_x[0-9a-fA-F]{4}_/g,match=>'_x005F_'+match.slice(1)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r/g,'&#13;');
}
function cell(row:number,column:number,value:CellValue,style:number){
 const address=XLSX.utils.encode_cell({r:row-1,c:column});
 if(blank(value))return `<c r="${address}" s="${style}"/>`;
 if(typeof value==='number'){if(!Number.isFinite(value))throw new AppError('销售原单含有无效数字，已停止导出。',422);return `<c r="${address}" s="${style}" t="n"><v>${value}</v></c>`;}
 // All text is inlineStr, including leading '=', '+', '-', '@', URLs and codes.
 // No source formula, hyperlink, macro or external relationship is copied.
 return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value!)}</t></is></c>`;
}
const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.########"/></numFmts><fonts count="4"><font><sz val="11"/><color rgb="FF172C42"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF526579"/><name val="Calibri"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF153550"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF186A65"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8D631B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD5E0E8"/></left><right style="thin"><color rgb="FFD5E0E8"/></right><top style="thin"><color rgb="FFD5E0E8"/></top><bottom style="thin"><color rgb="FFD5E0E8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
function worksheet(rows:string[],columns:number[],range:string,freezeColumns:number,freezeRows:number,mergeRanges:string[],filter?:string){
 const first=XLSX.utils.encode_cell({r:freezeRows,c:freezeColumns}),pane=freezeColumns?'bottomRight':'bottomLeft';
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${range}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="${freezeColumns}" ySplit="${freezeRows}" topLeftCell="${first}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${first}" sqref="${first}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${columns.map((width,index)=>`<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData>${filter?`<autoFilter ref="${filter}"/>`:''}${mergeRanges.length?`<mergeCells count="${mergeRanges.length}">${mergeRanges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}<printOptions horizontalCentered="0"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function salesOrderSourceWorkbook(record:SalesOrderSourceRecord,labels:SalesOrderDisplayLabels={},fieldLabelsVersion?:string):ArrayBuffer{
 if(new TextEncoder().encode(JSON.stringify(record.source)).byteLength>salesOrderSourceExportLimits.inputBytes)throw new AppError('销售原单超过 8 MiB 导出上限。',422);
 let source:SalesOrderSource;try{source=parseSalesOrderSource(record.source);}catch(error){if(error instanceof SalesOrderSourceError)throw new AppError('销售原单来源校验未通过：'+error.message,422);throw error;}
 const columns=salesOrderSourceExportColumns(source,labels),last=XLSX.utils.encode_col(columns.length-1),rows:string[]=[],merges:string[]=[];
 const decimalStyles=new Map<number,{style:number;format:number}>();
 const decimalStyle=(places:number)=>{let item=decimalStyles.get(places);if(!item){item={style:10+decimalStyles.size,format:165+decimalStyles.size};decimalStyles.set(places,item);}return item.style;};
 const fullRow=(row:number,value:string,style=2,height=28)=>{rows.push(`<row r="${row}" ht="${Math.max(height,rowHeight(value,columns.reduce((sum,column)=>sum+column.width,0)))}" customHeight="1">${cell(row,0,value,style)}</row>`);if(columns.length>1)merges.push(`A${row}:${last}${row}`);};
 fullRow(1,'销售订单明细 / Sales Order Confirmation',1,38);
 fullRow(2,`${title(labelFor('orderNo',labels)).replace(/\n/g,' / ')}：${source.orderNo}    ${title(labelFor('customer',labels)).replace(/\n/g,' / ')}：${source.customer}    产品 / Product：${source.productType}`,2,36);
 fullRow(3,`${title(labelFor('customerPO',labels)).replace(/\n/g,' / ')}：${blank(source.customerPO)?'未填写 / Not provided':source.customerPO}`,2,36);
 fullRow(4,`${source.lines.length} 条明细 / lines    数量 / Quantity：${quantitySummary(source,'quantity')}${source.lines.some(line=>line.sampleQuantity!==null)?`    样办 / Samples：${quantitySummary(source,'sampleQuantity')}（单独保留）`:''}`,2,30);
 fullRow(5,`整张订单共 ${source.lines.length} 条明细；已省略全空列，部分空白保持原样。`,2,30);
 const groupLabels={basic:'基本信息 / Basic information',color:'颜色信息 / Colors',quantity:'数量 / 价格 · Quantity & price'},groupStyles={basic:3,color:4,quantity:5};
 rows.push(`<row r="6" ht="28" customHeight="1">${columns.map((column,index)=>cell(6,index,index===0||columns[index-1].group!==column.group?groupLabels[column.group]:'',groupStyles[column.group])).join('')}</row>`);
 for(let start=0;start<columns.length;){let end=start;while(end+1<columns.length&&columns[end+1].group===columns[start].group)end++;if(end>start)merges.push(`${XLSX.utils.encode_col(start)}6:${XLSX.utils.encode_col(end)}6`);start=end+1;}
 const headerHeight=Math.max(56,...columns.map(column=>rowHeight(column.label,column.width,16,12)));
 rows.push(`<row r="7" ht="${headerHeight}" customHeight="1">${columns.map((column,index)=>cell(7,index,column.label,groupStyles[column.group])).join('')}</row>`);
 for(let index=0;index<source.lines.length;index++){
  const height=Math.max(30,...columns.map(column=>rowHeight(column.values[index],column.width)));
  rows.push(`<row r="${index+8}" ht="${height}" customHeight="1">${columns.map((column,c)=>{const value=column.values[index],decimal=['unitPrice','sourceAmount'].includes(column.key)?exactDecimal(value):null;return decimal?cell(index+8,c,decimal.value,decimalStyle(decimal.places)):cell(index+8,c,value,typeof value==='number'?(Number.isInteger(value)?decimalStyle(0):7):column.colorField&&column.colorField.status!=='adopted'?9:index%2?8:6);}).join('')}</row>`);
 }
 const notes:(string|number)[][]=[['核对事项 / Review item','说明 / Detail'],['用途','本文件为中英销售原单明细，供核对；不是金蝶导入模板，不代表审批、发布生产或推送 ERP / MES。'],['空栏规则','仅删除整单所有明细均为 null、空串或空白字符的栏目；零、斜杠和部分空白栏目保留。明细行不删除、不合并，空单元格不补零或横杠。'],['金额口径','价格保留原文，金额仅来自唯一匹配的原金额值或已有公式缓存；不执行公式、不补算、不汇总未知币种金额。'],['数量口径','按原单位分别汇总；样办单列，不加到订单数量，不换算 PCS / 副 / 付。'],['订单号',source.orderNo],['来源文件',source.source.filename],['来源工作表',source.source.sheet],['来源范围',source.source.detailRange],['原文件 SHA-256',source.source.sha256],['来源记录版本',record.version],['来源内容指纹',record.contentFingerprint],['导入时字段规则',source.dictionaryVersion||'未提供'],['导入时规则 SHA-256',source.dictionarySha256||'未提供'],['导出字段版本',fieldLabelsVersion||'按来源字段保留'],['订单数量 / Quantity',quantitySummary(source,'quantity')],['样办数量 / Samples',quantitySummary(source,'sampleQuantity')||'未提供'],['明细行数',source.lines.length],['有效导出列数',columns.length]];
 for(const warning of source.warnings)notes.push(['原单提醒',warning]);
 for(const column of columns){const field=column.colorField;if(field&&field.status!=='adopted')notes.push([`${field.sourceColumn} 列 · ${field.status==='pending'?'待匹配':'组合栏目'}`,`${column.label}\n原字段：${field.sourceLabel}`]);}
 for(const line of source.lines){
  if(blank(line.unitPrice))notes.push([`原表第 ${line.sourceRow} 行`,'单价未填写；导出不补零或推算。']);
  if(blank(line.deliveryText))notes.push([`原表第 ${line.sourceRow} 行`,'有效交期待确认；不采用隐藏历史日期或推断新日期。']);
  const amount=sourceAmount(line);if(amount.note)notes.push([`原表第 ${line.sourceRow} 行`,amount.note]);
  for(const note of line.notes)notes.push([`原表第 ${line.sourceRow} 行 · 来源备注`,note]);
 }
 if(notes.length>salesOrderSourceExportLimits.notesRows)throw new AppError('销售原单核对说明过多，请先核对来源后再导出。',422);
 const noteRows=notes.map((row,index)=>`<row r="${index+1}" ht="${index?Math.max(rowHeight(row[0],28),rowHeight(row[1],100)):32}" customHeight="1">${row.map((value,column)=>cell(index+1,column,value,index?index%2?6:8:3)).join('')}</row>`);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['']]),'中英订单明细');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['']]),'核对说明');
 book.Props={Title:'Sales Order Confirmation',Subject:'Original source order details',Author:'DOON',Comments:'Read-only export. Source formulas are not executed.'};
 const files=unzipSync(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer));
 const numberFormats=[...decimalStyles].map(([places,item])=>`<numFmt numFmtId="${item.format}" formatCode="${places?'0.'+'0'.repeat(places):'0'}"/>`).join('');
 const numberCells=[...decimalStyles.values()].map(item=>`<xf numFmtId="${item.format}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>`).join('');
 files['xl/styles.xml']=strToU8(styles.replace('<numFmts count="1">',`<numFmts count="${1+decimalStyles.size}">`).replace('</numFmts>',numberFormats+'</numFmts>').replace('<cellXfs count="10">',`<cellXfs count="${10+decimalStyles.size}">`).replace('</cellXfs>',numberCells+'</cellXfs>'));
 const freezeColumns=columns.filter(column=>['sourceRow','drawing','color'].includes(column.key)).length;
 files['xl/worksheets/sheet1.xml']=strToU8(worksheet(rows,columns.map(column=>column.width),`A1:${last}${source.lines.length+7}`,freezeColumns,7,merges,`A7:${last}${source.lines.length+7}`));
 files['xl/worksheets/sheet2.xml']=strToU8(worksheet(noteRows,[28,100],`A1:B${notes.length}`,0,1,[],'A1:B'+notes.length));
 // Repeat the source headers on print pages. Nothing outside this fresh workbook is copied.
 files['xl/workbook.xml']=strToU8(strFromU8(files['xl/workbook.xml']).replace('</workbook>','<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">\'中英订单明细\'!$1:$7</definedName></definedNames></workbook>'));
 const output=zipSync(files,{level:6});return output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer;
}
