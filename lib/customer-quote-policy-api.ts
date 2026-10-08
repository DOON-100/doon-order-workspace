import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {canonicalPriceJson} from './customer-price-archive';
import {AppError,audit,commit,json} from './store';
import {sha} from './workbooks';
const ids=z.array(z.string().min(1).max(240)).max(1000);
export async function customerQuotePolicyPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='customer-quote-access-update')return null;if(m.role!=='admin'||!m.active)throw new AppError('仅系统管理员可配置独立报价身份和客户授权。',403);
 const input=z.object({expectedPolicySha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),memberIds:ids,aliasesByMember:z.record(z.array(z.string().min(1).max(240)).max(30)),administratorMemberIds:ids.optional(),internalMemberIds:ids.optional(),customerMemberIds:z.record(ids).optional()}).strict().parse(await req.json());
 const policies=all(s,'customer_quote_access');if(policies.length>1)throw new AppError('存在重复报价策略，须先核对。',409);const before=policies[0]||null;
 const hash=before?await sha(new TextEncoder().encode(canonicalPriceJson(before)).buffer):null;if(hash!==input.expectedPolicySha256)throw new AppError('报价授权已变化，本次没有覆盖原配置。',409);
 const {expectedPolicySha256,...fields}=input;for(const key of ['administratorMemberIds','internalMemberIds','customerMemberIds'])if(!Object.hasOwn(fields,key))(fields as Record<string,unknown>)[key]=before?.[key]??(key==='customerMemberIds'?{}:[]);const policy={...before,...fields,id:before?.id||newId('customer_quote_access'),kind:'customer_quote_access',updatedAt:now(),updatedById:m.id};
 if(!customerQuoteAccessPolicy({...s,records:[...s.records.filter(r=>r.kind!=='customer_quote_access'),policy]}))throw new AppError('授权配置无效、重复或包含未入名单的成员。');
 for(const id of policy.memberIds){const member=all(s,'member').find(v=>v.id===id);if(!member?.active||!member.userId)throw new AppError('报价成员须为已绑定身份的有效独立账号。');}
 for(const id of Object.keys(policy.customerMemberIds??{}))if(!all(s,'customer_account').some(a=>a.id===id&&a.active))throw new AppError('稳定客户映射包含不存在或停用客户。');
 if(canonicalPriceJson(Object.fromEntries(Object.keys(fields).map(k=>[k,before?.[k]??(k==='aliasesByMember'||k==='customerMemberIds'?{}:[])])))===canonicalPriceJson(fields))return json({ok:true,alreadyPresent:true});
 await commit(s.revision,[policy,audit(m,policy,before,'确认独立报价账号及稳定客户授权')]);return json({ok:true,alreadyPresent:false});
}
