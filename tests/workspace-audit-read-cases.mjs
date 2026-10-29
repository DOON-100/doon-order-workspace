import assert from 'node:assert/strict';

// Synthetic records only. Exercise the actual GET data response, including the
// authorization-before-limit rule and price-history redaction for each identity.
export async function testWorkspaceAuditReads({ok,admin,rawInsert,rawRecords,pass}){
 const prefix='synthetic_audit_read_'+crypto.randomUUID(),id=name=>prefix+'_'+name;
 const reader={userId:id('reader_user'),email:id('reader')+'@example.invalid'};
 const member={id:id('reader'),kind:'member',userId:reader.userId,email:reader.email,name:'Synthetic audit reader',role:'clerk',active:true,orderScope:'assigned',customers:[id('own_customer_code')],createdAt:'2026-01-01T00:00:00Z'};
 rawInsert(member);
 const ownOrder={id:id('own_order'),kind:'order',customer:id('own_customer_code'),orderNo:id('own_order_no'),ownerEmail:reader.email,quantity:1,version:1,extra:{syntheticOriginal:'preserve exactly'}};
 const otherOrder={...ownOrder,id:id('other_order'),customer:id('other_customer_code'),orderNo:id('other_order_no'),ownerEmail:'other@example.invalid'};
 rawInsert(ownOrder);rawInsert(otherOrder);
 const customer={id:id('customer'),kind:'customer_account',customer:'Synthetic audit customer',customerCode:ownOrder.customer,active:true,version:1,salesName:'Other synthetic owner',serviceName:member.name,salesMemberIds:[],serviceMemberIds:[member.id]};
 rawInsert(customer);
 const expectedAdmin=[],expectedReader=[];
 const add=(record,readerVisible=true,adminVisible=true)=>{rawInsert(record);if(adminVisible)expectedAdmin.push(record.id);if(readerVisible)expectedReader.push(record.id);};
 for(let i=0;i<360;i++){
  const own=i%4!==0,order=own?ownOrder:otherOrder;
  add({id:id('order_audit_'+i),kind:'audit',targetId:order.id,lineId:order.id,action:'Synthetic order update',createdAt:i===0?'2099-01-01T00:00:00Z':'2026-01-01T00:00:00Z',before:null,after:{id:order.id,kind:'order',quantity:i}},own);
 }
 // These newer entries exceed the page size. Limiting candidates before applying
 // permissions would hide the older authorized order history or leak private data.
 const kinds=['customer_project','project_charge','customer_workflow_private','business_followup_entry','engineering_drawing','unified_communication_entry','framework_private','process_record','fixed_tool_result','sales_color_row','sales_order_source','kingdee_sales_attempt','ar_invoice','payment_term','handoff_business_entry','customer_shared_entry','ie_quote'];
 for(let i=0;i<300;i++){
  const source={id:id('private_'+i),kind:kinds[i%kinds.length],content:'SYNTHETIC_PRIVATE_AUDIT_SENTINEL'};
  const placement=i%3;
  if(placement===0)rawInsert(source);
  add({id:id('private_audit_'+i),kind:'audit',targetId:placement===0?source.id:id('missing_'+i),lineId:ownOrder.id,before:placement===1?source:null,after:placement===2?source:null},false,false);
 }
 const quote={id:id('quote'),kind:'customer_quote',customerAccountId:customer.id,status:'confirmed',version:1,terms:[],internalCosts:[{amount:17}],internalNotesZh:'synthetic internal notes',exchangeRateCnyPerUsd:7,reviewNotes:['synthetic review'],sourceFormula:'synthetic formula',templateMapping:{field:'synthetic'},fileKey:'synthetic-private-file',path:'synthetic-private-path',lines:[{id:'synthetic-line',fileKey:'synthetic-line-file',internalCosts:9,price:12}]};
 rawInsert(quote);
 const revision={id:id('quote_revision'),kind:'customer_quote_revision',quoteId:quote.id,version:1,snapshot:quote};rawInsert(revision);
 add({id:id('quote_audit'),kind:'audit',targetId:revision.id,before:null,after:revision});
 const mailbox={id:id('mailbox'),kind:'member_notification_mailbox',memberId:member.id};rawInsert(mailbox);
 add({id:id('mailbox_audit'),kind:'audit',targetId:mailbox.id,lineId:ownOrder.id,after:mailbox},false);
 const archive={id:id('archive'),kind:'customer_price_archive',customerAccountId:customer.id,dataset:{schemaVersion:1,customer:{code:customer.customerCode,name:customer.customer},files:[],products:[],prices:[],issues:[]}};rawInsert(archive);
 const archiveChild={id:id('archive_child'),kind:'customer_price_file',archiveId:archive.id};rawInsert(archiveChild);
 add({id:id('archive_audit'),kind:'audit',targetId:archiveChild.id,lineId:ownOrder.id,after:{...archiveChild,fileKey:'synthetic-private-file'}},false);
 // The historical snapshot still authorizes an order entry after its target is
 // unavailable. An unrelated current target must not override private snapshots.
 add({id:id('dangling_order_audit'),kind:'audit',targetId:id('missing_order'),lineId:ownOrder.id,after:{id:ownOrder.id,kind:'order',quantity:1}});
 add({id:id('dangling_private_audit'),kind:'audit',targetId:ownOrder.id,lineId:ownOrder.id,before:{kind:'customer_project',id:id('old_project')},after:ownOrder},false,false);
 const before=rawRecords();
 for(const [identity,expected,serviceOnly] of [[admin,expectedAdmin,false],[reader,expectedReader,true]]){
  const data=await ok('data',undefined,identity);
  assert.deepEqual(data.audits.map(row=>row.id),expected.slice(-250).reverse(),'latest visible audit entries must keep insertion order after authorization');
  assert.equal(data.orders.find(row=>row.id===ownOrder.id).extra.syntheticOriginal,'preserve exactly');
  assert(!JSON.stringify(data.audits).includes('SYNTHETIC_PRIVATE_AUDIT_SENTINEL'));
  const audit=data.audits.find(row=>row.id===id('quote_audit')),snapshot=audit.after.snapshot;
  assert.equal(snapshot.lines[0].price,12);
  assert(!('fileKey' in snapshot));assert(!('path' in snapshot));assert(!('fileKey' in snapshot.lines[0]));
  if(serviceOnly){
   for(const field of ['internalCosts','internalNotesZh','exchangeRateCnyPerUsd','reviewNotes','sourceFormula','templateMapping'])assert(!(field in snapshot),field+' leaked to service reader');
   assert(!('internalCosts' in snapshot.lines[0]));
   assert(!data.orders.some(row=>row.id===otherOrder.id));
  }else{
   assert.deepEqual(snapshot.internalCosts,[{amount:17}]);assert.deepEqual(snapshot.reviewNotes,['synthetic review']);
   assert(data.audits.some(row=>row.id===id('archive_audit')));
  }
  assert.deepEqual(rawRecords(),before,'GET audit reads must preserve all source records');
 }
 pass('审计按当前身份过滤后取最近250条，跨过300条受限历史仍保留顺序；价格原件路径及客服内部字段继续隐藏，源记录不变');
}
