import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {syntheticIeTemplate} from './ie-quote-workbook-cases.mjs';

export async function testIeQuoteWorkbookApi({ok,call,pass,rawRecords,rawInsert,files}){
 const m=rawRecords().find(r=>r.id==='ie_test_synthetic-engineer'),engineer={userId:m.userId,email:m.email,displayName:m.name,fullName:m.name};
 const source=rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-SYNTHETIC-01'),account={...rawRecords().find(r=>r.id===source.customerAccountId),id:'ie_test_template_account',customer:'打印模板合成客户',customerCode:'SYNTHETIC-CUSTOMER'};rawInsert(account);
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'],fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const draft=fields(source);delete draft.id;delete draft.version;draft.customerAccountId=account.id;draft.quoteNo='IE-TPL-1';draft.batchId='IE-TPL-1';draft.lines[0].model='SYNTHETIC-MODEL-1';
 let q=(await ok('ie-quote-save',draft,engineer)).quote;assert.equal(q.canExportWorkbook,false);assert.equal((await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,409);
 const beforeDownload=rawRecords().map(r=>JSON.stringify(r));
 let fillCopy=await call(`ie-quote-draft-export?id=${q.id}&version=${q.version}`,undefined,engineer);assert.equal(fillCopy.status,200,await fillCopy.clone().text());assert.equal(fillCopy.headers.get('X-IE-Workbook-Mode'),'generic');assert(decodeURIComponent(fillCopy.headers.get('content-disposition')).includes('未审填报草稿'));assert(!Object.keys(unzipSync(new Uint8Array(await fillCopy.arrayBuffer()))).some(n=>n.includes('/media/')));assert.deepEqual(rawRecords().map(r=>JSON.stringify(r)),beforeDownload);
 assert.equal((await call(`ie-quote-draft-export?id=${q.id}`,undefined,engineer)).status,400);
 const outsider=rawRecords().find(r=>r.id==='ie_test_synthetic-other'),outsiderUser={userId:outsider.userId,email:outsider.email,displayName:outsider.name,fullName:outsider.name};assert.equal((await call(`ie-quote-draft-export?id=${q.id}&version=${q.version}`,undefined,outsiderUser)).status,403);
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
 const complete=fields(q),incomplete=fields(q);incomplete.lines[0].materials[0].basePrice=null;incomplete.exchangeRateCnyPerUsd=null;incomplete.lines[0].materials[0].unit='';incomplete.lines[0].processes[0].standardSeconds=null;q=(await ok('ie-quote-save',incomplete,engineer)).quote;
 assert.equal(q.canExportDraftWorkbook,true);assert.equal(q.canExportWorkbook,false);assert.equal((await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,400);
 fillCopy=await call(`ie-quote-draft-export?id=${q.id}&version=${q.version}`,undefined,engineer);assert.equal(fillCopy.status,200,await fillCopy.clone().text());assert.equal(fillCopy.headers.get('X-IE-Workbook-Mode'),'original');const fillEntries=unzipSync(new Uint8Array(await fillCopy.arrayBuffer()));assert(fillEntries['xl/media/image1.png']);assert(!fillEntries['xl/media/image2.png']);assert(strFromU8(fillEntries['xl/worksheets/sheet1.xml']).match(/<c r="I66"[^>]* t="str"><f>[^<]*<\/f><v><\/v>/));
 if(files){const saved=files.get(record.preparedFileKey);files.set(record.preparedFileKey,new Uint8Array([1,2,3]).buffer);assert.equal((await call(`ie-quote-draft-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,409);files.set(record.preparedFileKey,saved);}
 complete.version=q.version;q=(await ok('ie-quote-save',complete,engineer)).quote;
 const oldVersion=q.version,oldQuote=structuredClone(q),updated=fields(q);updated.lines[0].drawingRevision='R2';q=(await ok('ie-quote-save',updated,engineer)).quote;assert.equal(q.canExportWorkbook,false);
 assert.equal((await call(`ie-quote-export?id=${q.id}&version=${q.version}`,undefined,engineer)).status,409);
 assert.equal((await call(`ie-quote-export?id=${q.id}&version=${oldVersion}`,undefined,engineer)).status,200);
 assert.equal((await call('ie-quote-template-register',form(oldQuote))).status,409);
 fillCopy=await call(`ie-quote-draft-export?id=${q.id}&version=${q.version}`,undefined,engineer);assert.equal(fillCopy.status,200);assert.equal(fillCopy.headers.get('X-IE-Workbook-Mode'),'generic');assert(!Object.keys(unzipSync(new Uint8Array(await fillCopy.arrayBuffer()))).some(n=>n.includes('/media/')));
 fillCopy=await call(`ie-quote-draft-export?id=${q.id}&version=${oldVersion}`,undefined,engineer);assert.equal(fillCopy.status,200);assert.equal(fillCopy.headers.get('X-IE-Workbook-Mode'),'original');
 pass('IE 模板API：仅管理员明确映射注册，原件私存不变，错客户/款式拒绝，导出只含所选原版图片且清除历史，图纸改版和过期绑定均阻断');
 pass('IE 草稿Excel API：缺价/汇率仍可下载未审填报稿且不写记录，原版优先、无模板用干净通用格式；旧版可追溯，越权/无版本/篡改模板阻断，正式导出继续严格');
}
