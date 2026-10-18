import {visiblePurchases,remaining,full} from '../lib/purchases';
import type {Entity,Member,State} from '../lib/domain';

export function readAgentPurchase(records:Entity[],memberId:string,sourceId:string){
 const member=records.find(row=>row.kind==='member'&&row.id===memberId) as Member|undefined;
 if(!member?.active||member.role==='supplier')return null;
 const source=visiblePurchases({records,revision:0} as State,member).find(row=>row.id===sourceId);
 if(!source)return null;
 const fields=['id','version','po','quantity','received','returnPending','balanceKnown','unit','promisedDate','expectedDate','dueDate','nextFollowupDate','sourceAsOf','sourceHash','auditStatus','closeStatus','lifecycle'] as const;
 const result=Object.fromEntries(fields.map(key=>[key,source[key]??null]));
 const valid=[source.quantity,source.received,source.returnPending].every(value=>Number.isFinite(value)&&value>=0)&&source.received<=source.quantity&&source.returnPending<=source.quantity-source.received;
 return {...result,balanceKnown:valid&&source.balanceKnown,validQuantity:valid,remaining:valid?remaining(source):null,full:valid&&full(source),eligible:source.lifecycle!=='archived'&&source.auditStatus==='已审核'&&source.closeStatus==='未关闭'};
}
