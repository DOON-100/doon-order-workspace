import {type Entity,type State,newId,now} from './domain';
import {AppError,database,invalidateSnapshotCache} from './store';
import {sha} from './workbooks';
import {apiRecordId,apiRecords,type KingdeeApiRecord} from './kingdee-sync-records';
import type {KingdeeConfig} from './kingdee-client';
import type {KingdeeQueryRow} from './kingdee-readonly-types';

export function validPendingRow(row:KingdeeQueryRow){
 return !row.uncertain&&['未入库','部分入库'].includes(row.values[11])&&[0,2,5,8,9,14,15].every(i=>!!row.values[i]?.trim())&&/^\d+(?:\.\d+)?$/.test(row.values[9])&&Number.isFinite(Number(row.values[9]));
}
export async function kingdeeCurrentVersion(s:State,c:KingdeeConfig){
 return sha(JSON.stringify(s.records.filter(r=>['kingdee_pending_api_row','kingdee_pending_sync_state'].includes(r.kind)&&r.accountId===c.accountId).sort((a,b)=>a.id.localeCompare(b.id))));
}
/** Mutable source cache only. Purchase ledgers, attachments and business follow-up are not targets. */
export async function planKingdeeCurrent(s:State,c:KingdeeConfig,rows:KingdeeQueryRow[],options:{full:boolean;sourceAsOf:string;actorId:string;batchId:string}){
 const createdAt=now(),byId=new Map(s.records.map(r=>[r.id,r])),upserts:Entity[]=[],remove:Entity[]=[],seen=new Set<string>();
 const owned=apiRecords(s).filter(r=>r.accountId===c.accountId);
 for(const old of owned){
  if(old.instanceId!==c.instanceId||old.clientId!==c.clientId||old.id!==await apiRecordId(c.accountId,old.row)||old.sourceHash!==await sha(JSON.stringify(old.row)))throw new AppError('金蝶当前来源身份或校验异常，本次未同步。',409);
 }
 let inserted=0,updated=0,unchanged=0,held=0;
 for(const row of rows){
  const id=await apiRecordId(c.accountId,row);if(seen.has(id))throw new AppError('金蝶商品行标识重复，本次未同步。',409);seen.add(id);
  if(!validPendingRow(row)){if(options.full)throw new AppError('金蝶明细状态或必要字段不完整，全量同步未执行，当前表保持原样。',409);held++;continue;}
  const old=byId.get(id) as KingdeeApiRecord|undefined,sourceHash=await sha(JSON.stringify(row));
  if(old&&(old.kind!=='kingdee_pending_api_row'||old.accountId!==c.accountId))throw new AppError('金蝶来源标识冲突。',409);
  if(old?.sourceHash===sourceHash){unchanged++;continue;}
  const record:KingdeeApiRecord={id,kind:'kingdee_pending_api_row',accountId:c.accountId,clientId:c.clientId,instanceId:c.instanceId,row,sourceHash,createdAt:old?.createdAt||createdAt,updatedAt:createdAt,actorId:options.actorId,batchId:options.batchId};
  upserts.push(record);if(old)updated++;else inserted++;
 }
 if(options.full){
  remove.push(...owned.filter(r=>!seen.has(r.id)));
  const ownedIds=new Set(owned.map(r=>r.id));
  // Retire the former per-row change copies as this cache now keeps current values only.
  remove.push(...s.records.filter(r=>r.kind==='kingdee_pending_schedule_issue'&&ownedIds.has(r.recordId)));
 }
 const id='kingdee_pending_sync_state_'+await sha(c.accountId),previous=byId.get(id);
 if(previous&&(previous.kind!=='kingdee_pending_sync_state'||previous.accountId!==c.accountId))throw new AppError('金蝶同步状态标识冲突。',409);
 const marker:Entity={id,kind:'kingdee_pending_sync_state',accountId:c.accountId,clientId:c.clientId,instanceId:c.instanceId,createdAt,sourceAsOf:options.sourceAsOf,mode:options.full?'full':'latest30',fullSyncedAt:options.full?createdAt:previous?.fullSyncedAt||'',committedRevision:s.revision+1};
 const removed=remove.filter(r=>r.kind==='kingdee_pending_api_row').length;
 return {upserts,remove,marker,result:{inserted,updated,removed,unchanged,held}};
}

/** Revision and optional scheduler fence cover replacement, deletion, receipt and metadata together. */
export async function commitKingdeeCurrent(s:State,plan:Awaited<ReturnType<typeof planKingdeeCurrent>>,extra:Entity[],lease?:{workerId:string;fence:number}){
 const db=database(),guard=newId('txn'),writes=[...plan.upserts,plan.marker,...extra];
 const leaseSql=lease?" AND EXISTS(SELECT 1 FROM kingdee_pending_schedule_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>(CAST(strftime('%s','now') AS INTEGER)*1000+1000))":'';
 const statements=[db.prepare("INSERT INTO transaction_guards(id,valid) VALUES(?,CASE WHEN (SELECT revision FROM workspace_revision WHERE id='main')=?"+leaseSql+' THEN 1 ELSE 0 END)').bind(guard,s.revision,...(lease?[lease.workerId,lease.fence]:[])),
  ...plan.remove.map(r=>db.prepare('DELETE FROM records WHERE id=? AND kind=?').bind(r.id,r.kind)),
  ...writes.map(r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').bind(r.id,r.kind,JSON.stringify(r))),
  // Verify persisted current rows inside the same transaction, before a concurrent sync can change them.
  ...writes.map(r=>db.prepare('UPDATE transaction_guards SET valid=CASE WHEN EXISTS(SELECT 1 FROM records WHERE id=? AND kind=? AND data=?) THEN 1 ELSE 0 END WHERE id=?').bind(r.id,r.kind,JSON.stringify(r),guard)),
  ...plan.remove.map(r=>db.prepare('UPDATE transaction_guards SET valid=CASE WHEN NOT EXISTS(SELECT 1 FROM records WHERE id=?) THEN 1 ELSE 0 END WHERE id=?').bind(r.id,guard)),
  db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'"),db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard)];
 try{await db.batch(statements);}catch(e){if(String(e).includes('revision_must_match'))throw new AppError('数据或定时租约已变化，本次未同步，请重新读取。',409);throw e;}
 invalidateSnapshotCache();
 // A later successful sync can replace these rows. Replay uses the durable batch result, not old row hashes.
}
