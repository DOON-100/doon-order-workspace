import {AppError,database} from './store';
import type {State} from './domain';

/** Read only the records this sync needs, not every order, attachment and audit. */
export async function kingdeeSyncState():Promise<State>{
 const db=database();
 for(let retry=0;retry<3;retry++){
  const start=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  const rows=await db.prepare("SELECT data FROM records WHERE kind IN ('member','purchase','kingdee_pending_snapshot','kingdee_pending_api_row','kingdee_sync_receipt') OR id LIKE 'kingdee_api_row_%' OR id LIKE 'kingdee_sync_receipt_%' ORDER BY rowid").all<{data:string}>();
  const end=await db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").first<{revision:number}>();
  if((start?.revision||0)===(end?.revision||0))return {revision:end?.revision||0,records:rows.results.map(row=>JSON.parse(row.data))};
 }
 throw new AppError('其他成员正在更新，请稍后重试。',409);
}
