import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBusinessReader,createBusinessAccess,businessProjection,withBusinessAccess,currentBusinessAccess} from './business-api.mjs';
import {createRuntimePool,userSchema} from './runtime-pool.mjs';

const user={username:'SYN-user',role:'admin',mustChange:false,identity:{id:'SYN-A'}};
test('业务传输只能读取固定 GET 接口，凭据不进入返回值，拒绝跨地址与任意范围',async()=>{
 const calls=[];
 const transport=(options,done)=>{
  calls.push(options);const request=new EventEmitter();request.end=()=>{const response=new EventEmitter();response.statusCode=options.path.endsWith('customer-quote-templates')?400:200;response.headers={'content-type':'application/json'};done(response);queueMicrotask(()=>{response.emit('data',Buffer.from('{"rows":[{"id":"SYN-1"}]}'));response.emit('end');});};return request;
 };
 const read=createBusinessReader({publicOrigin:'https://example.test',transport});
 const result=await read('other=not-forwarded; doon_employee_session='+'s'.repeat(43),'purchase-data');
 assert.deepEqual(result,{rows:[{id:'SYN-1'}]});assert.equal(calls[0].method,'GET');assert.equal(calls[0].path,'/api/workspace/purchase-data');assert.equal(calls[0].hostname,'host.docker.internal');assert(!calls[0].headers.Cookie.includes('other'));assert.equal(calls[0].rejectUnauthorized,true);
 await assert.rejects(read('doon_session='+'s'.repeat(43),'https://evil.test'));
 await assert.rejects(read('doon_session='+'s'.repeat(43),'data',{path:'../../private'}));assert.equal(calls.length,1);
 await assert.rejects(read('doon_session='+'s'.repeat(43),'customer-quote-templates'),{status:400},'旧模块要求查询参数时保留 400，不把它误判为全局 503');
 assert.throws(()=>createBusinessReader({publicOrigin:'https://example.test',connectHost:'evil.test'}));
});

test('每次读取重验成员、原有字段权限；目录无样本，分页不泄漏账号及集成凭据',async()=>{
 let revoked=false,priceVisible=true,reads=0,authentications=0;
 const access=createBusinessAccess({cookie:'synthetic',user,authenticate:async()=>{authentications++;return revoked?null:user;},read:async(cookie,source)=>{
  reads++;if(source!=='purchase-data')throw Object.assign(new Error('not granted'),{status:403});
  return{revision:3,me:{passwordHash:'private'},integration:{apiKey:'private'},rows:[{id:'SYN-1',version:2,supplier:'SYN供应商',...(priceVisible?{price:'12.00'}:{}),apiToken:'private'},{id:'SYN-2',version:1,supplier:'SYN供应商乙'}]};
 }});
 const modules=await access.catalog();assert.equal(authentications,1,'一次列目录只检查一次 Studio 准入，避免耗尽认证限流；每个业务 GET 仍由原接口重新鉴权');assert.deepEqual(modules.modules.map(m=>m.id),['purchase-data']);assert.equal(modules.eventsEnabled,false);assert(!JSON.stringify(modules).includes('SYN供应商'));
 const fields=await access.catalog('purchase-data');assert(fields.datasets.find(d=>d.path==='/rows').fields.some(f=>f.path==='/price'));assert(!JSON.stringify(fields).includes('apiToken'));
 const page=await access.query({source:'purchase-data',dataset:'/rows',offset:0,limit:1,fields:['/supplier']});assert.equal(page.total,2);assert.equal(page.nextOffset,1);assert.equal(page.records[0]['/id'],'SYN-1');assert(!JSON.stringify(page).includes('private'));
 priceVisible=false;await assert.rejects(access.query({source:'purchase-data',dataset:'/rows',fields:['/price']}));
 assert.equal(await access.verify({}),false);assert.equal((await access.poll()).enabled,false);
 const before=reads;revoked=true;await assert.rejects(access.query({source:'purchase-data',dataset:'/rows'}));assert.equal(reads,before);
 assert.throws(currentBusinessAccess);await withBusinessAccess(access,async()=>{await new Promise(resolve=>setImmediate(resolve));assert.equal(currentBusinessAccess(),access);});assert.throws(currentBusinessAccess);
 assert.deepEqual(businessProjection({records:[{id:'SYN',nested:{password:'secret',note:'safe'}}]}),{records:[{id:'SYN',nested:{note:'safe'}}]});
});

test('用户运行时并发建一次，跨用户存储独立；活跃实例不淘汰，闲置仅关闭连接不删除数据',async()=>{
 let now=0,created=0,closed=0;const schemas=[];
 const pool=createRuntimePool({max:1,idleMs:100,now:()=>now,create:async(user,schema)=>{created++;schemas.push(schema);return{close:async()=>{closed++;}};}});
 const [one,two]=await Promise.all([pool.acquire(user),pool.acquire(user)]);assert.equal(created,1);assert.equal(one.studio,two.studio);
 const other={...user,identity:{id:'SYN-B'}};await assert.rejects(pool.acquire(other),{status:429});now=200;one.release();await assert.rejects(pool.acquire(other),{status:429});two.release();now=400;
 const third=await pool.acquire(other);assert.equal(closed,1);assert.notEqual(schemas[0],schemas[1]);assert.equal(schemas[0],userSchema('SYN-A'));assert(!schemas[0].includes('SYN-A'));third.release();await pool.close();assert.equal(closed,2);
});

test('旧模块缺省参数及单模块失败不会阻断全部目录；并行相同目录合并在途请求，下次重新鉴权',async()=>{
 let authCalls=0,reads=0;
 const access=createBusinessAccess({cookie:'synthetic',user,authenticate:async()=>{authCalls++;return user;},read:async(cookie,source)=>{
  reads++;if(source==='data')return{records:[{id:'SYN-1',status:'已确认'}]};
  throw Object.assign(new Error('synthetic unavailable'),{status:source==='customer-project-data'?503:source==='customer-quote-templates'?400:404});
 }});
 const [one,two]=await Promise.all([access.catalog(),access.catalog()]);assert.equal(one,two);assert.equal(authCalls,1);assert.equal(reads,34);assert.equal(one.modules[0].id,'data');assert.deepEqual(one.unavailable,[{source:'customer-project-data',status:503}]);
 await access.catalog();assert.equal(authCalls,2);assert.equal(reads,68);
});
