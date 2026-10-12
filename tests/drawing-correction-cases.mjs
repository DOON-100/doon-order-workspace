import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// Synthetic API regressions only. This suite does not read a LAN database,
// employee files or credentials, and deliberately preserves earlier fixtures.
export async function testDrawingCorrection({ok,call,state,original,preview,admin,pass,rawRecords,rawPut}){
 const clone=value=>structuredClone(value),priorRecords=clone(rawRecords());
 const identity=o=>Object.fromEntries(['orderNo','drawing','color','lens','batch'].map(key=>[key,o[key]||'']));
 const current=id=>clone(rawRecords().find(record=>record.id===id));
 const orderCount=()=>rawRecords().filter(record=>record.kind==='order').length;
 const makeLedger=(drawing='SYN-DRAW-OLD',marker='initial')=>{
  const book=XLSX.utils.book_new(),sheet={};
  for(const [col,value] of Object.entries({I:'订单号',J:'图纸编号',M:'订单数量',BF:'包装入仓数量'}))sheet[col+'3']={t:'s',v:value};
  for(const [col,value] of Object.entries({A:'度昂',B:'合成图号跟单',C:'SYN-DRAW-CUSTOMER',H:'白片',I:'SYN-DRAW-ORDER',J:drawing,L:'C1',M:100,N:105,T:'2026-10-30',U:'2026-10-29',W:'钛架',AB:'原有生产备注',BF:20}))sheet[col+'4']={t:typeof value==='number'?'n':'s',v:value};
  sheet.A1={t:'s',v:marker};sheet['!ref']='A1:BH4';XLSX.utils.book_append_sheet(book,sheet,'动态表');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 };
 const originalBytes=makeLedger(),job=await original(originalBytes,'active','synthetic-drawing-original.xlsx');
 await ok('ledger-commit',{id:job.id,offset:0});
 const originalOrder=clone((await state()).orders.find(o=>o.orderNo==='SYN-DRAW-ORDER'));assert(originalOrder);
 const filenameResponse=await call('ledger-file?id='+encodeURIComponent(job.id));assert.equal(filenameResponse.status,200);
 const storedOriginal=Buffer.from(await filenameResponse.arrayBuffer());assert.deepEqual(storedOriginal,Buffer.from(originalBytes));
 const createActor=async role=>{
  const user={userId:'synthetic_drawing_'+role,email:'synthetic_drawing_'+role+'@test.invalid',displayName:'合成图号'+role,fullName:'合成图号'+role};
  rawPut({id:'synthetic_drawing_member_'+role,kind:'member',userId:user.userId,email:user.email,name:user.displayName,role,customers:[originalOrder.customer],orderScope:'all',departments:['pmc','titanium','plating','plastic','finished'],active:true,createdAt:'2026-10-12T00:00:00.000Z'});
  return user;
 };
 const pmc=await createActor('pmc'),otherActors=[];
 for(const role of ['sales','production','clerk','finance','programmer','viewer','supplier'])otherActors.push(await createActor(role));
 const patch=(order,drawing='SYN-DRAW-NEW',reason='合成测试核对图纸编号')=>({id:order.id,version:order.version,drawing,reason});
 const rejected=async(action,body,status=403,actor=admin)=>{
  const snapshot=clone(rawRecords()),response=await call(action,body,actor),message=await response.text();
  if(Array.isArray(status))assert(status.includes(response.status),`${action}: ${response.status} ${message}`);
  else assert.equal(response.status,status,`${action}: ${message}`);
  assert.deepEqual(rawRecords(),snapshot,`${action} rejection must not write any record.`);
 };
 for(const actor of otherActors)await rejected('drawing-correction',patch(originalOrder),403,actor);
 await rejected('drawing-correction',patch(originalOrder),401,null);
 const fixture=(suffix,overrides={})=>{
  const value={...clone(originalOrder),id:'synthetic_drawing_'+suffix,orderNo:'SYN-DRAW-'+suffix,version:1,identityHistory:undefined,...overrides};
  if(value.ledger)value.ledger={...value.ledger,columns:{...value.ledger.columns,I:value.orderNo,J:value.drawing,L:value.color,H:value.lens}};
  rawPut(value);return current(value.id);
 };
 const archived=fixture('ARCHIVED',{lifecycle:'archived',closedDate:'2026-10-11'}),cancelled=fixture('CANCELLED',{sourceStatus:'已取消'}),nonLedger=fixture('NO-LEDGER',{ledger:undefined});
 for(const order of [archived,cancelled,nonLedger])await rejected('drawing-correction',patch(order),403);
 await rejected('drawing-correction',{...patch(originalOrder),id:'synthetic-drawing-missing'},403);
 pass('图纸更正仅管理员 / PMC 可用，客服保留全部查询范围也不能修改；归档、取消及非原表明细拒绝');

 for(const drawing of ['', '   ', '-', '——', 'x'.repeat(121), 'SYN\nDRAW', 'SYN\tDRAW', 'SYN\u0000DRAW', 'SYN\u007fDRAW'])await rejected('drawing-correction',patch(originalOrder,drawing),400);
 for(const reason of ['', '核对', 'r'.repeat(1001)])await rejected('drawing-correction',patch(originalOrder,'SYN-DRAW-NEW',reason),400);
 await rejected('drawing-correction',{...patch(originalOrder),version:0},400);
 await rejected('drawing-correction',{...patch(originalOrder),quantity:999},400);
 await rejected('edit-order',{id:originalOrder.id,version:originalOrder.version,patch:{drawing:'SYN-DRAW-BYPASS'}},403);
 await rejected('ledger-edit',{id:originalOrder.id,version:originalOrder.version,patch:{J:'SYN-DRAW-BYPASS'},reason:'不可绕过源字段更正'},403);
 pass('图号长度、空值、控制字符、原因和严格请求字段校验生效，普通编辑及工序入口不能绕过');

 // Keep old working and factory files plus their pending previews, as a coworker
 // may have downloaded these before another user corrects the source drawing.
 const exported=await call('export',{type:'working',filters:{q:originalOrder.orderNo}});assert.equal(exported.status,200);
 const workingBook=XLSX.read(await exported.arrayBuffer()),workingRows=XLSX.utils.sheet_to_json(workingBook.Sheets[workingBook.SheetNames[0]]);
 const oldWorking=clone(workingRows.find(row=>row['_明细编号']===originalOrder.id));assert(oldWorking?._导出批次);
 const pendingStandard=await preview([{...oldWorking,'内部跟进备注':'旧预览需要重做'}]);assert.equal(pendingStandard.rows[0].status,'update');
 const pendingLedger=await original(makeLedger('SYN-DRAW-NEW','pending new identity'),'active','synthetic-drawing-pending.xlsx');assert.equal(pendingLedger.summary.newRows,1);
 const factoryExport=await call('factory-order-table-export?lineId='+encodeURIComponent(originalOrder.id));assert.equal(factoryExport.status,200);
 const factoryBytes=await factoryExport.arrayBuffer();
 const factoryForm=bytes=>{const form=new FormData();form.set('file',new File([bytes],'synthetic-drawing-factory.xlsx'));form.set('customer',originalOrder.customer);form.set('orderNo',originalOrder.orderNo);return form;};
 const factoryBook=XLSX.read(factoryBytes);
 // AH/AI/AJ carry stable line/order/factory versions. Removing them recreates an
 // ordinary unversioned internal order with the proposed new drawing identity.
 for(const name of factoryBook.SheetNames){const sheet=factoryBook.Sheets[name];sheet.B21={t:'s',v:'SYN-DRAW-NEW'};for(const col of ['AH','AI','AJ'])delete sheet[col+'21'];}
 const pendingFactory=await ok('factory-order-table-preview',factoryForm(XLSX.write(factoryBook,{type:'buffer',bookType:'xlsx'})));
 const mesRow={报工编号:'SYN-DRAW-MES-BEFORE',订单号:originalOrder.orderNo,图纸编号:originalOrder.drawing,圈色:originalOrder.color,镜片类型:originalOrder.lens,良品数:2,报工时间:'2026-10-12 08:00:00',审批状态:'已审批',工单号:'SYN-DRAW-WORKORDER'};
 const firstMes=await preview([mesRow],'mes');assert.equal(firstMes.rows[0].after.lineId,originalOrder.id);await ok('commit-import',{id:firstMes.id,selected:[2]});
 const historicReport=current(firstMes.rows[0].after.id),beforeCorrection=current(originalOrder.id),countBefore=orderCount(),recordsBeforeCorrection=clone(rawRecords());
 const saved=await ok('drawing-correction',patch(beforeCorrection,'  SYN-DRAW-NEW  '));
 assert.equal(saved.ok,true);const corrected=current(originalOrder.id);assert.deepEqual(saved.order,corrected);
 assert.deepEqual(corrected,{...beforeCorrection,drawing:'SYN-DRAW-NEW',identityHistory:[identity(beforeCorrection)],ledger:{...beforeCorrection.ledger,columns:{...beforeCorrection.ledger.columns,J:'SYN-DRAW-NEW'}},extra:{...beforeCorrection.extra,'J · 图纸编号 / 款号':'SYN-DRAW-NEW'},version:beforeCorrection.version+1,updatedAt:corrected.updatedAt,updatedBy:corrected.updatedBy});
 assert.equal(orderCount(),countBefore);assert.deepEqual(current(historicReport.id),historicReport);
 const recordsAfterCorrection=rawRecords(),afterCorrectionById=new Map(recordsAfterCorrection.map(record=>[record.id,record])),beforeCorrectionIds=new Set(recordsBeforeCorrection.map(record=>record.id));
 const added=recordsAfterCorrection.filter(record=>!beforeCorrectionIds.has(record.id));assert.equal(added.length,1);const audit=added[0];
 assert.equal(audit.kind,'audit');assert.equal(audit.action,'更正图纸编号');assert.equal(audit.targetId,originalOrder.id);assert.equal(audit.lineId,originalOrder.id);assert.deepEqual(audit.before,beforeCorrection);assert.deepEqual(audit.after,corrected);assert.equal(audit.source,'合成测试核对图纸编号');
 for(const prior of recordsBeforeCorrection)if(prior.id!==originalOrder.id)assert.deepEqual(afterCorrectionById.get(prior.id),prior);
 const originalAfter=await call('ledger-file?id='+encodeURIComponent(job.id));assert.equal(originalAfter.status,200);assert.deepEqual(Buffer.from(await originalAfter.arrayBuffer()),storedOriginal);
 pass('更正同步图号、原表 J 和附加字段，明细 ID / 生产数据不变；旧完整身份和前后审计保留，原附件及旧 MES 事实字节不改');

 await rejected('drawing-correction',patch(beforeCorrection,'SYN-DRAW-STALE'),409);
 const noOpSnapshot=clone(rawRecords()),noOp=await ok('drawing-correction',patch(corrected,corrected.drawing));assert.equal(noOp.unchanged,true);assert.deepEqual(rawRecords(),noOpSnapshot);
 await rejected('commit-import',{id:pendingStandard.id,selected:[2]},409);
 await rejected('ledger-commit',{id:pendingLedger.id,offset:0},409);
 await rejected('factory-order-table-commit',{id:pendingFactory.id},409);
 pass('旧版本修改和三类旧待提交预览均阻止覆盖或重建；同值保存不产生新版本或审计');

 for(const [drawing,marker] of [['SYN-DRAW-OLD','old identity reupload'],['SYN-DRAW-NEW','new identity reupload']]){
  const held=await original(makeLedger(drawing,marker),'active','synthetic-drawing-held.xlsx');assert.equal(held.summary.newRows,0);assert.equal(held.summary.heldRows,1);assert.equal(held.total,0);await ok('ledger-commit',{id:held.id,offset:0});
 }
 assert.equal(orderCount(),countBefore);assert.deepEqual(current(originalOrder.id),corrected);
 const oldPlain={订单号:originalOrder.orderNo,客户:originalOrder.customer,图纸编号:originalOrder.drawing,色号:originalOrder.color,镜片类型:originalOrder.lens,订单数量:originalOrder.quantity};
 const oldPlainPreview=await preview([oldPlain]);assert.equal(oldPlainPreview.rows[0].status,'error');assert.match(oldPlainPreview.rows[0].reason,/图|历史|编号/);
 const attempt=await preview([{...oldPlain,_明细编号:originalOrder.id,图纸编号:'SYN-DRAW-UNAPPROVED'}]);assert.equal(attempt.rows[0].status,'error');
 const oldFactoryNoId=XLSX.read(factoryBytes);for(const name of oldFactoryNoId.SheetNames)for(const col of ['AH','AI','AJ'])delete oldFactoryNoId.Sheets[name][col+'21'];
 await rejected('factory-order-table-preview',factoryForm(XLSX.write(oldFactoryNoId,{type:'buffer',bookType:'xlsx'})),400);
 await rejected('factory-order-table-preview',factoryForm(factoryBytes),[400,409]);
 assert.equal(orderCount(),countBefore);
 pass('旧 / 新图号原表重传均保留既有单，旧图号无 ID 标准及工厂表明确拦截，不重复建单或退回旧图号');

 const safeRoundtrip=await preview([{...oldWorking,'内部跟进备注':'图号更正后的安全回传备注'}]);assert.equal(safeRoundtrip.rows[0].status,'update');assert.equal(safeRoundtrip.rows[0].after.drawing,corrected.drawing);
 await ok('commit-import',{id:safeRoundtrip.id,selected:[2]});let latest=current(originalOrder.id);assert.equal(latest.drawing,corrected.drawing);assert.equal(latest.ledger.columns.J,corrected.drawing);assert.equal(latest.extra['J · 图纸编号 / 款号'],corrected.drawing);assert.equal(latest.notes,'图号更正后的安全回传备注');assert.deepEqual(latest.identityHistory,corrected.identityHistory);
 const forged={id:'synthetic_drawing_forged_job',kind:'import',importType:'orders',actorId:(await state()).me.id,createdAt:new Date().toISOString(),status:'待确认',filename:'synthetic.xlsx',rows:[{index:2,status:'update',expectedVersion:latest.version,before:clone(latest),after:{...clone(latest),drawing:'SYN-DRAW-FORGED'},changes:['drawing']}]};rawPut(forged);
 await rejected('commit-import',{id:forged.id,selected:[2]},[400,403,409]);
 const ledgerExport=await call('ledger-export?mode=active&q='+encodeURIComponent(latest.orderNo));assert.equal(ledgerExport.status,200);const ledgerBook=XLSX.read(await ledgerExport.arrayBuffer()),ledgerRow=XLSX.utils.sheet_to_json(ledgerBook.Sheets[ledgerBook.SheetNames[0]]).find(row=>row['_明细编号']===latest.id);assert.equal(ledgerRow['款号'],latest.drawing);
 const latestFactoryExport=await call('factory-order-table-export?lineId='+encodeURIComponent(latest.id));assert.equal(latestFactoryExport.status,200);const latestFactoryBook=XLSX.read(await latestFactoryExport.arrayBuffer());for(const name of latestFactoryBook.SheetNames)assert.equal(latestFactoryBook.Sheets[name].B21.v,latest.drawing);
 pass('有可靠导出基线的旧工作表只合并合法跟进字段，不回退图号；提交层再次拦截绕过，最新总表及中英工厂表均导出新图号');

 const uniqueOld=await preview([{...mesRow,报工编号:'SYN-DRAW-MES-AFTER',报工时间:'2026-10-12 09:00:00'}],'mes');assert.equal(uniqueOld.rows[0].after.lineId,originalOrder.id);assert.equal(uniqueOld.rows[0].after.drawing,originalOrder.drawing);await ok('commit-import',{id:uniqueOld.id,selected:[2]});
 const ambiguous=fixture('MES-AMBIGUOUS',{orderNo:originalOrder.orderNo,drawing:originalOrder.drawing,color:originalOrder.color,lens:originalOrder.lens,batch:originalOrder.batch});
 const ambiguousMes=await preview([{...mesRow,报工编号:'SYN-DRAW-MES-AMBIGUOUS',报工时间:'2026-10-12 10:00:00'}],'mes');assert.equal(ambiguousMes.rows[0].after.lineId,'');assert.match(ambiguousMes.rows[0].reason,/未匹配/);assert.deepEqual(current(historicReport.id),historicReport);
 // Move only the synthetic ambiguity fixture outside this key for the remaining
 // correction checks; its prior image stays in this test, never in production.
 rawPut({...ambiguous,orderNo:'SYN-DRAW-MES-OTHER'});
 pass('MES 旧图号唯一历史身份仍关联原明细，歧义不猜测关联，既有报工事实不改写');

 // Native report IDs and the official composite format must not record the same
 // MES completion twice when the drawing was corrected between the two files.
 const formatOrder=fixture('MES-FORMAT',{drawing:'DNSYNOLD'}),formatNative={...mesRow,报工编号:'SYN-DRAW-MES-FORMAT-NATIVE',订单号:formatOrder.orderNo,图纸编号:formatOrder.drawing,工单号:'SYN-DRAW-MES-FORMAT-WO',报工时间:'2026-10-12 11:00:00'};
 const nativeJob=await preview([formatNative],'mes');assert.equal(nativeJob.rows[0].after.lineId,formatOrder.id);await ok('commit-import',{id:nativeJob.id,selected:[2]});
 await ok('drawing-correction',patch(formatOrder,'DNSYNNEW','合成 MES 跨格式核对'));
 const officialRow={开始时间:'2026-10-12 10:00:00',报工时间:formatNative.报工时间,工单号:formatNative.工单号,工序编号:'SYN-PACK',工序名称:`包装(BP-${formatOrder.orderNo}-DNSYNNEW-${formatOrder.color})`,生产任务号:'SYN-TASK',产品:'DNSYNNEW',单位:'副',产出良品数:formatNative.良品数,生产批号:'SYN-PRODUCTION-BATCH',审批状态:'已审批'};
 const officialBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(officialBook,XLSX.utils.json_to_sheet([officialRow]),'MES');
 const officialForm=new FormData();officialForm.set('file',new File([XLSX.write(officialBook,{type:'buffer',bookType:'xlsx'})],'synthetic-mes-official.xlsx'));officialForm.set('type','mes');officialForm.set('header','1');officialForm.set('lensMapping',JSON.stringify({BP:'白片'}));
 const officialJob=await ok('preview',officialForm);assert.equal(officialJob.rows[0].status,'error');assert.match(officialJob.rows[0].reason,/另一种导出格式|重复/);await rejected('commit-import',{id:officialJob.id,selected:[2]},400);
 const formatReports=rawRecords().filter(record=>record.kind==='report'&&record.lineId===formatOrder.id);assert.equal(formatReports.length,1);assert.equal(formatReports[0].drawing,'DNSYNOLD');assert.equal(formatReports[0].quantity,formatNative.良品数);
 pass('MES 更正前原生编号与更正后复合格式的同笔报工仍识别为重复，不因图号变化二次计数');

 const collisionBase=current(originalOrder.id),currentCollision=fixture('CURRENT-COLLISION',{orderNo:collisionBase.orderNo,drawing:'SYN-DRAW-RESERVED',color:collisionBase.color,lens:collisionBase.lens,batch:collisionBase.batch});
 await rejected('drawing-correction',patch(collisionBase,currentCollision.drawing),409);
 const historicalCollision=fixture('HISTORICAL-COLLISION',{orderNo:collisionBase.orderNo,drawing:'SYN-DRAW-OTHER-CURRENT',color:collisionBase.color,lens:collisionBase.lens,batch:collisionBase.batch,identityHistory:[{...identity(collisionBase),drawing:'SYN-DRAW-OTHER-OLD'}]});
 await rejected('drawing-correction',patch(collisionBase,historicalCollision.identityHistory[0].drawing),409);
 const pmcSaved=await ok('drawing-correction',patch(collisionBase,'SYN-DRAW-PMC-NEW','合成 PMC 核对修改'),pmc);latest=current(originalOrder.id);assert.deepEqual(pmcSaved.order,latest);assert.equal(latest.updatedBy,pmc.displayName);assert.deepEqual(latest.identityHistory,[identity(collisionBase),identity(originalOrder)]);
 pass('其他明细当前或历史完整业务键均保留防冲突，PMC 可更正并累积旧身份，不合并其他明细');

 const batchOrder=fixture('BATCH',{batch:'SYNTHETIC-BATCH',drawing:'SYN-BATCH-OLD'}),differentBatch=fixture('OTHER-BATCH',{orderNo:batchOrder.orderNo,batch:'OTHER-BATCH',drawing:'SYN-BATCH-NEW'});
 const batchSaved=await ok('drawing-correction',patch(batchOrder,differentBatch.drawing));assert.deepEqual(batchSaved.order.identityHistory,[identity(batchOrder)]);assert.equal(batchSaved.order.batch,'SYNTHETIC-BATCH');
 const lengthOrder=fixture('LENGTH');assert.equal((await ok('drawing-correction',patch(lengthOrder,'X'.repeat(120)))).order.drawing.length,120);
 const raceOrder=fixture('RACE'),raceBefore=clone(rawRecords()),race=await Promise.all([call('drawing-correction',patch(raceOrder,'SYN-RACE-A')),call('drawing-correction',patch(raceOrder,'SYN-RACE-B'),pmc)]);assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
 const raceSaved=current(raceOrder.id);assert.equal(raceSaved.version,raceOrder.version+1);assert.deepEqual(raceSaved.identityHistory,[identity(raceOrder)]);assert.equal(rawRecords().filter(record=>record.kind==='audit'&&record.targetId===raceOrder.id&&!raceBefore.some(prior=>prior.id===record.id)).length,1);
 pass('完整历史身份包含批次且不误挡不同批次，120 字边界可保存；并发更正只有一个原子成功');

 latest=current(originalOrder.id);await ok('ledger-lifecycle',{id:latest.id,version:latest.version,mode:'archived',reason:'合成图号更正后结单测试',closedDate:'2026-10-12'});const closed=current(latest.id),closedCount=orderCount();
 for(const drawing of [originalOrder.drawing,closed.drawing]){
  const held=await original(makeLedger(drawing,'closed identity '+drawing),'active','synthetic-drawing-closed-active.xlsx');assert.equal(held.summary.newRows,0);assert.equal(held.summary.heldRows,1);await ok('ledger-commit',{id:held.id,offset:0});
 }
 assert.deepEqual(current(closed.id),closed);assert.equal(orderCount(),closedCount);
 pass('更正后结单仍保留历史身份，旧 / 新图号不能通过在制原表重传重新建单或复活归档数据');

 const finalRecords=new Map(rawRecords().map(record=>[record.id,record]));for(const prior of priorRecords)assert.deepEqual(finalRecords.get(prior.id),prior);
 pass('图号更正回归不改任何前序客户、账号、报价、订单或历史记录，仅操作本套合成夹具');
}
