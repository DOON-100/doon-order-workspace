import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {syntheticIeTemplate} from './ie-quote-workbook-cases.mjs';

export async function testIeQuoteWorkbookApi({ok,call,pass,rawRecords,rawInsert,files}){
 const m=rawRecords().find(r=>r.id==='ie_test_synthetic-engineer'),engineer={userId:m.userId,email:m.email,displayName:m.name,fullName:m.name};
 const source=rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-SYNTHETIC-01'),account={...rawRecords().find(r=>r.id===source.customerAccountId),id:'ie_test_template_account',customer:'打印模板合成客户',customerCode:'SYNTHETIC-CUSTOMER'};rawInsert(account);
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'],fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const draft=fields(source);delete draft.id;delete draft.version;draft.customerAccountId=account.id;draft.quoteNo='IE-TPL-1';draft.batchId='IE-TPL-1';draft.lines[0].model='SYNTHETIC-MODEL-1';
 let q=(await ok('ie-quote-save',draft,engineer)).quote;assert.equal(q.canExportWorkbook,false);assert.equal((await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,409);
 const bytes=syntheticIeTemplate(),form=(quote=q,sheetName='STYLE1',ack=true)=>{const f=new FormData();f.set('quoteId',quote.id);f.set('version',String(quote.version));f.set('sheetBindings',JSON.stringify([{sheetName,lineId:quote.lines[0].id}]));if(ack)f.set('acknowledgeRemoveUnmapped','true');f.set('file',new File([bytes],'synthetic-template.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
 const before=rawRecords().filter(r=>r.kind==='ie_quote_template').length;
 assert.equal((await call('ie-quote-template-register',form(),engineer)).status,403);
 assert.equal((await call('ie-quote-template-register',form(q,'STYLE1',false))).status,400);
 assert.equal((await call('ie-quote-template-register',form(q,'STYLE2'))).status,400);
 assert.equal(rawRecords().filter(r=>r.kind==='ie_quote_template').length,before);
 const result=await ok('ie-quote-template-register',form());assert.equal(result.templateStatus.verified,true);assert.equal(result.removedSheetCount,4);assert(!JSON.stringify(result).includes('FileKey'));
 const record=rawRecords().find(r=>r.kind==='ie_quote_template'&&r.quoteId===q.id);assert(record.sourceFileKey&&record.preparedFileKey&&record.sourceFileKey!==record.preparedFileKey);
 if(files){assert.deepEqual(new Uint8Array(files.get(record.sourceFileKey)),bytes);assert.notDeepEqual(new Uint8Array(files.get(record.preparedFileKey)),bytes);}
 q=(await ok(`ie-quote?id=${q.id}`,undefined,engineer)).quote;assert.equal(q.canExportWorkbook,true);
 const exported=await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer);assert.equal(exported.status,200,await exported.clone().text());assert(exported.headers.get('content-type').includes('spreadsheetml'));const output=unzipSync(new Uint8Array(await exported.arrayBuffer()));
 const allXml=Object.entries(output).filter(([name])=>name.endsWith('.xml')).map(([,value])=>strFromU8(value)).join('\n');assert(!allXml.includes('OTHER-CUSTOMER-SECRET'));assert(!allXml.includes('OLD-CUSTOMER-PRICE'));assert(!allXml.includes('OLD-MATERIAL-DO-NOT-RETAIN'));assert(!output['xl/media/image2.png']);assert(output['xl/media/image1.png']);
 const oldVersion=q.version,oldQuote=structuredClone(q),updated=fields(q);updated.lines[0].drawingRevision='R2';q=(await ok('ie-quote-save',updated,engineer)).quote;assert.equal(q.canExportWorkbook,false);
 assert.equal((await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,409);
 assert.equal((await call(`ie-quote-export?id=${q.id}&version=${oldVersion}`,undefined,engineer)).status,200);
 assert.equal((await call('ie-quote-template-register',form(oldQuote))).status,409);
 pass('IE 模板API：仅管理员明确映射注册，原件私存不变，错客户/款式拒绝，导出只含所选原版图片且清除历史，图纸改版和过期绑定均阻断');
}
