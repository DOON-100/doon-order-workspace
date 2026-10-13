import assert from 'node:assert/strict';

// Independent-entry coverage uses only this suite's synthetic customer records.
export async function testCustomerProjectEntries({ok,call,state,pass,rawRecords,rawInsert}){
 const token=()=>crypto.randomUUID(),current=id=>rawRecords().find(row=>row.id===id);
 const users={};for(const key of ['writer','outsider']){const user={userId:'synthetic_entry_'+key,email:'synthetic-entry-'+key+'@test.invalid',displayName:'独立录入合成-'+key,fullName:'独立录入合成-'+key};await ok('member',{name:user.displayName,email:user.email,role:'clerk',customers:[],active:true});await ok('enroll',{},user);users[key]=user;}
 const member=(await state()).members.find(row=>row.email===users.writer.email);
 const customer=(await ok('customer-save',{customer:'独立录入合成客户',customerCode:'SYN-INDEPENDENT',salesName:'',serviceName:member.name,salesMemberIds:[],serviceMemberIds:[member.id],active:true})).item;
 const original=(await ok('customer-project-save',{token:token(),customerId:customer.id,title:'独立录入合成项目'})).item;
 const project={...original,id:'synthetic_entry_archived_project',status:'archived'};rawInsert(project);
 const save=(entryType,values={})=>({entryType,token:token(),projectId:project.id,...values});
 const create=async(entryType,values={})=>(await ok('customer-project-entry-save',save(entryType,values),users.writer)).item;
 const edit=async(entryType,row,values={})=>create(entryType,{id:row.id,version:current(row.id).version,...values});
 const deny=async(body,user=users.writer,status=400)=>{const before=structuredClone(rawRecords()),response=await call('customer-project-entry-save',body,user);assert.equal(response.status,status,await response.text());assert.deepEqual(rawRecords(),before,'Rejected independent entry must not write');};
 const patches={item:{model:'修改款色',quantity:25_000_000},round:{title:'修改轮次',status:'transferred',type:'revision',scope:[]},communication:{content:'修改沟通',nextAction:'仅登记，不隐式生成另一待办'},task:{title:'修改待办',status:'done',result:'直接保存处理结果'},drawing:{drawingNo:'修改图纸',attachmentIds:[],status:'withdrawn'},confirmation:{decision:'approved',evidence:'后补确认'},quote:{quoteNo:'MANUAL-QUOTE',amount:'',cost:'成本由工程后补'},sample:{status:'closed',scope:[]},dispatch:{trackingNo:'MANUAL-TRACK',lines:[{itemId:'',quantity:25_000_000}]},feedback:{decision:'approved'},handover:{orderNo:'MANUAL-ORDER',orderLinks:[{itemId:'',orderId:'',quantity:25_000_000}]},attachment:{filename:'修改资料.pdf',note:'先登记后上传'}};
 const created={};for(const entryType of Object.keys(patches)){const row=await create(entryType);assert.equal(row.roundId,'');assert.equal(row.version,1);created[entryType]=await edit(entryType,row,patches[entryType]);assert.equal(created[entryType].version,2);for(const [key,value]of Object.entries(patches[entryType]))assert.deepEqual(created[entryType][key],entryType==='quote'&&key==='amount'?0:value);}
 assert.equal(current(project.id).status,'archived');assert.equal(rawRecords().filter(row=>row.kind==='customer_project_task'&&row.projectId===project.id).length,1,'Independent communication never creates a duplicate task');
 assert.equal(created.task.reviewHistory.length,2);assert.equal(created.quote.cost,'成本由工程后补');
 let visible=await ok('customer-project-data',undefined,users.writer);for(const key of ['items','rounds','communications','tasks','drawings','confirmations','quoteLinks','samples','dispatches','feedback','handovers','attachments'])assert(visible[key].some(row=>row.projectId===project.id),key);assert.equal(visible.quoteLinks.find(row=>row.id===created.quote.id).quoteNo,'MANUAL-QUOTE');
 pass('十二类项目记录无轮次、款色、附件、报价、收款或状态前置即可独立新增和修改；归档项目仍可登记，数量无人工上限');

 const repeatBody=save('communication',{content:'幂等新增'}),repeated=await ok('customer-project-entry-save',repeatBody,users.writer);assert.equal((await ok('customer-project-entry-save',repeatBody,users.writer)).item.id,repeated.item.id);
 await deny({...repeatBody,content:'同请求号不同内容'},users.writer,409);await deny(save('item',{id:created.item.id,version:1,model:'旧版覆盖'}),users.writer,409);
 await deny(save('item'),users.outsider,403);await deny(repeatBody,users.outsider,403);await deny(save('item',{quantity:-1}));await deny(save('sample',{paymentSnapshot:{allowed:true}}));await deny(save('attachment',{fileKey:'forged-file-key'}));
 await deny(save('sample',{status:'unknown'}));const defaultSample=await create('sample',{status:'',purpose:''});assert.equal(defaultSample.status,'pending');assert.equal(defaultSample.purpose,'development');
 const foreignProject=(await ok('customer-project-save',{token:token(),customerId:customer.id,title:'同客户另一项目'})).item;
 const foreignItem=(await ok('customer-project-item-save',{token:token(),projectId:foreignProject.id,model:'另一项目款色',quantity:1})).item;
 await deny(save('round',{scope:[{itemId:foreignItem.id,quantity:1}]}));await deny(save('round',{roundId:'missing-round'}));await deny(save('item',{id:foreignItem.id,version:1}),users.writer,403);
 const sourceQuote={id:'synthetic_entry_quote_source',kind:'customer_quote',customerAccountId:customer.id,version:1,status:'draft',lines:[{id:'synthetic-entry-quote-line',model:'Synthetic'}]};rawInsert(sourceQuote);
 for(const body of [save('quote',{quoteId:sourceQuote.id,quoteVersion:99}),save('quote',{quoteId:sourceQuote.id,quoteVersion:1,lineIds:['missing-line']})]){const response=await call('customer-project-entry-save',body);assert.equal(response.status,400,await response.text());}
 const linked=(await ok('customer-project-entry-save',save('quote',{quoteId:sourceQuote.id,quoteVersion:1,lineIds:[sourceQuote.lines[0].id]}))).item;assert.equal(linked.quoteId,sourceQuote.id);await deny(save('quote',{id:linked.id,version:linked.version,quoteId:''}),users.writer,403);
 pass('独立保存保留客户权限、关联归属、并发版本和幂等校验，拒绝客户端伪造冻结资料与文件存储键');

 const editableRound=await create('round',{scope:[{itemId:created.item.id,quantity:10}]});
 const order={id:'synthetic_entry_formal_order',kind:'order',version:1,customer:customer.customerCode,orderNo:'SYN-ENTRY-ORDER',drawing:'SYN-ENTRY-DRAWING',color:'',lens:'',quantity:10,ownerEmail:users.writer.email,sourceStatus:'正式订单',workflowStatus:'PMC待接单',createdAt:'2026-10-13',updatedAt:'2026-10-13'};rawInsert(order);
 const released={...created.handover,id:'synthetic_entry_released_handover',independentEntry:false,roundId:editableRound.id,version:1,type:'bulk',scope:[{itemId:created.item.id,quantity:4}],orderLinks:[{itemId:created.item.id,orderId:order.id,quantity:4,orderVersion:1}],drawingIds:[],quoteLinkId:'',paymentSnapshot:{allowed:true,missing:[]}};rawInsert(released);
 const beforeRound=(await ok('customer-project-data',undefined,users.writer)).rounds.find(row=>row.id===editableRound.id);assert.equal(beforeRound.remainingScope[0].quantity,6);
 await create('handover',{roundId:editableRound.id,scope:[{itemId:created.item.id,quantity:25_000_000}],orderLinks:[{itemId:created.item.id,orderId:order.id,quantity:25_000_000}]});
 const changed=await edit('handover',released,{roundId:'',scope:[],orderLinks:[],note:'仅修改登记信息'});assert(!('executionSnapshot'in changed));assert(!('paymentSnapshot'in changed));assert.deepEqual(current(released.id).executionSnapshot,released);
 await edit('handover',changed,{quantity:123,note:'再次修改登记'});assert.deepEqual(current(released.id).executionSnapshot,released);
 visible=await ok('customer-project-data',undefined,users.writer);assert.equal(visible.rounds.find(row=>row.id===editableRound.id).remainingScope[0].quantity,6);assert(!('executionSnapshot'in visible.handovers.find(row=>row.id===released.id)));assert.deepEqual(current(order.id),order);
 const oldSample={...created.sample,id:'synthetic_entry_existing_sample',version:1,independentEntry:false,quoteLinkId:linked.id,itemSnapshot:[{model:'原下单款色',quantity:2}],paymentSnapshot:{allowed:true,missing:[]}};rawInsert(oldSample);
 const sampleEdit=await edit('sample',oldSample,{status:'pending',scope:[{itemId:created.item.id,quantity:999}]});assert(!('paymentSnapshot'in sampleEdit));assert(!('quoteLinkId'in sampleEdit));assert.deepEqual(current(oldSample.id).itemSnapshot,oldSample.itemSnapshot);assert.deepEqual(current(oldSample.id).paymentSnapshot,oldSample.paymentSnapshot);assert.equal(current(oldSample.id).quoteLinkId,linked.id);await deny(save('sample',{quoteLinkId:linked.id}),users.writer,403);
 const history=(await ok('customer-project-history?projectId='+project.id,undefined,users.writer)).history;assert(history.some(row=>row.targetId===released.id));assert(history.every(row=>!row.after?.executionSnapshot&&!row.before?.executionSnapshot));
 pass('独立交接不消耗正式转单额度，修改交接保存原执行快照；旧订单和样办下单快照保持原值且不泄漏到普通响应');

 const upload=new FormData();upload.set('projectId',project.id);upload.set('file',new File(['Synthetic attachment'],'independent.pdf',{type:'application/pdf'}));const attached=(await ok('customer-project-attachment',upload,users.writer)).item;const storedFileKey=current(attached.id).fileKey;
 await edit('attachment',attached,{filename:'renamed.pdf',note:'元数据独立维护'});assert.equal(current(attached.id).fileKey,storedFileKey);assert.equal((await call('customer-project-file?id='+attached.id,undefined,users.writer)).status,200);
 pass('已归档且没有轮次的项目可直接上传资料，修改附件名称保留真实原文件');
}
