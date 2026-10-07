import * as XLSX from 'xlsx';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {clean,type Order,type Entity} from './domain';
import {AppError} from './store';
import {openWorkbook,sheetRows} from './workbooks';

// Same column order as the customer's 032R2 production order. Customer data is
// stored in the private file bucket, never bundled into the application.
export const factoryHeaders=['件号#','图纸编号','款号','色号','系列','材质',
 'Front + pad arm + end piece (female)','金属/烟斗杆/庄头',
 'end piece insert','庄头角花','Nose pad','叶子',
 'Temple','金脾','end tip insert - house','片仔底座',
 'end tip insert - cover','脾尾角花','Manchon / tip','胶脾',
 '主架镜片','销售办数量','大货数量','单位','要求交货期','备注',
 '客户英文原文','工厂中文工艺','板料规格','电镀规格','订单号','客户','客户 PO',
 '_明细编号','_订单版本','_内部订单版本','内部订单状态','翻单参考','交货批次','原订单镜片','_表格基线'];
const englishParts=[['Front + pad arm + end piece (female)'],['end piece insert'],['Nose pad'],['Temple','Temple (entire)','Temple (end piece male only)'],['end tip insert - house'],['end tip insert - cover','end tip insert']];
const chineseParts=[['前框+鼻臂+庄头母件','金属/烟斗杆/庄头'],['庄头嵌件','庄头角花'],['鼻托','叶子'],['整支镜腿','镜腿','金脾'],['脚套嵌件底座','片仔底座'],['脚套嵌件盖','脚套嵌件','脾尾角花']];
const esc=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const xmlCell=(address:string,value:unknown,style='')=>typeof value==='number'?`<c r="${address}"${style}><v>${value}</v></c>`:`<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
function component(text:string,aliases:string[]){for(const line of text.split(/\r?\n/)){const split=line.search(/[:：]/);if(split<0)continue;const label=line.slice(0,split).trim();if(aliases.some(a=>label.toLowerCase()===a.toLowerCase()))return line.slice(split+1).trim();}return '';}
export function factoryValues(o:Order,v:Entity|undefined,index:number){
 const e=clean(v?.sourceEnglish||o.extra?.['客户英文描述']),c=clean([v?.platingSpec,v?.chineseProcess].filter(Boolean).join('\n')),material=clean(v?.materialSpec||o.extra?.['板料规格']);
 const values=[index+1,o.drawing,o.extra?.['客户款号']||o.extra?.['客款号']||'',o.color,o.extra?.['系列']||(/胶|AC|combined/i.test(o.productType||'')?'COMBINED':'METAL'),o.extra?.['材质']||'',...englishParts.flatMap((a,i)=>[component(e,a),component(c,chineseParts[i])]),o.extra?.['板料英文']||material.replace(/^(胶圈|脚套)[:：]\s*/,''),o.extra?.['板料中文']||material,v?.lensSpec||o.lens,'',o.quantity,'副',o.requestedDate||'',o.specialRequirements||o.notes||'',e,v?.chineseProcess||'',material,v?.platingSpec||'',o.orderNo,o.customer,o.customerPO,o.id,o.version,v?.version||0,v?.status||'未建内部订单',o.extra?.['翻单参考']||'',o.batch||'',o.lens];
 return [...values,JSON.stringify(values.slice(6,30))];
}
export function inspectFactoryTemplate(bytes:ArrayBuffer){const book=openWorkbook(bytes);const name=book.SheetNames.includes('032R2')?'032R2':book.SheetNames.find(n=>{const s=book.Sheets[n];return clean(s.B20?.v)==='图纸编号'&&clean(s.D20?.v)==='色号';});if(!name)throw new AppError('模板须包含第20行的图纸编号、款号、色号及中英配对工艺列（032R2格式）。');const s=book.Sheets[name];if(!s.G20||!s.H20||!s.W20)throw new AppError('模板缺少中英文工艺列或大货数量列。');return {book,name};}
function pairedFactoryWorkbook(orders:Order[],latest:Map<string,Entity>,template?:ArrayBuffer){
 if(!orders.length)throw new AppError('请选择要导出的订单。');
 if(new Set(orders.map(o=>JSON.stringify([o.customer,o.orderNo,o.customerPO]))).size!==1)throw new AppError('整单导出须选择同一客户、内部订单号和客户 PO。');
 if(orders.length>500)throw new AppError('一份内部订单最多500条明细。');
 const parsedTemplate=template?inspectFactoryTemplate(template):undefined;
 const colorSheet=parsedTemplate?.book.Sheets['颜色'],colorRows=colorSheet?XLSX.utils.sheet_to_json<unknown[]>(colorSheet,{header:1}):[],colorMap=new Map(colorRows.filter(r=>r[2]&&r[3]).map(r=>[clean(r[2]),clean(r[3])]));
 const rows=orders.map((o,i)=>{let v=latest.get(o.id);if(parsedTemplate){const sheet=parsedTemplate.book.Sheets[parsedTemplate.name],model=clean(o.extra?.['客户款号']||o.extra?.['客款号']).replace(/\s/g,'');let extra={...o.extra};for(let r=21;r<=XLSX.utils.decode_range(sheet['!ref']||'A1').e.r+1;r++)if(model&&clean(sheet['C'+r]?.v).replace(/\s/g,'').split('-')[0]===model&&clean(sheet['D'+r]?.v)===o.color){const material=clean(v?.materialSpec).replace(/^(胶圈|脚套)[:：]\s*/,'');if(clean(sheet['S'+r]?.v)===material){extra['板料英文']=material;extra['板料中文']=clean(sheet['T'+r]?.v);}break;}o={...o,extra};
   // Only unconfirmed draft wording uses the supplied template's colour dictionary.
   // Reviewed versions retain the exact wording already approved in the system.
   if(v?.status==='待客服确认'&&colorMap.size){v={...v};for(const field of ['chineseProcess','platingSpec'])v[field]=clean(v[field]).split('\n').map((line:string)=>{const cut=line.search(/[:：]/);if(cut<0)return line;const label=line.slice(0,cut).trim(),index=chineseParts.findIndex(a=>a.includes(label));if(index<0)return line;const mapped=colorMap.get(component(clean(v!.sourceEnglish),englishParts[index]));return mapped?line.slice(0,cut+1)+mapped:line;}).join('\n');}
  }return factoryValues(o,v,i);}),o=orders[0];
 const total=orders.reduce((n,o)=>n+o.quantity,0),footer=20+rows.length+1;
 const sheet=XLSX.utils.aoa_to_sheet([...Array.from({length:19},()=>[] as unknown[]),factoryHeaders,...rows,['合计']]);sheet['W'+footer]={t:'n',v:total};
 sheet.A1={t:'s',v:'DOON EYEWEAR (HK) LIMITED'};sheet.A2={t:'s',v:'中英文内部订单 / Bilingual Factory Order'};sheet.A13={t:'s',v:'客户编号'};sheet.B13={t:'s',v:o.customer};sheet.U13={t:'s',v:'生产单号：'};sheet.Y13={t:'s',v:o.orderNo};sheet.A14={t:'s',v:'客户 PO'};sheet.B14={t:'s',v:o.customerPO};sheet.F16={t:'s',v:'生产单（导出不代表下发）'};sheet.Y14={t:'s',v:`翻单参考：${o.extra?.['翻单参考']||'待填写'}`};
 sheet['!cols']=factoryHeaders.map((_,i)=>({wch:i<6?15:i<20?24:22,hidden:i>=33&&i<=35||i>=39}));sheet['!autofilter']={ref:`A20:AO${20+rows.length}`};
 const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,sheet,'中英内部订单');
 if(!template)return XLSX.write(b,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
 const {book,name}=parsedTemplate!,files=unzipSync(new Uint8Array(template)),sourceSheet=book.Sheets[name];
 let workbook=strFromU8(files['xl/workbook.xml']),rels=strFromU8(files['xl/_rels/workbook.xml.rels']);
 const tags=workbook.match(/<sheet\b[^>]*\/?\s*>/g)||[],tag=tags.find(t=>t.includes(`name="${esc(name)}"`));if(!tag)throw new AppError('模板工作表关系无法读取。');
 const rid=tag.match(/r:id="([^"]+)"/)?.[1],relation=(rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`Id="${rid}"`)),target=relation?.match(/Target="([^"]+)"/)?.[1];if(!target)throw new AppError('模板工作表文件不存在。');
 const key=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');let xml=strFromU8(files[key]);
 // Resolve shared strings before removing the pool, which can contain old orders.
 xml=xml.replace(/<c\b[^>]*?\bt="s"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,full=>{const addr=full.match(/r="([^"]+)"/)?.[1],style=full.match(/\bs="[^"]*"/)?.[0];return addr?xmlCell(addr,sourceSheet[addr]?.v||'',style?' '+style:''):full;});
 const oldRows=xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)||[],sample=oldRows.find(r=>/^<row\b[^>]*\br="21"/.test(r))||'';
 const styles=new Map<string,string>();for(const cell of sample.match(/<c\b[^>]*>/g)||[]){const a=cell.match(/r="([A-Z]+)21"/)?.[1],s=cell.match(/\bs="[^"]*"/)?.[0];if(a&&s)styles.set(a,' '+s);}
 const ht='ht="'+Math.max(96,Number(sample.match(/\bht="([^"]*)"/)?.[1])||0)+'"';
 const retained=oldRows.filter(r=>Number(r.match(/\br="(\d+)"/)?.[1])<21).join('');
 const dynamic=rows.map((r,i)=>`<row r="${21+i}" ${ht} customHeight="1">${r.map((v,j)=>{const col=XLSX.utils.encode_col(j);return xmlCell(col+(21+i),v,styles.get(col)||styles.get('Z')||'');}).join('')}</row>`).join('')+`<row r="${footer}" ht="28" customHeight="1">${xmlCell('A'+footer,'合计',styles.get('A')||'')}${xmlCell('W'+footer,total,styles.get('W')||'')}</row>`;
 xml=xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,`<sheetData>${retained}${dynamic}</sheetData>`);
 // Preserve header pictures, column widths, styles and print settings; replace only order data.
 for(const [a,v] of Object.entries({A2:'中英文内部订单 / Bilingual Factory Order',B13:o.customer,Y13:o.orderNo,B14:'翻单',Y14:`客户 PO：${o.customerPO}；参考：${o.extra?.['翻单参考']||'待填写'}；待确认`,F16:'生产单（导出不代表下发）',U7:'',U8:'',U9:'',U10:''})){
  const re=new RegExp(`<c\\b[^>]*\\br="${a}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);const old=xml.match(re)?.[0],style=old?.match(/\bs="[^"]*"/)?.[0];const cell=xmlCell(a,v,style?' '+style:'');if(old)xml=xml.replace(re,cell);else xml=xml.replace(new RegExp(`(<row\\b[^>]*\\br="${a.match(/\d+/)![0]}"[^>]*>)`),'$1'+cell);
 }
 // Add round-trip columns to the existing header without changing its paired labels.
 xml=xml.replace(/(<row\b[^>]*\br="20"[^>]*>)([\s\S]*?)(<\/row>)/,(_,a,body,z)=>a+body.replace(/<c\b[^>]*\br="(?:AA|AB|AC|AD|AE|AF|AG|AH|AI|AJ|AK|AL|AM|AN|AO)20"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,'')+factoryHeaders.slice(26).map((v,i)=>xmlCell(XLSX.utils.encode_col(26+i)+'20',v)).join('')+z);
 xml=xml.replace(/<dimension[^>]*\/>/,`<dimension ref="A1:AO${footer}"/>`).replace(/<autoFilter\b[^>]*\/>|<autoFilter\b[^>]*>[\s\S]*?<\/autoFilter>/g,'').replace(/<sheetProtection\b[^>]*\/>/g,'').replace(/<mergeCell\b[^>]*ref="[^"]+"[^>]*\/>/g,t=>{const range=t.match(/ref="([^"]+)"/)?.[1]||'';return Math.max(...(range.match(/\d+/g)||[]).map(Number))>20?'':t;}).replace(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/g,(_,body)=>`<mergeCells count="${(body.match(/<mergeCell\b/g)||[]).length}">${body}</mergeCells>`).replace(/<legacyDrawing\b[^>]*\/>/g,'').replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g,'').replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/g,'');
 xml=xml.replace(/<cols>([\s\S]*?)<\/cols>/,(_,body)=>'<cols>'+body.replace(/<col\b[^>]*\/>/g,(col:string)=>{const min=Number(col.match(/min="(\d+)"/)?.[1]),max=Number(col.match(/max="(\d+)"/)?.[1]);return min>26?'':max>26?col.replace(/max="\d+"/,'max="26"'):col;})+'<col min="27" max="33" width="32" customWidth="1"/><col min="34" max="36" width="18" customWidth="1" hidden="1"/><col min="37" max="39" width="20" customWidth="1"/><col min="40" max="41" width="20" customWidth="1" hidden="1"/></cols>');
 files[key]=strToU8(xml);workbook=workbook.replace(/<sheets>[\s\S]*?<\/sheets>/,`<sheets>${tag.replace(/name="[^"]*"/,'name="中英内部订单"')}</sheets>`).replace(/<definedNames>[\s\S]*?<\/definedNames>/g,'').replace(/<externalReferences>[\s\S]*?<\/externalReferences>/g,'').replace(/activeTab="\d+"/g,'activeTab="0"').replace(/firstSheet="\d+"/g,'firstSheet="0"').replace('</sheets>',`</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'中英内部订单'!$A$1:$Z$${footer}</definedName></definedNames>`);files['xl/workbook.xml']=strToU8(workbook);
 rels=rels.replace(/<Relationship\b[^>]*\/?\s*>/g,t=>/\/(worksheet|sharedStrings|calcChain)"/.test(t)&&!t.includes(`Id="${rid}"`)?'':t);files['xl/_rels/workbook.xml.rels']=strToU8(rels);
 // Keep only the selected sheet's relationship graph. Unreferenced worksheets,
 // comments, caches and shared strings must not leak historical order contents.
 const normalize=(path:string)=>{const parts:string[]=[];for(const p of path.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');};
 for(const p of Object.keys(files).filter(p=>p.endsWith('.rels'))){files[p]=strToU8(strFromU8(files[p]).replace(/<Relationship\b[^>]*\/?\s*>/g,t=>/TargetMode="External"/.test(t)||/\/(comments|vmlDrawing|calcChain|sharedStrings|externalLink|core-properties|extended-properties)"/.test(t)?'':t));}
 const reachable=new Set(['[Content_Types].xml']);const visit=(p:string)=>{if(reachable.has(p)||!files[p])return;reachable.add(p);const slash=p.lastIndexOf('/'),rel=p==='__root'?'_rels/.rels':p.slice(0,slash+1)+'_rels/'+p.slice(slash+1)+'.rels';if(!files[rel])return;reachable.add(rel);for(const t of strFromU8(files[rel]).match(/<Relationship\b[^>]*\/?\s*>/g)||[]){const target=t.match(/Target="([^"]+)"/)?.[1];if(target)visit(target.startsWith('/')?target.slice(1):normalize(p.slice(0,slash+1)+target));}};
 // OOXML package root has a special relationships filename.
 if(files['_rels/.rels']){reachable.add('_rels/.rels');for(const t of strFromU8(files['_rels/.rels']).match(/<Relationship\b[^>]*\/?\s*>/g)||[]){const target=t.match(/Target="([^"]+)"/)?.[1];if(target)visit(normalize(target));}}
 visit('xl/workbook.xml');for(const p of Object.keys(files))if(!reachable.has(p))delete files[p];
 files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace(/<Override\b[^>]*\/?\s*>/g,t=>{const p=t.match(/PartName="\/([^"]+)"/)?.[1];return p&&!files[p]?'':t;}));
 const bytes=zipSync(files);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
}
function readPairedFactoryRows(book:XLSX.WorkBook,name:string,context:{customer:string;orderNo:string;customerPO:string;reference:string}){
 const {headers,body,sheet}=sheetRows(book,name,20);const h=(r:unknown[],name:string)=>clean(r[headers.indexOf(name)]);
 const rows=body.filter(r=>clean(r.values[1])&&clean(r.values[3])).map(r=>{if(r.values.some((_,i)=>sheet[XLSX.utils.encode_cell({r:r.index-1,c:i})]?.f))throw new AppError(`第${r.index}行含公式，请先将明细粘贴为值。`);const v=r.values;
  let raw=h(v,'客户英文原文')||[6,8,10,12,14,16].map(i=>`${factoryHeaders[i]}: ${clean(v[i])}`).join('\n'),plating=h(v,'电镀规格')||[7,9,11,13,15,17].map(i=>`${chineseParts[(i-7)/2][0]}：${clean(v[i])}`).filter(x=>!x.endsWith('：')).join('\n'),process=h(v,'工厂中文工艺')||plating,material=h(v,'板料规格')||[clean(v[18]),clean(v[19])].filter(Boolean).join('；');
  const baseline=h(v,'_表格基线');if(baseline){let base:unknown[];try{base=JSON.parse(baseline);if(!Array.isArray(base)||base.length!==24)throw new Error();}catch{throw new AppError(`第${r.index}行表格基线损坏，请重新导出。`);}
   const replacePart=(text:string,aliases:string[],value:string)=>{let found=false;const lines=text.split('\n').map(line=>{const cut=line.search(/[:：]/);if(cut>=0&&aliases.includes(line.slice(0,cut).trim())){found=true;return line.slice(0,cut+1)+value;}return line;});if(!found)lines.push(aliases[0]+': '+value);return lines.join('\n');};
   for(let i=0;i<6;i++){const ec=6+2*i,cc=ec+1;if(clean(v[ec])!==clean(base[ec-6]))raw=replacePart(raw,englishParts[i],clean(v[ec]));if(clean(v[cc])!==clean(base[cc-6])){plating=replacePart(plating,chineseParts[i],clean(v[cc]));process=replacePart(process,chineseParts[i],clean(v[cc]));}}
   if(clean(v[18])!==clean(base[12])||clean(v[19])!==clean(base[13]))material=[clean(v[18]),clean(v[19])].filter(Boolean).join('；');
  }
  return {index:r.index,lineId:h(v,'_明细编号'),orderVersion:h(v,'_订单版本'),factoryVersion:h(v,'_内部订单版本'),orderNo:h(v,'订单号')||context.orderNo,customer:h(v,'客户')||context.customer,customerPO:h(v,'客户 PO')||context.customerPO,drawing:clean(v[1]),color:clean(v[3]),quantity:Number(v[22]),lens:h(v,'原订单镜片')||clean(v[20]),requestedDate:clean(v[24]),batch:h(v,'交货批次'),extra:{'客户款号':clean(v[2]),'系列':clean(v[4]),'材质':clean(v[5]),'翻单参考':h(v,'翻单参考')||context.reference},sourceEnglish:raw,chineseProcess:process,materialSpec:material,platingSpec:plating,lensSpec:clean(v[20]),notes:clean(v[25])};});
 if(!rows.length||rows.length>500)throw new AppError('工作表须有1至500条大货明细。');return rows;
}

const languageNames=['中文订单','英文订单'] as const;
const englishHeaders=['Item #','Drawing No.','Model','Color','Series','Material',
 ...factoryHeaders.slice(6,20),'Lenses','Sales samples','Bulk quantity','Unit','Requested delivery','Remarks',
 'Customer specification','Chinese process','Material specification','Plating specification','Order No.','Customer','Customer PO',
 '_Line ID','_Order version','_Factory version','Order status','Repeat-order reference','Delivery batch','_Original lenses','_Table baseline'];
const englishLens=(s:string)=>s.replace(/白片[（(]按历史同款暂列[，,]客户原表未注明[，,]待确认[）)]/g,'Clear lenses (provisional per prior order; not specified by customer; pending confirmation)')
 .replace(/白片[（(]客户原表未注明[，,]待确认[）)]/g,'Clear lenses (not specified by customer; pending confirmation)').replace(/^白片$/,'Clear lenses');
const englishNotes=(s:string)=>s.replaceAll('待用户确认后才可下发','Release only after customer-service approval')
 .replaceAll('客户未提供交期','Delivery date not provided by customer')
 .replace(/图号按现有 Concept6 大货对应[，,]版本待工程复核。/g,'Drawing numbers follow the existing Concept6 production order; revisions pending engineering review.')
 .replace(/客户原表 (\w+\d+)=([^，,]+)[，,](\w+\d+) 描述=([^，,]+)[，,]色号待确认。/g,'Customer source: $1=$2; $3 description=$4. Color code pending confirmation.')
 .replaceAll('；','; ');
const englishStatus=(s:string)=>({'待客服确认':'Pending customer-service approval','待PMC补图':'Pending PMC material/image review','待PMC确认':'Pending PMC approval','待下发工厂':'Pending factory release','已下发工厂':'Released to factory','未建内部订单':'No factory order'}[s]||s);

function setXmlCell(xml:string,address:string,value:unknown){
 const re=new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`),old=xml.match(re)?.[0],style=old?.match(/\bs="[^"]*"/)?.[0];
 const cell=xmlCell(address,value,style?' '+style:'');
 return old?xml.replace(re,cell):xml.replace(new RegExp(`(<row\\b[^>]*\\br="${address.match(/\d+/)![0]}"[^>]*>)`),'$1'+cell);
}
const packagePath=(p:string)=>{const parts:string[]=[];for(const v of p.split('/')){if(v==='..')parts.pop();else if(v&&v!=='.')parts.push(v);}return parts.join('/');};
const relationPath=(p:string)=>{const slash=p.lastIndexOf('/');return p.slice(0,slash+1)+'_rels/'+p.slice(slash+1)+'.rels';};

function embedHeaderCellImages(files:Record<string,Uint8Array>,sheetPath:string){
 if(!files['xl/cellimages.xml']||!files['xl/_rels/cellimages.xml.rels'])return;
 let xml=strFromU8(files[sheetPath]);const pictures=strFromU8(files['xl/cellimages.xml']).match(/<xdr:pic\b[^>]*>[\s\S]*?<\/xdr:pic>/g)||[];
 const imageRels=strFromU8(files['xl/_rels/cellimages.xml.rels']),sourceRels=relationPath(sheetPath);
 let sheetRels=files[sourceRels]?strFromU8(files[sourceRels]):'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
 const drawingRelation=(sheetRels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>/\/drawing"/.test(t)),target=drawingRelation?.match(/Target="([^"]+)"/)?.[1];
 const drawingPath=target?(target.startsWith('/')?target.slice(1):packagePath(sheetPath.slice(0,sheetPath.lastIndexOf('/')+1)+target)):'xl/drawings/factory-'+sheetPath.slice(sheetPath.lastIndexOf('/')+1);
 let drawing=files[drawingPath]?strFromU8(files[drawingPath]):'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"></xdr:wsDr>';
 let drawingRels=files[relationPath(drawingPath)]?strFromU8(files[relationPath(drawingPath)]):'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
 let pictureId=Math.max(0,...(drawing.match(/<xdr:cNvPr\b[^>]*\bid="\d+"/g)||[]).map(s=>Number(s.match(/id="(\d+)"/)?.[1]))),added=0;
 const columns=xml.match(/<col\b[^>]*\/>/g)||[];
 const pictureRows=new Set((xml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)||[]).filter(c=>/<f\b[^>]*>[\s\S]*?DISPIMG\(/i.test(c)).map(c=>Number(c.match(/r="[A-Z]+(\d+)"/)?.[1])).filter(r=>r<=20));
 xml=xml.replace(/<row\b[^>]*>/g,t=>{if(!pictureRows.has(Number(t.match(/\br="(\d+)"/)?.[1])))return t;const height=Math.max(72,Number(t.match(/\bht="([^"]+)"/)?.[1]||0));return t.replace(/\s+(?:ht|customHeight)="[^"]*"/g,'').replace(/>$/,` ht="${height}" customHeight="1">`);});
 xml=xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{
  const address=cell.match(/r="([A-Z]+)(\d+)"/),formula=cell.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1],imageName=formula?.match(/(?:_xlfn\.)?DISPIMG\((?:&quot;|")([^"&]+)(?:&quot;|")/i)?.[1];
  if(!address||Number(address[2])>20||!imageName)return cell;
  const pic=pictures.find(p=>p.includes(`name="${imageName}"`));if(!pic)throw new AppError('模板的部件图片缺失，无法生成 Excel。');
  const col=XLSX.utils.decode_col(address[1]),row=Number(address[2])-1,column=columns.find(c=>Number(c.match(/min="(\d+)"/)?.[1])<=col+1&&Number(c.match(/max="(\d+)"/)?.[1])>=col+1);
  const style=cell.match(/\bs="[^"]*"/)?.[0],blank=xmlCell(address[1]+address[2],'',style?' '+style:'');
  if(column?.includes('hidden="1"'))return blank;
  const embed=pic.match(/r:embed="([^"]+)"/)?.[1],imageRelation=(imageRels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`Id="${embed}"`)),imageTarget=imageRelation?.match(/Target="([^"]+)"/)?.[1];
  if(!imageTarget)throw new AppError('模板的部件图片关系缺失。');const asset=imageTarget.startsWith('/')?imageTarget.slice(1):packagePath('xl/'+imageTarget);if(!files[asset])throw new AppError('模板的部件图片文件缺失。');
  const width=Math.max(20,Number(column?.match(/width="([^"]+)"/)?.[1]||15)*7),rowXml=xml.match(new RegExp(`<row\\b[^>]*\\br="${row+1}"[^>]*>`))?.[0],height=Math.max(20,Number(rowXml?.match(/ht="([^"]+)"/)?.[1]||72)*4/3);
  const ext=pic.match(/<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/),ratio=Number(ext?.[1]||1)/Number(ext?.[2]||1),fitWidth=Math.min(width-8,(height-8)*ratio),fitHeight=fitWidth/ratio;
  const cx=Math.round(fitWidth*9525),cy=Math.round(fitHeight*9525),rid=`rIdFactoryCellImage${++added}`;
  const picture=pic.replace(/<xdr:cNvPr\b[^>]*\bid="\d+"/,m=>m.replace(/id="\d+"/,`id="${++pictureId}"`)).replace(/r:embed="[^"]+"/,`r:embed="${rid}"`)
   .replace(/name="[^"]+"/,`name="Factory-${sheetPath.slice(sheetPath.lastIndexOf('/')+1)}-${imageName}"`)
   .replace(/<a:off\b[^>]*\/>/,'<a:off x="0" y="0"/>').replace(/<a:ext\b[^>]*\/>/,`<a:ext cx="${cx}" cy="${cy}"/>`);
  const anchor=`<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${Math.round((width-fitWidth)/2*9525)}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${Math.round((height-fitHeight)/2*9525)}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>${picture}<xdr:clientData/></xdr:oneCellAnchor>`;
  drawing=drawing.replace(/<\/(?:xdr:)?wsDr>/,anchor+'$&');drawingRels=drawingRels.replace('</Relationships>',`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/${asset}"/></Relationships>`);
  return blank;
 });
 if(added){
  if(drawingRelation)sheetRels=sheetRels.replace(drawingRelation,drawingRelation.replace(/Target="[^"]+"/,`Target="/${drawingPath}"`));
  if(!drawingRelation){sheetRels=sheetRels.replace('</Relationships>',`<Relationship Id="rIdFactoryPictures" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/${drawingPath}"/></Relationships>`);xml=xml.replace('</worksheet>','<drawing r:id="rIdFactoryPictures"/></worksheet>');}
  drawing=drawing.replace(/<(?:xdr:)?wsDr\b[^>]*>/,t=>{for(const [prefix,uri] of [['xdr','http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'],['a','http://schemas.openxmlformats.org/drawingml/2006/main'],['r','http://schemas.openxmlformats.org/officeDocument/2006/relationships']])if(!t.includes(`xmlns:${prefix}=`))t=t.replace(/>$/,` xmlns:${prefix}="${uri}">`);return t;});
  files[drawingPath]=strToU8(drawing);files[relationPath(drawingPath)]=strToU8(drawingRels);files[sourceRels]=strToU8(sheetRels);
  let types=strFromU8(files['[Content_Types].xml']);if(!types.includes(`PartName="/${drawingPath}"`))types=types.replace('</Types>',`<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);files['[Content_Types].xml']=strToU8(types);
 }
 files[sheetPath]=strToU8(xml);
}

// Each language uses the supplied template's own columns and pictures. Hiding
// counterpart/round-trip columns retains the original anchors and row identity.
// The two sheets remain independently editable without creating duplicate orders.
export function factoryWorkbook(orders:Order[],latest:Map<string,Entity>,template?:ArrayBuffer){
 const paired=pairedFactoryWorkbook(orders,latest,template),book=openWorkbook(paired),source=book.Sheets[book.SheetNames[0]],files=unzipSync(new Uint8Array(paired));
 let workbook=strFromU8(files['xl/workbook.xml']),rels=strFromU8(files['xl/_rels/workbook.xml.rels']);
 const tag=workbook.match(/<sheet\b[^>]*\/?\s*>/)?.[0]!,rid=tag.match(/r:id="([^"]+)"/)?.[1];
 const relation=(rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`Id="${rid}"`))!,target=relation.match(/Target="([^"]+)"/)?.[1]!;
 const key=target.startsWith('/')?target.slice(1):packagePath('xl/'+target),second='xl/worksheets/factory-english.xml',sourceXml=strFromU8(files[key]);
 const footer=21+orders.length,technical=[33,34,35,39,40];
 for(const [language,name] of languageNames.entries()){
  let xml=sourceXml;const hidden=new Set([...technical,...(language?[7,9,11,13,15,17,19,27,28,29]:[6,8,10,12,14,16,18,26])]);
  xml=xml.replace(/<sheetView\b[^>]*>/g,t=>t.replace(/\s+tabSelected="[^"]*"/g,'').replace(/\/?\s*>$/,`${language?'':' tabSelected="1"'}${t.endsWith('/>')?'/>':'>'}`));
  const oldCols=xml.match(/<cols>([\s\S]*?)<\/cols>/)?.[1]||'',cols=factoryHeaders.map((_,i)=>{
   const original=(oldCols.match(/<col\b[^>]*\/>/g)||[]).find(c=>Number(c.match(/min="(\d+)"/)?.[1])<=i+1&&Number(c.match(/max="(\d+)"/)?.[1])>=i+1);
   const width=Math.max(Number(original?.match(/width="([^"]+)"/)?.[1]||String(i<6?15:i<20?24:22)),i===20?25:i===25?55:0);
   return `<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"${hidden.has(i)?' hidden="1"':''}/>`;
  }).join('');
  xml=oldCols?xml.replace(/<cols>[\s\S]*?<\/cols>/,`<cols>${cols}</cols>`):xml.replace('<sheetData>',`<cols>${cols}</cols><sheetData>`);
  for(let i=0;i<factoryHeaders.length;i++){
   // Keep the template's detailed part numbers and screw specifications.
   const header=i>=6&&i<20?source[XLSX.utils.encode_col(i)+'20']?.v:(language?englishHeaders[i]:factoryHeaders[i]);
   xml=setXmlCell(xml,XLSX.utils.encode_col(i)+'20',header||factoryHeaders[i]);
  }
  const o=orders[0];
  const headerValues=language?{A2:'Factory Order',A3:'Bill To:',AC3:'Sold-To-Party:',A4:'Address:',A5:'ATTN:',A6:'Tel:',A7:'Ship To:',A8:'Address:',A9:'ATTN:',A10:'Tel:',A12:'Order details',A13:'Customer',C13:'Customer grade',U13:'Order No.',A14:'Order type',B14:'Repeat order',C14:'Quality grade',F16:'Factory Order (export does not release order)',Y14:`Customer PO: ${o.customerPO}; Reference: ${o.extra?.['翻单参考']||'Pending'}`}:
   {A2:'中文内部订单',A3:'账单客户：',AC3:'订购客户：',A4:'地址：',A5:'联系人：',A6:'电话：',A7:'收货地址：',A8:'地址：',A9:'联系人：',A10:'电话：',A12:'订单明细',A13:'客户编号',C13:'客户等级',U13:'生产单号：',A14:'订单类型',B14:'翻单',C14:'品质等级',F16:'生产单（导出不代表下发）',Y14:`客户 PO：${o.customerPO}；参考：${o.extra?.['翻单参考']||'待填写'}`};
  for(const [a,v] of Object.entries(headerValues))xml=setXmlCell(xml,a,v);
  for(let r=21;r<footer;r++)if(language){
   for(const [col,value] of Object.entries({U:englishLens(clean(source['U'+r]?.v)),X:'pairs',Z:englishNotes(clean(source['Z'+r]?.v)),AK:englishStatus(clean(source['AK'+r]?.v))}))xml=setXmlCell(xml,col+r,value);
  }
  xml=setXmlCell(xml,'A'+footer,language?'Total':'合计');
  files[language?second:key]=strToU8(xml);
 }
 // A drawing part belongs to one worksheet. Clone drawing XML and its relations;
 // embedded image assets can be shared by both sheets.
 const sourceRel=relationPath(key);let contentTypes=strFromU8(files['[Content_Types].xml']);
 if(files[sourceRel]){
  let cloned=strFromU8(files[sourceRel]);
  cloned=cloned.replace(/<Relationship\b[^>]*\/?\s*>/g,t=>{
   if(!/\/drawing"/.test(t))return t;const original=t.match(/Target="([^"]+)"/)?.[1]!;
   const drawing=original.startsWith('/')?original.slice(1):packagePath(key.slice(0,key.lastIndexOf('/')+1)+original),copy='xl/drawings/factory-english-'+drawing.slice(drawing.lastIndexOf('/')+1);
   files[copy]=strToU8(strFromU8(files[drawing]).replace(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g,(t,n)=>t.replace(/id="\d+"/,`id="${10000+Number(n)}"`)));if(files[relationPath(drawing)])files[relationPath(copy)]=files[relationPath(drawing)];
   const type=(contentTypes.match(/<Override\b[^>]*\/?\s*>/g)||[]).find(v=>v.includes(`PartName="/${drawing}"`));
   if(type)contentTypes=contentTypes.replace('</Types>',type.replace(`PartName="/${drawing}"`,`PartName="/${copy}"`)+'</Types>');
   return t.replace(/Target="[^"]+"/,`Target="/${copy}"`);
  });files[relationPath(second)]=strToU8(cloned);
 }
 const newRid='rIdFactoryEnglish';
 rels=rels.replace('</Relationships>',`<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/factory-english.xml"/></Relationships>`);
 workbook=workbook.replace(/<sheets>[\s\S]*?<\/sheets>/,`<sheets>${tag.replace(/name="[^"]*"/,'name="中文订单"')}<sheet name="英文订单" sheetId="${Number(tag.match(/sheetId="(\d+)"/)?.[1]||1)+1}" r:id="${newRid}"/></sheets>`)
  .replace(/<definedNames>[\s\S]*?<\/definedNames>/g,'').replace('</sheets>',`</sheets><definedNames>${languageNames.map((n,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${n}'!$A$1:$Z$${footer}</definedName>`).join('')}</definedNames>`);
 contentTypes=contentTypes.replace('</Types>','<Override PartName="/xl/worksheets/factory-english.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
 files['xl/workbook.xml']=strToU8(workbook);files['xl/_rels/workbook.xml.rels']=strToU8(rels);files['[Content_Types].xml']=strToU8(contentTypes);
 embedHeaderCellImages(files,key);embedHeaderCellImages(files,second);
 const bytes=zipSync(files);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
}

export function readFactoryRows(bytes:ArrayBuffer,context:{customer:string;orderNo:string;customerPO:string;reference:string}){
 const book=openWorkbook(bytes),names=languageNames.filter(n=>book.SheetNames.includes(n));
 if(!names.length){const legacy=book.SheetNames.find(n=>clean(book.Sheets[n].B20?.v)==='图纸编号'&&clean(book.Sheets[n].D20?.v)==='色号');if(!legacy)throw new AppError('请上传032R2格式或本页面导出的中文订单、英文订单。');return readPairedFactoryRows(book,legacy,context);}
 const parsed=names.map(name=>{
  const sheet=book.Sheets[name];if(clean(sheet.B20?.v)!==(name==='英文订单'?'Drawing No.':'图纸编号')||!sheet.W20)throw new AppError(`${name}的表头不完整，请重新导出。`);
  const last=XLSX.utils.decode_range(sheet['!ref']||'A1').e.r+1;
  if(name==='英文订单')for(let r=21;r<=last;r++){
   const baseline=clean(sheet['AO'+r]?.v);if(!baseline)continue;let base:unknown[];try{base=JSON.parse(baseline);}catch{throw new AppError(`英文订单第${r}行表格基线损坏，请重新导出。`);}
   if(Array.isArray(base))for(const [col,index,translate] of [['U',14,englishLens],['Z',19,englishNotes]] as const){const cell=sheet[col+r];if(cell&&!cell.f&&clean(cell.v)===translate(clean(base[index]))){cell.v=base[index] as string;delete cell.w;}}
  }
  // Translate labels in memory only; both export variants retain the canonical
  // column addresses and hidden original values used by the existing importer.
  factoryHeaders.forEach((h,i)=>sheet[XLSX.utils.encode_col(i)+'20']={t:'s',v:h});
  return {name,rows:readPairedFactoryRows(book,name,context)};
 });
 if(parsed.length===1)return parsed[0].rows;
 const key=(r:typeof parsed[number]['rows'][number])=>r.lineId||JSON.stringify([r.customer,r.orderNo,r.customerPO,r.drawing,r.color,r.lens,r.batch]);
 const maps=parsed.map(p=>{const m=new Map<string,typeof p.rows[number]>();for(const r of p.rows){if(m.has(key(r)))throw new AppError(`${p.name}含重复订单明细，请核对。`);m.set(key(r),r);}return m;});
 if(maps[0].size!==maps[1].size||[...maps[0].keys()].some(k=>!maps[1].has(k)))throw new AppError('中文订单与英文订单的明细不一致，请核对后再导入。');
 return [...maps[0]].map(([id,cn])=>{
  const en=maps[1].get(id)!;
  if(cn.materialSpec!==en.materialSpec)throw new AppError(`中文订单与英文订单第${cn.index}行的板料规格不一致，请同步核对两表，或单独导入修改后的子表。`);
  for(const f of ['orderNo','customer','customerPO','drawing','color','quantity','lens','requestedDate','batch','orderVersion','factoryVersion','lensSpec','notes'] as const)if(cn[f]!==en[f])throw new AppError(`中文订单与英文订单第${cn.index}行的${{quantity:'数量',lensSpec:'镜片规格',notes:'备注'}[f as string]||f}不一致，请核对后再导入。`);
  if(JSON.stringify(cn.extra)!==JSON.stringify(en.extra))throw new AppError(`中文订单与英文订单第${cn.index}行的款号、系列、材质或参考订单不一致。`);
  return {...cn,sourceEnglish:en.sourceEnglish};
 });
}
