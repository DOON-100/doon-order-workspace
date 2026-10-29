import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDocumentStore,createPostgresDocumentStore,DOCUMENT_STORE_LIMITS,DOCUMENT_PG_TIMEOUTS} from './document-store.mjs';

const schema='agent_user_'+'1'.repeat(32),owner='SYN-owner';
const synthetic=(overrides={})=>({kind:'input',filename:'合成原件.txt',mimeType:'text/plain',bytes:Buffer.from('测试环境，不含正式业务数据。'),metadata:{text:'合成说明'},...overrides});
async function localFixture(operation){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-document-store-synthetic-'));let store=await createLocalDocumentStore(dir);
 try{await operation({dir,get store(){return store;},async reopen(){await store.close();store=await createLocalDocumentStore(dir);return store;}});}finally{await store.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
}

test('local originals survive repeated concurrent close/reopen with owner and thread isolation',()=>localFixture(async fixture=>{
 const original=synthetic(),saved=await fixture.store.put(owner,original);
 await fixture.store.bind(owner,saved.id,'SYN-thread');
 await assert.rejects(fixture.store.bind(owner,saved.id,'SYN-other-thread'),{status:404});
 assert.equal(await fixture.store.get('SYN-other-owner',saved.id),null);
 await Promise.all([fixture.store.close(),fixture.store.close(),fixture.store.close()]);
 const store=await fixture.reopen(),read=await store.get(owner,saved.id);
 assert.deepEqual(read.bytes,original.bytes);assert.equal(read.sha256,saved.sha256);assert.equal(read.size,original.bytes.length);assert.equal(read.threadId,'SYN-thread');assert.deepEqual(read.metadata,original.metadata);
}));

test('local quota includes UTF-8 metadata while public size remains original byte length',()=>localFixture(async({dir,store})=>{
 const seed=await store.put(owner,synthetic({bytes:Buffer.from('a'),metadata:{text:'中文来源'}})),next=synthetic({bytes:Buffer.from('b'),metadata:{text:'中文新内容'}});
 const db=new DatabaseSync(path.join(dir,'studio-documents.sqlite'));
 try{
  // Only this temporary synthetic fixture uses an artificial near-quota size;
  // no 500 MiB test file or business database is created.
  const oldMetadataBytes=Buffer.byteLength(JSON.stringify(seed.metadata)),nextStoredBytes=next.bytes.length+Buffer.byteLength(JSON.stringify(next.metadata));
  const boundary=DOCUMENT_STORE_LIMITS.bytes-oldMetadataBytes-nextStoredBytes;
  db.prepare('UPDATE documents SET size=? WHERE id=?').run(boundary+1,seed.id);
  await assert.rejects(store.put(owner,next),{status:413});assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,1);
  db.prepare('UPDATE documents SET size=? WHERE id=?').run(boundary,seed.id);
  const accepted=await store.put(owner,next);assert.equal(accepted.size,1);assert.deepEqual(accepted.bytes,next.bytes);
  await assert.rejects(store.put(owner,synthetic()),{status:413});
  assert.equal((await store.put('SYN-other-owner',next)).size,1);
 }finally{db.close();}
}));

test('local integrity checks reject corrupted originals without returning their contents',()=>localFixture(async({dir,store})=>{
 const saved=await store.put(owner,synthetic()),db=new DatabaseSync(path.join(dir,'studio-documents.sqlite'));
 try{db.prepare('UPDATE documents SET body=? WHERE id=?').run(Buffer.from('SYN-corruption'),saved.id);}finally{db.close();}
 await assert.rejects(store.get(owner,saved.id),error=>error.status===503&&!error.message.includes('SYN-corruption'));
}));

class FakePool extends EventEmitter{
 constructor(config,{quotaBytes=0,failInsert=false,failRollback=false}={}){super();this.config=config;this.quotaBytes=quotaBytes;this.failInsert=failInsert;this.failRollback=failRollback;this.calls=[];this.endCount=0;this.releases=[];this.saved=null;}
 async query(sql,params=[]){
  this.calls.push({sql,params});
  if(sql.startsWith('SELECT COUNT'))return{rows:[{count:0,bytes:this.quotaBytes,next_metadata_bytes:Buffer.byteLength(JSON.stringify(JSON.parse(params[1]),null,1))}]};
  if(sql.startsWith('INSERT')){
   if(this.failInsert)throw Error('SYN-insert-failed');
   const [id,owner,kind,filename,mime_type,size,sha256,thread_id,created_at,metadata,body]=params;this.saved={id,owner,kind,filename,mime_type,size,sha256,thread_id,created_at,metadata:JSON.parse(metadata),body};return{rows:[this.saved]};
  }
  if(sql.startsWith('SELECT *'))return{rows:this.saved&&this.saved.owner===params[0]&&this.saved.id===params[1]?[this.saved]:[]};
  if(sql==='ROLLBACK'&&this.failRollback)throw Error('SYN-rollback-failed');
  return{rows:[],rowCount:0};
 }
 async connect(){return{query:this.query.bind(this),release:value=>this.releases.push(value)};}
 async end(){this.endCount++;await Promise.resolve();if(this.endCount>1)throw Error('SYN-double-end');}
}
async function fakeStore(options={}){let pool;const store=await createPostgresDocumentStore({host:'synthetic.invalid',database:'ignored',max:99,connectionTimeoutMillis:0,query_timeout:0},schema,{createPool:config=>(pool=new FakePool(config,options))});return{store,pool};}

test('PG pool has bounded timeouts, handles idle errors and closes once under concurrent callers',async()=>{
 const {store,pool}=await fakeStore();
 try{
  assert.equal(pool.config.database,'doon_agent_studio');assert.equal(pool.config.max,1);
  for(const [key,value]of Object.entries(DOCUMENT_PG_TIMEOUTS))assert.equal(pool.config[key],value);
  assert.doesNotThrow(()=>pool.emit('error',new Error('SYN-idle-connection-terminated')));
  const file=await store.put(owner,synthetic());assert.deepEqual((await store.get(owner,file.id)).bytes,synthetic().bytes);assert.equal(await store.get('SYN-other',file.id),null);
  await Promise.all([store.close(),store.close(),store.close()]);assert.equal(pool.endCount,1);
 }finally{await store.close();}
});

test('PG quota sums persisted JSONB UTF-8 bytes and normalized new metadata bytes',async()=>{
 const {store,pool}=await fakeStore({quotaBytes:DOCUMENT_STORE_LIMITS.bytes-5});
 try{
  await assert.rejects(store.put(owner,synthetic({bytes:Buffer.from('a'),metadata:{text:'中'}})),{status:413});
  const query=pool.calls.find(call=>call.sql.startsWith('SELECT COUNT'));
  assert.match(query.sql,/SUM\(size\+octet_length\(metadata::text\)\)/);assert.match(query.sql,/octet_length\(\$2::jsonb::text\)/);
  assert.equal(query.params[0],owner);assert(!pool.calls.some(call=>call.sql.startsWith('INSERT')));assert(pool.calls.some(call=>call.sql==='ROLLBACK'));assert.deepEqual(pool.releases,[false]);
 }finally{await store.close();}
});

test('failed PG rollback discards the connection and retains the original operation failure',async()=>{
 const {store,pool}=await fakeStore({failInsert:true,failRollback:true});
 try{await assert.rejects(store.put(owner,synthetic()),/SYN-insert-failed/);assert.deepEqual(pool.releases,[true]);}finally{await store.close();}
});

test('PG synthetic database override refuses defaults, remote hosts and production database names',async()=>{
 const base={host:'127.0.0.1',port:55432,user:'synthetic_user',password:'synthetic-only'},database='doon_document_test_'+'a'.repeat(8);let created=0;
 const createPool=config=>{created++;return new FakePool(config);};
 for(const [connection,syntheticDatabase]of [[base,'doon_agent_studio'],[{...base,host:'production.invalid'},database],[{...base,port:undefined},database],[{...base,user:undefined},database],[{...base,password:undefined},database],[{...base,connectionString:'postgres://not-used'},database]])await assert.rejects(createPostgresDocumentStore(connection,schema,{createPool,syntheticDatabase}),{status:500});
 assert.equal(created,0);
 const store=await createPostgresDocumentStore(base,schema,{createPool,syntheticDatabase:database});assert.equal(created,1);await store.close();
});
