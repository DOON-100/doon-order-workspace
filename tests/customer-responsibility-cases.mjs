import assert from 'node:assert/strict';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';

// Synthetic identities only. Uses the test runner's isolated database; never
// reads the shared customer workbook or writes the production workspace.
export async function runCustomerResponsibilityCases({ok,call,state,pass,rawRecords,rawInsert,admin}){
 const clone=value=>structuredClone(value),original=clone(rawRecords());
 const users={};
 for(const [key,role] of [['teamA','sales'],['teamB','sales'],['other','sales'],['pmc','pmc'],['disabled','sales']]){
  const user={userId:'synthetic_customer_binding_'+key,email:('customer-binding-'+key+'@test.invalid').toLowerCase(),displayName:'合成客户责任-'+key,fullName:'合成客户责任-'+key};
  await ok('member',{name:user.displayName,email:user.email,role,orderScope:'all',customers:[],active:true});
  await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,member=key=>members.find(row=>row.email===users[key].email),id=key=>member(key).id;
 await ok('member',{...member('disabled'),active:false});
 const current=recordId=>rawRecords().find(row=>row.id===recordId);
 const deny=async(action,payload,user=users.teamA,status=403)=>{
  const before=clone(rawRecords()),response=await call(action,payload,user);
  assert.equal(response.status,status,await response.text());assert.deepEqual(rawRecords(),before);
 };
 const draft={customer:'合成多人责任一组',customerCode:'TEST-BIND-TEAM',salesName:'合成组长',serviceName:users.teamA.displayName,pmcName:users.pmc.displayName,notes:'保留原客户资料',active:true,salesMemberIds:[],serviceMemberIds:[id('teamA'),id('teamB')],quoteMemberIds:[id('teamA'),id('teamB')]};
 let team=(await ok('customer-save',draft)).item;
 assert.deepEqual(team.serviceMemberIds,draft.serviceMemberIds);
 const independent=(await ok('customer-save',{customer:'合成独立双职客户',customerCode:'TEST-BIND-INDEPENDENT',salesName:users.other.displayName,serviceName:'',pmcName:'',active:true,salesMemberIds:[id('other')],serviceMemberIds:[id('other')],quoteMemberIds:[id('other')]})).item;
 for(const key of ['teamA','teamB']){
  const service=await ok('service-data',undefined,users[key]);
  assert(service.customers.some(row=>row.id===team.id));assert(!service.customers.some(row=>row.id===independent.id));
  const assignment=(await ok('data',undefined,users[key])).collaborationAssignments.find(row=>row.customerId===team.id);
  assert(assignment&&!assignment.sales&&assignment.service&&!assignment.pmc);
 }
 const otherData=await ok('service-data',undefined,users.other);
 assert(otherData.customers.some(row=>row.id===independent.id));assert(!otherData.customers.some(row=>row.id===team.id));
 assert(!(await ok('service-data',undefined,users.pmc)).customers.some(row=>row.id===team.id));
 pass('稳定成员ID支持同组多人共享客服；独立业务客服双职组保持隔离，PMC跟单及全部订单查询不会获CRM权限');

 const base={customerId:team.id,orderId:'',type:'followup',title:'合成共享跟进',description:'',status:'open',waitingFor:'customer',dueDate:'',nextFollowUp:'',details:{category:'other'}};
 let followup=(await ok('service-save',base,users.teamA)).record;
 assert((await ok('service-data',undefined,users.teamB)).records.some(row=>row.id===followup.id));
 followup=(await ok('service-save',{...base,id:followup.id,version:followup.version,description:'另一名同组客服补充'},users.teamB)).record;
 assert.equal(followup.version,2);
 await deny('service-save',{...base,id:followup.id,version:followup.version,description:'跨组越权'},users.other);
 const invoice=(await ok('service-save',{...base,type:'receivable',title:'合成共享应收',details:{invoiceNo:'TEST-BIND-INVOICE',currency:'USD',amount:'100.00'}},users.teamA)).record;
 const receipt=await ok('service-receipt',{recordId:invoice.id,version:invoice.version,amount:'35.00',date:'2026-10-08',reference:'TEST-BIND-RECEIPT',note:'合成同组到账核销',token:crypto.randomUUID()},users.teamB);
 assert.equal(receipt.record.balanceCents,6500);
 assert((await ok('service-history?id='+encodeURIComponent(followup.id),undefined,users.teamA)).history.length===2);
 await deny('service-history?id='+encodeURIComponent(followup.id),undefined,users.other);
 pass('同组客服可互看并共同修改跟进、读取历史、确认应收到账；跨组读取和修改在后端拒绝');

 for(const [key,value] of [['salesMemberIds',[id('pmc')]],['serviceMemberIds',[]],['quoteMemberIds',[id('pmc')]]])await deny('customer-save',{...team,[key]:value},users.pmc);
 await deny('customer-save',{...team,serviceMemberIds:null},users.pmc);
 await deny('customer-save',{...team,serviceMemberIds:[id('other')]},users.teamA);
 const unchanged=(await ok('customer-save',{...team,expectedVersion:team.version,notes:'PMC仅维护普通资料'},users.pmc)).item;
 assert(!Object.hasOwn(unchanged,'expectedVersion'));
 await deny('customer-save',{...team,expectedVersion:team.version,notes:'旧版不得覆盖责任或备注'},admin,409);
 assert.deepEqual(unchanged.serviceMemberIds,team.serviceMemberIds);team=unchanged;
 for(const value of [[id('teamA'),id('teamA')],['not-a-member'],[id('disabled')],['']])await deny('customer-save',{...team,serviceMemberIds:value},admin,400);
 pass('责任数组仅管理员可更改；不存在、停用、空ID及重复成员拒绝，PMC只能回传不变名单维护普通资料');

 // Compile pure permission helpers separately so malformed historical records
 // and aliases can be checked without mutating even the synthetic database.
 await build({entryPoints:['lib/customer-responsibility.ts'],outfile:'test-output/customer-responsibility-unit.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
 const permissions=await import('../test-output/customer-responsibility-unit.mjs');
 const explicit={...team,salesName:users.teamB.displayName,salesMemberIds:[],serviceName:users.teamB.displayName,serviceMemberIds:[id('teamA')]};
 assert.equal(permissions.matchesCustomerResponsibility(explicit,member('teamB'),'sales'),false);
 assert.equal(permissions.matchesCustomerResponsibility(explicit,member('teamB'),'service'),false);
 assert.equal(permissions.matchesCustomerResponsibility({...explicit,serviceMemberIds:null},member('teamB'),'service'),false);
 assert.equal(permissions.explicitCustomerResponsibility({...team,quoteMemberIds:[]},member('teamA'),'quote'),false);
 const legacy={...team};for(const key of permissions.customerResponsibilityListKeys)delete legacy[key];
 assert.equal(permissions.matchesCustomerResponsibility(legacy,member('teamA'),'service'),true);
 assert.equal(permissions.matchesCustomerResponsibility({...legacy,serviceName:'Synthetic-approved-alias'},member('teamB'),'service',['Synthetic-approved-alias']),true);
 assert.equal(permissions.matchesCustomerResponsibility({...legacy,serviceName:'Synthetic-approved-alias EXTRA'},member('teamB'),'service',['Synthetic-approved-alias']),false);
 assert.equal(permissions.matchesCustomerResponsibility(team,{...member('teamA'),active:false},'service'),false);
 pass('显式空数组和异常历史数组不回退姓名；旧客户完整名称及已确认别名仍兼容，禁止部分姓名匹配');

 await build({entryPoints:['lib/customer-quote-access.ts'],outfile:'test-output/customer-responsibility-quotes-unit.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
 const quotePermissions=await import('../test-output/customer-responsibility-quotes-unit.mjs');
 const quotePolicy={id:'synthetic_customer_binding_quote_policy',kind:'customer_quote_access',memberIds:[id('teamA'),id('teamB'),id('other')],aliasesByMember:{},customerMemberIds:{[team.id]:[id('other')]}};
 const quoteState={revision:1,records:[...rawRecords().filter(row=>row.kind!=='customer_quote_access'),quotePolicy]};
 for(const key of ['teamA','teamB'])assert.equal(quotePermissions.assignedCustomerQuoteAccount(quoteState,member(key),team),true);
 assert.equal(quotePermissions.assignedCustomerQuoteAccount(quoteState,member('other'),team),false);
 assert.equal(quotePermissions.assignedCustomerQuoteAccount(quoteState,member('teamA'),{...team,quoteMemberIds:[]}),false);
 assert.equal(quotePermissions.assignedCustomerQuoteAccount(quoteState,member('teamA'),{...team,quoteMemberIds:null}),false);
 const noGrant={...quoteState,records:quoteState.records.map(row=>row.id===quotePolicy.id?{...row,memberIds:[id('other')]}:row)};
 assert.equal(quotePermissions.assignedCustomerQuoteAccount(noGrant,member('teamA'),team),false);
 await deny('customer-quotes',undefined,users.teamA);
 pass('报价名单与客户绑定双重校验：同组显式授权可共享、空名单拒绝、旧报价映射不越权，未获全局报价资格仍禁止访问');

 const attachmentBytes=Buffer.from('%PDF-1.7\nSynthetic shared-service attachment');
 const attachmentForm=new FormData();attachmentForm.set('recordId',followup.id);attachmentForm.set('version',String(followup.version));attachmentForm.set('file',new File([attachmentBytes],'synthetic-team.pdf',{type:'application/pdf'}));
 const uploaded=await ok('service-attachment',attachmentForm,users.teamA);followup=uploaded.record;
 const attachmentUrl='service-file?id='+encodeURIComponent(uploaded.attachment.id);
 assert.deepEqual(Buffer.from(await (await call(attachmentUrl,undefined,users.teamB)).arrayBuffer()),attachmentBytes);
 await deny(attachmentUrl,undefined,users.other);
 const orderTemplate=rawRecords().find(row=>row.kind==='order');assert(orderTemplate);
 const order={...clone(orderTemplate),id:'synthetic_customer_binding_order',version:1,customer:team.customer,orderNo:'TEST-BIND-ORDER',customerPO:'TEST-BIND-PO',drawing:'TEST-BIND-MODEL',color:'TEST-BIND-COLOR',lens:'TEST-BIND-LENS',quantity:100,requestedDate:'2026-10-20',lifecycle:'active',ledger:undefined};rawInsert(order);
 await deny('workflow',{id:order.id,version:1,action:'submit-service'},users.teamA);
 const submitted=(await ok('workflow',{id:order.id,version:1,action:'submit-pmc'},users.teamB)).item;
 for(const action of ['accept-pmc','save-pmc'])await deny('workflow',{id:order.id,version:submitted.version,action},users.teamB);
 await deny('workflow',{id:order.id,version:submitted.version,action:'return-business',note:'跨组不得审核'},users.other);
 team=(await ok('customer-save',{...team,serviceMemberIds:[id('teamB')],quoteMemberIds:[id('teamB')]})).item;
 await deny(attachmentUrl,undefined,users.teamA);await deny('service-history?id='+encodeURIComponent(followup.id),undefined,users.teamA);
 assert((await ok('service-data',undefined,users.teamB)).records.some(row=>row.id===followup.id));
 assert.deepEqual(Buffer.from(await (await call(attachmentUrl,undefined,users.teamB)).arrayBuffer()),attachmentBytes);
 pass('同组附件和交接按明确客服侧共享；清除成员立即收回附件历史，销售提交与PMC接单排期不因共享放开');

 // Omitted fields mean preserve unless the corresponding human responsibility
 // changes; null is the administrator's explicit reset to legacy name mapping.
 const saveWithoutLists={...team,serviceName:users.other.displayName};
 for(const key of permissions.customerResponsibilityListKeys)delete saveWithoutLists[key];
 team=(await ok('customer-save',saveWithoutLists)).item;
 assert.deepEqual(team.salesMemberIds,[]);assert(!Object.hasOwn(team,'serviceMemberIds'));assert(!Object.hasOwn(team,'quoteMemberIds'));
 assert(!(await ok('service-data',undefined,users.teamA)).records.some(row=>row.customerId===team.id));
 assert((await ok('service-data',undefined,users.other)).records.some(row=>row.id===followup.id));
 team=(await ok('customer-save',{...team,serviceMemberIds:[id('teamB')],quoteMemberIds:[id('teamB')]})).item;
 team=(await ok('customer-save',{...team,serviceMemberIds:null,quoteMemberIds:null})).item;
 assert(!Object.hasOwn(team,'serviceMemberIds'));assert(!Object.hasOwn(team,'quoteMemberIds'));assert.deepEqual(team.salesMemberIds,[]);
 team=(await ok('customer-save',{...team,serviceMemberIds:[],quoteMemberIds:[]})).item;
 assert(!(await ok('service-data',undefined,users.other)).records.some(row=>row.customerId===team.id));
 pass('责任姓名变化立即清除陈旧该侧及报价绑定；管理员可明确回退名称规则或置空撤权，历史业务不改变');

 const imported={...team,id:'synthetic_customer_binding_import',customer:'合成导入责任元数据客户',customerCode:'TEST-BIND-IMPORT',serviceName:users.teamA.displayName,serviceMemberIds:[id('teamA'),id('teamB')],quoteMemberIds:[id('teamA'),id('teamB')],source:{marker:'synthetic-preserved-source'},futureMetadata:{marker:'synthetic-preserved-future'}};
 rawInsert(imported);
 const importForm=serviceName=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'客户':imported.customer,'客户编码':imported.customerCode,'业务员':imported.salesName,'客服':serviceName,'PMC':imported.pmcName,'备注':'合成导入更新备注'}]),'客户');
  const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'synthetic-customer-responsibilities.xlsx'));return form;
 };
 await ok('customer-import',importForm(imported.serviceName));
 let refreshed=current(imported.id);assert.deepEqual(refreshed.serviceMemberIds,imported.serviceMemberIds);assert.deepEqual(refreshed.quoteMemberIds,imported.quoteMemberIds);assert.deepEqual(refreshed.source,imported.source);assert.deepEqual(refreshed.futureMetadata,imported.futureMetadata);
 await ok('customer-import',importForm(users.other.displayName));
 refreshed=current(imported.id);assert(!Object.hasOwn(refreshed,'serviceMemberIds'));assert(!Object.hasOwn(refreshed,'quoteMemberIds'));assert.deepEqual(refreshed.salesMemberIds,[]);assert.deepEqual(refreshed.source,imported.source);
 const deniedImport=importForm(users.teamA.displayName);await deny('customer-import',deniedImport,users.pmc);
 assert.equal(rawRecords().filter(row=>row.kind==='customer_account'&&row.customer===imported.customer).length,1);
 assert.equal(current(followup.id).description,'另一名同组客服补充');assert.equal(current(receipt.receipt.id).amountCents,3500);
 const final=new Map(rawRecords().map(row=>[row.id,row]));for(const row of original)assert.deepEqual(final.get(row.id),row);
 pass('重复导入保留稳定责任名单和源元数据，变更责任撤销陈旧授权、不复制客户、不覆盖跟进应收或既有历史');
}
