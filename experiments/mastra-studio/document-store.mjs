import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';

// Studio-owned objects only. Neither adapter reads the platform business database.
export const DOCUMENT_STORE_LIMITS=Object.freeze({files:1000,bytes:500*1024*1024,objectBytes:10*1024*1024});
export const DOCUMENT_PG_TIMEOUTS=Object.freeze({connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:12000,lock_timeout:3000,idle_in_transaction_session_timeout:15000});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validOwner=value=>typeof value==='string'&&/^[\w-]{1,160}$/.test(value);
export const documentId=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function input(owner,value){
 if(!validOwner(owner)||!['input','output'].includes(value.kind))throw fail('文件归属无效。');
 if(typeof value.filename!=='string'||!value.filename.trim()||value.filename.length>180||/[\\/\x00-\x1f\x7f]/.test(value.filename))throw fail('文件名无效。');
 if(typeof value.mimeType!=='string'||!/^[\w.+-]+\/[\w.+-]+$/.test(value.mimeType))throw fail('文件类型无效。');
 const bytes=Buffer.from(value.bytes);
 if(!bytes.length||bytes.length>DOCUMENT_STORE_LIMITS.objectBytes)throw fail('每个文件须大于 0 字节且不超过 10 MiB。',413);
 if(value.threadId!==undefined&&value.threadId!==null&&!validOwner(value.threadId))throw fail('会话标识无效。');
 const metadata=JSON.stringify(value.metadata||{});if(Buffer.byteLength(metadata)>1024*1024)throw fail('文件解析内容过大。',413);
 return{id:randomUUID(),owner,kind:value.kind,filename:value.filename,mimeType:value.mimeType,bytes,sha256:hash(bytes),size:bytes.length,threadId:value.threadId||null,metadata,createdAt:new Date().toISOString()};
}
function decoded(row){
 if(!row)return null;
 const bytes=Buffer.from(row.body);
 if(bytes.length!==Number(row.size)||hash(bytes)!==row.sha256)throw fail('文件完整性核验未通过。',503);
 return{id:row.id,kind:row.kind,filename:row.filename,mimeType:row.mime_type,size:Number(row.size),sha256:row.sha256,threadId:row.thread_id,createdAt:row.created_at,metadata:typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata,bytes};
}
function quota(count,bytes,next){if(Number(count)>=DOCUMENT_STORE_LIMITS.files||Number(bytes)+next>DOCUMENT_STORE_LIMITS.bytes)throw fail('当前账号的文档空间已满，请联系管理员。',413);}
const columns='id,owner,kind,filename,mime_type,size,sha256,thread_id,created_at,metadata,body';
const values=row=>[row.id,row.owner,row.kind,row.filename,row.mimeType,row.size,row.sha256,row.threadId,row.createdAt,row.metadata,row.bytes];

export async function createLocalDocumentStore(dataDir){
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(path.join(dataDir,'studio-documents.sqlite'));let closed=false;
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,thread_id TEXT,created_at TEXT NOT NULL,metadata TEXT NOT NULL,body BLOB NOT NULL); CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner);');
 return{
  async put(owner,value){const row=input(owner,value);db.exec('BEGIN IMMEDIATE');try{const total=db.prepare('SELECT COUNT(*) count,COALESCE(SUM(size+length(CAST(metadata AS BLOB))),0) bytes FROM documents WHERE owner=?').get(owner);quota(total.count,total.bytes,row.size+Buffer.byteLength(row.metadata));db.prepare(`INSERT INTO documents(${columns}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...values(row));db.exec('COMMIT');return decoded(db.prepare('SELECT * FROM documents WHERE owner=? AND id=?').get(owner,row.id));}catch(error){db.exec('ROLLBACK');throw error;}},
  async get(owner,id){if(!validOwner(owner)||!documentId(id))return null;return decoded(db.prepare('SELECT * FROM documents WHERE owner=? AND id=?').get(owner,id));},
  async bind(owner,id,threadId){if(!validOwner(owner)||!documentId(id)||!validOwner(threadId))throw fail('文件会话无效。');const row=db.prepare("UPDATE documents SET thread_id=? WHERE owner=? AND id=? AND kind='input' AND (thread_id IS NULL OR thread_id=?) RETURNING id").get(threadId,owner,id,threadId);if(!row)throw fail('附件不存在或已属于其他对话，请重新选择文件。',404);},
  async close(){if(!closed){closed=true;db.close();}},
 };
}

export async function createPostgresDocumentStore(connection,schemaName,{createPool,syntheticDatabase}={}){
 if(!/^agent_user_[a-f0-9]{32}$/.test(schemaName||''))throw fail('文档存储需要独立账号空间。',500);
 // The normal database remains fixed. Integration tests must explicitly name
 // a dedicated local synthetic database; PG* defaults/URLs cannot select it.
 if(syntheticDatabase!==undefined&&(!/^doon_document_test_[a-f0-9]{8,32}$/.test(syntheticDatabase)||!['localhost','127.0.0.1','::1'].includes(connection.host)||!Number.isInteger(connection.port)||connection.port<1||connection.port>65535||connection.connectionString||typeof connection.user!=='string'||!connection.user||typeof connection.password!=='string'))throw fail('文档集成测试必须显式使用本机独立合成数据库。',500);
 const {Pool}=await import('pg'),pool=(createPool||((config)=>new Pool(config)))({...connection,database:syntheticDatabase||'doon_agent_studio',max:1,...DOCUMENT_PG_TIMEOUTS});let closing;
 // pg already discards failed idle clients and reconnects on next checkout.
 // Handling this event prevents a transient disconnect from crashing Node;
 // never serialize errors here because they may include connection details.
 pool.on('error',()=>{});
 const table=`"${schemaName}"."doon_studio_documents"`;
 try{await pool.query(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,thread_id TEXT,created_at TEXT NOT NULL,metadata JSONB NOT NULL,body BYTEA NOT NULL)`);}catch(error){await pool.end();throw error;}
 return{
  async put(owner,value){const row=input(owner,value),client=await pool.connect();let discard=false;try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[schemaName+':documents:'+owner]);const total=(await client.query(`SELECT COUNT(*) count,COALESCE(SUM(size+octet_length(metadata::text)),0) bytes,octet_length($2::jsonb::text) next_metadata_bytes FROM ${table} WHERE owner=$1`,[owner,row.metadata])).rows[0];quota(total.count,total.bytes,row.size+Number(total.next_metadata_bytes));const saved=await client.query(`INSERT INTO ${table}(${columns}) VALUES (${values(row).map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values(row));await client.query('COMMIT');return decoded(saved.rows[0]);}catch(error){try{await client.query('ROLLBACK');}catch{discard=true;}throw error;}finally{client.release(discard);}},
  async get(owner,id){if(!validOwner(owner)||!documentId(id))return null;return decoded((await pool.query(`SELECT * FROM ${table} WHERE owner=$1 AND id=$2`,[owner,id])).rows[0]);},
  async bind(owner,id,threadId){if(!validOwner(owner)||!documentId(id)||!validOwner(threadId))throw fail('文件会话无效。');const result=await pool.query(`UPDATE ${table} SET thread_id=$1 WHERE owner=$2 AND id=$3 AND kind='input' AND (thread_id IS NULL OR thread_id=$1) RETURNING id`,[threadId,owner,id]);if(!result.rowCount)throw fail('附件不存在或已属于其他对话，请重新选择文件。',404);},
  close(){return closing??=pool.end();},
 };
}
