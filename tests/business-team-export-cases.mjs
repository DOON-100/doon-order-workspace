import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

export async function runBusinessTeamExportCases({api,identity,admin,rawInsert,rawRecords,pass}){
 const id=name=>'synthetic_business_scope_'+name,at='2026-10-13T00:00:00.000Z',team=id('team_1');
 const call=(action,scope=team,user=admin,body)=>identity.run(user,()=>api[body?'POST':'GET'](new Request('https://orders.test/api/workspace/'+action,{method:body?'POST':'GET',headers:{...(scope?{'X-Workspace-Team':scope}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const sheet=async(action,scope=team)=>{const response=await call(action,scope);assert.equal(response.status,200,action+' '+(response.status===200?'':await response.text()));assert.match(response.headers.get('Vary')||'',/X-Workspace-Team/i);const book=XLSX.read(await response.arrayBuffer());return {book,rows:XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])};};
 const raw=rawRecords(),orderBase=raw.find(row=>row.id===id('order_A'));assert(orderBase,'Run after business-team-scope-cases');
 const orders=['A','B'].map(name=>({...orderBase,id:id('export_order_'+name),orderNo:'SCOPE-EXPORT-'+name,customer:'SCOPE-'+name,lifecycle:'active',sourceStatus:'',workflowStatus:'生产中'}));
 const suppliers=['SCOPE-EXPORT-SUPPLIER-A','SCOPE-EXPORT-SUPPLIER-B'];
 for(const [index,o] of orders.entries()){
  rawInsert(o);
  rawInsert({id:id('export_outsource_'+index),kind:'outsource',lineId:o.id,supplier:suppliers[index],reference:'SCOPE-OUT-'+index,process:'cutting',quantity:10,received:0,status:'待回货',dueDate:'2026-12-01'});
  rawInsert({id:id('export_supplier_quote_'+index),kind:'supplier_quote',supplier:suppliers[index],category:'加工工序',itemName:'Synthetic item',version:1,createdAt:at});
  rawInsert({id:id('export_loss_'+index),kind:'loss',lineId:o.id,orderNo:o.orderNo,customer:o.customer,department:'titanium',process:'welding',reportDate:'2026-10-13',month:'2026-10',orderQuantity:10,input:10,good:8,wip:0,loss:2,delta:2,source:'balance',createdAt:at});
  rawInsert({id:id('export_purchase_'+index),kind:'purchase',customerOrder:o.orderNo,po:'SCOPE-PO-'+index,supplier:suppliers[index],itemCode:'synthetic',itemName:'Synthetic item',unit:'副',quantity:10,sourceAsOf:'2026-10-13',sourceHash:'synthetic-export',sourceRow:index+1,lifecycle:'active',closeStatus:'未关闭',auditStatus:'已审核',balanceKnown:false,raw:{'单据编号':'SCOPE-PO-'+index,'客户订单编号':o.orderNo}});
 }
 rawInsert({id:id('export_kingdee_template'),kind:'collaboration_template',templateType:'kingdee',headers:['客户编码','订单号'],sheet:'Synthetic Kingdee'});
 const ledger=await sheet('ledger-export?mode=active');assert(ledger.rows.some(row=>row['订单号']===orders[0].orderNo));assert(!ledger.rows.some(row=>row['订单号']===orders[1].orderNo));
 const kingdee=await sheet('kingdee-export');assert(kingdee.rows.some(row=>row['订单号']===orders[0].orderNo));assert(!kingdee.rows.some(row=>row['订单号']===orders[1].orderNo));
 const revision=(await (await call('data')).json()).revision,metric=await sheet('metric-export?metric=orders&revision='+revision);assert(metric.rows.some(row=>row['订单号']===orders[0].orderNo));assert(!metric.rows.some(row=>row['订单号']===orders[1].orderNo));
 const details=XLSX.utils.sheet_to_json(metric.book.Sheets['明细与跟进']);assert(details.some(row=>row['明细编号']===orders[0].id));assert(!details.some(row=>row['明细编号']===orders[1].id));
 pass('按组导出 PMC 台账、金蝶导入表和指标汇总，明细与汇总均不包含另一组订单');

 const loss=await sheet('loss-export?month=2026-10'),lossDetails=XLSX.utils.sheet_to_json(loss.book.Sheets['损耗确认明细']);assert(lossDetails.some(row=>row['明细编号']===orders[0].id));assert(!lossDetails.some(row=>row['明细编号']===orders[1].id));
 const supplier=await sheet('supplier-export'),quotes=await sheet('supplier-quote-export'),purchase=await sheet('purchase-export?mode=active');
 for(const output of [supplier,quotes]){assert(output.rows.some(row=>row['供应商']===suppliers[0]));assert(!output.rows.some(row=>row['供应商']===suppliers[1]));}
 assert(purchase.rows.some(row=>row['客户订单编号']===orders[0].orderNo));assert(!purchase.rows.some(row=>row['客户订单编号']===orders[1].orderNo));
 assert((await sheet('ledger-export?mode=active','')).rows.some(row=>row['订单号']===orders[1].orderNo));
 assert(!(await sheet('ledger-export?mode=active','__ungrouped')).rows.some(row=>orders.some(o=>o.id===row['_明细编号'])));
 pass('部门损耗、供应商交期与报价、采购导出遵循当前组；全部与未分组导出独立生效');

 const product={id:'synthetic-product',productType:'frame',sku:'EXPORT-SKU',factoryModel:'SYNTHETIC',sourceRefs:[]};
 for(const name of ['A','B'])rawInsert({id:id('export_archive_'+name),kind:'customer_price_archive',customerAccountId:id('customer_'+name),dataset:{customer:{code:'SCOPE-'+name,name:'Synthetic '+name},files:[],products:[product],prices:[]},createdAt:at});
 for(const view of ['sku','history']){const archive=await sheet('customer-price-archive-export?view='+view);assert(archive.rows.some(row=>row['客户代码']==='SCOPE-A'));assert(!archive.rows.some(row=>row['客户代码']==='SCOPE-B'));}
 for(const name of ['A','B']){
  const quoteId=id('export_quote_'+name),line={id:id('export_quote_line_'+name),model:'Synthetic export model',descriptionZh:'合成报价',descriptionEn:'Synthetic quote',quantity:10,unitPrice:2,toolingFee:0},snapshot={id:quoteId,kind:'customer_quote',customerAccountId:id('customer_'+name),customerCode:'SCOPE-'+name,customerName:'Synthetic '+name,status:'confirmed',version:1,quoteNo:'SCOPE-QUOTE-'+name,currency:'USD',quoteDate:'2026-10-13',validUntil:'2026-12-13',lines:[line]};
  rawInsert(snapshot);rawInsert({id:id('export_quote_revision_'+name),kind:'customer_quote_revision',quoteId,version:1,snapshot});
  rawInsert({...snapshot,...line,id:id('export_quote_completed_'+name),kind:'customer_quote_completed',lineId:line.id,quoteId,quoteVersion:1,confirmedAt:at,confirmedBy:'Synthetic test'});
 }
 const completed=await sheet('customer-quote-completed-export');assert(completed.rows.some(row=>row['客户编号']==='SCOPE-A'));assert(!completed.rows.some(row=>row['客户编号']==='SCOPE-B'));
 const full=await call('customer-workflow-export'),fullBody=await full.json();assert.equal(full.status,200,JSON.stringify(fullBody));assert.equal(fullBody.businessTeamId,team);assert(fullBody.records.some(row=>row.id===id('customer_A')));assert(!fullBody.records.some(row=>row.id===id('customer_B')));assert(fullBody.records.some(row=>row.id===id('project_One')));assert(!fullBody.records.some(row=>row.id===id('project_Two')));
 pass('客户 SKU、历史报价、已完成报价及客户完整记录导出与当前组一致');

 const actions=['ledger-export','kingdee-export','loss-export?month=2026-10','supplier-export','supplier-quote-export','purchase-export','customer-price-archive-export','customer-quote-completed-export','customer-workflow-export','metric-export?metric=orders&revision='+revision];
 for(const action of actions){assert.equal((await call(action,id('missing_team'))).status,403,action);assert.equal((await call(action,team,null)).status,401,action);}
 const reader={userId:id('reader_user'),email:'scope-reader@test.invalid',displayName:'Synthetic scope reader',fullName:'Synthetic scope reader'};
 assert.equal((await call('customer-workflow-export',team,reader)).status,403);
 const readonly=await call('ledger-export',id('team_2'),reader);assert.equal(readonly.status,403);
 pass('导出保留匿名和原有权限拒绝，非法组不得回退为全量数据');
}
