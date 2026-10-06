import {processDate} from './process-date';
import {z} from 'zod';
import {all,broad,canRead,now,strictDate,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {active,automaticDates,colLabels} from './ledger';
import {pmcColumns,pmcValue,type PmcRound} from './pmc';
import {inProductionScope,productionScope,isFinishedOutsource} from './manufacturing';

function access(m:Member){if(!broad(m))throw new AppError('权限受限：仅 PMC 和管理员可以修改排期或登记核对进度。',403);}
function order(s:State,m:Member,id:string){const o=s.records.find(r=>r.kind==='order'&&r.id===id) as Order|undefined;if(!o||!canRead(m,o))throw new AppError('无权访问该订单。',403);if(!active(o))throw new AppError('该明细已归档或取消，请刷新后核对。',409);return o;}
function round(s:State,m:Member,id:string){const r=s.records.find(r=>r.kind==='pmc_round'&&r.id===id) as PmcRound|undefined;if(!r||r.actorId!==m.id)throw new AppError('只能记录本人核对轮次的进度。',403);const latest=all(s,'pmc_round').filter(v=>v.actorId===m.id&&productionScope(v.productionScope)===productionScope(r.productionScope)).at(-1);if(latest?.id!==id)throw new AppError('已开始新一轮核对，请刷新进度。',409);return r;}
export function pmcGet(action:string,s:State,m:Member,req?:Request){
 if(action!=='pmc-data')return null;access(m);
 const scope=productionScope(req?new URL(req.url).searchParams.get('scope'):undefined);
 const latest=new Map<string,Entity>();for(const r of all(s,'pmc_round').filter(r=>productionScope(r.productionScope)===scope))latest.set(r.actorId,r);
 const rounds=[...latest.values()],ids=new Set(rounds.map(r=>r.id));
 return json({rounds,reviews:all(s,'pmc_review').filter(r=>ids.has(r.roundId))});
}
export async function pmcPost(action:string,req:Request,s:State,m:Member){
 if(!['pmc-save','pmc-round','pmc-review'].includes(action))return null;access(m);
 try{
 if(action==='pmc-save'){
  const {changes}=z.object({changes:z.array(z.object({id:z.string(),version:z.number().int().positive(),col:z.enum(pmcColumns),value:z.string().max(3000)})).min(1).max(100)}).parse(await req.json());
  const updates=new Map<string,Order>(),originals=new Map<string,Order>(),seen=new Set<string>();
  for(const change of changes){
   const key=change.id+':'+change.col;if(seen.has(key))throw new AppError('同一单元格不能在一批中重复提交。');seen.add(key);
   const o=order(s,m,change.id);originals.set(o.id,o);if(isFinishedOutsource(o)&&!['U','AB'].includes(change.col))throw new AppError('成品外发订单只在此表维护排期和状态备注，内部工序不报工。',403);if(!o.ledger&&!['U','AB'].includes(change.col))throw new AppError('此明细没有原表工序字段。');
   let value=change.value.trim();if(change.col!=='AB'&&value&&value!=='-')try{value=processDate(value,`${change.col} · ${colLabels[change.col]}`);}catch(e){throw new AppError((e as Error).message);}
   const base=o.version===change.version?o:all(s,'audit').filter(r=>r.lineId===o.id).flatMap(r=>[r.before,r.after]).find(r=>r?.kind==='order'&&r.version===change.version);
   if(!base)throw new AppError('原版本已失效，请刷新并重新核对；本批未保存。',409);
   if(pmcValue(o,change.col)!==pmcValue(base,change.col)&&pmcValue(o,change.col)!==value)throw new AppError(`原表第 ${o.ledger?.sourceRow||'—'} 行 ${o.orderNo} / ${o.drawing} / ${o.color} 的「${colLabels[change.col]}」已由其他同事修改。本批未保存，请比较最新值后再提交。`,409);
   if(pmcValue(o,change.col)===value)continue;
   let next=updates.get(o.id)||{...o,extra:{...o.extra},version:o.version+1,updatedAt:now(),updatedBy:m.name};
   if(next.ledger){const columns={...next.ledger.columns,U:pmcValue(next,'U'),AB:pmcValue(next,'AB'),[change.col]:value};if(!isFinishedOutsource(next))Object.assign(columns,automaticDates(columns));next={...next,ledger:{...next.ledger,columns},extra:{...next.extra,[`${change.col} · ${colLabels[change.col]}`]:value}};}
   if(change.col==='U')next.plannedDate=value==='-'?'':value;if(change.col==='AB')next.notes=value;
   if(next.ledger){next.extra['U · '+colLabels.U]=pmcValue(next,'U');next.extra['AB · '+colLabels.AB]=next.notes;}
   updates.set(o.id,next);
  }
  const rows=[...updates.values()];if(rows.length)await commit(s.revision,rows.flatMap(o=>[o,audit(m,o,originals.get(o.id),'PMC总表单元格修改',isFinishedOutsource(o)?'成品外发跟进总表':'PMC排期总表')]));
  return json({ok:true,count:rows.length,orders:rows,unchanged:!rows.length});
 }
 if(action==='pmc-round'){
  const input=z.object({token:z.string().uuid(),lineIds:z.array(z.string()).min(1).max(5000),scope:z.string().trim().min(1).max(200),productionScope:z.enum(['internal','external']).default('internal')}).parse(await req.json()),id='pmc_round_'+input.token;
  const prior=s.records.find(r=>r.id===id);if(prior){if(prior.actorId!==m.id||productionScope(prior.productionScope)!==input.productionScope)throw new AppError('核对轮次不可复用。',403);return json({ok:true,round:prior});}
  if(new Set(input.lineIds).size!==input.lineIds.length)throw new AppError('核对范围包含重复明细。');for(const id of input.lineIds)if(!inProductionScope(order(s,m,id),input.productionScope))throw new AppError('所选明细不属于此总表，请刷新后核对。',409);
  const item:PmcRound={id,kind:'pmc_round',actorId:m.id,actor:m.name,lineIds:input.lineIds,scope:input.scope,productionScope:input.productionScope,createdAt:now(),lastLineId:''};
  await commit(s.revision,[item,audit(m,item,null,'开始PMC核对轮次')]);return json({ok:true,round:item});
 }
 const p=z.object({roundId:z.string(),lineId:z.string(),version:z.number().int().positive(),status:z.enum(['done','pending']),note:z.string().trim().max(1000).default('')}).parse(await req.json());
 const r=round(s,m,p.roundId),o=order(s,m,p.lineId);if(!inProductionScope(o,productionScope(r.productionScope)))throw new AppError('该明细已转入其他总表，请到对应总表核对。',409);if(!r.lineIds.includes(o.id))throw new AppError('该明细未纳入本轮核对范围。');if(o.version!==p.version)throw new AppError('该行刚被修改，请核对最新内容后再标记。',409);if(p.status==='pending'&&!p.note)throw new AppError('请填写待处理原因，方便继续跟进。');
 const id=`${r.id}:${o.id}`,before=s.records.find(v=>v.id===id),item={id,kind:'pmc_review',roundId:r.id,lineId:o.id,orderVersion:o.version,status:p.status,note:p.note,actorId:m.id,actor:m.name,updatedAt:now()};
 await commit(s.revision,[item,{...r,lastLineId:o.id,updatedAt:now()},audit(m,item,before||null,'登记PMC核对进度')]);return json({ok:true,review:item});
 }catch(e){if(e instanceof z.ZodError)throw new AppError('提交内容不完整或超出限制，请核对后重试。');if(e instanceof AppError)throw e;if(e instanceof Error&&e.message.startsWith('日期'))throw new AppError(e.message);throw e;}
}
