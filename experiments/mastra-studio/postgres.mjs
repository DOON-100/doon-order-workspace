import fs from 'node:fs/promises';
import {PostgresStoreVNext} from '@mastra/pg';

export async function createCloudStorage(env=process.env){
 if(env.DOON_AGENT_SYNTHETIC_ONLY!=='1')throw new Error('Cloud Studio only supports synthetic tools in this phase');
 const password=(await fs.readFile(env.PG_PASSWORD_FILE||'/run/secrets/pg_studio_password','utf8')).trim();
 const connection={host:env.PGHOST||'postgres',port:5432,user:'doon_studio',password,max:3,idleTimeoutMillis:10000};
 const storage=new PostgresStoreVNext({id:'doon-agent-studio-cloud',...connection,database:'doon_agent_studio',observability:{...connection,database:'doon_agent_studio_observability',schemaName:'agent_signals'}});
 await storage.init();return storage;
}
