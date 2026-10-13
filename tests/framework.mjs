// Synthetic read-only workbench projections; no database, network or production files.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const output=await build({stdin:{contents:"export * from './lib/business-framework';export * from './lib/framework-business-query';",resolveDir:process.cwd(),loader:'ts'},write:false,bundle:true,platform:'node',format:'esm'});
const f=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
let checks=0;const check=(name,run)=>{run();checks++;console.log('PASS '+name);};
const member={id:'member-synthetic',kind:'member',email:'synthetic@example.invalid',name:'测试负责人',role:'sales',customers:['合成客户'],userId:'synthetic',active:true,createdAt:''};
const order={id:'order-synthetic',kind:'order',version:1,createdAt:'',updatedAt:'2026-10-12T04:00:00Z',updatedBy:'',source:'synthetic',orderNo:'TEST-001',customer:'合成客户',customerPO:'TEST-PO',drawing:'TEST-SKU',color:'',lens:'',batch:'',quantity:10,requestedDate:'2026-10-12',ownerEmail:member.email,stage:'生产中',plannedDate:'2026-10-10',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'',sourceStatus:'',extra:{}};
const data={me:member,orders:[order],reports:[],comments:[],members:[member]};
const projects={projects:[{id:'project-1',customerId:'customer-1',title:'合成项目',code:'SYN-1',status:'active'}],tasks:[],customers:[{id:'customer-1',customer:'合成客户'}],members:[{id:'reviewer-1',name:'合成审核人'}]};
const today='2026-10-13';
check('catalog references form one consistent definition graph',()=>{
 assert.equal(f.frameworkRules.length,17);assert.equal(f.frameworkMethods.length,16);assert.equal(f.frameworkAgents.length,9);assert.equal(f.frameworkFlows.length,9);
 for(const list of [f.frameworkRules,f.frameworkMethods,f.frameworkAgents,f.frameworkFlows])assert.equal(new Set(list.map(v=>v.id)).size,list.length);
 for(const m of f.frameworkMethods)for(const id of m.ruleIds)assert.ok(f.frameworkRules.some(r=>r.id===id));
 for(const a of f.frameworkAgents)for(const id of a.methodIds)assert.ok(f.frameworkMethods.some(m=>m.id===id));
 for(const flow of f.frameworkFlows){for(const id of flow.agentIds)assert.ok(f.frameworkAgents.some(a=>a.id===id));for(const s of flow.stages)assert.ok(s.title&&s.source&&s.owner&&s.review&&s.view);}
});
check('management definitions stay out of ordinary rule lists',()=>{
 assert.equal(f.frameworkIsManager(member),false);assert.equal(f.frameworkIsManager({...member,role:'programmer'}),true);
 assert.ok(!f.visibleFrameworkRules(member).some(r=>['rule-08','rule-16','rule-17'].includes(r.id)));
 assert.equal(f.visibleFrameworkRules({...member,role:'admin'}).length,17);
 assert.deepEqual(f.visibleFrameworkRules({...member,role:'supplier'}),[]);
 assert.deepEqual(f.visibleFrameworkRules({...member,active:false}),[]);
});
check('supplier and disabled accounts have no projected business rows',()=>{
 assert.deepEqual(f.buildFrameworkTodos({...data,me:{...member,role:'supplier'}},projects,undefined,today),[]);
 assert.deepEqual(f.buildFrameworkTodos({...data,me:{...member,active:false}},projects,undefined,today),[]);
});
check('review ownership follows the current task stage, not an inferred role',()=>{
 const p={...projects,tasks:[{id:'t1',projectId:'project-1',customerId:'customer-1',title:'合成审核',status:'service_review',ownerId:member.id,serviceReviewerId:'reviewer-1',canReviewService:false,dueDate:'2026-10-14'}]};
 const row=f.buildFrameworkTodos(data,p,undefined,today).find(t=>t.id==='project:t1');
 assert.equal(row.owner,'合成审核人');assert.equal(row.review,true);assert.equal(row.mine,true);assert.match(row.nextAction,/等待指定审核人/);
 const permitted=f.buildFrameworkTodos(data,{...p,tasks:[{...p.tasks[0],canReviewService:true}]},undefined,today).find(t=>t.id==='project:t1');assert.match(permitted.nextAction,/完成客服审核/);
});
check('orphan tasks and completed or paused project tasks are not active reminders',()=>{
 const p={...projects,projects:[...projects.projects,{id:'paused',status:'paused'}],tasks:[{id:'orphan',projectId:'missing',status:'open'},{id:'done',projectId:'project-1',status:'done'},{id:'cancelled',projectId:'project-1',status:'cancelled'},{id:'inactive',projectId:'paused',status:'open'}]};
 assert.ok(!f.buildFrameworkTodos(data,p,undefined,today).some(r=>r.source==='项目任务'));
});
check('customer followups preserve unlinked identity and pending dates',()=>{
 const extra={followups:[{id:'f1',title:'合成线索',customerId:'',projectId:'',ownerId:member.id,status:'waiting_customer',followUpDate:'',nextAction:'等待补充资料'},{id:'f2',status:'completed'}],customers:[],projects:[],members:[]};
 const row=f.buildFrameworkTodos(data,undefined,extra,today).find(t=>t.id==='followup:f1');assert.equal(row.customer,'未关联客户');assert.equal(row.date,'');assert.equal(row.status,'待客户反馈');assert.equal(row.nextAction,'等待补充资料');assert.ok(!f.buildFrameworkTodos(data,undefined,extra,today).some(t=>t.id==='followup:f2'));
});
check('comments require a visible active order, a pending state and a due date',()=>{
 const d={...data,comments:[{id:'keep',lineId:order.id,dueDate:'2026-10-12',text:'核对原记录',done:false},{id:'orphan',lineId:'unknown',dueDate:'2026-10-12'},{id:'done',lineId:order.id,dueDate:'2026-10-12',done:true},{id:'history',lineId:order.id,text:'仅历史记录'}]};
 assert.deepEqual(f.buildFrameworkTodos(d,undefined,undefined,today).filter(t=>t.source==='订单跟进').map(t=>t.id),['comment:keep']);
 assert.ok(!f.buildFrameworkTodos({...d,orders:[{...order,lifecycle:'archived'}]},undefined,undefined,today).length);
});
check('delivery reminders use explicit customer date and known remaining quantity',()=>{
 assert.equal(f.buildFrameworkTodos(data,undefined,undefined,today)[0].date,'2026-10-12');
 assert.ok(!f.buildFrameworkTodos({...data,orders:[{...order,requestedDate:'',plannedDate:'2026-10-01'}]},undefined,undefined,today).some(t=>t.source==='订单交期'));
 const reports=[{lineId:order.id,quantity:10,approval:'已审批'}];assert.ok(!f.buildFrameworkTodos({...data,reports},undefined,undefined,today).some(t=>t.source==='订单交期'));
 assert.ok(!f.buildFrameworkTodos({...data,orders:[{...order,ledger:{columns:{BF:'错误'},originalOutstanding:''}}]},undefined,undefined,today).some(t=>t.source==='订单交期'));
});
check('invalid dates never become overdue facts',()=>{
 for(const value of ['2026-02-30','bad','2026-13-01','2026-1-2',''])assert.equal(f.validFrameworkDate(value),'');
 assert.equal(f.frameworkDue('2026-02-30',today),'未定日期');assert.equal(f.frameworkDue('2026-10-13',today),'今日到期');
});
const communication={id:'communication-1',kind:'unified_communication',customerId:'customer-1',projectId:'project-1',orderId:'order-synthetic',title:'合成回复待核对',status:'pending_check',canReturn:true,updatedAt:'2026-10-13T02:00:00Z',occurredAt:'2026-01-01',createdById:member.id};
const communications={items:[communication],customers:projects.customers,projects:projects.projects,orders:[{id:order.id,customerId:'customer-1',orderNo:order.orderNo,drawing:order.drawing}]};
check('department notices keep exact source identity and checked versions separate from stale sources',()=>{
 const business={items:[{id:'doc-pending',type:'pi',number:'SYN-PI',customerId:'customer-1',orderId:order.id,status:'pending_check',canConfirm:true,version:1,fields:{}},{id:'doc-done',type:'invoice',customerId:'customer-1',status:'checked',fields:{}},{id:'doc-stale',type:'engineering_quote',customerId:'customer-1',status:'checked',sourceChanged:true,fields:{}}],customers:projects.customers,orders:[{...order,customerId:'customer-1'}],projects:[],members:[]};
 const rows=f.buildFrameworkDepartmentTodos(member,business);assert.equal(rows.length,3);assert.equal(rows.find(r=>r.recordId==='doc-pending').view,'order-confirmations');assert.equal(rows.find(r=>r.recordId==='doc-pending').mine,true);assert.equal(rows.find(r=>r.recordId==='doc-done').done,true);assert.equal(rows.find(r=>r.recordId==='doc-stale').done,false);assert.equal(rows.find(r=>r.recordId==='doc-stale').category,'工程资料');
});
check('customer handoff belongs only to specified accepting sales and drawing signature belongs to configured reviewer',()=>{
 const transfer={customers:projects.customers,sales:[member],handoffs:[{id:'handoff-test',customerId:'customer-1',to:member.id,status:'pending'}],poolRequests:[],claims:[],canApprove:false};
 const rows=f.buildFrameworkDepartmentTodos(member,undefined,transfer,{reviewerRole:'drawing_lead',policyVersion:2,drawings:[{id:'drawing-test',version:3,number:'SYN-DRAW',style:'SYN-SKU',configured:true,effective:false,lead:null,supervisor:null}]});assert.equal(rows.find(r=>r.id==='customer-handoff:handoff-test').mine,true);const d=rows.find(r=>r.id==='drawing-adoption:drawing-test');assert.equal(d.tab,'production-review');assert.equal(d.mine,true);assert.equal(d.date,'');assert.ok(!f.buildFrameworkDepartmentTodos({...member,role:'supplier'},undefined,transfer).length);
});
check('communication review follows server-provided responsibility without inventing a deadline or approval',()=>{
 const row=f.buildFrameworkTodos(data,undefined,undefined,today,communications).find(r=>r.id==='communication:communication-1');
 assert.equal(row.source,'统一沟通');assert.equal(row.status,'待人工核对');assert.equal(row.mine,true);assert.equal(row.owner,member.name);assert.equal(row.view,'communications');assert.equal(row.review,true);assert.equal(row.date,'');assert.match(row.reference,/SYN-1/);assert.match(row.reference,/TEST-001/);assert.match(row.nextAction,/需修改时退回/);assert.doesNotMatch(row.nextAction,/批准|发送|完成核对/);
});
check('a visible communication is not assigned to its author when they cannot return it',()=>{
 const row=f.buildFrameworkTodos(data,undefined,undefined,today,{...communications,items:[{...communication,canReturn:false}]}).find(r=>r.id==='communication:communication-1');
 assert.equal(row.mine,false);assert.equal(row.owner,'负责销售');assert.equal(row.nextAction,'等待负责销售核对');
});
check('communication tasks exclude nonpending states and unresolved authorized links',()=>{
 const items=[...['draft','returned','checked'].map(status=>({...communication,id:status,status})),{...communication,id:'unknown-customer',customerId:'unknown'},{...communication,id:'wrong-project',projectId:'unknown'},{...communication,id:'wrong-order',orderId:'unknown'}];
 assert.ok(!f.buildFrameworkTodos(data,undefined,undefined,today,{...communications,items}).some(r=>r.source==='统一沟通'));
 const row=f.buildFrameworkTodos(data,undefined,undefined,today,{...communications,items:[{...communication,projectId:'',orderId:''}]}).find(r=>r.source==='统一沟通');assert.equal(row.reference,'客户沟通');
});
check('unavailable communications remove only that source and preserve existing reminders',()=>{
 const before=JSON.stringify(communications),combined=f.buildFrameworkTodos(data,undefined,undefined,today,communications),without=f.buildFrameworkTodos(data,undefined,undefined,today,undefined);
 assert.equal(JSON.stringify(communications),before);assert.deepEqual(combined.filter(r=>r.source!=='统一沟通'),without);assert.ok(without.length>0);
});
check('local presentation does not mutate records or manufacture financial and channel tasks',()=>{
 const before=JSON.stringify(data);const rows=f.buildFrameworkTodos(data,projects,undefined,today);assert.equal(JSON.stringify(data),before);assert.ok(rows.every(r=>!r.source.includes('财务')&&!r.source.includes('邮箱')));
 const ids=rows.map(r=>r.id);assert.equal(ids.length,new Set(ids).size);
});
const pi={id:'pi-test',kind:'handoff_business_document',type:'pi',version:2,number:'SYN-PI',customerId:'customer-1',orderId:'order-synthetic',status:'checked',sourceChanged:false,fields:{currency:'USD',depositPercent:'30',paymentDueDate:'2026-10-10'},lines:[{orderLineId:'order-synthetic',description:'SYN-SKU',quantity:3,unitPrice:'0.11'}]};
const production={id:'prod-test',kind:'handoff_business_source',type:'production_order',customerId:pi.customerId,orderId:pi.orderId,status:'pending_check',sourceChanged:false,fields:{receivableId:'receivable-test'},sourceRefs:[{id:pi.id,version:2}]};
const receivable={id:'receivable-test',kind:'service_record',type:'receivable',customerId:pi.customerId,orderId:pi.orderId,status:'open',dueDate:'2026-10-10',details:{currency:'USD',amountCents:33},receivedCents:10,balanceCents:23};
const queryData={items:[pi,production],queues:{service:[receivable],finance:{receipts:[{amountCents:999999}]}}};
check('financial query uses exact current PI/production/receivable link and integer deposit ceiling without mixing project or screenshot money',()=>{
 const r=f.buildFrameworkFinancialQuery(queryData,today)[0];assert.equal(r.requiredDepositCents,10);assert.equal(r.depositMet,true);assert.equal(r.overdue,true);assert.equal(r.receivedCents,10);assert.equal(r.balanceCents,23);assert.equal(r.problems.length,0);
 const before=JSON.stringify(queryData);f.buildFrameworkFinancialQuery(queryData,today);assert.equal(JSON.stringify(queryData),before);
 assert.deepEqual(f.frameworkFinancialTotals([r,{...r,piId:'duplicate-pi'}],'deposit'),{USD:10});
 assert.deepEqual(f.frameworkFinancialTotals([r,{...r,piId:'EUR-pi',receivableId:'eur-receivable',currency:'EUR',balanceCents:50}],'overdue'),{USD:23,EUR:50});
});
check('missing, revoked-price, stale-source, cross-order and ambiguous financial bases are excluded rather than manufactured',()=>{
 for(const d of [{...queryData,items:[{...pi,sourceChanged:true},production]},{...queryData,items:[{...pi,lines:[{...pi.lines[0],unitPrice:''}]},production]},{...queryData,items:[pi,{...production,sourceRefs:[{id:pi.id,version:1}]}]},{...queryData,items:[pi,{...production,fields:{receivableId:'wrong'}}]},{...queryData,queues:{service:[{...receivable,orderId:'wrong'}]}},{...queryData,items:[pi,production,{...production,id:'second-production',fields:{receivableId:'other-receivable'}}]}]){const r=f.buildFrameworkFinancialQuery(d,today)[0];assert.equal(r.depositMet,false);assert.equal(r.overdue,false);assert.equal(r.receivedCents,null);assert.ok(r.problems.length);}
 const r=f.buildFrameworkFinancialQuery({...queryData,items:[{...pi,fields:{...pi.fields,depositPercent:''}},production]},today)[0];assert.equal(r.depositMet,false);assert.equal(r.overdue,true);assert.match(r.problems.join(''),/定金比例/);
 const absent=f.buildFrameworkFinancialQuery({...queryData,items:[pi]},today)[0];assert.equal(absent.depositMet,false);assert.equal(absent.overdue,false);
});
check('business query recognizes explicit identifiers inside supported natural wording without model execution',()=>{
 assert.equal(f.frameworkQueryMatch('查询 SYN-PO 的订单',['SYN-PO']),true);assert.equal(f.frameworkQueryMatch('SYN-SKU',['SYN-SKU']),true);assert.equal(f.frameworkQueryMatch('其他客户',['SYN-PO']),false);
});
check('customer tasks keep exact customer identity, owner and due date without treating permission as responsibility',()=>{
 const transfers={customers:projects.customers,handoffs:[],poolRequests:[],claims:[],sales:[],canApprove:false,tasks:[{id:'own',title:'Synthetic own duty',customerId:'customer-1',ownerId:member.id,owner:member.name,due:'2026-10-12',status:'受阻',canEdit:true},{id:'other',title:'Synthetic visible duty',customerId:'',ownerId:'other',due:'bad',status:'待接手',canEdit:true},{id:'closed',status:'完成'}]};
 const rows=f.buildFrameworkDepartmentTodos(member,undefined,transfers);assert.equal(rows.length,2);assert.equal(rows[0].view,'customers');assert.equal(rows[0].tab,'tasks');assert.equal(rows[0].recordId,'own');assert.equal(rows[0].customerId,'customer-1');assert.equal(rows[0].mine,true);assert.equal(rows[1].mine,false);assert.equal(rows[1].customer,'未关联客户');assert.equal(rows[1].date,'');
});
check('funding reminders use the server gate until current sales declares the agreed deposit, independent of official paid balance',()=>{
 const g={fundingReminder:true,productionId:'prod-gate',piId:'pi-gate',piVersion:2,fundingBasisCurrent:true,canDeclareDeposit:true};
 const b={items:[{id:'prod-gate',type:'production_order',customerId:'customer-1',fields:{}}],customers:projects.customers,orders:[],projects:[],members:[],queues:{orders:[{id:order.id,orderNo:order.orderNo,productionGate:g},{id:'other-line',productionGate:g}],service:[{...receivable,receivedCents:33,balanceCents:0}]}};
 const rows=f.buildFrameworkDepartmentTodos(member,b);assert.equal(rows.length,1);assert.equal(rows[0].recordId,'prod-gate');assert.equal(rows[0].mine,true);assert.match(rows[0].nextAction,/不等于正式财务到账/);assert.equal(rows[0].view,'production-orders');
 assert.equal(f.buildFrameworkDepartmentTodos(member,{...b,queues:{orders:[{productionGate:{...g,fundingReminder:false}}]}}).length,0);
 assert.equal(f.buildFrameworkDepartmentTodos(member,{...b,queues:{orders:[{productionGate:{...g,canDeclareDeposit:false}}]}})[0].mine,false);
});
check('personal receipt tasks track one exact source version and never count as an approval',()=>{
 const rows=f.buildFrameworkNoticeTodos(member,[{id:'notice-test',type:'engineering_drawing',number:'SYN-D',version:4,customer:'Synthetic',received:false,canReceive:true},{id:'received',type:'finance_file',number:'SYN-F',version:2,received:true,canReceive:true}]);
 assert.equal(rows[0].receiveVersion,4);assert.match(rows[0].nextAction,/不代表批准或到账/);assert.equal(rows[1].done,true);assert.equal(rows[1].receiveVersion,undefined);assert.equal(f.buildFrameworkNoticeTodos({...member,active:false},[]).length,0);
});
check('finance reminders use current server action permissions and exact task links, preserving uncertainty without financial posting',()=>{
 const tasks=[{id:'f1',type:'收款核对',status:'待财务接收',customerId:'customer-1',orderId:'order-synthetic',customerLabel:'Synthetic',orderLabel:'Synthetic order',recipientName:'Synthetic finance',due:'2026-10-20',canAccept:true},{id:'f2',type:'对账',status:'待业务核对',sourceChanged:true,due:'invalid',canReview:false},{id:'closed',status:'已核对'}];
 const before=JSON.stringify(tasks),rows=f.buildFrameworkFinanceTodos(member,tasks);assert.equal(rows.length,2);assert.equal(rows[0].view,'finance-documents');assert.equal(rows[0].tab,'finance-tasks');assert.equal(rows[0].recordId,'f1');assert.equal(rows[0].mine,true);assert.equal(rows[1].mine,false);assert.equal(rows[1].date,'');assert.match(rows[1].nextAction,/不将旧结果当作新依据/);assert.equal(JSON.stringify(tasks),before);assert.equal(f.buildFrameworkFinanceTodos({...member,active:false},tasks).length,0);
});
check('customer next-action reminders use current primary responsibility and explicit follow-up values',()=>{
 const accounts=[{id:'customer-1',customer:'Synthetic',customerCode:'SYN',salesMemberIds:[member.id],salesName:member.name}];
 const profiles=[{id:'customer-1',workflow:{primarySalesMemberId:'someone-else',next:'Synthetic next action',nextDate:'2026-10-20',followState:'进行中'}}];
 const row=f.buildFrameworkCustomerTodos(member,accounts,profiles)[0];assert.equal(row.mine,false);assert.equal(row.customerId,'customer-1');assert.equal(row.tab,'workflow');assert.equal(row.date,'2026-10-20');assert.equal(f.buildFrameworkCustomerTodos(member,accounts,[{...profiles[0],workflow:{...profiles[0].workflow,followState:'暂停'}}]).length,0);
});
console.log(`Framework checks passed: ${checks}`);
