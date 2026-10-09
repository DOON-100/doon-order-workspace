import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {unzipSync,strFromU8} from 'fflate';

// No real customer names, material codes, prices or source files.
export async function testCustomerQuoteTemplateApi({ok,call,state,pass,rawRecords,rawPut}){
 const identity={userId:'synthetic_template_sales',email:'synthetic_template_sales@test.invalid',displayName:'Synthetic Template Sales',fullName:'Synthetic Template Sales'};
 await ok('member',{name:identity.displayName,email:identity.email,role:'sales',customers:[],active:true});await ok('enroll',{},identity);
 const member=(await state()).members.find(m=>m.email===identity.email),policy=structuredClone(rawRecords().find(r=>r.kind==='customer_quote_access'));
 rawPut({...policy,memberIds:[...new Set([...policy.memberIds,member.id])]});
 const account=(await ok('customer-save',{customer:'SYNTHETIC TEMPLATE CUSTOMER',customerCode:'SYNTH-T',salesName:identity.displayName,serviceName:'',quoteMemberIds:[member.id],active:true})).item;
 const other=(await ok('customer-save',{customer:'SYNTHETIC OTHER TEMPLATE CUSTOMER',customerCode:'SYNTH-OTHER-T',salesName:'',serviceName:'',quoteMemberIds:[],active:true})).item;
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([
  ['SYNTHETIC CUSTOMER SPARE PARTS'],[],['Model Name','Material Number','Material Description','Unit Price Whole Model','Notes'],
  ['SYNTH-FRAME-A','SYNTH-RAW-A','FRAME RAW 50-20',null,'Synthetic customer specification'],
  [null,'SYNTH-TIP-L','TEMPLE TIP LEFT BLACK',null,'Synthetic left tip'],
  ['SYNTH-FRAME-B','SYNTH-RAW-B','FRAME IP GOLD 51-21',null,'Synthetic gold frame'],
  [null,'SYNTH-TIP-L','TEMPLE TIP LEFT BLACK',null,'Synthetic shared tip'],
 ]);
 sheet['!merges']=[{s:{r:3,c:0},e:{r:4,c:0}},{s:{r:5,c:0},e:{r:6,c:0}}];sheet['!cols']=[{wch:20},{wch:24},{wch:50},{wch:20},{wch:35}];XLSX.utils.book_append_sheet(book,sheet,'Synthetic parts');
 const original=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const registration=()=>{const form=new FormData();for(const [key,value] of Object.entries({customerAccountId:account.id,brand:'Synthetic brand',businessType:'spare_parts',title:'Synthetic spares template'}))form.set(key,value);form.set('file',new File([original],'synthetic-spares.xlsx'));return form;};
 const denied=async(action,body,status,user)=>{const before=structuredClone(rawRecords());const response=await call(action,body,user);assert.equal(response.status,status,await response.text());assert.deepEqual(rawRecords(),before);};
 await denied('customer-quote-template-register',registration(),403,identity);
 const registered=await ok('customer-quote-template-register',registration()),template=registered.template;
 assert.equal(template.rowCount,4);assert.equal(template.itemCount,3);assert(!JSON.stringify(registered).includes('fileKey'));
 assert((await ok('customer-quote-template-register',registration())).alreadyPresent);
 assert.equal((await ok('customer-quote-templates?customerAccountId='+account.id,undefined,identity)).templates.length,1);
 await denied('customer-quote-templates?customerAccountId='+other.id,undefined,403,identity);
 pass('客户模板按客户档案授权、原件摘要去重，共享物料独立映射多个客户位置');
 const base={companyEn:'Synthetic Company',companyZh:'合成测试公司',collectionEn:'Synthetic',collectionZh:'合成',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,contactName:'Synthetic Contact',quoteNo:'SYNTH-SPECIAL-QUOTE',quoteDate:'2026-01-01',validUntil:'2026-12-31',currency:'EUR',brand:'Synthetic brand',businessType:'spare_parts',internalNotesZh:'SECRET-SYNTHETIC-TEMPLATE-COST',internalCosts:[{id:'cost',label:'SECRET-SYNTHETIC-SUPPLIER',rmb:70,notes:'Synthetic internal cost'}],lines:[{id:'placeholder',model:'Synthetic placeholder',descriptionZh:'合成',descriptionEn:'Synthetic placeholder',quantity:null,unitPrice:null,toolingFee:null}],terms:[{id:'synthetic-term',labelZh:'供货条件',labelEn:'Supply conditions',zh:'按各行部件供货，已复核合成范围。',en:'Supply individual listed items with reviewed synthetic scope.',needsReview:false}],reviewNotes:[]};
 let q=(await ok('customer-quote-save',base)).quote;
 const saved=q.version;
 await denied('customer-quote-template-apply',{quoteId:q.id,version:q.version,templateId:'not-a-template'},403);
 q=(await ok('customer-quote-template-apply',{quoteId:q.id,version:q.version,templateId:template.id},identity)).quote;
 assert.equal(q.lines.length,3);assert.equal(q.templateBinding.rowCount,4);assert.equal(q.quoteMode,'price_list');assert.equal(q.pricingBasis,'pending');assert.equal(q.currencyReviewed,false);
 assert(q.lines.every(l=>l.quantity===null&&l.unitPrice===null&&l.unit==='unknown'&&!l.scopeReviewed));
 await denied('customer-quote-template-apply',{quoteId:q.id,version:saved,templateId:template.id},409,identity);
 await denied('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true},400);
 const payload=quote=>Object.fromEntries([...Object.keys(base),'quoteMode','pricingBasis','currencyReviewed','id','version'].filter(key=>quote[key]!==undefined).map(key=>[key,quote[key]]));
 q=(await ok('customer-quote-save',{...payload(q),pricingBasis:'row_item',currencyReviewed:true,reviewNotes:[],lines:q.lines.map((line,index)=>({...line,factoryModel:'SYNTH-FACTORY-'+index,component:index===1?'temple_tip':'frame',productType:index===1?'spare_part':'frame',side:index===1?'left':'none',supplyStage:index===0?'raw':'finished',unit:index===1?'piece':'pair',scopeReviewed:true,scopeNotesZh:'仅列示合成物料；不包含其他配件',scopeNotesEn:'Listed synthetic item only; excludes other components',quantityBasisZh:'测试价目，数量待订单确认',quantityBasisEn:'Synthetic price list; quantity to be confirmed per order',unitPrice:10+index,toolingFee:0}))},identity)).quote;
 q=(await ok('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true})).quote;
 const confirmed=q.version,rows=(await ok('customer-quote-completed',undefined,identity)).rows.filter(row=>row.quoteId===q.id);
 assert.equal(rows.length,3);assert(rows.every(row=>row.currency==='EUR'&&row.quantity===null&&row.unitPriceUsd===null));assert(rows.every(row=>row.templateBinding.id===template.id));
 assert(rows.some(row=>row.unit==='piece'&&row.materialNumber==='SYNTH-TIP-L'));
 const response=await call(`customer-quote-template-export?quoteId=${q.id}&quoteVersion=${confirmed}`,undefined,identity);assert.equal(response.status,200,await (response.status!==200?response.text():Promise.resolve('')));
 const exported=new Uint8Array(await response.arrayBuffer()),output=XLSX.read(exported,{type:'array'}),customerSheet=output.Sheets['Synthetic parts'];
 assert.equal(customerSheet.D5.v,11);assert.equal(customerSheet.D7.v,11);assert.equal(customerSheet.D4.v,10);assert.equal(customerSheet.D6.v,12);assert.deepEqual(customerSheet['!merges'],sheet['!merges']);
 const originalZip=unzipSync(original),outputZip=unzipSync(exported);for(const [name,bytes] of Object.entries(originalZip)){if(!['xl/worksheets/sheet1.xml','xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml'].includes(name))assert.deepEqual(outputZip[name],bytes,name);}
 const publicXml=Object.values(outputZip).map(bytes=>strFromU8(bytes)).join('\n');for(const secret of ['SECRET-SYNTHETIC-TEMPLATE-COST','SECRET-SYNTHETIC-SUPPLIER'])assert(!publicXml.includes(secret));
 assert(rawRecords().some(r=>r.kind==='customer_quote_template_output'&&r.quoteId===q.id&&r.quoteVersion===confirmed&&!r.uploaded));
 pass('确认版本自动进入通用报价总表，EUR与单件价格保留原币种，客户模板重复位置同价且内部核价不进入成品');
 const upload=bytes=>{const form=new FormData();form.set('quoteId',q.id);form.set('quoteVersion',String(confirmed));form.set('file',new File([bytes],'synthetic-actual-customer.xlsx'));return form;};
 const archive=await ok('customer-quote-template-archive',upload(exported),identity);assert(archive.output.uploaded);assert(!Object.hasOwn(archive.output,'fileKey'));
 const download=await call('customer-quote-template-output-file?id='+archive.output.id,undefined,identity);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(exported));
 customerSheet.D5.v=99;const changed=XLSX.write(output,{type:'buffer',bookType:'xlsx'});await denied('customer-quote-template-archive',upload(changed),400,identity);
 const total=await call('customer-quote-completed-export',undefined,identity);assert.equal(total.status,200);const totalBook=XLSX.read(await total.arrayBuffer()),totalRows=XLSX.utils.sheet_to_json(totalBook.Sheets[totalBook.SheetNames[0]]);assert.equal(totalRows.filter(r=>r['报价单号']===q.quoteNo).length,3);assert(totalRows.filter(r=>r['报价单号']===q.quoteNo).every(r=>r['币种']==='EUR'));assert(!JSON.stringify(totalRows).includes('SECRET-SYNTHETIC'));
 pass('实际对客Excel必须与确认版本的物料、价格及计价条件一致，手改价格须修订；总表Excel执行权限并排除内部成本');
 q=(await ok('customer-quote-revise',{id:q.id,version:q.version},identity)).quote;
 assert.equal((await call(`customer-quote-template-export?quoteId=${q.id}&quoteVersion=${confirmed}`,undefined,identity)).status,200);
 await denied(`customer-quote-template-export?quoteId=${q.id}&quoteVersion=${q.version}`,undefined,403,identity);
 q=(await ok('customer-quote-save',{...payload(q),customerAccountId:other.id,customerName:other.customer,customerCode:other.customerCode})).quote;assert(!q.templateBinding);
 await denied('customer-quote-template-output-file?id='+archive.output.id,undefined,403,identity);
 assert(rawRecords().some(r=>r.kind==='customer_quote_revision'&&r.quoteId===q.id&&r.version===confirmed&&r.snapshot.templateBinding?.id===template.id));
 pass('修订保留确认快照与客户成品，草稿不能冒充正式文件，重绑定客户后旧客户文件权限即时收回');
}
