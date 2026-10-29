import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {DOCUMENT_LIMITS as limits,DocumentFormatError} from './document-formats.mjs';

const fail=(message,code='DOCUMENT_INVALID',status=422)=>{throw new DocumentFormatError(message,code,status);};
const ensure=(value,message,code,status)=>{if(!value)fail(message,code,status);};
const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',txt:'text/plain',md:'text/markdown'};
const textLimit=()=>fail('文档提取内容超过 120000 字符，请拆分后重试。','DOCUMENT_TEXT_LIMIT',413);
function filename(value){ensure(typeof value==='string'&&value.length>0&&value.length<=200&&!/[\\/\x00-\x1f\x7f:]/.test(value)&&value!=='.'&&value!=='..','文件名无效，请使用不包含路径的文件名。');return value;}
function cleanText(value){return value.replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\u0000','');}
function utfText(bytes){
 let encoding='utf-8';if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
 try{const value=new TextDecoder(encoding,{fatal:true}).decode(bytes);ensure(!/[\x00-\x08\x0b\x0e-\x1f]/.test(value),'文字文件包含无法识别的二进制内容。');return cleanText(value);}catch(error){if(error instanceof DocumentFormatError)throw error;fail('文字文件编码无效，请另存为 UTF-8 后上传。','DOCUMENT_ENCODING');}
}
function zipExtraCheck(bytes,start,length){
 const end=start+length;let cursor=start;
 while(cursor<end){
  ensure(cursor+4<=end,'Office 压缩扩展字段损坏。','DOCUMENT_ARCHIVE_INVALID');
  const kind=bytes.readUInt16LE(cursor),size=bytes.readUInt16LE(cursor+2);cursor+=4;
  ensure(cursor+size<=end&&kind!==0x0001,'Office 压缩扩展字段损坏或使用不支持的 ZIP64。','DOCUMENT_ARCHIVE_INVALID');cursor+=size;
 }
}
// Inspect ZIP metadata before a parser allocates inflated XML. Do not extract to disk.
function zipCheck(bytes,required){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}}
 ensure(end>=0,'Office 文件压缩结构损坏。','DOCUMENT_ARCHIVE_INVALID');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 ensure(!bytes.readUInt16LE(end+4)&&!bytes.readUInt16LE(end+6)&&count===bytes.readUInt16LE(end+8)&&count>0&&count<=5000&&offset+size===end,'Office 压缩包过大或不支持分卷、ZIP64 格式。','DOCUMENT_ARCHIVE_LIMIT',413);
 // SheetJS searches backwards for the last EOCD signature without validating
 // comment length. Do not let a signature in a comment select a different index.
 ensure(!bytes.subarray(end+22).includes(Buffer.from([0x50,0x4b,0x05,0x06])),'Office 压缩注释包含冲突索引。','DOCUMENT_ARCHIVE_INVALID');
 let cursor=offset,total=0;const names=new Set(),ranges=[];
 for(let i=0;i<count;i++){
  ensure(cursor+46<=end&&bytes.readUInt32LE(cursor)===0x02014b50,'Office 压缩目录无效。','DOCUMENT_ARCHIVE_INVALID');
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24),nameLen=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
  ensure(cursor+46+nameLen+extra+comment<=end&&local+30<=offset&&bytes.readUInt32LE(local)===0x04034b50,'Office 文件索引无效。','DOCUMENT_ARCHIVE_INVALID');
  const name=bytes.subarray(cursor+46,cursor+46+nameLen).toString('utf8');
  ensure(!(flags&0x2041)&&[0,8].includes(method)&&!bytes.readUInt16LE(cursor+34)&&!name.startsWith('/')&&!/[\\\x00:]/.test(name)&&!name.split('/').includes('..')&&!names.has(name),'Office 文件包含不支持的加密或压缩条目。','DOCUMENT_ARCHIVE_INVALID');
  const localNameLen=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28);
  ensure(bytes.subarray(local+30,local+30+localNameLen).toString('utf8')===name&&local+30+localNameLen+localExtra+compressed<=offset,'Office 文件条目边界无效。','DOCUMENT_ARCHIVE_INVALID');
  total+=expanded;ensure(expanded<=24*1024*1024&&total<=64*1024*1024&&expanded<=Math.max(1024*1024,compressed*1000),'Office 文件解压规模超过限制，请拆分文档。','DOCUMENT_ARCHIVE_LIMIT',413);
  // SheetJS trusts local headers and both local/central ZIP64 extra fields;
  // JSZip trusts central headers. Require the same bounded view for both.
  zipExtraCheck(bytes,cursor+46+nameLen,extra);zipExtraCheck(bytes,local+30+localNameLen,localExtra);
  const checksum=bytes.readUInt32LE(cursor+16),localChecksum=bytes.readUInt32LE(local+14),localCompressed=bytes.readUInt32LE(local+18),localExpanded=bytes.readUInt32LE(local+22),descriptor=!!(flags&8);
  ensure(bytes.readUInt16LE(local+6)===flags&&bytes.readUInt16LE(local+8)===method&&[checksum,...(descriptor?[0]:[])].includes(localChecksum)&&[compressed,...(descriptor?[0]:[])].includes(localCompressed)&&[expanded,...(descriptor?[0]:[])].includes(localExpanded),'Office 本地文件头与压缩目录不一致。','DOCUMENT_ARCHIVE_INVALID');
  const start=local+30+localNameLen+localExtra,packed=bytes.subarray(start,start+compressed);let unpacked;
  try{unpacked=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.max(1,expanded)});}catch{fail('Office 压缩条目损坏或实际解压大小超过声明限制。','DOCUMENT_ARCHIVE_INVALID');}
  ensure(unpacked.length===expanded&&crc32(unpacked)===checksum,'Office 压缩条目长度或校验值无效。','DOCUMENT_ARCHIVE_INVALID');
  let recordEnd=start+compressed;
  if(descriptor){
   ensure(recordEnd+12<=offset,'Office 压缩数据描述符缺失。','DOCUMENT_ARCHIVE_INVALID');
   if(bytes.readUInt32LE(recordEnd)===0x08074b50)recordEnd+=4;
   ensure(recordEnd+12<=offset&&bytes.readUInt32LE(recordEnd)===checksum&&bytes.readUInt32LE(recordEnd+4)===compressed&&bytes.readUInt32LE(recordEnd+8)===expanded,'Office 压缩数据描述符与目录不一致。','DOCUMENT_ARCHIVE_INVALID');recordEnd+=12;
  }
  ranges.push([local,recordEnd]);
  names.add(name);cursor+=46+nameLen+extra+comment;
 }
 ranges.sort((a,b)=>a[0]-b[0]);ensure(ranges.every((range,index)=>index===0||range[0]>=ranges[index-1][1]),'Office 压缩条目边界重叠。','DOCUMENT_ARCHIVE_INVALID');
 ensure(cursor===end&&names.has('[Content_Types].xml')&&names.has(required),'文件内容与 Office 扩展名不匹配。','DOCUMENT_FORMAT_MISMATCH');
 return names;
}
async function parse(input){
 const name=filename(input.filename),format=name.split('.').at(-1).toLowerCase(),bytes=Buffer.from(input.bytes);
 ensure(Object.hasOwn(types,format),'支持 PDF、DOCX、XLS/XLSX、CSV、TXT、MD 文档。','DOCUMENT_UNSUPPORTED',415);
 const mime=input.mimeType.split(';')[0].trim().toLowerCase();
 ensure([types[format],'','application/octet-stream',...(format==='md'?['text/plain','text/x-markdown']:[]),...(format==='csv'?['text/plain','application/vnd.ms-excel']:[])].includes(mime),'文件类型与扩展名不匹配。','DOCUMENT_FORMAT_MISMATCH',415);
 ensure(bytes.length&&bytes.length<=limits.inputBytes,'文件必须非空且不超过 10 MiB。','DOCUMENT_SIZE_LIMIT',413);
 const sections=[],warnings=[];let characters=0;
 const add=(source,text)=>{text=cleanText(text).trim();if(!text)return;characters+=text.length;if(characters>limits.characters)textLimit();sections.push({source,text});};
 if(format==='pdf'){
  ensure(bytes.subarray(0,1024).includes(Buffer.from('%PDF-')),'PDF 文件头无效。','DOCUMENT_FORMAT_MISMATCH');
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const resource=directory=>fileURLToPath(new URL('./node_modules/pdfjs-dist/'+directory+'/',import.meta.url)).replaceAll('\\','/');
  const task=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,enableXfa:false,verbosity:0,cMapUrl:resource('cmaps'),cMapPacked:true,standardFontDataUrl:resource('standard_fonts')});
  let document;
  try{
   document=await task.promise;ensure(document.numPages<=limits.pages,'PDF 超过 100 页，请拆分后上传。','DOCUMENT_PAGE_LIMIT',413);
   for(let number=1;number<=document.numPages;number++){
    const page=await document.getPage(number),content=await page.getTextContent();
    const text=content.items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
    add(`第 ${number} 页`,text);if(!text)warnings.push(`第 ${number} 页没有可提取文字，图片或扫描内容尚未读取。`);page.cleanup();
   }
   ensure(sections.length,'此 PDF 没有可读文字层，请先进行 OCR 或上传可复制文字的版本。','DOCUMENT_OCR_REQUIRED');
  }catch(error){if(error?.name==='PasswordException')fail('PDF 已加密，请先解密后上传。','DOCUMENT_ENCRYPTED');throw error;}finally{await task.destroy();}
 }else if(format==='docx'){
  zipCheck(bytes,'word/document.xml');const mammoth=(await import('mammoth')).default;
  const result=await mammoth.extractRawText({buffer:bytes});
  const paragraphs=result.value.split(/\n\s*\n/);for(let i=0;i<paragraphs.length;i++)add(`第 ${i+1} 段`,paragraphs[i]);
  if(result.messages.length)warnings.push('Word 解析器报告部分格式无法保留；仅提供可提取的正文。');
  warnings.push('Word 按正文段落提取；图片、页面布局和修订显示效果不在文本解析范围。');
 }else if(['xlsx','xls','csv'].includes(format)){
  if(format==='xlsx')zipCheck(bytes,'xl/workbook.xml');
  if(format==='xls')ensure(bytes.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])),'XLS 文件头无效，请使用真实的 Excel 工作簿。','DOCUMENT_FORMAT_MISMATCH');
  const XLSX=await import('xlsx');const book=XLSX.read(format==='csv'?utfText(bytes):bytes,{type:format==='csv'?'string':'buffer',dense:true,raw:true,cellFormula:true,cellHTML:false,cellText:true,sheetRows:limits.rows+1,bookVBA:false});
  ensure(book.SheetNames.length<=100,'工作簿超过 100 个工作表，请拆分后上传。','DOCUMENT_SHEET_LIMIT',413);let rows=0;
  for(const sheetName of book.SheetNames){
   const sheet=book.Sheets[sheetName];if(!sheet['!ref'])continue;
   const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
   ensure(range.e.r-range.s.r+1<=limits.rows&&range.e.c-range.s.c+1<=limits.columns,'表格超过 5000 行或 100 列，请拆分后上传。','DOCUMENT_ROW_LIMIT',413);
   for(let r=range.s.r;r<=range.e.r;r++){
    const cells=[];for(let c=range.s.c;c<=range.e.c;c++){
     const cell=sheet['!data']?.[r]?.[c]??sheet[r]?.[c]??sheet[XLSX.utils.encode_cell({r,c})];
     cells.push(cell?String(cell.w??cell.v??(cell.f?'[公式没有缓存结果，尚未计算]':'')):'');
    }
    if(cells.every(value=>!value))continue;
    ensure(++rows<=limits.rows,'工作簿累计超过 5000 行，请拆分后上传。','DOCUMENT_ROW_LIMIT',413);add(`工作表「${sheetName}」第 ${r+1} 行`,cells.join('\t'));
   }
  }
  warnings.push('表格只读取已有单元格值和公式缓存；不执行宏、公式或外部数据连接。无缓存的公式标注为尚未计算。');
 }else{
  const value=utfText(bytes);if(value.length>limits.characters)textLimit();let start=1;const lines=value.split('\n');let chunk=[];
  for(let i=0;i<lines.length;i++){chunk.push(lines[i]);if(chunk.join('\n').length>=4000||i===lines.length-1){add(`第 ${start}–${i+1} 行`,chunk.join('\n'));chunk=[];start=i+2;}}
 }
 ensure(sections.length,'文档中没有可提取的正文或单元格值。','DOCUMENT_EMPTY');
 const text=sections.map(section=>`[${section.source}]\n${section.text}`).join('\n\n');
 ensure(text.length<=limits.characters,'附带来源标记后的文档超过 120000 字符，请拆分后重试。','DOCUMENT_TEXT_LIMIT',413);
 return{filename:name,format,text,sections,characters:text.length,warnings};
}
function visibleCell(value){return String(value??'');}
function plainBlocks(title,blocks,markdown=false){
 const lines=[markdown?'# '+title:title];
 for(const block of blocks){
  if(block.type==='heading')lines.push(markdown?'#'.repeat(block.level)+' '+block.text:block.text);
  else if(block.type==='paragraph')lines.push(block.text);
  else{const rows=[block.headers,...block.rows];lines.push(rows.map((row,index)=>{const line=row.map(value=>visibleCell(value).replaceAll('\n',' '));return markdown?'| '+line.map(value=>value.replaceAll('|','\\|')).join(' | ')+' |'+(index===0?'\n| '+line.map(()=>'---').join(' | ')+' |':''):line.join('\t');}).join('\n'));}
 }
 return lines.join('\n\n')+'\n';
}
async function render(input){
 const {format,title,blocks}=input;ensure(['docx','xlsx','pdf','md','txt'].includes(format),'输出格式仅支持 DOCX、XLSX、PDF、MD、TXT。','DOCUMENT_UNSUPPORTED',415);
 ensure(title.trim()&&!/[\x00-\x08\x0b\x0e-\x1f]/.test(title),'文档标题无效。');let bytes;
 if(format==='txt'||format==='md')bytes=Buffer.from(plainBlocks(title,blocks,format==='md'));
 if(format==='docx'){
  const {Document,Paragraph,TextRun,Table,TableRow,TableCell,Packer,HeadingLevel,WidthType}=await import('docx');
  const paragraph=(text,heading)=>new Paragraph({children:[new TextRun({text,font:'Noto Sans CJK SC'})],...(heading?{heading}: {})});
  const children=[paragraph(title,HeadingLevel.TITLE)];for(const block of blocks){
   if(block.type==='heading')children.push(paragraph(block.text,HeadingLevel['HEADING_'+block.level]));
   else if(block.type==='paragraph')for(const line of block.text.split('\n'))children.push(paragraph(line));
   else children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[block.headers,...block.rows].map((row,index)=>new TableRow({tableHeader:index===0,children:row.map(value=>new TableCell({children:[paragraph(visibleCell(value))]}))}))}));
  }
  bytes=await Packer.toBuffer(new Document({creator:'DOON Agent',title,sections:[{children}],styles:{default:{document:{run:{font:'Noto Sans CJK SC',size:22},paragraph:{spacing:{after:120}}}}}}));
 }
 if(format==='xlsx'){
  const XLSX=await import('xlsx'),book=XLSX.utils.book_new();let index=0,notes=[[title]],totalRows=1;
  for(const block of blocks)totalRows+=block.type==='table'?block.rows.length+1:1;
  ensure(totalRows<=limits.rows,'生成工作簿累计超过 5000 行，请拆分内容。','DOCUMENT_ROW_LIMIT',413);
  for(const block of blocks){if(block.type==='table'){
   const sheet=XLSX.utils.aoa_to_sheet([block.headers,...block.rows]);sheet['!cols']=block.headers.map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,'表格'+(++index));
  }else notes.push([block.text]);}
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(notes),'说明');bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true});
 }
 if(format==='pdf'){
  const imported=await import('pdfkit'),PDFDocument=imported.default||imported.PDFDocument;
  const font=await fs.readFile(new URL('./assets/fonts/NotoSansCJKsc-Regular.otf',import.meta.url));
  ensure(createHash('sha256').update(font).digest('hex')==='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b','PDF 字体校验失败。','DOCUMENT_FONT_INVALID',500);
  const document=new PDFDocument({size:'A4',margin:48,info:{Title:title,Author:'DOON Agent'},compress:true});
  document.font(font);const available=new Set(document._font.font.characterSet);
  const content=plainBlocks(title,blocks);ensure([...content].every(char=>/\s/.test(char)||available.has(char.codePointAt(0))),'内容包含当前字体不支持的字符，请去掉特殊符号或选择 DOCX。','DOCUMENT_FONT_UNSUPPORTED');
  const chunks=[];let size=0,pages=1;
  const done=new Promise((resolve,reject)=>{document.on('data',chunk=>{size+=chunk.length;if(size>limits.outputBytes){document.destroy();reject(new DocumentFormatError('生成文件超过 10 MiB，请减少内容。','DOCUMENT_SIZE_LIMIT',413));}else chunks.push(chunk);});document.once('end',()=>resolve(Buffer.concat(chunks)));document.once('error',reject);});
  document.on('pageAdded',()=>{if(++pages>limits.pages)fail('生成 PDF 超过 100 页，请拆分内容。','DOCUMENT_PAGE_LIMIT',413);});
  document.fontSize(20).text(title).moveDown(.7);for(const block of blocks){
   if(block.type==='heading')document.fontSize(Math.max(12,19-block.level)).text(block.text).moveDown(.4);
   else if(block.type==='paragraph')document.fontSize(10).text(block.text,{lineGap:3}).moveDown(.6);
   else{document.fontSize(9);for(const row of [block.headers,...block.rows])document.text(row.map(visibleCell).join('  |  '),{lineGap:3});document.moveDown(.6);}
  }
  document.end();bytes=await done;
 }
 ensure(bytes?.length&&bytes.length<=limits.outputBytes,'生成文件超过 10 MiB，请减少内容。','DOCUMENT_SIZE_LIMIT',413);
 const stem=title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'文档';
 return{filename:stem+'.'+format,mimeType:types[format],bytes};
}
try{const value=workerData.operation==='parse'?await parse(workerData.input):await render(workerData.input);parentPort.postMessage({ok:true,value});}
catch(error){const safe=error instanceof DocumentFormatError?error:new DocumentFormatError('文档无法解析或生成，请检查文件格式、加密状态和内容。','DOCUMENT_PROCESSING_FAILED',422);parentPort.postMessage({ok:false,error:{message:safe.message,code:safe.code,status:safe.status}});}
