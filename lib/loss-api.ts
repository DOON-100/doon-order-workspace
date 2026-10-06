import {z} from 'zod';
import * as XLSX from 'xlsx';
import {all,canRead,now,strictDate,type State,type Member,type Order} from './domain';
import {AppError,audit,commit,json} from './store';
import {today} from './ledger';
import {applyLedgerPatch} from './ledger-edit';
import {departmentName,processName,lossProcesses,latestLoss,goodQuantity,mayRecordLoss,filterLosses,summarizeLosses,type LossRecord} from './losses';
const quantity=z.number().int().min(0).max(10000000);
export async function lossPost(action:string,req:Request,s:State,m:Member){
 if(action!=='loss-record')return null;
 const p=z.object({lineId:z.string(),version:z.number().int(),process:z.string(),department:z.string(),source:z.enum(['balance','mes']).default('balance'),sourceRef:z.string().trim().max(500).default(''),reportedLoss:quantity.nullable().default(null),input:quantity.nullable(),wip:quantity.nullable(),reportDate:z.string(),reason:z.string().trim().min(3).max(1000),correction:z.boolean().default(false),previousId:z.string().default(''),token:z.string().uuid(),patch:z.record(z.string().max(3000)).default({})}).parse(await req.json());
 const o=all(s,'order').find(o=>o.id===p.lineId) as Order|undefined,def=lossProcesses.find(d=>d.id===p.process);
 if(!o||!mayRecordLoss(m,o,p.department))throw new AppError('权限受限：仅本部门文员、PMC、生产管理人员或管理员可确认损耗。',403);
 if(!def||!def.departments.includes(p.department))throw new AppError('请选择此工序对应的责任部门。');
 const records=all(s,'loss') as LossRecord[],fingerprint=JSON.stringify(p),retry=records.find(r=>r.id==='loss_'+p.token);
 if(retry){if(retry.actorId!==m.id||retry.fingerprint!==fingerprint)throw new AppError('重复提交标识不一致，请刷新后核对。',409);return json({ok:true,item:retry,repeated:true});}
 if(o.version!==p.version)throw new AppError('订单报工已更新，请刷新并重新核对投入、完成和在制数。',409);
 const prior=latestLoss(records,o.id,p.process);
 if((prior?.id||'')!==p.previousId)throw new AppError('同事已登记此工序的损耗，请刷新后核对，避免重复记账。',409);
 if(prior&&prior.department!==p.department)throw new AppError('此工序已由'+departmentName(prior.department)+'记账，请沿用该责任部门，避免跨部门重复。');
 try{p.reportDate=strictDate(p.reportDate);if(!p.reportDate)throw new Error('日期不能为空');}catch{throw new AppError('损耗确认日期：请选择日历，填写完整、有效的年-月-日。');}
 if(p.reportDate>today())throw new AppError('损耗确认日期不能晚于今天。');
 if(prior&&p.reportDate<prior.reportDate)throw new AppError('确认日期不能早于本工序上次记录；历史错误请在当前日期登记冲减更正。');
 const changed=Object.keys(p.patch).length>0,next=changed?applyLedgerPatch(o,m,p.patch):o,good=goodQuantity(next,def);
 if(p.source==='balance'&&(good===null||p.input===null||p.wip===null))throw new AppError('请填写累计投入、合格完成和仍在制数；空白和不适用不能作为零损耗。');
 if(p.source==='mes'&&(p.reportedLoss===null||p.sourceRef.length<3))throw new AppError('请填写 MES 已确认的累计报废损耗及报工/处理凭证；不良数不能直接当作报废。');
 const loss=p.source==='mes'?p.reportedLoss!:p.input!-good!-p.wip!;if(loss<0)throw new AppError('投入数不足：合格完成数与仍在制数之和不能超过累计投入数。');
 const delta=loss-(prior?.loss||0);if(delta<0&&!p.correction)throw new AppError('累计损耗减少，请勾选“冲减更正”并说明核对依据。');
 if(prior&&prior.loss===loss&&prior.input===(p.source==='mes'?null:p.input)&&prior.good===good&&prior.wip===(p.source==='mes'?null:p.wip)&&prior.source===p.source&&prior.sourceRef===p.sourceRef)throw new AppError('本工序数量与上次确认一致，无需重复登记。');
 const item:LossRecord={id:'loss_'+p.token,kind:'loss',lineId:o.id,process:p.process,department:p.department,sequence:(prior?.sequence||0)+1,previousId:prior?.id||'',reportDate:p.reportDate,month:p.reportDate.slice(0,7),input:p.source==='mes'?null:p.input,good,wip:p.source==='mes'?null:p.wip,loss,delta,reason:p.reason,correction:delta<0,source:p.source,sourceRef:p.sourceRef,actor:m.name,actorId:m.id,createdAt:now(),orderVersion:next.version,orderNo:o.orderNo,customer:o.customer,drawing:o.drawing,color:o.color,lens:o.lens,orderQuantity:o.quantity,sourceRow:o.ledger?.sourceRow??null,fingerprint};
 await commit(s.revision,[...(changed?[next,audit(m,next,o,'更新原表工序并确认损耗',p.reason)]:[]),item,audit(m,item,prior||null,delta<0?'冲减部门损耗':'确认部门损耗',p.reason)]);
 return json({ok:true,item});
}
export async function lossGet(action:string,req:Request,s:State,m:Member){
 if(action!=='loss-export')return null;
 const params=new URL(req.url).searchParams,month=params.get('month')||'';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new AppError('请选择有效的报表月份。');
 const orders=all(s,'order') as Order[],ids=new Set(orders.filter(o=>canRead(m,o)).map(o=>o.id));
 const records=filterLosses((all(s,'loss') as LossRecord[]).filter(r=>ids.has(r.lineId)),{month,department:params.get('department')||'',q:params.get('q')||'',customer:params.get('customer')||''});
 const summaries=summarizeLosses(records).filter(d=>!params.get('department')||d.department===params.get('department'));
 const book=XLSX.utils.book_new();
 const summary=XLSX.utils.aoa_to_sheet([['度昂 · 部门损耗月报',month],['口径','按确认日期归月；当月净损耗 = 新增 − 冲减。未登记不等于零损耗。'],['说明','各工序合计为工序数量，不等同于成品短缺；部门订单数量按明细去重，不可跨部门累加。'],['数据截止',now()],[],['责任部门','涉及订单数','涉及明细数','涉及订单数量','新增损耗','冲减损耗','当月净损耗','确认记录数'],...summaries.map(d=>[d.name,d.orders,d.lines,d.orderQuantity,d.added,d.reduced,d.net,d.records])]);
 summary['!cols']=[{wch:24},...Array.from({length:7},()=>({wch:19}))];XLSX.utils.book_append_sheet(book,summary,'部门月度汇总');
 const details=XLSX.utils.aoa_to_sheet([['确认日期','月份','责任部门','工序','订单号','客户','款号','色号','镜片','订单数量快照','累计投入','累计合格完成','仍在制','累计确认损耗','本次损耗增减','类型','核对依据','登记人','登记时间','原表行号','明细编号','记录编号','报工版本','损耗来源','MES 凭证'],...records.map(r=>[r.reportDate,r.month,departmentName(r.department),processName(r.process),r.orderNo,r.customer,r.drawing,r.color,r.lens,r.orderQuantity,r.input,r.good,r.wip,r.loss,r.delta,r.correction?'冲减更正':'确认',r.reason,r.actor,r.createdAt,r.sourceRow,r.lineId,r.id,r.orderVersion,r.source==='mes'?'MES 已确认损耗（人工核对录入）':'部门核对公式',r.sourceRef])]);
 details['!cols']=Array.from({length:25},(_,i)=>({wch:i===16?48:[20,21,24].includes(i)?46:18}));details['!autofilter']={ref:details['!ref']!};XLSX.utils.book_append_sheet(book,details,'损耗确认明细');
 return new Response(XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as BodyInit,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('部门损耗月报_'+month+'.xlsx'),'Cache-Control':'no-store'}});
}
