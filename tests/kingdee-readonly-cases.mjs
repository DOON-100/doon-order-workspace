import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';

export async function testKingdeeReadonly({call,ok,api,identity,admin,clerk,files,rawRecords,pass}){
 const before=JSON.stringify(rawRecords()),beforeFiles=new Map(files),settings=globalThis.__testEnv;
 const oldFetch=globalThis.fetch,calls=[];
 const config={DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-client',DOON_KINGDEE_CLIENT_SECRET:'synthetic-client-secret',DOON_KINGDEE_INSTANCE_ID:'synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'synthetic-account'};
 let mode='ok',listCalls=0,authCalls=0,tokenCalls=0;
 const hmac=(key,message)=>Buffer.from(createHmac('sha256',key).update(message).digest('hex')).toString('base64');
 function summary(id){return {id,bill_no:'SYN-PO-'+id,bill_date:'2026-10-21',bill_status:'C',bill_close_state:'C',supplier_id:'SYN-SUP',supplier_name:'合成供应商',emp_name:'合成采购员',io_status:'Z',real_io_status:'Z'};}
 function detail(id){return {...summary(id),due_date:'2099-01-01',contact_phone:'DO-NOT-EXPOSE',price:999,material_entity:[{id:'line-'+id,entry_realio_status:({'1':'A','2':'Z','3':'C','4':''})[id]??'A',close_state:id==='5'?'2':'1',qty:10,delivery_date:'2026-10-25',material_number:'SYN-MAT',material_name:'合成镜架',material_model:'SYN',unit_name:'副',comment:'合成明细',custom_entity_field:{private:'DO-NOT-EXPOSE'}}]};}
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url),headers=options.headers;calls.push({path:u.pathname,method:options.method});
  assert.equal(u.origin,'https://api.kingdee.com');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  const names=[...u.searchParams.keys()].sort(),query=names.map(k=>k+'='+encodeURIComponent(encodeURIComponent(u.searchParams.get(k)))).join('&');
  const canonical=[options.method,encodeURIComponent(u.pathname),query,'x-api-nonce:'+headers['X-Api-Nonce'],'x-api-timestamp:'+headers['X-Api-TimeStamp'],''].join('\n');
  assert.equal(headers['X-Api-Signature'],hmac(config.DOON_KINGDEE_CLIENT_SECRET,canonical));
  assert.equal(headers['X-Api-ClientID'],config.DOON_KINGDEE_CLIENT_ID);
  if(u.pathname.endsWith('push_app_authorize')){
   authCalls++;assert.equal(options.method,'POST');assert.equal(options.body,undefined);assert.equal(u.searchParams.get('outerInstanceId'),config.DOON_KINGDEE_INSTANCE_ID);
   return Response.json({code:200,data:[{clientId:config.DOON_KINGDEE_CLIENT_ID,outerInstanceId:config.DOON_KINGDEE_INSTANCE_ID,accountId:mode==='wrong-account'?'other-account':config.DOON_KINGDEE_ACCOUNT_ID,status:1,appKey:'synthetic app+key',appSecret:'synthetic-app-secret',domain:mode==='bad-router'?'https://evil.invalid':'https://tf.jdy.com'}]});
  }
  if(u.pathname.endsWith('kingdee_auth_token')){
   tokenCalls++;assert.equal(options.method,'GET');assert.equal(u.searchParams.get('app_signature'),hmac('synthetic-app-secret','synthetic app+key'));
   return Response.json({errcode:0,data:{'app-token':'SYNTHETIC-TOKEN'}});
  }
  assert.equal(options.method,'GET');assert.equal(headers['app-token'],'SYNTHETIC-TOKEN');assert.equal(headers['X-GW-Router-Addr'],'https://tf.jdy.com');
  if(mode==='network')throw new Error('DO-NOT-EXPOSE upstream secret');
  if(mode==='rate')return new Response('DO-NOT-EXPOSE',{status:429});
  if(mode==='business')return Response.json({errcode:42,description:'DO-NOT-EXPOSE'});
  if(u.pathname.endsWith('/pur_order')){
   listCalls++;assert.equal(u.searchParams.get('bill_status'),'C');assert.equal(u.searchParams.get('page_size'),'5');
   const page=Number(u.searchParams.get('page')),ids=page===1?['1','2','3','4','5']:['6','7'];
   if(mode==='duplicate')ids[1]=ids[0];
   const rows=ids.map(summary);if(mode==='changed'&&listCalls%2===0)rows[0].bill_no='changed';
   return Response.json({errcode:0,data:{count:7,total_page:2,page,page_size:5,current_page_size:rows.length,rows:mode==='incomplete'?rows.slice(1):rows}});
  }
  assert.equal(u.pathname,'/jdy/v2/scm/pur_order_detail');
  const value=detail(u.searchParams.get('id'));
  if(mode==='missing-lines')delete value.material_entity;
  if(mode==='unsafe-id')value.id=9007199254740992;
  if(mode==='duplicate-line')value.material_entity.push(value.material_entity[0]);
  return Response.json({errcode:0,data:value});
 };
 try{
  assert.equal((await ok('kingdee-readonly-status')).configured,false);
  assert.equal((await call('kingdee-readonly-query')).status,503);
  Object.assign(settings,config);
  assert.equal((await ok('kingdee-readonly-status')).configured,true);assert.equal(calls.length,0);
  for(const action of ['kingdee-readonly-status','kingdee-readonly-query']){
   assert.equal((await call(action,undefined,null)).status,401);
   assert.equal((await call(action,undefined,clerk)).status,403);
   const response=await identity.run(admin,()=>api.GET(new Request('https://orders.test/api/workspace/'+action,{headers:{'X-Workspace-Team':'any-group'}}),{params:Promise.resolve({action})}));assert.equal(response.status,403);
  }
  for(const query of ['page=0','page=1&page=2','start=2026-02-30','start=2026-10-22&end=2026-10-21','url=https://evil.invalid','id=123'])assert.equal((await call('kingdee-readonly-query?'+query)).status,400);
  assert.equal(calls.length,0);pass('金蝶只读入口默认未配置，匿名、非采购成员、小组范围和任意参数在外呼前拒绝');
  const first=await ok('kingdee-readonly-query?start=2026-10-01&end=2026-10-21');
  assert.equal(first.readOnly,true);assert.equal(first.count,7);assert.equal(first.pages,2);assert.equal(first.rows.length,4);assert.equal(first.unknown,1);assert.equal(first.excludedComplete,1);
  assert.equal(first.rows[0].values[9],'10');assert.equal(first.rows[0].values[10],'2026-10-25');assert.equal(first.rows[0].values[11],'未入库');assert.equal(first.rows[1].values[11],'部分入库');assert.equal(first.rows[2].uncertain,true);assert.equal(first.rows[3].values[12],'手动关闭');
  assert(!JSON.stringify(first).includes('DO-NOT-EXPOSE'));assert(!JSON.stringify(first).includes('SYNTHETIC-TOKEN'));assert(!JSON.stringify(first).includes('2099-01-01'));
  const second=await ok('kingdee-readonly-query?page=2');assert.equal(second.orderIds.length,2);assert.equal(authCalls,1);assert.equal(tokenCalls,1);
  pass('金蝶签名、正式账套核对和缓存令牌通过；列表加商品详情只读分页，状态未知不推断且不泄露价格、凭据或联系资料');
  for(const failure of ['incomplete','duplicate','changed','missing-lines','unsafe-id','duplicate-line','rate','business','network']){
   mode=failure;listCalls=0;
   const response=await call('kingdee-readonly-query');assert(response.status>=400,failure);const body=await response.text();assert(!body.includes('DO-NOT-EXPOSE'),failure);
   // Rotate the synthetic instance to exercise fresh authorization after an upstream failure.
   config.DOON_KINGDEE_INSTANCE_ID+='x';settings.DOON_KINGDEE_INSTANCE_ID=config.DOON_KINGDEE_INSTANCE_ID;
  }
  for(const failure of ['wrong-account','bad-router']){
   mode=failure;const tokenBefore=tokenCalls;assert.equal((await call('kingdee-readonly-query')).status,502);assert.equal(tokenCalls,tokenBefore);
   config.DOON_KINGDEE_INSTANCE_ID+='x';settings.DOON_KINGDEE_INSTANCE_ID=config.DOON_KINGDEE_INSTANCE_ID;
  }
  pass('金蝶分页缺失、重复、变化、商品行损坏、错账套、异常路由、限流及网络错误均停止查询且不输出上游敏感信息');
  const beforePost=calls.length;assert.notEqual((await call('kingdee-readonly-query',{})).status,200);assert.equal(calls.length,beforePost);
  assert.equal(JSON.stringify(rawRecords()),before);assert.deepEqual(files,beforeFiles);
  assert(calls.every(c=>c.method==='GET'||c.path==='/jdyconnector/app_management/push_app_authorize'));
  pass('金蝶查询前后所有业务记录、来源文件逐值不变，无业务写接口、导入提交或自动同步');
 }finally{globalThis.fetch=oldFetch;for(const key of Object.keys(config))delete settings[key];}
}
