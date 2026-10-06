import {type Entity,type Order} from './domain';
import {active,dateValue} from './ledger';
import {inProductionScope,productionScope,type ProductionScope} from './manufacturing';

export const pmcColumns=['U','AB','AC','AD','AE','AF'] as const;
export type PmcColumn=typeof pmcColumns[number];
export type PmcRound=Entity&{kind:'pmc_round';actorId:string;actor:string;lineIds:string[];createdAt:string;lastLineId:string;scope:string;productionScope?:ProductionScope};
export type PmcReview=Entity&{kind:'pmc_review';roundId:string;lineId:string;orderVersion:number;status:'done'|'pending';note:string;actor:string;updatedAt:string};
export function pmcValue(o:Order,col:string){if(col==='U')return o.plannedDate|| (o.ledger?.columns.U==='-'?'-':'');if(col==='AB')return o.notes||'';const value=o.ledger?.columns[col]||'';return value==='-'?'-':dateValue(value)||value;}
// Keep each imported workbook in its original position; edits never affect row order.
export function pmcOrder(orders:Order[]){
 const groups=new Map<string,number>();for(const o of orders){const key=o.ledger?.sourceHash||o.id;if(!groups.has(key))groups.set(key,groups.size);}
 return [...orders].sort((a,b)=>(groups.get(a.ledger?.sourceHash||a.id)!-groups.get(b.ledger?.sourceHash||b.id)!)||((a.ledger?.sourceRow||0)-(b.ledger?.sourceRow||0))||a.id.localeCompare(b.id));
}
export function reviewState(o:Order,round:PmcRound|undefined,review:PmcReview|undefined){
 if(!round)return 'not-started';if(!round.lineIds.includes(o.id))return 'outside';if(!active(o))return 'closed';if(!inProductionScope(o,productionScope(round.productionScope)))return 'moved';if(!review)return 'unreviewed';if(review.orderVersion!==o.version)return 'changed';return review.status;
}
export const reviewLabels:Record<string,string>={'not-started':'未开始',outside:'未纳入本轮',closed:'已退出在制',moved:'已转其他总表',unreviewed:'待核对',changed:'需复核',done:'已核对',pending:'待处理'};
