import fs from 'node:fs/promises';
import {PostgresStoreVNext} from '@mastra/pg';
import {createPostgresDocumentStore} from './document-store.mjs';

export async function createCloudStorage(env=process.env,{schemaName}={}){
 if(env.DOON_AGENT_DATA_MODE!=='live-readonly'&&env.DOON_AGENT_SYNTHETIC_ONLY!=='1')throw new Error('Cloud Studio data mode must be explicit');
 if(env.DOON_AGENT_DATA_MODE==='live-readonly'&&!/^agent_user_[a-f0-9]{32}$/.test(schemaName||''))throw new Error('Live storage requires a trusted per-user schema');
 const password=(await fs.readFile(env.PG_PASSWORD_FILE||'/run/secrets/pg_studio_password','utf8')).trim();
 const connection={host:env.PGHOST||'postgres',port:5432,user:'doon_studio',password,max:schemaName?1:3,idleTimeoutMillis:10000};
 const storage=new PostgresStoreVNext({id:'doon-agent-studio-cloud'+(schemaName?'-'+schemaName:''),...connection,database:'doon_agent_studio',...(schemaName?{schemaName,storageIsolationKey:schemaName}:{}),observability:{...connection,database:'doon_agent_studio_observability',schemaName:schemaName||'agent_signals'}});
 await storage.init();
 if(schemaName){
  try{storage.documents=await createPostgresDocumentStore(connection,schemaName);}catch(error){await storage.close();throw error;}
  const close=storage.close.bind(storage);let closing;
  storage.close=()=>closing??=(async()=>{try{await storage.documents.close();}finally{await close();}})();
 }
 return storage;
}
