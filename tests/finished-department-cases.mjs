import assert from 'node:assert/strict';

// Only synthetic identities and orders are inserted into the isolated test DB.
export async function testFinishedDepartment({ok,call,pass,rawInsert,rawRecords}){
 const businessDate=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),shift=days=>new Date(Date.parse(businessDate+'T00:00:00Z')+days*86400000).toISOString().slice(0,10),yesterday=shift(-1),tomorrow=shift(1),createdAt=new Date().toISOString();
 const identity=(key,role,departments=[],orderScope='all')=>{const user={userId:'finished_department_'+key,email:'finished-department-'+key+'@test.invalid',displayName:'合成完工岗位 '+key};rawInsert({id:'member_'+user.userId,kind:'member',userId:user.userId,email:user.email,name:user.displayName,role,departments,orderScope,customers:[],active:true,createdAt});return user;};
 const worker=identity('worker','clerk',['finished']),other=identity('other','clerk',['plastic']),production=identity('production','production'),finance=identity('finance','finance'),sales=identity('sales','sales'),restricted=identity('restricted','clerk',['finished'],'assigned');
 const order=(key,changes={})=>({id:'finished_department_order_'+key,kind:'order',version:1,createdAt,updatedAt:createdAt,updatedBy:'合成测试',source:'synthetic',orderNo:'SYNTH-FINISHED-'+key,customer:'SYNTHETIC CUSTOMER',customerPO:'SYNTHETIC PO',drawing:'SYNTHETIC-DRAWING',color:'SYNTHETIC-COLOR',lens:'白片',productType:'成品',batch:'',quantity:10,requestedDate:tomorrow,plannedDate:tomorrow,promisedDate:'',promiseConfirmed:false,shipDate:'',ownerEmail:'',stage:'生产中',customerNote:'合成原备注',arrangement:'合成安排',notes:'合成排期备注',sourceStatus:'正式订单',extra:{'合成保留字段':'原值'},lifecycle:'active',ledger:{columns:{A:'度昂',AG:'7',AH:yesterday,BF:'10',BG:yesterday,BH:'',BI:'合成成品备注'},sourceRow:9,sheet:'合成',filename:'synthetic.xlsx',sourceHash:'synthetic-source',issues:[],ownerName:'合成跟单员',originalOutstanding:'10'},...changes});
 const current=id=>structuredClone(rawRecords().find(x=>x.id===id)),insert=(key,changes={})=>{const row=order(key,changes);rawInsert(row);return row;};
 const payload=(row,changes={})=>({id:row.id,version:row.version,mode:'archived',reason:'合成完成核对依据',closedDate:businessDate,...changes});
 const rejected=async(row,changes={},status=400,user=worker)=>{const before=current(row.id),audits=rawRecords().filter(x=>x.kind==='audit').length,response=await call('ledger-lifecycle',payload(row,changes),user);assert.equal(response.status,status,await response.text());assert.deepEqual(current(row.id),before);assert.equal(rawRecords().filter(x=>x.kind==='audit').length,audits);};

 for(const factory of ['度昂','合成成品外厂']){
  const row=insert(factory==='度昂'?'internal':'external');rawInsert({...row,ledger:{...row.ledger,columns:{...row.ledger.columns,A:factory,BF:'0',BG:'',BH:''}}});
  await ok('ledger-edit',{id:row.id,version:1,patch:{BF:'10',BG:businessDate,BH:businessDate},reason:'合成QC检验合格后入仓'},worker);let received=current(row.id);assert.equal(received.lifecycle,'active');assert.equal(received.closedDate,businessDate);assert.equal(received.ledger.columns.BF,'10');
  await ok('ledger-lifecycle',payload(received),worker);const closed=current(row.id);assert.equal(closed.lifecycle,'archived');assert.equal(closed.closedDate,businessDate);assert.equal(closed.ledger.columns.BH,businessDate);assert.equal(closed.extra['BH · 结单日'],businessDate);assert.equal(closed.updatedBy,worker.displayName);assert.equal(closed.version,received.version+1);assert(closed.archivedAt);assert.equal(closed.archiveReason,'合成完成核对依据');assert.deepEqual({...closed.ledger.columns,BH:received.ledger.columns.BH},received.ledger.columns);assert.equal(closed.ledger.sourceHash,received.ledger.sourceHash);assert.equal(closed.notes,received.notes);assert.equal(closed.extra['合成保留字段'],'原值');assert(rawRecords().some(x=>x.kind==='audit'&&x.targetId===row.id&&x.action==='结单归档'&&x.actorId==='member_'+worker.userId));
  await rejected(closed,{mode:'active'},403);await rejected(closed,{},403);
 }
 pass('成品文员可对本厂及外厂原明细入仓后正常结单；填写BH不自动归档，显式结单同步BH并保留原记录及审计');

 for(const [key,stock,quantity=10] of [['short','9'],['excess','11'],['blank',''],['not-applicable','-'],['invalid','invalid'],['negative','-1'],['zero','0',0],['fractional-order','10',10.5]]){
  const row=order(key,{quantity});row.ledger.columns.BF=stock;rawInsert(row);await rejected(row);
 }
 for(const [key,stockDate] of [['blank-stock-date',''],['invalid-stock-date','2026-02-30'],['future-stock-date',tomorrow]]){const row=order(key);row.ledger.columns.BG=stockDate;rawInsert(row);await rejected(row);}
 const valid=insert('denials');await rejected(valid,{closedDate:''});await rejected(valid,{closedDate:'2026-02-30'});await rejected(valid,{closedDate:shift(-2)});await rejected(valid,{closedDate:tomorrow});await rejected(valid,{version:0},409);await rejected(valid,{mode:'active'},403);
 for(const user of [other,production,finance,sales,restricted])await rejected(valid,{},403,user);
 const cancelled=insert('cancelled',{sourceStatus:'已取消'});await rejected(cancelled,{},403);const noLedger=insert('standard',{ledger:undefined});await rejected(noLedger,{},403);
 pass('成品文员不能短结、超量结单、恢复、处理取消或不可读订单；无效数量日期与旧版本被拒且不写入');

 const raced=insert('race'),race=await Promise.all([call('ledger-lifecycle',payload(raced),worker),call('ledger-lifecycle',payload(raced),worker)]);assert.equal(race.filter(r=>r.status===200).length,1);assert(race.some(r=>[403,409].includes(r.status)));assert.equal(current(raced.id).version,2);assert.equal(rawRecords().filter(x=>x.kind==='audit'&&x.targetId===raced.id&&x.action==='结单归档').length,1);
 const exception=insert('pmc-special');exception.ledger.columns.BF='1';rawInsert(exception);await ok('ledger-lifecycle',payload(exception));let archived=current(exception.id);assert.equal(archived.ledger.columns.BF,'1');assert.equal(archived.ledger.columns.BH,businessDate);await ok('ledger-lifecycle',payload(archived,{mode:'active'}));assert.equal(current(exception.id).lifecycle,'active');
 pass('正常结单并发只有一次写入，PMC既有特殊结单与恢复权限保持');

 const supplier={id:'finished_department_supplier',kind:'supplier',name:'合成协作成品厂',active:true,version:1},guarded=insert('collaboration');guarded.ledger.columns={...guarded.ledger.columns,A:supplier.name,BF:'0',BG:''};rawInsert(guarded);rawInsert(supplier);
 await ok('finished-supplier-task-create',{lineId:guarded.id,supplierId:supplier.id,orderVersion:guarded.version,template:'custom',steps:[{id:'packing',label:'包装'}],dueDate:tomorrow,baseline:{cutoffDate:businessDate,confirmed:true,stepCompleted:{packing:0},inTransit:[],pendingInspection:[],reworks:[],note:'合成已核定期初'},token:crypto.randomUUID()});
 for(const user of [worker,undefined])for(const [action,body] of [['ledger-edit',{id:guarded.id,version:1,patch:{BF:'10'},reason:'合成绕过测试'}],['ledger-edit',{id:guarded.id,version:1,patch:{BG:businessDate},reason:'合成绕过测试'}],['ledger-edit',{id:guarded.id,version:1,patch:{BH:businessDate},reason:'合成绕过测试'}],['ledger-lifecycle',payload(guarded)],['pack',{lineId:guarded.id}]]){const before=current(guarded.id),response=await call(action,body,user);assert.equal(response.status,409,await response.text());assert.deepEqual(current(guarded.id),before);}
 pass('活跃成品协作任务仍禁止从原表、结单及pack入口绕过收货、QC与入仓账本');
}
