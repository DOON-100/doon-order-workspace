// Shared SQL descriptors: the event and its business changes commit together.
export const workflowOutboxSchema=`CREATE TABLE IF NOT EXISTS workflow_event_base(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_event_outbox(id TEXT PRIMARY KEY,revision INTEGER UNIQUE NOT NULL,created_at TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL);`;
/** @param {any[]} records @param {number} revision @param {string} id @param {string} at */
export function workflowOutboxStatements(records,revision,id,at){
 const ids=[...new Set(records.map(r=>r.id))];
 return[
  {sql:'INSERT OR IGNORE INTO workflow_event_base SELECT 1,?,COALESCE(json_group_array(json(data)),\'[]\') FROM records',args:[revision]},
  {sql:`INSERT INTO workflow_event_outbox SELECT ?,?,?,COALESCE(json_group_array(json(data)),'[]'),? FROM records WHERE id IN (${ids.map(()=>'?').join(',')||'NULL'})`,args:[id,revision+1,at,JSON.stringify(records),...ids]},
 ];
}
