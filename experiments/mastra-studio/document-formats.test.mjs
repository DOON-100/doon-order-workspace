import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {parseDocument,renderDocument,DOCUMENT_LIMITS} from './document-formats.mjs';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

const blocks=[{type:'heading',level:1,text:'核验结果'},{type:'paragraph',text:'合成数据，仅供测试。第二行\n换行内容。'},{type:'table',headers:['项目','数量','状态'],rows:[['测试镜框',12,true],['=SUM(A1:A2)',3.5,null]]}];
const generate=format=>renderDocument({format,title:'中文合成报告',blocks});
const checkError=code=>error=>error.code===code&&typeof error.status==='number';
async function pdfFixture(pages,{blank=false}={}){
 const document=new PDFDocument({autoFirstPage:false}),chunks=[];
 const done=new Promise((resolve,reject)=>{document.on('data',chunk=>chunks.push(chunk));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);});
 for(let page=1;page<=pages;page++){document.addPage();if(!blank)document.text('Synthetic page '+page);}
 document.end();return done;
}

test('text and Markdown preserve Chinese text and explicit source positions',async()=>{
 for(const format of ['txt','md']){const output=await generate(format),parsed=await parseDocument(output);assert(parsed.text.includes('测试镜框'));assert(parsed.text.includes('换行内容'));assert.match(parsed.sections[0].source,/第 1–\d+ 行/);assert.equal(parsed.characters,parsed.text.length);}
 const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('合成 UTF16 文件','utf16le')]);assert((await parseDocument({filename:'编码.txt',mimeType:'text/plain',bytes:utf16})).text.includes('合成'));
});
test('DOCX round trip preserves Unicode and table values',async()=>{
 const output=await generate('docx');assert(output.bytes.subarray(0,2).equals(Buffer.from('PK')));
 const parsed=await parseDocument(output);assert(parsed.text.includes('中文合成报告'));assert(parsed.text.includes('测试镜框'));assert(parsed.text.includes('12'));assert(parsed.sections.every(section=>/^第 \d+ 段$/.test(section.source)));
});
test('XLSX generation writes typed values and formula-like strings as inert text',async()=>{
 const output=await generate('xlsx'),book=XLSX.read(output.bytes,{type:'buffer'}),table=book.Sheets['表格1'];
 assert.equal(table.B2.v,12);assert.equal(table.B2.t,'n');assert.equal(table.C2.v,true);assert.equal(table.A3.v,'=SUM(A1:A2)');assert.equal(table.A3.t,'s');assert.equal(table.A3.f,undefined);
 const parsed=await parseDocument(output);assert(parsed.text.includes('工作表「表格1」第 2 行'));assert(parsed.text.includes('测试镜框'));
});
test('legacy XLS and CSV use actual cells without running formulas',async()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['名称','数量'],['合成',900]]);sheet.B2.f='1+1';XLSX.utils.book_append_sheet(book,sheet,'合成表');
 const xls=XLSX.write(book,{type:'buffer',bookType:'biff8'}),parsed=await parseDocument({filename:'合成.xls',mimeType:'application/vnd.ms-excel',bytes:xls});assert(parsed.text.includes('900'));assert(parsed.text.includes('合成'));
 const csv=await parseDocument({filename:'合成.csv',mimeType:'text/csv',bytes:Buffer.from('名称,数量\n"甲,乙",12\n"多行\n说明",3')});assert(csv.text.includes('甲,乙'));assert(csv.text.includes('多行\n说明'));assert.equal(csv.sections.length,3);
});
test('PDF generation embeds Chinese font and text can be independently extracted',async()=>{
 const output=await generate('pdf');assert(output.bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
 const parsed=await parseDocument(output);assert(parsed.text.includes('中文合成报告'));assert(parsed.text.includes('测试镜框'));assert(parsed.text.includes('数量'));assert.equal(parsed.sections[0].source,'第 1 页');
});
test('PDF extraction retains page attribution and reports blank pages explicitly',async()=>{
 const bytes=await pdfFixture(3),result=await parseDocument({filename:'pages.pdf',mimeType:'application/pdf',bytes});assert.equal(result.sections.length,3);assert(result.sections[2].text.includes('Synthetic page 3'));assert.equal(result.sections[2].source,'第 3 页');
 await assert.rejects(parseDocument({filename:'scan.pdf',mimeType:'application/pdf',bytes:await pdfFixture(1,{blank:true})}),checkError('DOCUMENT_OCR_REQUIRED'));
});
test('PDF page limit rejects the whole input instead of reading only the first pages',async()=>{
 await assert.rejects(parseDocument({filename:'large.pdf',mimeType:'application/pdf',bytes:await pdfFixture(101)}),checkError('DOCUMENT_PAGE_LIMIT'));
});
test('text and byte limits reject without silently truncating',async()=>{
 await assert.rejects(parseDocument({filename:'large.txt',mimeType:'text/plain',bytes:Buffer.alloc(DOCUMENT_LIMITS.inputBytes+1,65)}),checkError('DOCUMENT_SIZE_LIMIT'));
 await assert.rejects(parseDocument({filename:'long.txt',mimeType:'text/plain',bytes:Buffer.from('x'.repeat(120001))}),checkError('DOCUMENT_TEXT_LIMIT'));
 await assert.rejects(renderDocument({format:'txt',title:'synthetic',blocks:[{type:'paragraph',text:'x'.repeat(120001)}]}),checkError('DOCUMENT_TEXT_LIMIT'));
});
test('workbook row and column limits reject rather than use truncated reader output',async()=>{
 const make=sheet=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'synthetic');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});};
 for(const sheet of [XLSX.utils.aoa_to_sheet(Array.from({length:5001},(_,i)=>[i])),XLSX.utils.aoa_to_sheet([Array(101).fill('synthetic')])])await assert.rejects(parseDocument({filename:'large.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:make(sheet)}),checkError('DOCUMENT_ROW_LIMIT'));
});
test('malformed Office archive, mismatched type and advertised decompression bomb are rejected',async()=>{
 const output=await generate('docx');
 await assert.rejects(parseDocument({...output,bytes:output.bytes.subarray(0,output.bytes.length-10)}),checkError('DOCUMENT_ARCHIVE_INVALID'));
 const bomb=Buffer.from(output.bytes);for(let i=0;i<bomb.length-46;i++){if(bomb.readUInt32LE(i)===0x02014b50){bomb.writeUInt32LE(100*1024*1024,i+24);break;}}
 await assert.rejects(parseDocument({...output,bytes:bomb}),checkError('DOCUMENT_ARCHIVE_LIMIT'));
 const lyingSize=Buffer.from(output.bytes);for(let i=0;i<lyingSize.length-46;i++){if(lyingSize.readUInt32LE(i)===0x02014b50&&lyingSize.readUInt32LE(i+24)>1){lyingSize.writeUInt32LE(1,i+24);break;}}
 await assert.rejects(parseDocument({...output,bytes:lyingSize}),checkError('DOCUMENT_ARCHIVE_INVALID'));
 await assert.rejects(parseDocument({...output,filename:'wrong.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),checkError('DOCUMENT_FORMAT_MISMATCH'));
});
test('Office local headers cannot override the checked central directory budget',async()=>{
 const output=await generate('xlsx');let central;
 for(let i=0;i<output.bytes.length-46;i++)if(output.bytes.readUInt32LE(i)===0x02014b50&&output.bytes.readUInt32LE(i+24)>1){central=i;break;}
 assert.notEqual(central,undefined);const local=output.bytes.readUInt32LE(central+42);
 for(const [offset,size,value] of [[22,4,1024*1024*1024],[18,4,1024*1024*1024],[8,2,99],[6,2,8],[14,4,0]]){
  const bytes=Buffer.from(output.bytes);size===2?bytes.writeUInt16LE(value,local+offset):bytes.writeUInt32LE(value,local+offset);
  await assert.rejects(parseDocument({...output,bytes}),checkError('DOCUMENT_ARCHIVE_INVALID'));
 }
});
test('Office data descriptors are validated and supported without unbounded local sizes',async()=>{
 const output=await generate('xlsx'),zip=await JSZip.loadAsync(output.bytes),bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',streamFiles:true});
 assert((await parseDocument({...output,bytes})).text.includes('测试镜框'));
 let descriptor;for(let i=0;i<bytes.length-16;i++)if(bytes.readUInt32LE(i)===0x08074b50){descriptor=i;break;}
 assert.notEqual(descriptor,undefined);const corrupt=Buffer.from(bytes);corrupt.writeUInt32LE(1024*1024*1024,descriptor+12);
 await assert.rejects(parseDocument({...output,bytes:corrupt}),checkError('DOCUMENT_ARCHIVE_INVALID'));
});
test('Office ZIP64 extra fields and comment indexes cannot select an unchecked archive view',async()=>{
 const output=await generate('docx');let central;
 for(let i=0;i<output.bytes.length-46;i++)if(output.bytes.readUInt32LE(i)===0x02014b50&&output.bytes.readUInt16LE(i+30)>=4){central=i;break;}
 // JSZip emits a UTF-8 path extra field for the Chinese document properties.
 // Build a valid harmless extra field first if this fixture has no extra fields.
 const zip=await JSZip.loadAsync(output.bytes);zip.file('合成.txt','synthetic');const base=await zip.generateAsync({type:'nodebuffer'});
 for(let i=0;i<base.length-46;i++)if(base.readUInt32LE(i)===0x02014b50&&base.readUInt16LE(i+30)>=4){central=i;break;}
 assert.notEqual(central,undefined);
 const centralExtra=central+46+base.readUInt16LE(central+28),local=base.readUInt32LE(central+42),localExtra=local+30+base.readUInt16LE(local+26);
 for(const offset of [centralExtra,localExtra]){const bytes=Buffer.from(base);bytes.writeUInt16LE(1,offset);await assert.rejects(parseDocument({...output,bytes}),checkError('DOCUMENT_ARCHIVE_INVALID'));}
 const comment=Buffer.from('PK\x05\x06 conflicting index'),bytes=Buffer.concat([output.bytes,comment]);bytes.writeUInt16LE(comment.length,output.bytes.length-2);
 await assert.rejects(parseDocument({...output,bytes}),checkError('DOCUMENT_ARCHIVE_INVALID'));
});
test('path filenames, MIME confusion, binary text, invalid UTF8 and arbitrary sources are refused',async()=>{
 for(const input of [{filename:'../secret.txt',mimeType:'text/plain',bytes:Buffer.from('synthetic')},{filename:'payload.txt',mimeType:'image/png',bytes:Buffer.from('synthetic')},{filename:'binary.txt',mimeType:'text/plain',bytes:Buffer.from([65,0,66])},{filename:'bad.txt',mimeType:'text/plain',bytes:Buffer.from([0xff])},{filename:'url.txt',mimeType:'text/plain',bytes:'https://example.test/private'}])await assert.rejects(parseDocument(input));
 await assert.rejects(parseDocument({filename:'macro.docm',mimeType:'application/octet-stream',bytes:Buffer.from('synthetic')}),checkError('DOCUMENT_UNSUPPORTED'));
});
test('render schema rejects extra operations, arbitrary cell objects and malformed tables',async()=>{
 for(const block of [{type:'shell',command:'echo synthetic'},{type:'paragraph',text:'synthetic',path:'arbitrary'},{type:'paragraph',text:'invalid\u0000'},{type:'paragraph',text:'invalid\ud800'},{type:'heading',text:'synthetic',level:7},{type:'table',headers:['a'],rows:[[{formula:'1+1'}]]},{type:'table',headers:['a'],rows:[[1,2]]},{type:'table',headers:['a'],rows:[[Infinity]]}])await assert.rejects(renderDocument({format:'docx',title:'合成',blocks:[block]}));
 await assert.rejects(renderDocument({format:'exe',title:'合成',blocks:[{type:'paragraph',text:'synthetic'}]}),checkError('DOCUMENT_UNSUPPORTED'));
});
test('rendered filenames cannot escape a download name or contain header controls',async()=>{
 const output=await renderDocument({format:'txt',title:'../测试:标题/文档',blocks:[{type:'paragraph',text:'synthetic'}]});assert(!/[\\/:]/.test(output.filename));assert(output.filename.endsWith('.txt'));
});
test('parser error messages do not serialize source bytes and worker recovers after errors',async()=>{
 await assert.rejects(parseDocument({filename:'private.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF-PRIVATE_SYNTHETIC_DO_NOT_ECHO')}),error=>!error.message.includes('PRIVATE_SYNTHETIC'));
 assert((await parseDocument({filename:'healthy.txt',mimeType:'text/plain',bytes:Buffer.from('healthy')})).text.includes('healthy'));
});
test('worker queue is bounded and does not block the main event loop',async()=>{
 let ticks=0;const timer=setInterval(()=>ticks++,5);
 try{const results=await Promise.allSettled(Array.from({length:10},(_,i)=>parseDocument({filename:'queue'+i+'.txt',mimeType:'text/plain',bytes:Buffer.from('synthetic')})));assert.equal(results.filter(r=>r.status==='fulfilled').length,9);const rejected=results.filter(r=>r.status==='rejected');assert.equal(rejected.length,1);assert.equal(rejected[0].reason.code,'DOCUMENT_QUEUE_FULL');assert(ticks>0);}finally{clearInterval(timer);}
});
test('bundled font and license match pinned provenance',async()=>{
 const root=new URL('./assets/fonts/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.license,'OFL-1.1');for(const file of manifest.files){const bytes=await fs.readFile(new URL(file.name,root));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
});
