// Real native API, isolated synthetic data, no production or external ERP calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as XLSX from 'xlsx';
import {StateStore,windowsCodec} from '../../dist/state.js';
import {FoundationService} from '../../dist/service.js';
import {main} from '../../dist/program.js';
import {orderWriteCommands} from '../../dist/catalog.js';
import {syntheticKingdeeSalesTemplate} from '../../../tests/kingdee-sales-cases.mjs';
export async function verifyOrderWrites({services,dir,origin,env,root,pass,nativeCommands=process.platform==='win32'}){
 const admin=services.admin_test.foundation,a=services.sales_a.foundation,denied=services.unassigned.foundation;
 const inputFile=path.join(dir,'w3-input.json'),input=async value=>{await fs.writeFile(inputFile,JSON.stringify(value));return inputFile;};
 let state,foundation;
 if(nativeCommands){state=new StateStore(path.join(dir,'w3-admin-process'),windowsCodec);await state.setup(origin,true);foundation=new FoundationService(state);await foundation.login(async()=>({username:'admin_test',password:'Synthetic-Only-2026!'}));}
 const flag=process.argv.indexOf('--cli-root'),cliRoot=flag<0?path.join(root,'cli'):path.resolve(process.argv[flag+1]),binary=flag<0?process.execPath:path.join(cliRoot,'node.exe'),tested=new Set();
 if(!nativeCommands&&flag>=0)throw Error('Downloaded package acceptance requires native Windows command execution');
 const run=async args=>{
  const expected=orderWriteCommands.find(row=>row.name.split(' ').every((part,index)=>args[index]===part))?.name;
  assert(expected,'W3 command must be registered');
  let value;
  if(nativeCommands){
   try{value=JSON.parse(execFileSync(binary,[path.join(cliRoot,'dist/index.js'),...args,'--json'],{env:{...env,DOON_CLI_HOME:state.directory},windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024}));}
   catch(error){if(error.stdout)throw Error('Synthetic W3 command failed: '+expected+' '+error.stdout);throw error;}
  }else{
   // Reuse the synthetic service's in-memory codec. The production CLI still requires DPAPI.
   let output='';const write=process.stdout.write;
   process.stdout.write=(chunk,encoding,callback)=>{output+=chunk.toString();if(typeof encoding==='function')encoding();else callback?.();return true;};
   try{assert.equal(await main([...args,'--json'],admin),0,output);value=JSON.parse(output);}
   finally{process.stdout.write=write;}
  }
  assert.equal(value.ok,true);assert.equal(value.command,expected);tested.add(value.command);return value.data;
 };
 try{
  if(!process.argv.includes('--skip-kingdee')){const form=new FormData();form.set('file',new File([Uint8Array.from(syntheticKingdeeSalesTemplate())],'synthetic-kingdee-template.xlsx'));const session=await services.admin_test.state.session(await services.admin_test.state.config());const template=await fetch(origin+'/api/workspace/kingdee-template',{method:'POST',headers:{Cookie:session.cookie,Origin:origin},body:form});assert.equal(template.status,200);pass();}
  for(const [prefix,type]of [['sales orders','order'],['sales orders','workflow'],['purchasing factory-orders','factory'],['purchasing factory-orders','table']])await run([...prefix.split(' '),'schema','--type',type]);await run(['sales','sources','schema']);
  const factoryBook=XLSX.utils.book_new(),headers=['件号#','图纸编号','款号','色号','系列','材质','Front','中文前框','Insert','中文角花','Pad','中文叶子','Temple','中文金脾','House','中文底座','Cover','中文盖','Manchon / tip','胶脾','主架镜片','销售办数量','大货数量','单位','要求交货期','备注'],factorySheet=XLSX.utils.aoa_to_sheet([...Array.from({length:19},()=>[]),headers,[1,'SYN-W3-DRAW','MODEL','C03A','METAL','TI','Synthetic original','合成工艺','','','','','','','','','','','','','Clear','',12,'PCS','2026-12-01','Synthetic only']]);XLSX.utils.book_append_sheet(factoryBook,factorySheet,'032R2');const factoryFile=path.join(dir,'w3-factory.xlsx');await fs.writeFile(factoryFile,XLSX.write(factoryBook,{type:'buffer',bookType:'xlsx'}));
  const preview=await run(['purchasing','factory-orders','table-preview','--input',await input({customer:'C1',orderNo:'SYN-W3-ORDER',customerPO:'SYN-W3-PO'}),'--file',factoryFile]);assert.equal(preview.rows.length,1);
  const committed=await run(['purchasing','factory-orders','table-commit','--input',await input({id:preview.previewId})]),orderId=committed.items[0].orderId;assert.equal(committed.count,1);const repeated=await admin.orderWrite().tableCommit(inputFile);assert.equal(repeated.repeated,true);pass();
  await run(['sales','orders','form',orderId]);await run(['purchasing','factory-orders','form',orderId]);
  const factoryExport=path.join(dir,'w3-factory-export.xlsx');await run(['purchasing','factory-orders','export','--order',orderId,'--output',factoryExport]);const roundtrip=XLSX.read(await fs.readFile(factoryExport),{type:'buffer'});assert.deepEqual(roundtrip.SheetNames,['中文订单','英文订单']);assert(JSON.stringify(roundtrip.Sheets['中文订单']).includes(orderId));
  await assert.rejects(denied.orderWrite().order(orderId),{code:'NOT_IN_SCOPE'});
  await run(['sales','orders','update','--input',await input({id:orderId,patch:{notes:'Synthetic changed order'}}),'--version','1']);
  await assert.rejects(denied.orderWrite().update(await input({id:orderId,patch:{notes:'denied'}}),'2'),{code:'FORBIDDEN'});
  const sent=await run(['sales','orders','workflow','--type','submit-service','--input',await input({id:orderId}),'--version','2']);assert.equal(sent.record.workflowStatus,'客服待审核');pass();
  const factoryToken=randomUUID(),factoryPayload={lineId:orderId,sourceEnglish:'Original synthetic wording',chineseProcess:'合成中文工艺'};
  const saved=await run(['purchasing','factory-orders','save','--type','draft','--input',await input(factoryPayload),'--version','1','--order-version','3','--request-id',factoryToken]);assert.equal(saved.record.version,2);
  const replay=await admin.orderWrite().saveFactory('draft',inputFile,'1','3',factoryToken);assert.equal(replay.record.id,saved.record.id);
  await assert.rejects(admin.orderWrite().saveFactory('draft',inputFile,'1','3',randomUUID()),{code:'CONFLICT'});
  await assert.rejects(admin.orderWrite().saveFactory('draft',inputFile,'2','1',randomUUID()),{code:'CONFLICT'});
  await assert.rejects(admin.orderWrite().saveFactory('draft',await input({...factoryPayload,materialSpec:'changed UUID content'}),'1','3',factoryToken),{code:'CONFLICT'});
  await assert.rejects(a.orderWrite().saveFactory('release',await input({lineId:orderId}),'2','3',randomUUID()),{code:'FORBIDDEN'});pass();
  const factoryUpdated=await admin.orderWrite().saveFactory('service-confirm',await input({lineId:orderId}),'2','3',randomUUID());assert.equal(factoryUpdated.record.status,'待PMC补图');assert.equal(factoryUpdated.record.sourceEnglish,factoryPayload.sourceEnglish);
  await assert.rejects(a.orderWrite().saveFactory('draft',await input(factoryPayload),'1','3',factoryToken),{code:'CONFLICT'});
  const raceFile=await input({lineId:orderId,materialSpec:'Synthetic concurrent edit'}),race=await Promise.allSettled([admin.orderWrite().saveFactory('draft',raceFile,'3','3',randomUUID()),admin.orderWrite().saveFactory('draft',raceFile,'3','3',randomUUID())]);assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.equal(race.find(row=>row.status==='rejected').reason.code,'CONFLICT');
  assert.equal((await admin.orderWrite().saveFactory('draft',await input(factoryPayload),'1','3',factoryToken)).record.id,saved.record.id);
  const stalePreview=await admin.orderWrite().tablePreview(await input({customer:'C1',orderNo:'SYN-W3-ORDER',customerPO:'SYN-W3-PO'}),factoryFile);await admin.orderWrite().saveFactory('draft',await input({lineId:orderId}),'4','3',randomUUID());await assert.rejects(admin.orderWrite().tableCommit(await input({id:stalePreview.previewId})),{code:'CONFLICT'});pass();
  const docs=admin.documentsWrite(),sourceFields={date:'2026-10-20',currency:'USD',buyer:'Synthetic buyer',seller:'Synthetic seller',billingAddress:'Synthetic bill',shippingAddress:'Synthetic ship',paymentTerms:'Net 30',tradeTerms:'EXW',paymentDueDate:'2026-11-20',delivery:'Synthetic delivery'},sourcePayload={customerId:'c1',projectId:'p1',orderId,number:'SYN-W3-PO',fields:sourceFields,lines:[{orderLineId:orderId,description:'Synthetic frame',quantity:12,unitPrice:'3.50'}],sourceRefs:[]};
  await run(['service','documents','schema','--kind','source','--type','po']);
  const source=await run(['service','documents','save','--kind','source','--type','po','--input',await input(sourcePayload),'--version','0','--request-id',randomUUID()]);assert.equal(source.record.version,1);const poId=source.record.id;
  await assert.rejects(denied.documentsWrite().form(poId),{code:'NOT_IN_SCOPE'});
  await assert.rejects(docs.save('source','po',await input({id:poId,fields:{unknown:'denied'}}),'1',randomUUID()),{code:'INVALID_INPUT'});
  const updateToken=randomUUID(),updateFile=await input({id:poId,fields:{notes:'Synthetic partial update'}}),updated=await docs.save('source','po',updateFile,'1',updateToken);assert.equal(updated.record.fields.buyer,sourceFields.buyer);assert.equal(updated.record.version,2);const again=await docs.save('source','po',updateFile,'1',updateToken);assert.equal(again.record.version,2);
  await assert.rejects(docs.save('source','po',updateFile,'1',randomUUID()),{code:'CONFLICT'});pass();
  const pi=await run(['service','documents','generate','--type','pi','--input',await input({sourceId:poId,number:'SYN-W3-PI'}),'--version','2','--request-id',randomUUID()]),piId=pi.record.id;assert.equal(pi.record.type,'pi');
  await run(['service','documents','form',piId]);await run(['service','documents','references','--customer','c1','--limit','20']);
  const submitted=await run(['service','documents','action','--type','submit','--input',await input({id:piId,note:'Synthetic check'}),'--version','1','--request-id',randomUUID()]);assert.equal(submitted.record.status,'pending_check');
  await assert.rejects(docs.action('confirm',inputFile,'2',randomUUID()),{code:'FORBIDDEN'});
  const checked=await a.documentsWrite().action('confirm',await input({id:piId,note:'Synthetic responsible employee check'}),'2',randomUUID());assert.equal(checked.record.status,'checked');pass();
  const pdf=path.join(dir,'w3-original.pdf');await fs.writeFile(pdf,'%PDF-1.4\nSYNTHETIC W3 ORIGINAL ONLY\n%%EOF');const upload=await run(['service','documents','file-upload','--input',await input({id:poId,note:'Synthetic original'}),'--file',pdf,'--version','2','--request-id',randomUUID()]);await run(['service','documents','files',poId]);const download=path.join(dir,'w3-copy.pdf');await run(['service','documents','file-download',poId,upload.file.id,'--output',download]);assert.deepEqual(await fs.readFile(download),await fs.readFile(pdf));await assert.rejects(docs.download(poId,upload.file.id,download),{code:'OUTPUT_EXISTS'});pass();
  const sourceEvidence={schemaVersion:1,orderNo:'SYN-W3-EVIDENCE',customer:'C1',productType:'TI',customerPO:'SYN-PO',documentType:'Sales Order Confirmation',source:{filename:'synthetic.xlsx',sha256:createHash('sha256').update('synthetic').digest('hex'),sheet:'Synthetic',detailRange:'A2:N2'},warnings:[],lines:[{id:'synthetic-source-line',sourceRow:2,drawing:'DN1001',model:'MODEL1001',color:'C01',sku:'',quantity:12,unit:'PCS',sampleQuantity:null,unitPrice:'3.50',deliveryText:'2026-12-01',colorFields:[],rawFields:[],notes:[]}]};
  const evidenceToken=randomUUID(),evidenceInput=await input(sourceEvidence),evidence=await run(['sales','sources','import','--input',evidenceInput,'--request-id',evidenceToken]);assert.equal((await admin.orderWrite().importSource(evidenceInput,evidenceToken)).record.id,evidence.record.id);await assert.rejects(a.orderWrite().importSource(evidenceInput,randomUUID()),{code:'FORBIDDEN'});pass();
  if(process.argv.includes('--skip-kingdee')){assert.deepEqual([...tested].sort(),orderWriteCommands.filter(row=>!row.name.startsWith('sales kingdee ')).map(row=>row.name).sort());return [...tested];}
  await run(['sales','kingdee','schema']);const status=await run(['sales','kingdee','status']);assert(status.connection.readinessIssues.length);await run(['sales','kingdee','list']);const prepared=await run(['sales','kingdee','prepare','--input',await input({sourceId:evidence.record.id})]);assert.equal((await admin.kingdeeSales().prepare(inputFile)).record.id,prepared.record.id);
  const sourceTemplate=path.join(dir,'w3-source-template.xlsx');await run(['sales','kingdee','source-template','--output',sourceTemplate]);const sourceBook=XLSX.read(await fs.readFile(sourceTemplate),{type:'buffer'}),sourceSheet=sourceBook.Sheets['中英订单上传'],raw=['SYN-W3-BILINGUAL','C1','SYN-W3-CUSTOMER-PO','TI','DN1001','MODEL1001','SYN-SKU','C01',12,'PCS',null,'3.50','2026-12-01','GOLD','2026-10-20','Synthetic employee','USD','1','赊销','不含税','0','否','Original English','原文中文','Synthetic'];for(let c=0;c<raw.length;c++)if(raw[c]!==null)sourceSheet[XLSX.utils.encode_cell({r:1,c})]={t:typeof raw[c]==='number'?'n':'s',v:raw[c]};const sourceFile=path.join(dir,'w3-bilingual.xlsx');await fs.writeFile(sourceFile,XLSX.write(sourceBook,{type:'buffer',bookType:'xlsx'}));
  const originalPreview=await run(['sales','kingdee','source-preview','--file',sourceFile]);await assert.rejects(denied.kingdeeSales().sourceCommit(await input({id:originalPreview.preview.id,acknowledged:true})),{code:'FORBIDDEN'});const draft=await run(['sales','kingdee','source-commit','--input',await input({id:originalPreview.preview.id,acknowledged:true})]),draftId=draft.record.id;assert.equal((await admin.kingdeeSales().sourceCommit(inputFile)).record.id,draftId);await run(['sales','kingdee','form',draftId]);
  const originalCopy=path.join(dir,'w3-bilingual-copy.xlsx');await run(['sales','kingdee','source-download',draft.record.sourceId,'--output',originalCopy]);assert.deepEqual(await fs.readFile(originalCopy),await fs.readFile(sourceFile));pass();
  const savedDraft=await run(['sales','kingdee','save','--input',await input({id:draftId,inputs:{remark:'Synthetic changed remark'}}),'--version','1']);assert.equal(savedDraft.record.inputs.customerPO,raw[2]);const validated=await run(['sales','kingdee','action','--type','validate','--input',await input({id:draftId}),'--version','2']);assert.equal(validated.record.validation.valid,true,JSON.stringify(validated.record.validation));const confirmed=await admin.kingdeeSales().action('confirm',await input({id:draftId,acknowledged:true}),'3');assert.equal(confirmed.record.status,'confirmed');
  await run(['sales','kingdee','export',draftId,'--version','4','--output',path.join(dir,'w3-kingdee-export.xlsx')]);await assert.rejects(admin.kingdeeSales().action('upload',await input({id:draftId}),'4'),{code:'SERVER_UNAVAILABLE'});await assert.rejects(admin.kingdeeSales().action('reconcile',inputFile,'4'));assert.equal((await admin.kingdeeSales().form(draftId)).record.status,'confirmed');pass();
  assert.deepEqual([...tested].sort(),orderWriteCommands.map(row=>row.name).sort(),'Every W3 command must execute the CLI parser and real business handler');
  return [...tested];
 }finally{if(foundation)await foundation.logout();}
}
