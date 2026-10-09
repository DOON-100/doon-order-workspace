import * as XLSX from 'xlsx';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';

export type CustomerQuoteTemplateUnit='piece'|'pair'|'set';
export type CustomerQuoteTemplateItem={
 id:string;materialNumber:string;description:string;modelNames:string[];sourceRows:number[];
 partType:'frame'|'clip_on'|'bridge'|'temple_lug'|'temple_tip'|'nose_pad'|'unknown';
 supplyStage:'raw'|'semi_finished'|'finished'|'unknown';side:'left'|'right'|'none';
 size:string;finish:string;unit:null;status:'pending';conflicts:string[];
};
export type CustomerQuoteTemplateRow={sheetName:string;sourceRow:number;materialNumber:string;itemId:string;modelName:string;description:string;priceCell:string};
type SourceCell={address:string;value:string|number|boolean};
export type CustomerQuoteTemplate={
 adapterId:'metropolitan-spare-parts-v1';sourceHash:string;sheetName:string;worksheetPath:string;headerRow:number;
 items:CustomerQuoteTemplateItem[];rowMappings:CustomerQuoteTemplateRow[];sourceCells:SourceCell[];issues:string[];
};
export type CustomerQuoteTemplatePrice={itemId:string;materialNumber:string;description:string;unit:string;unitPrice:number;status:string;quantity?:number|null;quantityBasisEn?:string;scopeNotesEn?:string;factoryModel?:string;customerModel?:string;component?:string;side?:string;supplyStage?:string};
export type CustomerQuoteTemplateMetadata={quoteNo:string;quoteDate:string;validUntil:string;currency:string;quantityMode?:string;brand?:string;businessType?:string;terms:(string|{label:string;value:string})[]};
export type CustomerQuoteTemplateExportInput={template:CustomerQuoteTemplate;prices:CustomerQuoteTemplatePrice[];metadata:CustomerQuoteTemplateMetadata};

const MAX_INPUT=10*1024*1024,MAX_EXPANDED=24*1024*1024,MAX_ENTRY=8*1024*1024,MAX_ROWS=5000,MAX_ITEMS=1000;
// SheetJS emits this empty dynamic-array manifest even for plain scalar sheets.
const SAFE_METADATA='<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';
const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const unxml=(value:string)=>value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi,(_,n:string,k:string)=>n?String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[k.toLowerCase()]);
const fail=(message:string):never=>{throw new Error(message);};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function text(value:unknown,max=4000){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('模板文本包含不支持的内容或超过长度限制。');return value as string;}
function attrs(tag:string){const result:Record<string,string>={};for(const m of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g))result[m[1]]=unxml(m[3]);return result;}
function bytesOf(value:Uint8Array|ArrayBuffer){const bytes=value instanceof Uint8Array?value:new Uint8Array(value);if(!bytes.length||bytes.length>MAX_INPUT)fail('请使用不超过 10 MB 的 XLSX 文件。');return bytes;}
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');}

// Read ZIP sizes before inflation; declared and actual sizes must agree afterwards.
function archive(value:Uint8Array|ArrayBuffer){
 const bytes=bytesOf(value),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
 if(end<0)fail('文件不是支持的 XLSX ZIP 包。');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true),length=v.getUint32(end+12,true);
 if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||count>128||count===65535||start+length!==end)fail('不支持分卷、ZIP64 或异常 ZIP 包。');
 const entries=new Map<string,number>();let p=start,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||v.getUint32(p,true)!==0x02014b50)fail('ZIP 目录已损坏。');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),compressed=v.getUint32(p+20,true),size=v.getUint32(p+24,true),n=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),offset=v.getUint32(p+42,true);
  if(p+46+n+extra+comment>end)fail('ZIP 目录超出文件范围。');
  const name=strFromU8(bytes.subarray(p+46,p+46+n));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(part=>part==='..'||part==='.'||part==='__proto__')||entries.has(name))fail('ZIP 包含重复或不安全的文件路径。');
  if(flags&1||![0,8].includes(method)||size===0xffffffff||offset===0xffffffff||size>MAX_ENTRY||size>Math.max(1024*1024,compressed*200)||(total+=size)>MAX_EXPANDED)fail('XLSX 压缩内容超过安全限制，或含不支持的加密内容。');
  if(offset+30>start||v.getUint32(offset,true)!==0x04034b50)fail('ZIP 文件条目已损坏。');
  const localName=v.getUint16(offset+26,true),localExtra=v.getUint16(offset+28,true);
  if(offset+30+localName+localExtra+compressed>start||strFromU8(bytes.subarray(offset+30,offset+30+localName))!==name||v.getUint16(offset+8,true)!==method)fail('ZIP 条目与目录不一致。');
  entries.set(name,size);p+=46+n+extra+comment;
 }
 if(p!==end)fail('ZIP 包含额外目录内容。');
 let files:Record<string,Uint8Array>;try{files=unzipSync(bytes);}catch{fail('XLSX 压缩内容无法读取。');}
 if(Object.keys(files!).length!==entries.size)fail('ZIP 条目数量不一致。');
 for(const [name,size] of entries)if(!files![name]||files![name].length!==size)fail('ZIP 解压大小与声明不一致。');
 return files!;
}

type Package={files:Record<string,Uint8Array>;book:XLSX.WorkBook;sheet:XLSX.WorkSheet;sheetName:string;worksheetPath:string;terms?:XLSX.WorkSheet};
function open(value:Uint8Array|ArrayBuffer,output=false):Package{
 const files=archive(value);
 const allowed=/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:core|app|custom)\.xml|xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|metadata\.xml|theme\/theme\d+\.xml|_rels\/workbook\.xml\.rels|worksheets\/(?:sheet\d+|customerQuoteTerms)\.xml))$/;
 const directories=new Set(['_rels/','docProps/','xl/','xl/_rels/','xl/worksheets/','xl/theme/']);
 for(const [name,content] of Object.entries(files)){
  if(!allowed.test(name)&&!(directories.has(name)&&!content.length))fail('此模板含图片、批注、宏、嵌入对象或其他额外内容，第一期不能安全保留，请先提供仅含客户报价表的模板。');
  if(name.endsWith('.xml')||name.endsWith('.rels')){
   const source=strFromU8(content);
   if(name.startsWith('xl/worksheets/')){
    const tags=new Set(['worksheet','sheetPr','outlinePr','pageSetUpPr','tabColor','dimension','sheetViews','sheetView','selection','pane','sheetFormatPr','cols','col','sheetData','row','c','v','f','is','t','mergeCells','mergeCell','pageMargins','pageSetup','printOptions','headerFooter','autoFilter','sheetCalcPr','ignoredErrors','ignoredError']);
    if(source.includes('<!--')||[...source.matchAll(/<\/?([\w:]+)/g)].some(match=>!tags.has(match[1].split(':').pop()!)))fail('报价工作表含不支持的附加 XML 内容，须先核对以免泄漏。');
   }
   if(name==='xl/metadata.xml'){if(source.replace(/<\?xml[^>]*\?>/,'').replace(/\s+/g,'')!==SAFE_METADATA.replace(/\s+/g,''))fail('模板含额外单元格元数据，第一期不能安全保留。');continue;}
   if(name==='docProps/custom.xml'){
    const properties=[...source.matchAll(/<property\b[^>]*>[\s\S]*?<\/property>/g)];
    if(!properties.length||source.replace(/<\?xml[^>]*\?>/,'').replace(/<Properties\b[^>]*>|<\/Properties>/g,'').replace(/<property\b[^>]*>[\s\S]*?<\/property>/g,'').trim())fail('模板含额外文档自定义内容，须先核对。');
    const seen=new Set<string>();for(const [property] of properties){const a=attrs(property.match(/^<property\b[^>]*>/)![0]),match=property.match(/>(<vt:(lpwstr|i4)>[^<]*<\/vt:\2>)<\/property>$/);if(!match||seen.has(a.name)||a.fmtid!=='{D5CDD505-2E9C-101B-9397-08002B2CF9AE}')fail('模板含不支持的自定义属性。');seen.add(a.name);const content=match![1];if(a.name==='ICV'?!/^<vt:lpwstr>[A-F0-9]{32}_\d+<\/vt:lpwstr>$/i.test(content):a.name==='KSOProductBuildVer'?!/^<vt:lpwstr>\d+[.\d-]*<\/vt:lpwstr>$/.test(content):a.name==='CalculationRule'?!/^<vt:i4>[01]<\/vt:i4>$/.test(content):true)fail('模板含额外文档属性内容，须先核对以免泄漏。');}
   }
   const activeSource=name==='[Content_Types].xml'?source.replace(/<Default\b[^>]*\/\s*>/g,''):source;
   if(/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|externalLink|TargetMode\s*=\s*["']External/i.test(activeSource))fail('模板包含宏、外部链接或不安全 XML，无法使用。');
   const structuralSource=source.replace(/<extLst>[\s\S]*?<\/extLst>/g,extension=>{
    const plain=extension.replace(/\s+/g,'');
    if(name==='xl/styles.xml'&&/^<extLst><exturi="\{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C\}"xmlns:x14="http:\/\/schemas\.microsoft\.com\/office\/spreadsheetml\/2009\/9\/main"><x14:slicerStylesdefaultSlicerStyle="SlicerStyle(?:Light|Dark)\d+"\/><\/ext><\/extLst>$/.test(plain))return '';
    if(name==='xl/workbook.xml'&&/^<extLst><exturi="\{B58B0392-4F1F-4190-BB64-5DF3571DCE5F\}"xmlns:xcalcf="http:\/\/schemas\.microsoft\.com\/office\/spreadsheetml\/2018\/calcfeatures"><xcalcf:calcFeatures>(?:<xcalcf:featurename="microsoft\.com:(?:RD|Single|FV|CNMTM|LET_WF|LAMBDA_WF|ARRAYTEXT_WF)"\/>)+<\/xcalcf:calcFeatures><\/ext><\/extLst>$/.test(plain))return '';
    return extension;
   });
   if(/<(?:\w+:)?(?:f|formula|definedName|hyperlink|drawing|legacyDrawing|oleObject|extLst|sheetProtection|dataValidation)\b/.test(structuralSource))fail('模板含公式、链接或不支持的隐藏附加内容，无法安全导出。');
   if(/<(?:\w+:)?(?:row|col)\b[^>]*\bhidden\s*=\s*["'](?:1|true)["']/i.test(source))fail('模板包含隐藏行列，须先核对隐藏内容。');
  }
 }
 for(const required of ['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels'])if(!files[required])fail('XLSX 缺少工作簿结构。');
 const workbook=strFromU8(files['xl/workbook.xml']),rels=strFromU8(files['xl/_rels/workbook.xml.rels']);
 const sheets=[...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)].map(m=>attrs(m[0]));
 if(sheets.some(s=>s.state&&s.state!=='visible'))fail('模板包含隐藏工作表，无法安全导出。');
 if(sheets.length!==(output?2:1)||output&&sheets[1].name!=='Terms')fail(output?'实际客户文件必须包含原报价表及 Terms 两张工作表。':'第一期只接受一张可见报价工作表；请先分离其他工作表。');
 const relations=[...rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/?>/g)].map(m=>attrs(m[0]));
 const paths=sheets.map(s=>{
  const rel=relations.find(r=>r.Id===s['r:id']);if(!rel||!rel.Type.endsWith('/worksheet')||!rel.Target||rel.Target.includes('..')||rel.Target.includes('\\'))fail('工作表关系无效。');
  const path=rel!.Target.startsWith('/')?rel!.Target.slice(1):'xl/'+rel!.Target;if(!files[path])fail('工作表文件不存在。');return path;
 });
 const referenced=new Set(paths);for(const name of Object.keys(files))if(/^xl\/worksheets\/[^/]+\.xml$/.test(name)&&!referenced.has(name))fail('XLSX 包含未登记工作表，无法安全导出。');
 for(const path of paths){const addresses=new Set<string>();for(const [tag] of strFromU8(files[path]).matchAll(/<(?:\w+:)?c\b[^>]*>/g)){const address=attrs(tag).r;if(!address||!/^\$?[A-Z]+\$?[1-9]\d*$/.test(address)||addresses.has(address))fail('模板包含重复或无效的单元格地址，须先修正。');addresses.add(address);}}
 let book:XLSX.WorkBook;try{book=XLSX.read(bytesOf(value),{type:'array',cellFormula:true,cellStyles:true,cellText:false,cellDates:false});}catch{fail('无法解析客户工作表。');}
 if(book!.SheetNames.length!==sheets.length)fail('工作表目录不一致。');
 return {files,book:book!,sheet:book!.Sheets[sheets[0].name],sheetName:sheets[0].name,worksheetPath:paths[0],terms:output?book!.Sheets.Terms:undefined};
}
const valueAt=(sheet:XLSX.WorkSheet,address:string)=>sheet[address]?.v??'';
function numberId(value:unknown){if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)fail('客户物料号必须为完整文本或安全整数，不能含小数或超长数值。');return String(value);}return text(value,160).trim();}
function describe(description:string):Pick<CustomerQuoteTemplateItem,'partType'|'supplyStage'|'side'|'size'|'finish'>{
 const upper=description.toUpperCase();
 return {partType:/\b(?:NOSE\s*PADS?|PADS?)\b/.test(upper)?'nose_pad':/\bTEMPLE\s*TIP\b/.test(upper)?'temple_tip':/\b(?:TEMPLE\s*LUG|END\s*PIECE)\b/.test(upper)?'temple_lug':/\bBRIDGE\b/.test(upper)?'bridge':/\bCLIP(?:\s|-)?ON\b/.test(upper)?'clip_on':/\bFRAME\b/.test(upper)?'frame':'unknown',
 supplyStage:/\bSEMI[ -]FINISHED\b/.test(upper)?'semi_finished':/\bRAW\b/.test(upper)?'raw':/\b(?:FINISHED|IP)\b/.test(upper)?'finished':'unknown',side:/\bLEFT\b/.test(upper)?'left':/\bRIGHT\b/.test(upper)?'right':'none',size:description.match(/\bSIZE\s+([\d.]+\s*[-x×]\s*[\d.]+)/i)?.[1]||'',finish:description.match(/\bIP\s+([A-Z][A-Z -]*?)(?=\s+(?:SIZE|LEFT|RIGHT)|[,;()]|$)/i)?.[1]?.trim()||''};
}
function mapping(pkg:Package):Omit<CustomerQuoteTemplate,'sourceHash'>{
 const sheet=pkg.sheet,range=XLSX.utils.decode_range(sheet['!ref']||'A1:A1');
 if(range.e.r>=MAX_ROWS||range.e.c>4)fail('第一期模板只支持 A:E 列及 5000 行以内的客户报价表。');
 let headerRow=0;
 for(let row=1;row<=Math.min(100,range.e.r+1);row++){
  const headers=['A','B','C','D'].map(c=>String(valueAt(sheet,c+row)).trim().replace(/\s+/g,' ').toLowerCase());
  if(['model name','english model name'].includes(headers[0])&&headers[1]==='material number'&&headers[2]==='material description'&&headers[3]==='unit price whole model'){if(headerRow)fail('报价表存在多个主表头，须先核对模板。');headerRow=row;}
 }
 if(!headerRow)fail('无法识别 A:D 表头：Model Name、Material Number、Material Description、Unit Price Whole Model。');
 const merges=sheet['!merges']||[];
 for(const merge of merges)if(merge.e.r>=headerRow&&(merge.s.c!==0||merge.e.c!==0))fail('报价数据区只允许 A 列父款纵向合并，不支持合并物料、说明或价格格。');
 const rowMappings:CustomerQuoteTemplateRow[]=[],items:CustomerQuoteTemplateItem[]=[],byMaterial=new Map<string,CustomerQuoteTemplateItem>();let group='';
 for(let row=headerRow+1;row<=range.e.r+1;row++){
  const b=valueAt(sheet,'B'+row),c=valueAt(sheet,'C'+row),a=valueAt(sheet,'A'+row),d=valueAt(sheet,'D'+row);
  const merge=merges.find(m=>m.s.c===0&&m.e.c===0&&m.s.r<=row-1&&m.e.r>=row-1),anchor=merge?valueAt(sheet,'A'+(merge.s.r+1)):a;
  if(anchor!=='')group=text(String(anchor),500);
  if(b===''&&c===''){if(d!=='')fail(`D${row} 有未映射的价格或附加内容，请先核对模板。`);continue;}
  if(b===''||c==='')fail(`第 ${row} 行物料号和原文说明不完整，请先核对。`);
  const materialNumber=numberId(b),description=text(c,4000);if(!materialNumber||!description.trim())fail(`第 ${row} 行缺少有效物料或说明。`);
  const id='material:'+materialNumber,modelName=anchor!==''?String(anchor):group;
  rowMappings.push({sheetName:pkg.sheetName,sourceRow:row,materialNumber,itemId:id,modelName,description,priceCell:'D'+row});
  let item=byMaterial.get(materialNumber);
  if(!item){item={id,materialNumber,description,modelNames:[],sourceRows:[],...describe(description),unit:null,status:'pending',conflicts:[]};byMaterial.set(materialNumber,item);items.push(item);}
  else if(item.description!==description&&!item.conflicts.includes(description))item.conflicts.push(description);
  if(modelName&&!item.modelNames.includes(modelName))item.modelNames.push(modelName);item.sourceRows.push(row);
 }
 if(!items.length||items.length>MAX_ITEMS)fail('模板必须含 1 至 1000 个有效物料。');
 const targets=new Set(rowMappings.map(row=>row.priceCell)),sourceCells:SourceCell[]=[];
 for(const address of Object.keys(sheet).filter(a=>!a.startsWith('!')).sort()){
  const cell=sheet[address];if(cell.f||cell.l||cell.c)fail('模板包含公式、链接或批注，第一期不能安全保留。');
  if(!targets.has(address)&&cell.v!==undefined&&cell.v!==null&&cell.v!==''){if(!['string','number','boolean'].includes(typeof cell.v))fail('模板包含不支持的单元格类型。');if(typeof cell.v==='string')text(cell.v);sourceCells.push({address,value:cell.v});}
 }
 const issues=items.filter(i=>i.conflicts.length).map(i=>`物料 ${i.materialNumber} 在不同位置使用不同原文说明；请修正客户模板并重新登记，不能自动合并价格。`);
 return {adapterId:'metropolitan-spare-parts-v1',sheetName:pkg.sheetName,worksheetPath:pkg.worksheetPath,headerRow,items,rowMappings,sourceCells,issues};
}
export async function parseCustomerQuoteTemplate(bytes:Uint8Array|ArrayBuffer):Promise<CustomerQuoteTemplate>{const pkg=open(bytes);return {...mapping(pkg),sourceHash:await digest(bytesOf(bytes))};}

function date(value:string){const parsed=new Date(value+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail('报价日期及有效期必须为有效的 YYYY-MM-DD 日期。');return value;}
function confirmed(input:CustomerQuoteTemplateExportInput){
 const {template,prices,metadata}=input;
 if(template.adapterId!=='metropolitan-spare-parts-v1'||!template.items.length||template.items.length>MAX_ITEMS||template.items.some(i=>i.conflicts.length)||new Set(template.items.map(i=>i.id)).size!==template.items.length)fail('模板含未解决的物料冲突，请先修正并重新登记。');
 if(prices.length!==template.items.length||new Set(prices.map(p=>p.itemId)).size!==prices.length)fail('报价必须为每个模板物料提供唯一的已确认价格。');
 const mode=metadata.quantityMode||'price_list';if(!['order','price_list'].includes(mode))fail('必须明确报价为订单价或价格目录。');
 const byId=new Map<string,CustomerQuoteTemplatePrice>();
 for(const price of prices){
  const item=template.items.find(i=>i.id===price.itemId);if(!item||price.materialNumber!==item.materialNumber||price.description!==item.description)fail('报价行的物料号或原文说明与模板不一致，请先修订并确认报价。');
  if(price.status!=='confirmed'||!['piece','pair','set'].includes(price.unit)||typeof price.unitPrice!=='number'||!Number.isFinite(price.unitPrice)||price.unitPrice<0||price.unitPrice>1e9)fail('每个物料必须确认 piece/pair/set 单位及有效对客单价。');
  if(mode==='order'&&(!Number.isSafeInteger(price.quantity)||Number(price.quantity)<=0)||mode==='price_list'&&price.quantity!=null&&(!Number.isSafeInteger(price.quantity)||Number(price.quantity)<=0))fail('订单报价必须逐物料确认正整数数量；价目适用数量基准须为空或正整数。');
  for(const field of ['quantityBasisEn','scopeNotesEn','factoryModel','customerModel','component'] as const)if(price[field]!==undefined)text(price[field],field==='scopeNotesEn'?4000:1000);
  if(price.side!==undefined&&!['left','right','none'].includes(price.side)||price.supplyStage!==undefined&&!['raw','semi_finished','finished','unknown'].includes(price.supplyStage))fail('报价的左右属性或供货状态不完整。');
  byId.set(price.itemId,price);
 }
 if(!text(metadata.quoteNo,160).trim())fail('缺少报价单号。');date(metadata.quoteDate);date(metadata.validUntil);if(metadata.validUntil<metadata.quoteDate)fail('报价有效期不得早于报价日期。');
 if(!/^[A-Z]{3}$/.test(metadata.currency))fail('必须明确三位大写币种。');
 if(!Array.isArray(metadata.terms)||metadata.terms.length>400)fail('报价条款必须为不超过 400 项的外部条款。');
 const terms=metadata.terms.map(term=>typeof term==='string'?text(term,4000):text(term.label,240)+': '+text(term.value,4000));
 const rows:(string|number)[][]=[['Customer quotation terms'],['Quote number',metadata.quoteNo],['Quote date',metadata.quoteDate],['Valid until',metadata.validUntil],['Currency',metadata.currency],['Quantity mode',mode],['Brand',text(metadata.brand||'',240)],['Business type',text(metadata.businessType||'',240)],[],['Item ID','Material Number','Material Description','Unit',mode==='order'?'Order quantity':'Quantity basis (price list only)','Currency','Unit price','Supply scope (included / excluded)','Quantity basis explanation','Factory model','Customer model','Component','Side','Supply stage']];
 for(const item of template.items){const price=byId.get(item.id)!;rows.push([item.id,item.materialNumber,item.description,price.unit,price.quantity??'',metadata.currency,price.unitPrice,price.scopeNotesEn||'',price.quantityBasisEn||'',price.factoryModel||'',price.customerModel||'',price.component||'',price.side||'',price.supplyStage||'']);}
 rows.push([],['Terms']);for(const term of terms)rows.push([term]);
 return {byId,rows};
}
export function assertCustomerQuoteTemplateExportable(input:CustomerQuoteTemplateExportInput):void{confirmed(input);}
function sameMapping(actual:Omit<CustomerQuoteTemplate,'sourceHash'>,expected:CustomerQuoteTemplate){if(actual.sheetName!==expected.sheetName||actual.worksheetPath!==expected.worksheetPath||actual.headerRow!==expected.headerRow||!equal(actual.rowMappings,expected.rowMappings)||!equal(actual.sourceCells,expected.sourceCells)||!equal(actual.items,expected.items))fail('客户文件的物料、原文说明、行映射或原表内容已变化，请先修订并重新确认报价。');}
function patchPrices(source:string,rows:CustomerQuoteTemplateRow[],prices:Map<string,CustomerQuoteTemplatePrice>){
 for(const mapping of rows){
  const address=mapping.priceCell,cellPattern=new RegExp('<(?:\\w+:)?c\\b[^>]*\\br=["\\\']'+address+'["\\\'][^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:\\w+:)?c>)','g');
  let found=0;source=source.replace(cellPattern,tag=>{found++;const start=tag.match(/^<([\w:]+)\b([^>]*?)(?:\/?>)/)!;const cellAttrs=start[2].replace(/\s+t\s*=\s*(["']).*?\1/g,'').replace(/\s*\/$/,'');return `<${start[1]}${cellAttrs}><v>${String(prices.get(mapping.itemId)!.unitPrice)}</v></${start[1]}>`;});
  if(found>1)fail('客户模板存在重复价格单元格。');
  if(!found){let inserted=false;const rowPattern=new RegExp('(<(?:\\w+:)?row\\b[^>]*\\br=["\\\']'+mapping.sourceRow+'["\\\'][^>]*>)([\\s\\S]*?)(<\\/(?:\\w+:)?row>)');source=source.replace(rowPattern,(_,start:string,inside:string,end:string)=>{inserted=true;const newCell=`<c r="${address}"><v>${String(prices.get(mapping.itemId)!.unitPrice)}</v></c>`;const next=inside.search(/<(?:\w+:)?c\b[^>]*\br=["'][E-Z]/);return start+(next<0?inside+newCell:inside.slice(0,next)+newCell+inside.slice(next))+end;});if(!inserted)fail('客户模板价格行不存在。');}
 }
 return source;
}
function termsXml(rows:(string|number)[][]){return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:N'+rows.length+'"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="70" customWidth="1"/><col min="4" max="7" width="16" customWidth="1"/><col min="8" max="9" width="70" customWidth="1"/><col min="10" max="14" width="24" customWidth="1"/></cols><sheetData>'+rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>{if(value==='')return '';const address=XLSX.utils.encode_cell({r,c});return typeof value==='number'?`<c r="${address}"><v>${value}</v></c>`:`<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}).join('')+'</row>').join('')+'</sheetData></worksheet>';}
export async function exportCustomerQuoteTemplate(bytes:Uint8Array|ArrayBuffer,input:CustomerQuoteTemplateExportInput):Promise<Uint8Array>{
 const pkg=open(bytes),actual=mapping(pkg);if(await digest(bytesOf(bytes))!==input.template.sourceHash)fail('模板原件摘要不一致，请重新登记。');sameMapping(actual,input.template);
 const {byId,rows}=confirmed(input),files={...pkg.files},workbook=strFromU8(files['xl/workbook.xml']),rels=strFromU8(files['xl/_rels/workbook.xml.rels']);
 if(input.template.sheetName==='Terms')fail('原报价工作表名称不能为 Terms。');
 let relationId='rIdCustomerQuoteTerms',suffix=1;while(rels.includes('Id="'+relationId+'"')||rels.includes("Id='"+relationId+"'"))relationId='rIdCustomerQuoteTerms'+suffix++;
 const sheetId=Math.max(...[...workbook.matchAll(/\bsheetId=["'](\d+)["']/g)].map(m=>Number(m[1])))+1;
 files[pkg.worksheetPath]=strToU8(patchPrices(strFromU8(files[pkg.worksheetPath]),input.template.rowMappings,byId));
 files['xl/worksheets/customerQuoteTerms.xml']=strToU8(termsXml(rows));
 files['xl/workbook.xml']=strToU8(workbook.replace(/<\/(?:\w+:)?sheets>/,`<sheet name="Terms" sheetId="${sheetId}" r:id="${relationId}"/></sheets>`));
 files['xl/_rels/workbook.xml.rels']=strToU8(rels.replace(/<\/(?:\w+:)?Relationships>/,`<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/customerQuoteTerms.xml"/></Relationships>`));
 files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace(/<\/(?:\w+:)?Types>/,'<Override PartName="/xl/worksheets/customerQuoteTerms.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
 const result=zipSync(files,{level:6});await validateCustomerQuoteTemplateOutput(result,input);return result;
}
export async function validateCustomerQuoteTemplateOutput(bytes:Uint8Array|ArrayBuffer,input:CustomerQuoteTemplateExportInput):Promise<{valid:true;rowCount:number;itemCount:number}>{
 const pkg=open(bytes,true),actual=mapping(pkg);sameMapping(actual,input.template);const {byId,rows}=confirmed(input);
 for(const row of input.template.rowMappings){const cell=pkg.sheet[row.priceCell],expected=byId.get(row.itemId)!;if(!cell||cell.t!=='n'||cell.f||cell.v!==expected.unitPrice)fail(`客户文件 ${row.priceCell} 的价格与已确认版本不一致，请先修订并确认报价，不能直接覆盖归档。`);}
 const expected=XLSX.utils.aoa_to_sheet(rows),cells=(sheet:XLSX.WorkSheet)=>Object.keys(sheet).filter(k=>!k.startsWith('!')&&sheet[k].v!==undefined&&sheet[k].v!==null&&sheet[k].v!=='').sort().map(address=>({address,value:sheet[address].v}));
 if(!pkg.terms||!equal(cells(pkg.terms),cells(expected)))fail('客户文件 Terms 的币种、单位、数量或条款与已确认版本不一致，请先修订并确认报价。');
 return {valid:true,rowCount:actual.rowMappings.length,itemCount:actual.items.length};
}
