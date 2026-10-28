import {all,type Entity,type Member,type State} from './domain';
import {AppError,json} from './store';
import {memberNotificationMailbox} from './member-notification-mailboxes';
export const communicationCliContract='communication-cli-version-hash-token-v1';
const keys=['id','kind','version','channel','label','address','ownerId','active','updatedAt','updatedBy','sendEnabled','continuityMemberId','reason'];
const account=(row:Entity)=>({...Object.fromEntries(keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])),grants:Object.fromEntries(Object.entries(row.grants||{}).map(([id,g]:[string,any])=>[id,{view:g.view===true,draft:g.draft===true,send:g.send===true}]))});
export async function communicationCliGet(action:string,req:Request,s:State,m:Member){
 if(!['communication-cli-contract','communication-cli-accounts','communication-cli-account-history','communication-cli-mailbox-history'].includes(action))return null;
 if(!m.active||m.role==='supplier')throw new AppError('没有内部通讯资料访问权限。',403);
 if(action==='communication-cli-contract')return json({contract:communicationCliContract,manualOnly:true,canSend:false,knowledgeMaintenance:false,mailboxToken:true});
 if(!['admin','programmer'].includes(m.role)||action==='communication-cli-mailbox-history'&&m.role!=='admin')throw new AppError('没有此配置资料的读取权限。',403);
 if(action==='communication-cli-accounts')return json({items:all(s,'framework_channel_account').map(account),members:all(s,'member').filter(x=>x.active&&x.role!=='supplier').map(x=>({id:x.id,name:x.name})),manualOnly:true,canSend:false});
 const id=new URL(req.url).searchParams.get('id')||'';
 if(action==='communication-cli-mailbox-history'){
  const row=memberNotificationMailbox(s,id);if(!row)throw new AppError('通知邮箱不存在或记录重复。',409);
  const dto=(r:Entity|null)=>r?{id:r.id,memberId:r.memberId,email:r.email,version:r.version,confirmed:r.confirmed,updatedAt:r.updatedAt,updatedBy:r.updatedBy}:null;
  return json({item:dto(row),history:all(s,'audit').filter(x=>x.targetId===row.id&&x.after?.memberId===id).map(x=>({id:x.id,action:x.action,actor:x.actor,createdAt:x.createdAt,before:dto(x.before),after:dto(x.after)}))});
 }
 const row=all(s,'framework_channel_account').find(x=>x.id===id);if(!row)throw new AppError('渠道账号不存在。',404);
 return json({item:account(row),history:all(s,'framework_history').filter(x=>x.targetId===id&&x.snapshot?.kind==='framework_channel_account').map(x=>({id:x.id,version:x.version,actor:x.actor,createdAt:x.createdAt,snapshot:account(x.snapshot)}))});
}
