import {all,broad,now,readsAllOrders,strictDate,type Member,type State} from './domain';
import {AppError,bucket,commit,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {requestedExportBusinessTeam} from './business-team-export';
import {sha} from './workbooks';
import {KINGDEE_PENDING_QUANTITY_MEANING,orderedKingdeePendingSnapshots,parseKingdeePending,pendingMetadata,visibleKingdeePending,type KingdeePendingImport,type KingdeePendingRow,type KingdeePendingSnapshot} from './kingdee-pending';

function manage(m:Member){if(!m.active||!broad(m))throw new AppError('仅现有 PMC / 采购和管理员可同步金蝶采购源表。',403);}
function publicJob(job:KingdeePendingImport){return {id:job.id,status:job.status,hash:job.hash,headers:job.headers,metadata:job.metadata,sample:job.sample,...(job.snapshotId?{snapshotId:job.snapshotId}:{})};}
async function readRows(snapshot:KingdeePendingSnapshot|KingdeePendingImport){
 const blob=await bucket().get(snapshot.rowsKey);if(!blob)throw new AppError('金蝶源表快照暂不可用，请重试。',503);
 const text=await new Response(blob.body).text();if(await sha(text)!==snapshot.rowsHash)throw new AppError('金蝶源表明细校验未通过，请保留原文件并联系管理员。',409);
 return JSON.parse(text) as KingdeePendingRow[];
}

export async function kingdeePendingGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['kingdee-pending-data','kingdee-pending-file'].includes(action))return null;
 if(!m.active||m.role==='supplier')throw new AppError('没有采购明细查看权限。',403);
 const teamId=requestedExportBusinessTeam(s,m,req),history=orderedKingdeePendingSnapshots(s),id=new URL(req.url).searchParams.get('id');
 const selected=id?history.find(snapshot=>snapshot.id===id):history[0];
 if(id&&!selected)throw new AppError('采购来源快照不存在。',404);
 if(action==='kingdee-pending-file'){
  if(!selected)throw new AppError('采购来源快照不存在。',404);
  if(teamId||!readsAllOrders(m)&&!broad(m))throw new AppError('原件包含全表，仅全部采购范围的授权人员可下载；分组查看请使用授权明细。',403);
  const source=await bucket().get(selected.fileKey);if(!source)throw new AppError('金蝶原始文件暂不可用。',503);
  return new Response(source.body,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(selected.metadata.filename)}`,'Cache-Control':'no-store','Vary':businessTeamHeader,'X-Content-Type-Options':'nosniff'}});
 }
 if(!selected)return json({snapshot:null,canImport:broad(m),canDownloadOriginal:false,history:[]});
 const visible=visibleKingdeePending(s,m,selected.headers,await readRows(selected),teamId);
 const response=json({snapshot:{id:selected.id,headers:selected.headers,rows:visible.rows,metadata:pendingMetadata(selected.metadata,selected.headers,visible.rows,visible.full)},canImport:broad(m),canDownloadOriginal:visible.full,history:visible.full?history.map(snapshot=>({id:snapshot.id,metadata:snapshot.metadata})):[]});
 response.headers.set('Vary',businessTeamHeader);return response;
}

export async function kingdeePendingPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['kingdee-pending-preview','kingdee-pending-commit'].includes(action))return null;
 manage(m);
 if(action==='kingdee-pending-preview'){
  const form=await req.formData(),file=form.get('file');
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.xlsx'))throw new AppError('请选择不超过 10 MB 的金蝶采购未上货 XLSX 原表。');
  let sourceAsOf:string;
  try{sourceAsOf=strictDate(String(form.get('sourceAsOf')||''));}catch{throw new AppError('请填写有效的金蝶导出截至日期。');}
  if(!sourceAsOf)throw new AppError('请填写金蝶导出截至日期。');
  const bytes=await file.arrayBuffer(),parsed=await parseKingdeePending(bytes);
  const prior=(all(s,'kingdee_pending_import') as KingdeePendingImport[]).find(job=>job.hash===parsed.hash);
  if(prior)return json(publicJob(prior));
  const additionalFilter=String(form.get('sourceFilter')||'').trim();
  if(additionalFilter.length>10000)throw new AppError('筛选说明不能超过 10000 字。');
  const sourceAccount=String(form.get('sourceAccount')||'').trim();if(sourceAccount.length>200)throw new AppError('来源账套不能超过 200 字。');
  const timestamp=now(),filename=file.name.replace(/[\\/\r\n]/g,'_').slice(0,180),id='kingdee_pending_import_'+parsed.hash;
  const metadata={filename,hash:parsed.hash,sourceAsOf,sourceFilter:[parsed.sourceFilter,additionalFilter].filter(Boolean).join('；'),sourceAccount,sourceSheet:parsed.sourceSheet,headerRow:parsed.headerRow,importedAt:timestamp,importedBy:m.name,rowCount:parsed.rowCount,sourceRowCount:parsed.sourceRowCount,orderCount:parsed.orderCount,supplierCount:parsed.supplierCount,quantityMeaning:KINGDEE_PENDING_QUANTITY_MEANING};
  // Content-addressed blobs are identical across retries; no legacy purchase is touched.
  const rowsKey='kingdee_pending_rows_'+parsed.hash,fileKey='kingdee_pending_file_'+parsed.hash,rowsText=JSON.stringify(parsed.rows),rowsHash=await sha(rowsText);
  const job:KingdeePendingImport={id,kind:'kingdee_pending_import',hash:parsed.hash,headers:parsed.headers,metadata,rowsHash,rowsKey,fileKey,sample:parsed.rows.filter(row=>row.rowType==='data').slice(0,5),status:'待确认',actorId:m.id,createdAt:timestamp};
  await bucket().put(rowsKey,rowsText);await bucket().put(fileKey,bytes);await commit(s.revision,[job]);
  return json(publicJob(job));
 }
 const input=await req.json().catch(()=>null) as {id?:unknown}|null;
 if(!input||typeof input.id!=='string'||input.id.length>150)throw new AppError('请选择有效的采购来源预览批次。');
 const job=(all(s,'kingdee_pending_import') as KingdeePendingImport[]).find(row=>row.id===input.id);
 if(!job)throw new AppError('采购来源预览批次不存在。',404);
 if(job.status==='已完成')return json(publicJob(job));
 await readRows(job);
 const source=await bucket().get(job.fileKey);if(!source)throw new AppError('金蝶原始文件暂不可用，未提交快照。',503);
 const sourceBytes=source.body instanceof ArrayBuffer?source.body:source.body instanceof Uint8Array?source.body.buffer.slice(source.body.byteOffset,source.body.byteOffset+source.body.byteLength):await new Response(source.body).arrayBuffer();
 if(await sha(sourceBytes as ArrayBuffer)!==job.hash)throw new AppError('金蝶原始文件校验未通过，未提交快照。',409);
 const timestamp=now(),snapshotId='kingdee_pending_snapshot_'+job.hash,metadata={...job.metadata,importedAt:timestamp};
 const previous=orderedKingdeePendingSnapshots(s).find(snapshot=>snapshot.hash===job.hash);
 if(previous)return json({...publicJob(job),status:'已完成',snapshotId:previous.id,metadata:previous.metadata});
 const snapshot:KingdeePendingSnapshot={id:snapshotId,kind:'kingdee_pending_snapshot',headers:job.headers,metadata,hash:job.hash,rowsHash:job.rowsHash,rowsKey:job.rowsKey,fileKey:job.fileKey,committedRevision:s.revision+1,actorId:m.id,createdAt:timestamp};
 const completed:KingdeePendingImport={...job,status:'已完成',snapshotId,metadata,updatedAt:timestamp};
 await commit(s.revision,[snapshot,completed]);return json(publicJob(completed));
}
