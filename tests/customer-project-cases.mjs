import assert from 'node:assert/strict';

// Synthetic API integration suite. No production files, accounts or workbooks.
export async function testCustomerProjects({ok,call,state,pass,rawRecords,rawInsert,rawUpdate,admin}){
 const original=structuredClone(rawRecords()),token=()=>crypto.randomUUID(),current=id=>rawRecords().find(r=>r.id===id);
 const users={};for(const [key,role] of [['sales','sales'],['service','clerk'],['service2','sales'],['inactive','clerk'],['other','sales'],['pmc','pmc']]){
  const user={userId:'synthetic_project_'+key,email:'synthetic-project-'+key+'@test.invalid',displayName:'合成项目-'+key,fullName:'合成项目-'+key};await ok('member',{name:user.displayName,email:user.email,role,orderScope:'all',customers:[],active:true});await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,mid=key=>members.find(m=>m.email===users[key].email).id;
 const customer=(await ok('customer-save',{customer:'合成项目客户甲',customerCode:'TEST-PROJECT-A',salesName:users.sales.displayName,serviceName:users.service.displayName,pmcName:users.pmc.displayName,salesMemberIds:[mid('sales')],serviceMemberIds:[mid('service'),mid('service2'),mid('inactive')],active:true})).item;
 const inactiveMember=members.find(m=>m.id===mid('inactive')),beforeDisable=structuredClone(rawRecords());
 const deniedDisable=await call('member',{...inactiveMember,active:false});assert.equal(deniedDisable.status,409);assert.deepEqual(rawRecords(),beforeDisable);
 // Establish a pre-existing disabled history fixture without weakening the handover guard.
 rawUpdate({...inactiveMember,active:false});
 const otherCustomer=(await ok('customer-save',{customer:'合成项目客户乙',customerCode:'TEST-PROJECT-B',salesName:users.other.displayName,serviceName:'',pmcName:'',salesMemberIds:[mid('other')],serviceMemberIds:[],active:true})).item;
 const customerBefore=structuredClone(current(customer.id));
 const team=(await ok('customer-project-team-save',{token:token(),name:'合成项目小组',leaderIds:[mid('sales')],salesMemberIds:[mid('sales'),mid('other')],serviceMemberIds:[mid('service'),mid('service2')],customerIds:[customer.id],active:true})).item;
 assert.deepEqual(current(customer.id),customerBefore);assert.equal((await ok('customer-project-data',undefined,users.other)).customers.some(c=>c.id===customer.id),false);
 const denied=async(action,body,user=users.other,status=403)=>{const before=structuredClone(rawRecords()),res=await call(action,body,user);assert.equal(res.status,status,await res.text());assert.deepEqual(rawRecords(),before);};
 const serviceIds=[mid('service'),mid('service2')];
 const projectPayload={token:token(),customerId:customer.id,title:'合成新品开发',code:'TEST-PROJECT-001',description:'只在合成测试数据库',teamId:team.id,salesMemberId:mid('sales'),serviceMemberId:mid('service'),serviceMemberIds:serviceIds,dueDate:'2026-11-30',status:'active'};
 let project=(await ok('customer-project-save',projectPayload,users.sales)).item;
 assert.equal((await ok('customer-project-save',projectPayload,users.sales)).item.id,project.id);
 for(const key of ['service','service2']){const visible=(await ok('customer-project-data',undefined,users[key])).projects.find(p=>p.id===project.id);assert(visible?.canWrite);assert.deepEqual(visible.serviceMemberIds,serviceIds);}
 assert(!(await ok('customer-project-data',undefined,users.other)).projects.some(p=>p.id===project.id));
 await denied('customer-project-save',{...projectPayload,token:token(),id:project.id,version:current(project.id).version},users.other);
 await denied('customer-project-team-save',{id:team.id,version:team.version,name:team.name,customerIds:team.customerIds,token:token()},users.sales);
 pass('客户项目小组仅作组织视图，不改旧客户权限；同组既有责任人共享，其他组及小组未授权成员隔离');
 const editProject=patch=>({...projectPayload,token:token(),id:project.id,version:current(project.id).version,...patch});
 for(const invalidIds of [[mid('service'),mid('other')],[mid('service'),mid('inactive')],[mid('service'),mid('service')]])await denied('customer-project-save',editProject({serviceMemberIds:invalidIds}),users.sales,400);
 const legacyPayload=()=>{const body=editProject({});delete body.serviceMemberIds;return body;};
 project=(await ok('customer-project-save',legacyPayload(),users.service)).item;assert.deepEqual(project.serviceMemberIds,serviceIds);
 await denied('customer-project-save',{...legacyPayload(),serviceMemberId:mid('service2')},users.service,409);
 project=(await ok('customer-project-save',editProject({serviceMemberIds:[]}),users.sales)).item;
 assert.deepEqual(project.serviceMemberIds,[]);assert.equal(project.serviceMemberId,'');
 assert.deepEqual((await ok('customer-project-data',undefined,users.service)).projects.find(p=>p.id===project.id).serviceMemberIds,[]);
 project=(await ok('customer-project-save',editProject({serviceMemberIds:serviceIds}),users.sales)).item;
 const legacyProject={...project,id:'synthetic_project_legacy_single_service',code:'TEST-PROJECT-LEGACY',serviceMemberId:mid('service2')};delete legacyProject.serviceMemberIds;rawInsert(legacyProject);
 assert.deepEqual((await ok('customer-project-data',undefined,users.service2)).projects.find(p=>p.id===legacyProject.id).serviceMemberIds,[mid('service2')]);
 assert.equal(Object.hasOwn(current(legacyProject.id),'serviceMemberIds'),false,'读取旧单客服记录不能触发数据迁移');
 pass('多客服逐人校验既有客户权限，拒绝未授权、停用及重复成员；旧单人兼容且清空与旧客户端保存不会误改多客服');
 const narrowTeam=(await ok('customer-project-team-save',{token:token(),name:'合成项目客服单组',leaderIds:[mid('sales')],salesMemberIds:[mid('sales')],serviceMemberIds:[mid('service'),mid('other')],customerIds:[customer.id],active:true})).item;
 const groupedPayload={...projectPayload,token:token(),teamId:narrowTeam.id,code:'TEST-PROJECT-GROUP',title:'合成组内客服校验',serviceMemberIds:[mid('service')]};
 // Customer write access alone is insufficient, and sales/leader membership is not service membership.
 for(const outsider of ['service2','sales'])await denied('customer-project-save',{...groupedPayload,token:token(),serviceMemberIds:[mid(outsider)]},users.sales,400);
 // Being configured as team service staff must not grant access to an unrelated customer.
 await denied('customer-project-save',{...groupedPayload,token:token(),serviceMemberIds:[mid('other')]},users.sales,400);
 let groupedProject=(await ok('customer-project-save',groupedPayload,users.sales)).item;
 const editGrouped=patch=>({...groupedPayload,token:token(),id:groupedProject.id,version:current(groupedProject.id).version,...patch});
 groupedProject=(await ok('customer-project-save',editGrouped({description:'合成同组合法更新'}),users.service)).item;
 assert.deepEqual(groupedProject.serviceMemberIds,[mid('service')]);
 await denied('customer-project-save',editGrouped({serviceMemberIds:serviceIds}),users.sales,400);
 groupedProject=(await ok('customer-project-save',editGrouped({teamId:team.id,serviceMemberIds:serviceIds}),users.sales)).item;
 assert.deepEqual(groupedProject.serviceMemberIds,serviceIds);
 await denied('customer-project-save',editGrouped({teamId:narrowTeam.id,serviceMemberIds:serviceIds}),users.sales,400);
 groupedProject=(await ok('customer-project-save',editGrouped({teamId:narrowTeam.id,serviceMemberIds:[mid('service')]}),users.sales)).item;
 assert.deepEqual(groupedProject.serviceMemberIds,[mid('service')]);
 // Historical out-of-team staff remain intact on read and same-team edits, including old single-owner forms.
 const historical={...groupedProject,id:'synthetic_project_historical_team_service',code:'TEST-PROJECT-HISTORICAL-GROUP',serviceMemberIds:serviceIds,serviceMemberId:mid('service')};rawInsert(historical);
 const beforeHistoricalRead=structuredClone(rawRecords());
 assert.deepEqual((await ok('customer-project-data',undefined,users.service2)).projects.find(p=>p.id===historical.id).serviceMemberIds,serviceIds);
 assert.deepEqual(rawRecords(),beforeHistoricalRead);
 const editHistorical=patch=>({...groupedPayload,token:token(),id:historical.id,version:current(historical.id).version,serviceMemberIds:serviceIds,...patch});
 let historicalSaved=(await ok('customer-project-save',editHistorical({description:'合成历史分派保留'}),users.service2)).item;
 assert.deepEqual(historicalSaved.serviceMemberIds,serviceIds);assert.equal(historicalSaved.version,historical.version+1);
 const historicalLegacy=editHistorical({description:'合成旧表单仍保留历史分派'});delete historicalLegacy.serviceMemberIds;
 historicalSaved=(await ok('customer-project-save',historicalLegacy,users.service)).item;assert.deepEqual(historicalSaved.serviceMemberIds,serviceIds);
 await denied('customer-project-save',editHistorical({serviceMemberIds:[...serviceIds,mid('sales')]}),users.sales,400);
 const thirdTeam=(await ok('customer-project-team-save',{token:token(),name:'合成项目另一客服组',leaderIds:[mid('sales')],salesMemberIds:[mid('sales')],serviceMemberIds:[mid('service2')],customerIds:[customer.id],active:true})).item;
 await denied('customer-project-save',editHistorical({teamId:thirdTeam.id}),users.sales,400);
 historicalSaved=(await ok('customer-project-save',editHistorical({teamId:thirdTeam.id,serviceMemberIds:[mid('service2')]}),users.sales)).item;
 assert.deepEqual(historicalSaved.serviceMemberIds,[mid('service2')]);assert.equal(historicalSaved.serviceMemberId,mid('service2'));
 const ungrouped=(await ok('customer-project-save',{...groupedPayload,token:token(),teamId:'',serviceMemberIds:[mid('service2')]},users.sales)).item;
 assert.deepEqual(ungrouped.serviceMemberIds,[mid('service2')]);assert.deepEqual(current(customer.id),customerBefore);
 pass('项目客服须同时属于所选组客服名单和客户责任；跨组新增、组长冒充客服及带旧客服切组均零写拒绝，同组历史分派保留且无组规则不变');
 const makeItem=async(model,color)=> (await ok('customer-project-item-save',{token:token(),projectId:project.id,model,drawing:model,color,lens:'白片',quantity:10},users.sales)).item;
 const itemA=await makeItem('SYN-PROJ-A','C1'),itemB=await makeItem('SYN-PROJ-B','C2');
 const roundPayload={token:token(),projectId:project.id,title:'R1首次开发',type:'development',scope:[{itemId:itemA.id,quantity:2},{itemId:itemB.id,quantity:2}],stage:'图纸确认',requiredDrawingTypes:['2d'],requireQuote:true,requiredSampleIds:[],sampleGateStage:'order'};
 const round=(await ok('customer-project-round-save',roundPayload,users.service)).item;
 await denied('customer-project-round-save',{...roundPayload,id:round.id,version:99,token:token()},users.service,409);
 const otherProject=(await ok('customer-project-save',{token:token(),customerId:otherCustomer.id,title:'另一个客户项目'},users.other)).item;
 const otherItem=(await ok('customer-project-item-save',{token:token(),projectId:otherProject.id,model:'OTHER',quantity:2},users.other)).item;
 await denied('customer-project-round-save',{...roundPayload,token:token(),scope:[{itemId:otherItem.id,quantity:1}]},users.service,400);
 const comm={token:token(),projectId:project.id,roundId:round.id,channel:'email',contact:'合成联系人',occurredAt:'2026-10-12',content:'客户要求保留原始邮件并补齐设计参数。'.repeat(20),nextAction:'请工程核对结构',ownerId:mid('service'),dueDate:'2026-10-18',attachmentIds:[]};
 await ok('customer-project-communication',comm,users.sales);await ok('customer-project-communication',comm,users.sales);assert.equal(rawRecords().filter(r=>r.kind==='customer_project_communication'&&r.projectId===project.id).length,1);
 pass('款色与轮次按客户项目校验，旧版本拒绝；沟通追加与待办生成重试不重复');
 const form=new FormData();form.set('projectId',project.id);form.set('roundId',round.id);form.set('file',new File(['synthetic STEP contents'],'synthetic.step'));const attachment=(await ok('customer-project-attachment',form,users.sales)).item;
 await denied('customer-project-file?id='+attachment.id,undefined,users.other);assert.equal((await call('customer-project-file?id='+attachment.id,undefined,users.service)).status,200);
 const sharedAttachments=[],sharedCommunications=[];
 for(const key of ['service','service2']){
  const upload=new FormData();upload.set('projectId',project.id);upload.set('roundId',round.id);upload.set('file',new File(['synthetic STEP '+key],key+'.step'));
  const sharedAttachment=(await ok('customer-project-attachment',upload,users[key])).item;sharedAttachments.push(sharedAttachment);
  sharedCommunications.push((await ok('customer-project-communication',{...comm,token:token(),content:'合成客服协同跟进 '+key,ownerId:mid(key),nextAction:'',attachmentIds:[sharedAttachment.id]},users[key])).item);
 }
 for(const key of ['service','service2']){
  const sharedData=await ok('customer-project-data',undefined,users[key]),history=(await ok('customer-project-history?projectId='+project.id,undefined,users[key])).history;
  for(const record of sharedCommunications){assert(sharedData.communications.some(r=>r.id===record.id));assert(history.some(h=>h.targetId===record.id));}
  for(const file of [attachment,...sharedAttachments]){assert(sharedData.attachments.some(r=>r.id===file.id));assert.equal((await call('customer-project-file?id='+file.id,undefined,users[key])).status,200);}
 }
 assert.deepEqual(current(customer.id),customerBefore);
 pass('两名客服以各自账号追加沟通和上传资料，双方均能读取项目、对方沟通、附件及历史，客户主档保持原样');
 const drawing=(await ok('customer-project-drawing',{token:token(),projectId:project.id,roundId:round.id,itemIds:[itemA.id,itemB.id],type:'2d',drawingNo:'SYN-2D',revision:'V1',attachmentIds:[attachment.id]},users.service)).item;
 const quote={id:'synthetic_project_quote',kind:'customer_quote',customerAccountId:customer.id,customerName:customer.customer,customerCode:customer.customerCode,status:'confirmed',version:2,quoteNo:'SYN-PROJECT-Q',internalNotesZh:'SYNTHETIC-PROJECT-COST-SECRET',lines:[{id:'syn-line-a',model:itemA.model},{id:'syn-line-b',model:itemB.model}]};rawInsert(quote);rawInsert({id:'synthetic_project_quote_revision',kind:'customer_quote_revision',quoteId:quote.id,version:2,snapshot:quote});
 const linkPayload={token:token(),projectId:project.id,roundId:round.id,itemIds:[itemA.id,itemB.id],quoteId:quote.id,quoteVersion:2,lineIds:['syn-line-a','syn-line-b'],acceptedBy:'合成客户',acceptedDate:'2026-10-12',evidence:'合成客户邮件已接受报价V2'};
 await denied('customer-project-quote-link',linkPayload,users.sales);const quoteLink=(await ok('customer-project-quote-link',linkPayload)).item;
 const salesMember=(await state()).members.find(member=>member.id===mid('sales'));
 await ok('member',{...salesMember,role:'admin'});const temporaryLink={...linkPayload,token:token(),evidence:'合成临时管理员创建报价接受关联'};await ok('customer-project-quote-link',temporaryLink,users.sales);
 await ok('member',{...salesMember,role:'sales'});await denied('customer-project-quote-link',temporaryLink,users.sales);
 const releasePayload={token:token(),projectId:project.id,roundId:round.id,roundVersion:1,purpose:'development',scope:[{itemId:itemA.id,quantity:2}],drawingIds:[drawing.id],quoteLinkId:quoteLink.id,ownerId:mid('pmc'),requiredDate:'2026-10-25'};
 await denied('customer-project-sample-release',releasePayload,users.service,400);
 await ok('customer-project-confirmation',{token:token(),projectId:project.id,roundId:round.id,drawingId:drawing.id,itemIds:[itemA.id,itemB.id],decision:'approved',contact:'合成客户',date:'2026-10-12',evidence:'合成客户明确确认V1与款色范围'},users.service);
 await denied('customer-project-sample-release',releasePayload,users.service,400);
 await denied('project-payment-requirement',{token:token(),projectId:project.id,roundId:round.id,mode:'free',version:0,reason:'合成免费开发'},users.service);
 await denied('project-payment-requirement',{token:token(),projectId:project.id,roundId:round.id,mode:'free',version:0,reason:'第二客服不能借协作获得收款核实权'},users.service2);
 await ok('project-payment-requirement',{token:token(),projectId:project.id,roundId:round.id,mode:'free',version:0,reason:'管理员批准合成免费开发'});
 const sample=(await ok('customer-project-sample-release',releasePayload,users.service)).item;assert.equal((await ok('customer-project-sample-release',releasePayload,users.service)).item.id,sample.id);
 assert.equal(current(round.id).status,'partial');assert.equal(current(project.id).status,'active');assert(!rawRecords().some(r=>r.kind==='order'&&r.id===sample.id));
 const pmcData=await ok('customer-project-data',undefined,users.pmc);assert(pmcData.samples.some(x=>x.id===sample.id));assert.equal(pmcData.projects.length,0);assert.equal(pmcData.quoteLinks.length,0);assert.equal(pmcData.communications.length,0);assert(!('paymentSnapshot' in pmcData.samples[0]));assert.equal((await call('customer-project-file?id='+attachment.id,undefined,users.pmc)).status,200);
 const serviceData=await ok('customer-project-data',undefined,users.service);assert.equal(serviceData.quoteLinks[0].quoteNo,quote.quoteNo);assert(!JSON.stringify(serviceData).includes('SYNTHETIC-PROJECT-COST-SECRET'));await denied('customer-quote-save',{id:quote.id,version:quote.version},users.service);
 const service2Data=await ok('customer-project-data',undefined,users.service2);assert(service2Data.drawings.some(d=>d.id===drawing.id));assert.equal(service2Data.quoteLinks[0].quoteNo,quote.quoteNo);assert(!JSON.stringify(service2Data).includes('SYNTHETIC-PROJECT-COST-SECRET'));await denied('customer-quote-save',{id:quote.id,version:quote.version},users.service2);
 pass('准确图纸版本、客户报价接受与财务核实同时满足才放样办；部分款色只完成已转范围，独立样办不污染PMC大货统计');
 await denied('customer-project-sample-update',{id:sample.id,version:1,status:'accepted',note:'越权制作'},users.service);
 let internal=(await ok('customer-project-sample-update',{id:sample.id,version:1,status:'accepted',plannedDate:'2026-10-22',note:'内部已核对排期'},users.pmc)).item;
 await denied('customer-project-sample-update',{id:sample.id,version:1,status:'making',note:'旧版'},users.pmc,409);
 for(const status of ['making','qc','ready'])internal=(await ok('customer-project-sample-update',{id:sample.id,version:internal.version,status,plannedDate:'2026-10-22',note:'合成实际制作进度'},users.pmc)).item;
 internal=(await ok('customer-project-sample-promise',{id:sample.id,version:internal.version,promisedDate:'2026-10-24',promiseNote:'客服核实后对客回复'},users.service)).item;
 const dispatchPayload={token:token(),projectId:project.id,sampleId:sample.id,lines:[{itemId:itemA.id,quantity:2}],carrier:'合成物流',trackingNo:'SYN-TRACK',recipient:'合成收件人',shipDate:'2026-10-22'};
 const dispatch=(await ok('customer-project-sample-dispatch',dispatchPayload,users.service)).item;await ok('customer-project-sample-dispatch',dispatchPayload,users.service);
 await denied('customer-project-sample-dispatch',{...dispatchPayload,token:token()},users.service,400);
 await ok('customer-project-dispatch-receive',{id:dispatch.id,version:1,receivedDate:'2026-10-25'},users.service);
 assert.equal(rawRecords().filter(r=>r.kind==='customer_project_feedback'&&r.sampleId===sample.id).length,0);
 await ok('customer-project-sample-feedback',{token:token(),projectId:project.id,sampleId:sample.id,itemId:itemA.id,decision:'revise',contact:'合成客户',date:'2026-10-25',evidence:'合成客户收到样办后要求改镜腿',note:'镜腿加长1mm'},users.service);
 const revision=(await ok('customer-project-round-save',{...roundPayload,token:token(),title:'R2改样',type:'revision',parentRoundId:round.id,scope:[{itemId:itemA.id,quantity:2}],reason:'镜腿加长1mm'},users.service)).item;
 assert.equal(current(sample.id).status,'ready');assert.equal(current(round.id).status,'partial');assert.notEqual(revision.id,round.id);
 const rest=(await ok('customer-project-sample-release',{...releasePayload,token:token(),roundVersion:current(round.id).version,scope:[{itemId:itemB.id,quantity:2}]},users.service)).item;
 assert.equal(current(round.id).status,'transferred');assert.equal(current(project.id).status,'active');
 await denied('customer-project-round-save',{...roundPayload,id:round.id,version:current(round.id).version,token:token()},users.service,409);
 pass('样办内部权限、独立复期、实寄限额及签收不等于客批；改样新开轮次，已转原轮历史保留');
 const bulk=(await ok('customer-project-round-save',{token:token(),projectId:project.id,title:'B1大货',type:'bulk',scope:[{itemId:itemA.id,quantity:10}],requiredDrawingTypes:['2d'],requireQuote:false,requiredSampleIds:[sample.id],sampleGateStage:'order'},users.service)).item;
 await ok('project-payment-requirement',{token:token(),projectId:project.id,roundId:bulk.id,mode:'free',version:0,reason:'合成测试信用条件批准'});
 const order={id:'synthetic_project_bulk_order',kind:'order',version:1,customer:customer.customerCode,orderNo:'SYN-BULK-001',customerPO:'SYN-PO',drawing:itemA.drawing,color:itemA.color,lens:itemA.lens,batch:'',quantity:10,requestedDate:'2026-11-30',ownerEmail:'',stage:'待下达',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'',sourceStatus:'待正式订单确认',workflowStatus:'业务待提交',extra:{},createdAt:'2026-10-12',updatedAt:'2026-10-12'};rawInsert(order);
 const bulkPayload={token:token(),projectId:project.id,roundId:bulk.id,roundVersion:1,orderLinks:[{itemId:itemA.id,orderId:order.id,quantity:10,orderVersion:1}],drawingIds:[drawing.id]};
 await denied('customer-project-bulk-link',bulkPayload,users.service,400);
 await ok('customer-project-sample-feedback',{token:token(),projectId:project.id,sampleId:sample.id,itemId:itemA.id,decision:'approved',contact:'合成客户',date:'2026-10-27',evidence:'合成客户明确客批该样办'},users.service);
 await denied('customer-project-bulk-link',bulkPayload,users.service,400);
 const formal={...order,id:'synthetic_project_formal_order',sourceStatus:'正式订单',workflowStatus:'PMC待接单'};rawInsert(formal);const formalBefore=structuredClone(current(formal.id));
 const successful={...bulkPayload,token:token(),orderLinks:[{itemId:itemA.id,orderId:formal.id,quantity:10,orderVersion:1}]};const handover=(await ok('customer-project-bulk-link',successful,users.service)).item;assert.equal((await ok('customer-project-bulk-link',successful,users.service)).item.id,handover.id);
 assert.equal(current(bulk.id).status,'transferred');assert.deepEqual(current(formal.id),formalBefore);
 const frozenDrawing=structuredClone(current(drawing.id));await ok('customer-project-drawing-withdraw',{id:drawing.id,version:1,reason:'合成工程资料撤回需重新核对'},users.service);assert.equal(current(drawing.id).revision,frozenDrawing.revision);assert(rawRecords().some(r=>r.kind==='customer_project_task'&&r.handoverId===handover.id));assert.deepEqual(current(formal.id),formalBefore);
 const general=await ok('data',undefined,users.pmc);assert(!general.audits.some(a=>String(a.after?.kind||'').startsWith('customer_project')));
 await denied('customer-project-history?projectId='+project.id,undefined,users.other);
 pass('正式大货拒绝草稿及未客批，成功关联不写旧订单；撤回图纸生成异常，历史审计按客户隔离');
 const preserved=new Map(rawRecords().map(record=>[record.id,record]));
 for(const before of original)assert.deepEqual(preserved.get(before.id),before,'原记录不得被项目功能改写 '+before.id);
 assert.deepEqual(current(customer.id),customerBefore);
 pass('完整客户项目流程只新增自有实体，原客户、订单、报价及其他业务记录保持不变');
}
