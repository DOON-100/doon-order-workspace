import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';

// Login email remains on Member. Notification addresses are separate records
// resolved by stable member ID; the legacy IE record uses this same resolver.
export type MemberNotificationMailbox=Entity & {kind:'member_notification_mailbox'|'ie_quote_notification_mailbox';memberId:string;email:string;version:number;confirmed:boolean;updatedAt:string;updatedBy:string};
const mailboxKinds=new Set(['member_notification_mailbox','ie_quote_notification_mailbox']);
export const memberNotificationMailboxRecords=(s:State)=>s.records.filter(r=>mailboxKinds.has(r.kind)) as MemberNotificationMailbox[];
export function memberNotificationMailbox(s:State,memberId:string){const rows=memberNotificationMailboxRecords(s).filter(r=>r.memberId===memberId);return rows.length===1?rows[0]:null;}
export const validMemberNotificationEmail=(email:string)=>/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)&&!/(?:^|[.@])(?:localhost|local|invalid|test|example)$/i.test(email)&&email.length<=254;
function administrator(m:Member){if(!m.active||m.role!=='admin')throw new AppError('仅管理员可以维护成员通知邮箱；不会修改登录账号或权限。',403);}
function publicMailbox(mailbox:MemberNotificationMailbox|null,memberId:string){return {memberId,email:mailbox?.email||'',version:mailbox?.version||0,confirmed:!!mailbox?.confirmed,updatedAt:mailbox?.updatedAt||'',updatedBy:mailbox?.updatedBy||''};}
export function memberNotificationMailboxGet(action:string,s:State,m:Member):Response|null{
 if(action!=='member-notification-mailboxes')return null;administrator(m);
 return json({canConfigure:true,mailboxes:(all(s,'member') as Member[]).filter(v=>v.role!=='supplier').map(v=>({...publicMailbox(memberNotificationMailbox(s,v.id),v.id),name:v.name,active:v.active}))});
}
const mailboxInput=z.object({memberId:z.string().trim().min(1).max(120),email:z.string().trim().max(254),expectedVersion:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export async function memberNotificationMailboxPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['member-notification-mailbox','ie-quote-notification-mailbox'].includes(action))return null;administrator(m);
 const parsed=mailboxInput.safeParse(await req.json());if(!parsed.success)throw new AppError('请明确成员、通知邮箱及当前版本后保存，不能附带账号或权限字段。');
 const input=parsed.data,email=input.email.toLowerCase();
 if(email&&(!z.string().email().safeParse(email).success||!validMemberNotificationEmail(email)))throw new AppError('请填写真实通知邮箱，不能使用 .local / .invalid / localhost 等占位地址。');
 if(!all(s,'member').some(v=>v.id===input.memberId&&v.role!=='supplier'))throw new AppError('只能为已存在的内部成员维护通知邮箱。');
 const records=memberNotificationMailboxRecords(s),same=records.filter(v=>v.memberId===input.memberId);
 if(same.length>1)throw new AppError('通知邮箱记录重复，请核查后处理；不会猜测或覆盖其他记录。',409);
 const before=same[0]||null;if((before?.version||0)!==input.expectedVersion)throw new AppError('通知邮箱已更新，请刷新后核对。',409);
 if(email&&records.some(v=>v.memberId!==input.memberId&&v.email.toLowerCase()===email))throw new AppError('该通知邮箱已绑定其他成员，请核对人员与邮箱对应关系。',409);
 const mailbox:MemberNotificationMailbox={id:before?.id||newId('member_notification_mailbox'),kind:before?.kind||'member_notification_mailbox',memberId:input.memberId,email,version:(before?.version||0)+1,confirmed:!!email,updatedAt:now(),updatedBy:m.name};
 await commit(s.revision,[mailbox,audit(m,mailbox,before,email?'更新成员通知邮箱':'清空成员通知邮箱','成员与权限',mailbox)]);
 return json({ok:true,mailbox:publicMailbox(mailbox,input.memberId)});
}
