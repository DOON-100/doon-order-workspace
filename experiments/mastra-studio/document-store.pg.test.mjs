// Explicit opt-in integration test. No PG* defaults, production database, Docker
// installation or database creation. Provision a dedicated local database named
// doon_document_test_<8-32 lowercase hex characters> and its test-only role first.
// Set DOON_DOCUMENT_PG_TEST=1 and every DOON_DOCUMENT_TEST_PG_{HOST,PORT,DATABASE,
// USER,PASSWORD}; then run: node --test document-store.pg.test.mjs
// All rows and schemas are synthetic. This script drops only random schemas it
// created in this run. It never drops the supplied database or modifies roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresDocumentStore,DOCUMENT_STORE_LIMITS,DOCUMENT_PG_TIMEOUTS} from './document-store.mjs';

const enabled=process.env.DOON_DOCUMENT_PG_TEST==='1';
function configuration(){
 const values=Object.fromEntries(['HOST','PORT','DATABASE','USER','PASSWORD'].map(key=>[key,process.env['DOON_DOCUMENT_TEST_PG_'+key]]));
 if(Object.values(values).some(value=>typeof value!=='string'||!value))throw Error('请显式配置独立合成 PostgreSQL 测试连接的全部 DOON_DOCUMENT_TEST_PG_* 参数。');
 const port=Number(values.PORT);
 if(!['localhost','127.0.0.1','::1'].includes(values.HOST)||!/^doon_document_test_[a-f0-9]{8,32}$/.test(values.DATABASE)||!/^\d+$/.test(values.PORT)||!Number.isInteger(port)||port<1||port>65535)throw Error('集成测试只允许本机显式端口及 doon_document_test_<hex> 独立合成数据库。');
 return{host:values.HOST,port,user:values.USER,password:values.PASSWORD,database:values.DATABASE};
}
const fixture=()=>({kind:'input',filename:'合成验收.txt',mimeType:'text/plain',bytes:Buffer.from('测试环境，不含正式业务数据。'),metadata:{text:'中文原件和来源核验',sections:[{source:'第 1 行',text:'合成文字'}]}});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('synthetic PG persists originals, isolates owners/schemas, reconnects after idle termination and closes idempotently',{skip:!enabled,timeout:90000},async()=>{
 const config=configuration(),suffix=randomBytes(8).toString('hex'),application='doon-document-test-'+suffix;
 const admin=new Pool({...config,max:1,application_name:application+'-admin',...DOCUMENT_PG_TIMEOUTS});admin.on('error',()=>{});
 const schemas=['agent_user_'+randomBytes(16).toString('hex'),'agent_user_'+randomBytes(16).toString('hex')],created=[],stores=[];let first,second;
 try{
  const actual=(await admin.query('SELECT current_database() name')).rows[0].name;assert.equal(actual,config.database);
  for(const schema of schemas){assert.match(schema,/^agent_user_[a-f0-9]{32}$/);await admin.query(`CREATE SCHEMA "${schema}"`);created.push(schema);}
  const open=async(index,tag)=>{const store=await createPostgresDocumentStore({...config,application_name:application+'-'+tag},schemas[index],{syntheticDatabase:config.database});stores.push(store);return store;};
  first=await open(0,'first');second=await open(1,'second');
  const source=fixture(),saved=await first.put('SYN-owner',source);assert.equal(saved.size,source.bytes.length);assert.equal(saved.sha256,createHash('sha256').update(source.bytes).digest('hex'));
  await first.bind('SYN-owner',saved.id,'SYN-thread');await assert.rejects(first.bind('SYN-owner',saved.id,'SYN-other-thread'),{status:404});
  assert.equal(await first.get('SYN-other-owner',saved.id),null);assert.equal(await second.get('SYN-owner',saved.id),null);
  await Promise.all([first.close(),first.close(),first.close()]);first=await open(0,'reopened');
  const persisted=await first.get('SYN-owner',saved.id);assert.deepEqual(persisted.bytes,source.bytes);assert.deepEqual(persisted.metadata,source.metadata);assert.equal(persisted.sha256,saved.sha256);assert.equal(persisted.threadId,'SYN-thread');

  // Select and terminate only this test's idle connection in the synthetic DB.
  const idle=(await admin.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND application_name=$2 AND usename=current_user AND state='idle'",[config.database,application+'-reopened'])).rows;
  assert.equal(idle.length,1);assert.equal((await admin.query('SELECT pg_terminate_backend($1) terminated',[idle[0].pid])).rows[0].terminated,true);
  for(let attempt=0;attempt<40;attempt++){if(!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND datname=$2',[idle[0].pid,config.database])).rowCount)break;await delay(50);}
  await delay(50);const recovered=await first.get('SYN-owner',saved.id);assert.equal(recovered.sha256,saved.sha256);assert.deepEqual(recovered.bytes,source.bytes);
  const nextPid=(await admin.query("SELECT pid FROM pg_stat_activity WHERE datname=$1 AND application_name=$2 AND usename=current_user AND state='idle'",[config.database,application+'-reopened'])).rows[0]?.pid;assert(nextPid&&nextPid!==idle[0].pid);

  // Exercise actual JSONB UTF-8 quota accounting without writing 500 MiB. Only
  // this synthetic sentinel's size is adjusted and is restored immediately.
  const quotaOwner='SYN-quota',sentinel=await first.put(quotaOwner,fixture()),next=fixture();
  const sizes=(await admin.query(`SELECT octet_length(metadata::text) old_bytes,octet_length($2::jsonb::text) next_bytes FROM "${schemas[0]}"."doon_studio_documents" WHERE id=$1`,[sentinel.id,JSON.stringify(next.metadata)])).rows[0];
  const limit=DOCUMENT_STORE_LIMITS.bytes-Number(sizes.old_bytes)-Number(sizes.next_bytes)-next.bytes.length;
  try{
   await admin.query(`UPDATE "${schemas[0]}"."doon_studio_documents" SET size=$1 WHERE id=$2`,[limit+1,sentinel.id]);await assert.rejects(first.put(quotaOwner,next),{status:413});
   await admin.query(`UPDATE "${schemas[0]}"."doon_studio_documents" SET size=$1 WHERE id=$2`,[limit,sentinel.id]);const boundary=await first.put(quotaOwner,next);assert.equal(boundary.size,next.bytes.length);
  }finally{await admin.query(`UPDATE "${schemas[0]}"."doon_studio_documents" SET size=$1 WHERE id=$2`,[sentinel.size,sentinel.id]);}
  await Promise.all(stores.flatMap(store=>[store.close(),store.close()]));
 }catch(error){
  // Keep server error strings, connection details and file contents out of logs.
  throw Error('合成 PostgreSQL 文档存储验证失败'+(/^[A-Z0-9]{5}$/.test(error.code||'')?'（'+error.code+'）':'')+'。');
 }finally{
  const closed=await Promise.allSettled(stores.map(store=>store.close()));
  try{for(const schema of created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await admin.end();}
  if(closed.some(result=>result.status==='rejected'))throw Error('合成文档存储关闭未完成。');
 }
});
