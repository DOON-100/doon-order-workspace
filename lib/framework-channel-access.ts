import {all,type Member,type State,type Entity} from './domain';

export type FrameworkChannelGrant={view:boolean;draft:boolean;send:boolean};
export type FrameworkChannelAccount=Entity&{kind:'framework_channel_account';version:number;channel:'email'|'whatsapp';label:string;address:string;ownerId:string;active:boolean;grants:Record<string,FrameworkChannelGrant>};
export function frameworkAccountAccess(s:State,m:Member,accountId:string,write=false){
 if(!m.active||m.role==='supplier')return false;
 if(write&&!['admin','sales','clerk','pmc'].includes(m.role))return false;
 const a=all(s,'framework_channel_account').find(a=>a.id===accountId) as FrameworkChannelAccount|undefined;
 if(!a||!a.active)return false;
 if(m.role==='admin'||a.ownerId===m.id)return true;
 const grant=a.grants?.[m.id];return !!grant?.view&&(!write||!!grant.draft);
}
/** Account access is an additional intersection with customer/project/order access. */
export function frameworkChannelAccess(s:State,m:Member,communicationId:string,write=false){
 const bindings=all(s,'framework_channel_binding').filter(b=>b.communicationId===communicationId);
 if(!bindings.length)return true; // Existing manually entered communication has no channel account.
 if(bindings.length!==1||!bindings[0].accountId)return false;
 return frameworkAccountAccess(s,m,bindings[0].accountId,write);
}
export function frameworkChannelMatches(s:State,communicationId:string,channel:string){
 const bindings=all(s,'framework_channel_binding').filter(b=>b.communicationId===communicationId);
 if(!bindings.length)return true;
 if(bindings.length!==1)return false;
 return all(s,'framework_channel_account').some(a=>a.id===bindings[0].accountId&&a.channel===channel);
}
