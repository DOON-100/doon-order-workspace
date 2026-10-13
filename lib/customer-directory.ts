import {z} from 'zod';

export const customerDirectoryGrades=['待核查','AAA','AA','A','B','C'] as const;
export const customerDirectoryBuckets=['待核查','潜力／在谈','现有合作','搁置与公海'] as const;
const directoryDate=z.string().trim().max(10).refine(value=>{
 if(!value)return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 const date=new Date(value+'T00:00:00.000Z');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&value<=today;
},'历史日期应为不晚于今天的有效 YYYY-MM-DD，或留空');

// Optional metadata is added only by an explicit save; old records have no defaults or backfill.
// Contact information uses the private customer workflow profile and exact-ID legacy sources.
export const customerDirectorySchema=z.object({
 country:z.string().trim().max(160).optional(),
 grade:z.enum(customerDirectoryGrades).optional(),
 gradeStatus:z.enum(['待确认','候选','人工设置']).optional(),
 qualityGrade:z.string().trim().max(80).optional(),
 productDifficulty:z.string().trim().max(80).optional(),
 bucket:z.enum(customerDirectoryBuckets).optional(),
 focus:z.boolean().nullable().optional(),
 registeredOn:directoryDate.optional(),
 handoffOn:directoryDate.optional(),
}).strict();

export type CustomerDirectory=z.infer<typeof customerDirectorySchema>;

/** Display an explicit legacy note marker only; this is never a customer join key. */
export function customerDirectorySourceCode(notes?:string){return notes?.match(/\[\d{8}交接核查:([A-Za-z0-9_-]{1,40})\]/)?.[1]||'';}
