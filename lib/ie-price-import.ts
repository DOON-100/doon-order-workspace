import * as XLSX from 'xlsx';
import {strFromU8} from 'fflate';
import {readIeWorkbookArchive} from './ie-quote-workbook';
import {ieCatalogInput,ieCatalogOfferKey,type IeCatalogInput} from './ie-price-catalog';

export type IePriceImportRow={rowId:number;sheetName:string;sourceRow:number;status:'new'|'duplicate'|'error';issues:string[];entry:IeCatalogInput};
export type IePriceImportOptions={category:IeCatalogInput['category'];supplier:string;effectiveDate:string;filename:string;sheetName?:string};
const key=(v:unknown)=>String(v??'').normalize('NFKC').replace(/[\s（）()]/g,'').trim();
const value=(v:unknown)=>String(v??'').trim();
const aliases={supplier:['供应商简称','供应商','供应商名称','供应商全称'],name:['物品名称','物料名称','工序名称','工序/工艺路线列表','工序','名称','项目名称','加工工序'],price:['单价未税','未税单价','单价含税','含税单价','基价','单价','标准单价','参考单价','单位产值','人工成本','标准单位人工成本','标准单位人工成本参考绩效单位产值'],unit:['单位','计数单位','计价单位'],specification:['物料规格描述','规格描述','规格','描述','工艺描述'],frameType:['架型','产品类型','结构'],processType:['电镀类别','工艺类别'],color:['供应商颜色描述','颜色','颜色描述'],taxRate:['加收税点','税率'],taxBasis:['税价口径','价格口径','含税口径','税价类型'],notes:['备注'],seconds:['标准秒数','标准秒','标准工时秒'],currency:['币别','币种','货币']} as const;
function column(headers:unknown[],names:readonly string[]){return headers.findIndex(v=>names.includes(key(v)));}
function decimal(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 const s=value(v);if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return null;return Number(s);
}
export function parseIePriceWorkbook(bytes:Uint8Array,options:IePriceImportOptions){
 const archive=readIeWorkbookArchive(bytes);
 // Some XLSX writers declare unused macro MIME defaults. Reject actual program
 // parts and macro overrides, while allowing an unused extension declaration.
 if(Object.entries(archive).some(([name,data])=>/vbaProject|activeX|embeddings|xl\/workbook\.bin/i.test(name)||/\[Content_Types\]\.xml/i.test(name)&&/<Override\b[^>]*(?:macroEnabled|vbaProject|activeX|oleObject)/i.test(strFromU8(data))))throw new Error('只接受不含宏和嵌入程序的 XLSX 报价表。');
 // SheetJS reads values and formula text only: no formula evaluation or external fetch.
 const book=XLSX.read(bytes,{type:'array',cellFormula:true,cellHTML:false,cellText:false,bookVBA:false});
 if(book.SheetNames.length>100)throw new Error('工作表超过 100 个，请拆分上传。');
 if(options.sheetName&&!book.SheetNames.includes(options.sheetName))throw new Error('指定工作表不存在。');
 const result:IePriceImportRow[]=[],issues:string[]=[],sheets:string[]=[],seen=new Set<string>();
 for(const sheetName of book.SheetNames){
  if(options.sheetName&&sheetName!==options.sheetName)continue;
  // Mixed cost workbooks contain STYLE calculations and several unrelated
  // libraries. Do not turn another library's matching column into this category.
  if(!options.sheetName&&options.category==='material'&&!/BOM|材料|物料/i.test(sheetName))continue;
  if(!options.sheetName&&options.category==='general'&&!/外发|外协|加工报价|工艺报价/.test(sheetName))continue;
  if(!options.sheetName&&options.category==='process'&&!/标准.*人工|人工.*标准|标准.*工序|工序.*基价|人工基价/.test(sheetName))continue;
  const sheet=book.Sheets[sheetName];if(!sheet['!ref'])continue;
  // Excel often formats whole columns (the source labor library ends at XFD).
  // Bound meaningful cells, not formatting-only dimensions, without truncation.
  let lastRow=0,lastColumn=0,meaningful=0;
  for(const [address,cell] of Object.entries(sheet)){
   if(address.startsWith('!')||!cell||cell.v===undefined&&!cell.f||cell.v===''&&!cell.f)continue;
   const pos=XLSX.utils.decode_cell(address);lastRow=Math.max(lastRow,pos.r);lastColumn=Math.max(lastColumn,pos.c);meaningful++;
  }
  if(lastRow>10000||lastColumn>100||meaningful>100000)throw new Error(`工作表 ${sheetName} 实际内容超过 10001 行、101 列或十万单元格限制。`);
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,blankrows:true,range:{s:{r:0,c:0},e:{r:lastRow,c:lastColumn}}});
  let header=-1,nameColumn=-1,priceColumn=-1,matrix=false;
  for(let i=0;i<Math.min(rows.length,30);i++){
   const n=column(rows[i],aliases.name),untaxed=column(rows[i],['单价未税','未税单价']),p=untaxed>=0?untaxed:column(rows[i],aliases.price),supplier=column(rows[i],aliases.supplier),plating=column(rows[i],aliases.processType);
   const isPlating=(supplier>=0||!!options.supplier)&&plating>=0;
   if(options.category==='plating'&&!isPlating)continue;
   if(options.category==='process'&&isPlating)continue;
   if(options.category==='general'&&isPlating)continue;
   if(options.category==='material'&&isPlating)continue;
   const isMatrix=options.category==='general'&&n>=0&&rows[i].some(v=>key(v)==='胶架')&&rows[i].some(v=>key(v)==='钛架');
   if(n>=0&&(p>=0||isMatrix)){header=i;nameColumn=n;priceColumn=p;matrix=isMatrix;break;}
  }
  if(header<0)continue;sheets.push(sheetName);
  const headers=rows[header],indexes=Object.fromEntries(Object.entries(aliases).map(([k,v])=>[k,column(headers,v)]));
  const dataStart=header+(matrix?2:1);let carriedName='';
  for(let i=dataStart;i<rows.length;i++){
   const row=rows[i];if(!row.some(v=>v!==null&&value(v)!==''))continue;
   const rawName=value(row[nameColumn]);if(matrix&&rawName)carriedName=rawName;
   const name=matrix?(rawName||carriedName):rawName;
   if(!name||/^(合计|小计|总计|序号|注[:：]|说明)/.test(name))continue;
   const get=(field:keyof typeof aliases)=>indexes[field]<0?'':value(row[indexes[field]]);
   const base={category:options.category,name,specification:get('specification'),unit:get('unit'),standardSeconds:null as number|null,priceSource:`${options.filename} / ${sheetName} / 第 ${i+1} 行`,effectiveDate:options.effectiveDate,active:true,supplier:get('supplier')||options.supplier,frameType:get('frameType'),processType:get('processType'),color:get('color'),currency:get('currency')||'CNY',taxBasis:'exclusive' as 'exclusive'|'inclusive',taxRate:0,notes:get('notes')};
   const add=(entry:IeCatalogInput,priceIndex:number,extraIssues:string[]=[]):void=>{
    const problems=[...extraIssues],cell=sheet[XLSX.utils.encode_cell({r:i,c:priceIndex})];
    if(cell?.f)problems.push('价格为公式或外部引用，请在原生 Excel 核对后提供明确数值；不会采用保存缓存。');
    const valid=ieCatalogInput.safeParse(entry);if(!valid.success)problems.push(...valid.error.issues.slice(0,4).map(v=>`${v.path.join('.')}: ${v.message}`));
    if(entry.currency!=='CNY')problems.push('当前报价以人民币未税计价；外币请换算核对后手工登记。');
    const identity=ieCatalogOfferKey(entry),duplicate=seen.has(identity);seen.add(identity);
    result.push({rowId:result.length+1,sheetName,sourceRow:i+1,status:problems.length?'error':duplicate?'duplicate':'new',issues:problems.length?problems:duplicate?['本文件有相同报价，保留首条。']:[],entry});
    if(result.length>2000)throw new Error('可识别报价超过 2000 条，请拆分上传。');
   };
   if(matrix){
    const itemColumn=column(headers,['货物名称']),part=itemColumn<0?'':value(row[itemColumn]);
    for(const family of ['胶架','不锈钢','钛架']){const c=column(headers,[family]);if(c<0)continue;
     const low=decimal(row[c]),high=decimal(row[c+1]);if(low===null&&high===null)continue;
     const variants=low===high?[{price:low,label:'固定价',col:c}]:[{price:low,label:'最低价',col:c},{price:high,label:'最高价',col:c+1}];
     for(const v of variants){if(v.price===null)continue;add({...base,name:part?`${name} · ${part}`:name,frameType:family,processType:v.label,specification:[base.specification,part].filter(Boolean).join(' / '),basePrice:v.price,notes:[base.notes,low!==high?'原表为报价区间，请 IE 核对实际采用价格。':''].filter(Boolean).join('；')},v.col);}
    }
   }else{
    const price=decimal(row[priceColumn]),problems:string[]=[];
    const priceHeader=key(headers[priceColumn]),basis=key(get('taxBasis')).toLowerCase();
    const headerBasis=['单价含税','含税单价'].includes(priceHeader)?'inclusive':['单价未税','未税单价'].includes(priceHeader)?'exclusive':null;
    const explicitBasis=['含税','inclusive'].includes(basis)?'inclusive':['未税','不含税','exclusive'].includes(basis)?'exclusive':null;
    if(basis&&!explicitBasis)problems.push('税价口径须明确为含税或未税。');
    if(explicitBasis&&headerBasis&&explicitBasis!==headerBasis)problems.push('税价口径与单价列标题矛盾，请核对。');
    base.taxBasis=headerBasis||explicitBasis||'exclusive';
    if(!headerBasis&&!explicitBasis&&options.category!=='process')problems.push('单价税价口径不明确，请提供未税/含税单价列或税价口径。');
    if(price===null)problems.push('缺少明确非负数值单价，空白不当作 0。');
    if(options.category==='process'&&indexes.seconds>=0&&get('seconds'))base.standardSeconds=decimal(row[indexes.seconds]);
    const rate=get('taxRate');if(rate){const n=rate.endsWith('%')?decimal(rate.slice(0,-1)):decimal(rate);if(n===null||n>1&&!rate.endsWith('%'))problems.push('税率须为 0—1 或明确的百分数。');else base.taxRate=rate.endsWith('%')?n!/100:n!;}
    add({...base,basePrice:price??-1},priceColumn,problems);
   }
  }
 }
 if(!sheets.length)issues.push('没有识别到此类别的报价子表。请使用“物品名称/工序名称/物料名称”和“单价（未税）”等明确表头，或指定工作表。');
 if(!result.length)issues.push('没有可预览的报价行。');
 return {rows:result,issues,sheets};
}
