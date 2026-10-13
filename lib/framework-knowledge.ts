import {z} from 'zod';
import {all,type Entity,type Member,type State} from './domain';
import {canUseCustomerQuotes} from './customer-quote-access';
import {visibleFrameworkRules} from './business-framework';
export const frameworkKnowledgeIds=[...Array.from({length:17},(_,i)=>'rule-'+String(i+1).padStart(2,'0')),'source-research','source-reply','source-nda','context-linking','context-review'] as const;
export const frameworkKnowledgeSchema=z.object({id:z.string().min(1).max(160),kind:z.literal('framework_knowledge_document'),ruleId:z.string().refine(x=>frameworkKnowledgeIds.includes(x)),version:z.number().int().positive(),title:z.string().min(1).max(300),body:z.string().min(1).max(500000),sourceName:z.string().min(1).max(240).refine(x=>!/[\\/]/.test(x),'只保留文件名，不能包含私有路径'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceVersionDate:z.string().max(30),importedAt:z.string().min(1).max(40),importedById:z.string().min(1).max(160),requiresQuoteAccess:z.boolean(),active:z.boolean()}).strict();
export type FrameworkKnowledgeDocument=z.infer<typeof frameworkKnowledgeSchema>;
export function canReadFrameworkKnowledge(s:State,m:Member,raw:Entity){
 const parsed=frameworkKnowledgeSchema.safeParse(raw);if(!parsed.success||!m.active||m.role==='supplier')return false;
 const doc=parsed.data;if((doc.requiresQuoteAccess||['source-research','source-reply','rule-03'].includes(doc.ruleId))&&!canUseCustomerQuotes(s,m))return false;
 if(m.role==='admin')return true;
 if(doc.ruleId.startsWith('rule-'))return visibleFrameworkRules(m).some(r=>r.id===doc.ruleId);
 return ['sales','clerk','pmc'].includes(m.role);
}
export function frameworkKnowledgeMetadata(s:State,m:Member){
 return all(s,'framework_knowledge_document').filter(r=>canReadFrameworkKnowledge(s,m,r)).map(({body:_,...meta})=>meta).sort((a,b)=>String(a.ruleId).localeCompare(String(b.ruleId))||b.version-a.version);
}
