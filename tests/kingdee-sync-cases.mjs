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
 const originals=rawRecords(),beforeFiles=new Map(files),calls=[],queries=[];
 const oldPrepare=settings.DB.prepare;settings.DB.prepare=sql=>{queries.push(sql);return oldPrepare(sql);};
 let mode='legacy',active=0,peak=0;
 const ids=()=>mode==='legacy'?Array.from({length:30},(_,i)=>String(i+1)):mode==='wide'?['wide',...Array.from({length:29},(_,i)=>'wide-other-'+i)]:[...(mode==='one-new'?['new']:mode==='retry-new'?['retry']:[]),...Array.from({length:30},(_,i)=>'bulk-'+i)].slice(0,30);
 const summary=(id,index)=>({id,bill_no:'SYNC-PO-'+id,bill_date:'2026-10-20',create_time:`2026-10-20 10:${String(59-index).padStart(2,'0')}:00`,bill_status:'C',bill_close_state:'C',supplier_id:'SYNC-SUP',supplier_name:'合成同步供应商',emp_name:'合成采购员'});
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);calls.push({path:u.pathname,method:options.method,id:u.searchParams.get('id')});
  if(u.pathname.endsWith('push_app_authorize'))return Response.json({code:200,data:[{clientId:config.DOON_KINGDEE_CLIENT_ID,outerInstanceId:config.DOON_KINGDEE_INSTANCE_ID,accountId:config.DOON_KINGDEE_ACCOUNT_ID,status:1,appKey:'sync-key',appSecret:'sync-secret',domain:'https://tf.jdy.com'}]});
  if(u.pathname.endsWith('kingdee_auth_token'))return Response.json({errcode:0,data:{'app-token':'SYNC-TOKEN'}});
  assert.equal(options.method,'GET');assert.equal(u.origin,'https://api.kingdee.com');
  if(mode==='network')throw new Error('synthetic-network');
  if(u.pathname.endsWith('/pur_order')){
   assert.equal(u.searchParams.get('page'),'1');assert.equal(u.searchParams.get('page_size'),'30');assert.equal(u.searchParams.get('bill_status'),'C');assert(Number(u.searchParams.get('create_end_time'))<=Date.now());
   const rows=ids().map(summary);if(mode==='unordered')rows.reverse();
   return Response.json({errcode:0,data:{count:6311,total_page:211,page:1,page_size:30,current_page_size:30,rows}});
  }
  assert.equal(u.pathname,'/jdy/v2/scm/pur_order_detail');active++;peak=Math.max(peak,active);
  try{
   await new Promise(resolve=>setTimeout(resolve,2));
   const id=u.searchParams.get('id'),list=ids(),detail={...summary(id,list.indexOf(id)),material_entity:Array.from({length:id==='wide'?40:1},(_,n)=>({id:'line-'+id+'-'+n,entry_realio_status:id==='5'?'':id==='6'?'C':'A',close_state:'1',qty:mode==='existing-changed'?999:10,delivery_date:'2026-10-25',material_number:'SYNC-MAT',material_name:'合成物料',unit_name:'副',comment:'合成原文'}))};
   if(mode==='bad-detail'&&list.indexOf(id)===1)detail.id='wrong';
   return Response.json({errcode:0,data:detail});
  }finally{active--;}
 };
 try{
  assert.equal((await call('kingdee-sync-run',uuid())).status,503);Object.assign(settings,config);
  for(const user of [null,clerk]){assert.equal((await call('kingdee-sync-run',uuid(),user)).status,user?403:401);assert.equal((await call('kingdee-sync-result',undefined,user)).status,user?403:401);assert.equal((await call('kingdee-sync-ready',undefined,user)).status,user?403:401);}
  for(const headers of [{'X-Workspace-Team':'group'},{Origin:'https://evil.invalid'}]){
   const res=await identity.run(admin,()=>api.POST(new Request('https://orders.test/api/workspace/kingdee-sync-run',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(uuid())}),{params:Promise.resolve({action:'kingdee-sync-run'})}));assert.equal(res.status,403);
  }
  for(const body of [{},{...uuid(),limit:31},{...uuid(),rows:[]},{requestId:'bad'}])assert.equal((await call('kingdee-sync-run',body)).status,400);
  assert.equal(calls.length,0);pass('最新 30 条同步仍校验身份、范围、同源及固定载荷，不能由浏览器扩大数量或提交源行');
  const beforeReady=JSON.stringify(rawRecords());assert.equal((await ok('kingdee-sync-ready')).ready,true);assert.equal(JSON.stringify(rawRecords()),beforeReady);assert.equal(calls.length,2);assert(calls.every(c=>c.path.includes('/app_management/')));await ok('kingdee-sync-ready');assert.equal(calls.length,2);
  const firstKey=uuid(),first=await ok('kingdee-sync-run',firstKey);assert.equal(first.selected,30);assert.equal(first.inserted,25);assert.equal(first.skipped,2);assert.equal(first.held,2);assert.equal(first.excludedComplete,1);assert.equal(saved().length,25);assert.equal(peak,3);
  const firstRecords=JSON.stringify(saved()),beforeRetry=calls.length,afterFirst=JSON.stringify(rawRecords());
  assert.deepEqual(await ok('kingdee-sync-run',firstKey),first);assert.equal(calls.length,beforeRetry);assert.equal(JSON.stringify(rawRecords()),afterFirst);
  assert.deepEqual((await ok('kingdee-sync-result?requestId='+firstKey.requestId)).receipt,first);assert.equal((await ok('kingdee-sync-result?requestId='+randomUUID())).status,'not-completed');
  assert.equal(calls.filter(c=>c.path.endsWith('/pur_order')).length,1);assert.equal(calls.filter(c=>c.path.endsWith('/pur_order_detail')).length,30);
  assert(!queries.some(sql=>/^SELECT data FROM records ORDER BY rowid$/i.test(sql)));
  pass('先选最新 30 行再去重，历史原表与归档采购仍跳过；只读一次列表和每单详情，三路并发且不读取整库');
  const repeated=await ok('kingdee-sync-run',uuid());assert.equal(repeated.inserted,0);assert.equal(repeated.skipped,27);assert.equal(JSON.stringify(saved()),firstRecords);assert.equal(rawRecords().filter(r=>r.kind==='kingdee_sync_cursor').length,0);
  const beforeView=queries.length;const data=await ok('kingdee-pending-data');assert(!queries.slice(beforeView).some(sql=>/^SELECT data FROM records ORDER BY rowid$/i.test(sql)));assert.equal(data.snapshot.metadata.apiAddedCount,25);assert(data.snapshot.headers.includes('金蝶行 ID'));
  assert.deepEqual((await ok('kingdee-pending-data?id='+seed.id)).snapshot.rows,rows);assert.equal((await ok('kingdee-pending-data',undefined,clerk)).snapshot.rows.some(r=>String(r.values[0]).startsWith('SYNC-PO-')),false);
  mode='bulk';assert.equal((await ok('kingdee-sync-run',uuid())).inserted,30);const bulkBefore=JSON.stringify(saved());
  mode='existing-changed';assert.equal((await ok('kingdee-sync-run',uuid())).inserted,0);assert.equal(JSON.stringify(saved()),bulkBefore);
  mode='one-new';const one=await ok('kingdee-sync-run',uuid());assert.equal(one.inserted,1);assert.equal(one.skipped,29);assert.equal(one.selected,30);assert.equal(saved().length,56);assert(saved().some(r=>r.row.values[14]==='bulk-29'));
  pass('最新 30 条中 29 条已存在时只新增 1 条，不向历史补满；已记录的旧行完整保留，源数量变化也不更新');
  mode='wide';const beforeWide=calls.length,wide=await ok('kingdee-sync-run',uuid());assert.equal(wide.inserted,30);assert.equal(wide.selected,30);assert.equal(calls.slice(beforeWide).filter(c=>c.path.endsWith('/pur_order_detail')).length,3);
  assert.equal((await ok('kingdee-sync-run',uuid())).inserted,0);assert.equal(saved().filter(r=>r.row.values[14]==='wide').length,30);
  pass('一张采购单 40 行只取最新窗口的 30 行，重复点击不续传更早 10 行；取满即停，不读取余下订单');
  for(const failure of ['unordered','bad-detail']){mode=failure;const before=JSON.stringify(rawRecords());assert.equal((await call('kingdee-sync-run',uuid())).status,409);assert.equal(JSON.stringify(rawRecords()),before);assert.equal(active,0);}
  mode='retry-new';let before=JSON.stringify(rawRecords());settings.DB.batch=async statements=>{await oldBatch([oldPrepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'")]);return oldBatch(statements);};assert.equal((await call('kingdee-sync-run',uuid())).status,409);assert.equal(JSON.stringify(rawRecords()),before);settings.DB.batch=oldBatch;
  settings.DB.batch=async statements=>oldBatch([...statements,oldPrepare('INSERT INTO transaction_guards (id,valid) VALUES (?,0)').bind('synthetic-failure')]);const failedKey=uuid();assert.equal((await call('kingdee-sync-run',failedKey)).status,409);assert.equal(JSON.stringify(rawRecords()),before);assert.equal((await ok('kingdee-sync-result?requestId='+failedKey.requestId)).status,'not-completed');settings.DB.batch=oldBatch;
  const race=await Promise.all([call('kingdee-sync-run',failedKey),call('kingdee-sync-run',uuid())]);assert.deepEqual(race.map(r=>r.status).sort(),[200,429]);assert.equal((await ok('kingdee-sync-result?requestId='+failedKey.requestId)).receipt.inserted,1);
  pass('源标识或时间顺序异常零写入；并发修订、存储失败整批回滚，重复请求查原回执，同账套并发只执行一个');
  before=JSON.stringify(rawRecords());mode='network';assert((await call('kingdee-sync-run',uuid())).status>=400);assert.equal(JSON.stringify(rawRecords()),before);
  const afterRecords=new Map(rawRecords().map(record=>[record.id,record]));for(const original of originals)assert.deepEqual(afterRecords.get(original.id),original);assert.deepEqual(files,beforeFiles);
  assert(calls.every(c=>c.method==='GET'||c.path==='/jdyconnector/app_management/push_app_authorize'));assert(rawRecords().filter(r=>r.kind==='kingdee_sync_receipt').every(r=>r.inserted<=30));
  pass('金蝶业务全程只读，旧业务、账号、原件及历史版本不变，API 新增与摘要审计保持原子提交');
 }finally{globalThis.fetch=oldFetch;settings.DB.batch=oldBatch;settings.DB.prepare=oldPrepare;for(const key of Object.keys(config))delete settings[key];}
}
