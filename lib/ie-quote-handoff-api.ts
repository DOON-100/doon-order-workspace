import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {canUseIeQuotes} from './ie-quote-access';
import {publicIeQuote,releasedIeSnapshot} from './ie-quotes';
import {canPushIeToBusiness,canReadIeHandoff,ieHandoffCandidates,publicIeHandoff,validIeHandoffSource,type IeSalesHandoff} from './ie-quote-handoffs';
const id=z.string().trim().min(1).max(120),change=z.object({id,version:z.number().int().positive()}).strict();
function accessible(s:State,m:Member,id:string){const h=all(s,'ie_quote_sales_handoff').find(r=>r.id===id) as IeSalesHandoff|undefined;if(!h||!canReadIeHandoff(s,m,h))throw new AppError('业务下推记录不存在或当前无权查看。',403);return h;}
export function ieHandoffGet(action:string,url:URL,s:State,m:Member):Response|null{
 if(!['ie-quote-handoffs','ie-quote-handoff'].includes(action))return null;
 if(!canUseIeQuotes(s,m))throw new AppError('没有工程报价访问权限。',403);
 if(action==='ie-quote-handoff'){const h=accessible(s,m,url.searchParams.get('id')||''),q=releasedIeSnapshot(s,h.quoteId,h.quoteVersion)!;return json({handoff:publicIeHandoff(s,m,h),quote:publicIeQuote(s,m,q)});}
 const quoteId=url.searchParams.get('quoteId');return json({canUse:true,handoffs:(all(s,'ie_quote_sales_handoff') as IeSalesHandoff[]).filter(h=>(!quoteId||h.quoteId===quoteId)&&canReadIeHandoff(s,m,h)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(h=>publicIeHandoff(s,m,h))});
}
export async function ieHandoffPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-handoff','ie-quote-handoff-accept'].includes(action))return null;
 if(action==='ie-quote-handoff'){
  const parsed=change.extend({recipientMemberIds:z.array(id).min(1).max(100).refine(ids=>new Set(ids).size===ids.length)}).strict().safeParse(await req.json());if(!parsed.success)throw new AppError('请明确已复核的工程版本和至少一位负责该客户的业务人员。');
  const input=parsed.data,q=releasedIeSnapshot(s,input.id,input.version);if(!q||!canPushIeToBusiness(s,m,q))throw new AppError('只有工程填报 / 复核人员可下推该客户最新已复核版本；新发布后须重新选择。',403);
  const candidates=ieHandoffCandidates(s,q);if(input.recipientMemberIds.some(id=>!candidates.some(c=>c.memberId===id)))throw new AppError('收件人员须已负责此客户报价且可读完整成本；请管理员先核对客户责任与原报价权限。',403);
  const recipientMemberIds=[...input.recipientMemberIds].sort(),existing=(all(s,'ie_quote_sales_handoff') as IeSalesHandoff[]).filter(h=>h.quoteId===q.id&&h.quoteVersion===q.version);
  if(existing.length){if(existing.length!==1||JSON.stringify([...existing[0].recipientMemberIds].sort())!==JSON.stringify(recipientMemberIds))throw new AppError('此工程版本已经下推；请查看既有接收记录，不可覆盖原收件范围。',409);return json({ok:true,handoff:publicIeHandoff(s,m,existing[0]),alreadyPresent:true});}
  const h:IeSalesHandoff={id:newId('ie_quote_sales_handoff'),kind:'ie_quote_sales_handoff',version:1,quoteId:q.id,quoteVersion:q.version,customerAccountId:q.customerAccountId,recipientMemberIds,recipientNames:recipientMemberIds.map(id=>candidates.find(c=>c.memberId===id)!.name),createdAt:now(),createdBy:m.name,createdById:m.id,acceptedBy:[],sourceSnapshot:structuredClone(q)};
  await commit(s.revision,[h,audit(m,h,null,'将已复核工程报价下推负责业务','IE 工程报价',h)]);return json({ok:true,handoff:publicIeHandoff(s,m,h),alreadyPresent:false});
 }
 const parsed=change.safeParse(await req.json());if(!parsed.success)throw new AppError('接收操作须指定下推记录及版本。');const input=parsed.data,before=accessible(s,m,input.id),q=releasedIeSnapshot(s,before.quoteId,before.quoteVersion)!;
 if(!before.recipientMemberIds.includes(m.id)||!ieHandoffCandidates(s,q).some(c=>c.memberId===m.id))throw new AppError('只有指定且仍负责该客户报价的业务人员可接收。',403);
 if(!validIeHandoffSource(s,q))throw new AppError('工程已发布更新版本，请接收新的工程依据。',409);
 if(before.acceptedBy.some(a=>a.memberId===m.id))return json({ok:true,handoff:publicIeHandoff(s,m,before),alreadyPresent:true});
 if(input.version!==before.version)throw new AppError('接收记录已更新，请刷新后核对。',409);
 const h:IeSalesHandoff={...before,version:before.version+1,acceptedBy:[...before.acceptedBy,{memberId:m.id,name:m.name,at:now()}]};await commit(s.revision,[h,audit(m,h,before,'业务接收已复核工程报价依据','IE 工程报价',h)]);return json({ok:true,handoff:publicIeHandoff(s,m,h),alreadyPresent:false});
}
