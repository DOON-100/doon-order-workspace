import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';

export async function testKingdeeSync({call,ok,api,identity,admin,clerk,files,rawRecords,rawInsert,pass}){
 const settings=globalThis.__testEnv,oldFetch=globalThis.fetch,oldBatch=settings.DB.batch;
 const config={DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'sync-synthetic-client',DOON_KINGDEE_CLIENT_SECRET:'sync-synthetic-secret',DOON_KINGDEE_INSTANCE_ID:'sync-synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'sync-synthetic-account'};
 const uuid=()=>({requestId:randomUUID()}),saved=()=>rawRecords().filter(r=>r.kind==='kingdee_pending_api_row');
 const headers=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
 const values=['SYNC-PO-2','2026-10-21','合成同步供应商','合成采购员','已审核','未关闭','2026-10-25','SYNC-MAT','合成物料','副',99,'原始备注','',''];
 const rows=[{sourceRow:2,values,displayValues:values.map(String),rowType:'data'}],rowsText=JSON.stringify(rows),hash=createHash('sha256').update(rowsText).digest('hex');
 const seed={id:'sync-synthetic-snapshot',kind:'kingdee_pending_snapshot',headers,rowsKey:'sync-synthetic-rows',rowsHash:hash,fileKey:'sync-synthetic-file',hash:'synthetic',committedRevision:999999,createdAt:'2026-10-21T00:00:00Z',metadata:{filename:'synthetic.xlsx',hash:'synthetic',sourceAsOf:'2026-10-21',sourceFilter:'合成测试',sourceAccount:'合成账套',sourceSheet:'合成表',headerRow:1,importedAt:'2026-10-21T00:00:00Z',importedBy:'合成用户',rowCount:1,sourceRowCount:1,orderCount:1,supplierCount:1,quantityMeaning:'原表数量'}};
 files.set(seed.rowsKey,rowsText);files.set(seed.fileKey,new Uint8Array([1,2,3]));rawInsert(seed);
 rawInsert({id:'sync-synthetic-purchase-known',kind:'purchase',po:'SYNC-PO-4',itemCode:'SYNC-MAT',supplier:'合成同步供应商',unit:'副',lifecycle:'archived',quantity:99});
 rawInsert({id:'sync-synthetic-purchase-ambiguous',kind:'purchase',po:'SYNC-PO-3',itemCode:'OTHER',supplier:'合成同步供应商',unit:'副',lifecycle:'active',quantity:99});
 const originals=rawRecords(),beforeFiles=new Map(files),calls=[];
 let mode='ok',detailReads=new Map();
 const summary=id=>({id,bill_no:'SYNC-PO-'+id,bill_date:'2026-10-21',bill_status:'C',bill_close_state:'C',supplier_id:'SYNC-SUP',supplier_name:'合成同步供应商',emp_name:'合成采购员'});
 const line=(id,n)=>({id:'line-'+id+'-'+n,entry_realio_status:id==='5'?'':'A',close_state:'1',qty:mode==='existing-changed'?999:10,delivery_date:'2026-10-25',material_number:'SYNC-MAT',material_name:'合成物料',material_model:'合成规格',unit_name:'副',comment:'合成备注'});
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push({path:u.pathname,method:options.method});
  if(u.pathname.endsWith('push_app_authorize'))return Response.json({code:200,data:[{clientId:config.DOON_KINGDEE_CLIENT_ID,outerInstanceId:config.DOON_KINGDEE_INSTANCE_ID,accountId:config.DOON_KINGDEE_ACCOUNT_ID,status:1,appKey:'sync-key',appSecret:'sync-secret',domain:'https://tf.jdy.com'}]});
  if(u.pathname.endsWith('kingdee_auth_token'))return Response.json({errcode:0,data:{'app-token':'SYNC-TOKEN'}});
  assert.equal(options.method,'GET');assert.equal(u.origin,'https://api.kingdee.com');
  if(mode==='network')throw new Error('synthetic-network');
  if(u.pathname.endsWith('/pur_order')){
   const page=Number(u.searchParams.get('page'));assert.equal(u.searchParams.get('page_size'),'5');assert.equal(u.searchParams.get('bill_status'),'C');
   const ids=page===1?['1','2','3','4','5']:['6'];return Response.json({errcode:0,data:{count:6,total_page:2,page,page_size:5,current_page_size:ids.length,rows:ids.map(summary)}});
  }
  assert.equal(u.pathname,'/jdy/v2/scm/pur_order_detail');const id=u.searchParams.get('id'),read=(detailReads.get(id)||0)+1;detailReads.set(id,read);
  const material_entity=Array.from({length:id==='1'?40:1},(_,n)=>line(id,n));
  if(id==='1')material_entity.push({...line(id,'complete'),entry_realio_status:'C'});
  if(id==='1'&&['changed','new','revision-race'].includes(mode)){
   material_entity.push({...line(id,'new'),qty:mode==='changed'&&read>1?11:10});
   if(mode==='revision-race'&&read>1)await oldBatch([settings.DB.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'")]);
  }
  return Response.json({errcode:0,data:{...summary(id),material_entity}});
 };
 try{
  assert.equal((await call('kingdee-sync-run',uuid())).status,503);Object.assign(settings,config);
  for(const user of [null,clerk]){assert.equal((await call('kingdee-sync-run',uuid(),user)).status,user?403:401);assert.equal((await call('kingdee-sync-result',undefined,user)).status,user?403:401);}
  for(const headers of [{'X-Workspace-Team':'group'},{Origin:'https://evil.invalid'}]){
   const res=await identity.run(admin,()=>api.POST(new Request('https://orders.test/api/workspace/kingdee-sync-run',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(uuid())}),{params:Promise.resolve({action:'kingdee-sync-run'})}));assert.equal(res.status,403);
  }
  for(const body of [{},{...uuid(),limit:31},{...uuid(),rows:[]},{requestId:'bad'}])assert.equal((await call('kingdee-sync-run',body)).status,400);
  assert.equal(calls.length,0);pass('金蝶一键同步的身份、范围、跨站、连接配置及载荷校验均在外呼和写入前生效');
  const firstKey=uuid(),first=await ok('kingdee-sync-run',firstKey);assert.equal(first.inserted,30);assert.equal(first.deferred,10);assert.equal(first.skipped,2);assert.equal(first.held,2);assert.equal(first.nextPage,1);assert.equal(saved().length,30);
  const firstRecords=JSON.stringify(saved()),beforeRetry=calls.length,afterFirst=JSON.stringify(rawRecords());
  assert.deepEqual(await ok('kingdee-sync-run',firstKey),first);assert.equal(calls.length,beforeRetry);assert.equal(JSON.stringify(rawRecords()),afterFirst);
  assert.deepEqual((await ok('kingdee-sync-result?requestId='+firstKey.requestId)).receipt,first);
  assert.equal((await ok('kingdee-sync-result?requestId='+randomUUID())).status,'not-completed');
  pass('单张采购单超过 30 行仍仅新增 30 行；旧 Excel 与归档采购去重、歧义暂存，重复请求只回读原回执');
  const second=await ok('kingdee-sync-run',uuid());assert.equal(second.inserted,10);assert.equal(second.skipped,32);assert.equal(second.nextPage,2);assert.equal(saved().length,40);
  const third=await ok('kingdee-sync-run',uuid());assert.equal(third.page,2);assert.equal(third.inserted,1);assert.equal(third.nextPage,1);assert.equal(saved().length,41);
  assert.equal(JSON.stringify(saved().slice(0,30)),firstRecords);
  mode='existing-changed';const changed=await ok('kingdee-sync-run',uuid());assert.equal(changed.inserted,0);assert.equal(changed.skipped,42);assert(saved().every(r=>r.row.values[9]==='10'));
  const data=await ok('kingdee-pending-data');assert.equal(data.snapshot.rows.filter(r=>r.rowType==='data').length,42);assert.equal(data.snapshot.metadata.apiAddedCount,41);assert(data.snapshot.headers.includes('金蝶行 ID'));
  assert.deepEqual((await ok('kingdee-pending-data?id='+seed.id)).snapshot.rows,rows);
  assert.equal((await ok('kingdee-pending-data',undefined,clerk)).snapshot.rows.some(r=>String(r.values[0]).startsWith('SYNC-PO-')),false);
  assert.deepEqual(new Uint8Array(await (await call('kingdee-pending-file?id='+seed.id)).arrayBuffer()),beforeFiles.get(seed.fileKey));
  pass('下一次从剩余行和下一页继续；金蝶数量改变也不更新既有记录，当前总表可读新增行，原文件和历史版本不变');
  mode='ok';await ok('kingdee-sync-run',uuid()); // cursor back to page 1
  let before=JSON.stringify(rawRecords());mode='changed';detailReads.clear();assert.equal((await call('kingdee-sync-run',uuid())).status,409);assert.equal(JSON.stringify(rawRecords()),before);
  mode='revision-race';detailReads.clear();assert.equal((await call('kingdee-sync-run',uuid())).status,409);assert.equal(JSON.stringify(rawRecords()),before);
  mode='new';detailReads.clear();settings.DB.batch=async statements=>oldBatch([...statements,settings.DB.prepare('INSERT INTO transaction_guards (id,valid) VALUES (?,0)').bind('synthetic-failure')]);
  const failedKey=uuid();assert.equal((await call('kingdee-sync-run',failedKey)).status,409);assert.equal(JSON.stringify(rawRecords()),before);assert.equal((await ok('kingdee-sync-result?requestId='+failedKey.requestId)).status,'not-completed');settings.DB.batch=oldBatch;
  const race=await Promise.all([call('kingdee-sync-run',failedKey),call('kingdee-sync-run',uuid())]);assert.deepEqual(race.map(r=>r.status).sort(),[200,429]);assert.equal(saved().length,42);
  pass('写入前复查发现源变更或并发修订则零写入；数据库失败原子回滚，同账套并发仅一个批次执行');
  before=JSON.stringify(rawRecords());mode='network';assert((await call('kingdee-sync-run',uuid())).status>=400);assert.equal(JSON.stringify(rawRecords()),before);
  for(const original of originals)assert.deepEqual(rawRecords().find(r=>r.id===original.id),original);
  assert.deepEqual(files,beforeFiles);assert(calls.every(c=>c.method==='GET'||c.path==='/jdyconnector/app_management/push_app_authorize'));
  assert(rawRecords().filter(r=>r.kind==='kingdee_sync_receipt').every(r=>r.inserted<=30));
  pass('全流程金蝶业务接口仅 GET；原始业务、账号、来源文件逐值不变，每批最多 30 行且只写独立新增记录与审计');
 }finally{globalThis.fetch=oldFetch;settings.DB.batch=oldBatch;for(const key of Object.keys(config))delete settings[key];}
}
