import {z} from 'zod';
import {all,allowedFields,broad,businessKey,canRead,now,type Entity,type Member,type Order,type PreviewRow,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {syncFollowColumns} from './ledger-edit';

export async function commitImport(body:unknown,s:State,m:Member){
 const input=z.object({id:z.string(),selected:z.array(z.number().int()).min(1).max(5000),reason:z.string().max(1000).default(''),offset:z.number().int().min(0).optional()}).parse(body);
 const job=s.records.find(r=>r.id===input.id&&r.kind==='import');if(!job||(job.actorId!==m.id&&!broad(m)))throw new AppError('无权提交此导入批次。',403);
 const progress=()=>json({ok:true,reused:true,count:job.applied||0,offset:job.offset||job.applied||0,total:job.selected?.length||0,status:job.status});
 if(job.status==='已提交')return progress();
 if(Date.now()-Date.parse(job.createdAt)>24*3600000)throw new AppError('预览已超过 24 小时，请重新上传核对。已成功合并的记录已保留。');
 const selected=[...new Set(input.selected)].sort((a,b)=>a-b),selectedSet=new Set(selected),allRows=(job.rows as PreviewRow[]).filter(r=>selectedSet.has(r.index));
 if(selected.length!==input.selected.length||allRows.length!==selected.length)throw new AppError('选择包含重复或不存在的行，请重新核对预览。');
 if(allRows.some(r=>!['new','update','conflict'].includes(r.status)))throw new AppError('存在不可提交的行。');
 if(allRows.some(r=>r.status==='conflict')&&!input.reason.trim())throw new AppError('提交冲突行前，请填写核对依据。');
 const offset=job.offset||0;
 if(offset&&(JSON.stringify(job.selected)!==JSON.stringify(selected)||job.reviewReason!==input.reason))throw new AppError('分批合并已开始，不能变更选择或核对依据。请继续原批次，或重新上传剩余内容。',409);
 if(input.offset!==undefined&&input.offset!==offset){if(input.offset<offset)return progress();throw new AppError('批次进度不一致，请从导入记录重新打开。',409);}
 if(offset&&input.offset===undefined)throw new AppError('请继续分批合并，不能重复提交已写入的行。',409);
 const rows=allRows.slice(offset,offset+200),updates:Entity[]=[],importType=job.importType;
 function validate(r:PreviewRow){
  const current=s.records.find(x=>x.id===r.after.id);
  if((current?.version||0)!==r.expectedVersion)throw new AppError(`第 ${r.index} 行在预览后已被修改，请重新预览。已合并 ${offset} 条保留，本批未写入。`,409);
  if(importType==='mes'){if(!broad(m))throw new AppError('此操作需要 PMC 或管理员权限。',403);}
  else {
   if(current?.lifecycle==='archived')throw new AppError('已归档订单不能通过工作表覆盖，请先恢复在制。',403);
   if((!current||businessKey(current as Order)!==businessKey(r.after))&&all(s,'order').some(o=>o.id!==r.after.id&&businessKey(o as Order)===businessKey(r.after)))throw new AppError(`第 ${r.index} 行的订单明细已存在，请重新预览，避免重复建单。`,409);
   if(current){if(!canRead(m,current as Order)||(!broad(m)&&r.changes?.some(k=>!allowedFields(m,current as Order).includes(k))))throw new AppError('你的字段权限已改变，请重新预览。',403);}
   else if(!broad(m)&&!(m.role==='sales'&&m.customers.includes(r.after.customer)))throw new AppError('仅该客户的业务/客服、PMC 或管理员可新建订单。',403);
  }
  return current;
 }
 // Fail early before starting, then validate each remaining batch against fresh state.
 if(!offset)for(const r of allRows)validate(r);
 for(const r of rows){const current=validate(r),raw={...r.after,version:(current?.version||0)+1,updatedAt:now(),updatedBy:m.name,source:job.filename},next=job.importType==='orders'?syncFollowColumns(raw):raw;updates.push(next,audit(m,next,current||null,job.importType==='mes'?'导入包装报工':'合并工作表',`${job.filename} · ${input.reason||'确认预览'}`));}
 const nextOffset=offset+rows.length,status=nextOffset===allRows.length?'已提交':'部分已提交';
 updates.push({...job,status,offset:nextOffset,applied:nextOffset,committedAt:now(),committedBy:m.name,reviewReason:input.reason,selected});
 await commit(s.revision,updates);return json({ok:true,count:nextOffset,offset:nextOffset,total:allRows.length,status});
}
