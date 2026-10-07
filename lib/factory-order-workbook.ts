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
 const e=clean(v?.sourceEnglish||o.extra?.['客户英文描述']),c=clean(v?.platingSpec||v?.chineseProcess),material=clean(v?.materialSpec||o.extra?.['板料规格']);
 const values=[index+1,o.drawing,o.extra?.['客户款号']||o.extra?.['客款号']||'',o.color,o.extra?.['系列']||(/胶|AC|combined/i.test(o.productType||'')?'COMBINED':'METAL'),o.extra?.['材质']||'',...englishParts.flatMap((a,i)=>[component(e,a),component(c,chineseParts[i])]),o.extra?.['板料英文']||material.replace(/^(胶圈|脚套)[:：]\s*/,''),o.extra?.['板料中文']||material,v?.lensSpec||o.lens,'',o.quantity,'副',o.requestedDate||'',o.specialRequirements||o.notes||'',e,v?.chineseProcess||'',material,v?.platingSpec||'',o.orderNo,o.customer,o.customerPO,o.id,o.version,v?.version||0,v?.status||'未建内部订单',o.extra?.['翻单参考']||'',o.batch||'',o.lens];
 return [...values,JSON.stringify(values.slice(6,30))];
}
export function inspectFactoryTemplate(bytes:ArrayBuffer){const book=openWorkbook(bytes);const name=book.SheetNames.includes('032R2')?'032R2':book.SheetNames.find(n=>{const s=book.Sheets[n];return clean(s.B20?.v)==='图纸编号'&&clean(s.D20?.v)==='色号';});if(!name)throw new AppError('模板须包含第20行的图纸编号、款号、色号及中英配对工艺列（032R2格式）。');const s=book.Sheets[name];if(!s.G20||!s.H20||!s.W20)throw new AppError('模板缺少中英文工艺列或大货数量列。');return {book,name};}
export function factoryWorkbook(orders:Order[],latest:Map<string,Entity>,template?:ArrayBuffer){
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
 xml=xml.replace(/<c\b([^>]*)\bt="s"([^>]*)>([\s\S]*?)<\/c>/g,(full,a,z,body)=>{const addr=(a+z).match(/r="([^"]+)"/)?.[1];return addr?xmlCell(addr,sourceSheet[addr]?.v||'',(a+z).match(/\bs="[^"]*"/)?.[0]?' '+(a+z).match(/\bs="[^"]*"/)![0]:''):full;});
 const oldRows=xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g)||[],sample=oldRows.find(r=>/^<row\b[^>]*\br="21"/.test(r))||'';
 const styles=new Map<string,string>();for(const cell of sample.match(/<c\b[^>]*>/g)||[]){const a=cell.match(/r="([A-Z]+)21"/)?.[1],s=cell.match(/\bs="[^"]*"/)?.[0];if(a&&s)styles.set(a,' '+s);}
 const ht='ht="'+Math.max(96,Number(sample.match(/\bht="([^"]*)"/)?.[1])||0)+'"';
 const retained=oldRows.filter(r=>Number(r.match(/\br="(\d+)"/)?.[1])<21).join('');
 const dynamic=rows.map((r,i)=>`<row r="${21+i}" ${ht} customHeight="1">${r.map((v,j)=>{const col=XLSX.utils.encode_col(j);return xmlCell(col+(21+i),v,styles.get(col)||styles.get('Z')||'');}).join('')}</row>`).join('')+`<row r="${footer}" ht="28" customHeight="1">${xmlCell('A'+footer,'合计',styles.get('A')||'')}${xmlCell('W'+footer,total,styles.get('W')||'')}</row>`;
 xml=xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,`<sheetData>${retained}${dynamic}</sheetData>`);
 // Preserve header pictures, column widths, styles and print settings; replace only order data.
 for(const [a,v] of Object.entries({A2:'中英文内部订单 / Bilingual Factory Order',B13:o.customer,Y13:o.orderNo,B14:'翻单',Y14:`客户 PO：${o.customerPO}；参考：${o.extra?.['翻单参考']||'待填写'}；待确认`,F16:'生产单（导出不代表下发）',U7:'',U8:'',U9:'',U10:''})){
  const re=new RegExp(`<c\\b[^>]*\\br="${a}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);const old=xml.match(re)?.[0],style=old?.match(/\bs="[^"]*"/)?.[0];const cell=xmlCell(a,v,style?' '+style:'');if(old)xml=xml.replace(re,cell);else xml=xml.replace(new RegExp(`(<row\\b[^>]*\\br="${a.match(/\d+/)![0]}"[^>]*>)`),'$1'+cell);
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
export function readFactoryRows(bytes:ArrayBuffer,context:{customer:string;orderNo:string;customerPO:string;reference:string}){
 const book=openWorkbook(bytes),name=book.SheetNames.find(n=>clean(book.Sheets[n].B20?.v)==='图纸编号'&&clean(book.Sheets[n].D20?.v)==='色号');if(!name)throw new AppError('请上传032R2格式或本页面导出的内部订单。');
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
