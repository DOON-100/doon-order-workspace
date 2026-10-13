import type {Entity} from './domain';
import type {FrameworkDepartmentData} from './business-framework';
export type FrameworkFinancialAnswer={piId:string;piNumber:string;piVersion:number;customerId:string;orderId:string;orderLineIds:string[];receivableId:string;currency:string;amountCents:number|null;receivedCents:number|null;balanceCents:number|null;requiredDepositCents:number|null;depositMet:boolean;dueDate:string;overdue:boolean;problems:string[]};
const finiteCents=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
function money(value:unknown){if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))return null;const [whole,fraction='']=value.split('.');const cents=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));return cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents):null;}
function total(lines:Entity[]){if(!lines.length)return null;let sum=BigInt(0);for(const l of lines){const price=money(l.unitPrice);if(price===null||!Number.isSafeInteger(l.quantity)||l.quantity<=0)return null;sum+=BigInt(price)*BigInt(l.quantity);}return sum<=BigInt(Number.MAX_SAFE_INTEGER)?Number(sum):null;}
/** Only explicit, current PI -> production -> receivable identities. Project money, text evidence and matching numbers are never payment evidence. */
export function buildFrameworkFinancialQuery(data:FrameworkDepartmentData|undefined,today:string):FrameworkFinancialAnswer[]{
 const items=data?.items||[],receivables=(data?.queues?.service||[]).filter(r=>r.type==='receivable');
 return items.filter(p=>p.kind==='handoff_business_document'&&p.type==='pi').map(pi=>{
  const problems:string[]=[],production=items.filter(p=>p.type==='production_order'&&p.customerId===pi.customerId&&p.orderId===pi.orderId&&(p.sourceRefs||[]).some((ref:Entity)=>ref.id===pi.id));
  const ids=[...new Set(production.map(p=>p.fields?.receivableId).filter(Boolean))] as string[],receivable=ids.length===1?receivables.find(r=>r.id===ids[0]):undefined;
  if(pi.status!=='checked'||pi.sourceChanged)problems.push('PI尚未核对或原依据已变化');
  if(!production.length)problems.push('未通过生产单明确关联原应收');
  if(production.some(p=>p.status==='draft'||p.sourceChanged||(p.sourceRefs||[]).some((ref:Entity)=>ref.id===pi.id&&ref.version!==pi.version)))problems.push('生产单或引用PI版本待重核');
  if(ids.length!==1||production.some(p=>!p.fields?.receivableId))problems.push('应收绑定缺失或对应多条不同应收');
  const amount=total(pi.lines||[]),currency=String(pi.fields?.currency||'');
  if(amount===null||amount<=0||!currency)problems.push('PI金额或币种缺失，或当前无价格读取权限');
  if(!receivable||receivable.status==='cancelled'||receivable.customerId!==pi.customerId||receivable.orderId!==pi.orderId)problems.push('原应收不存在、不可见、取消或归属不一致');
  if(receivable&&(receivable.details?.currency!==currency||receivable.details?.amountCents!==amount))problems.push('PI与原应收的币种或整单金额不一致');
  const net=receivable?.receivedCents,balance=receivable?.balanceCents;
  if(receivable&&(!finiteCents(net)||typeof balance!=='number'||!Number.isSafeInteger(balance)||balance!==Number(receivable.details?.amountCents)-net))problems.push('正式净收款来源无效，须财务核实');
  const piDue=String(pi.fields?.paymentDueDate||''),receiptDue=String(receivable?.dueDate||''),dueDate=piDue||receiptDue;
  if(piDue&&receiptDue&&piDue!==receiptDue)problems.push('PI与应收到期日不一致');
  const percent=money(pi.fields?.depositPercent),required=amount!==null&&percent!==null&&percent>0&&percent<=10000?Number((BigInt(amount)*BigInt(percent)+BigInt(9999))/BigInt(10000)):null;
  const valid=!problems.length;
  return {piId:pi.id,piNumber:pi.number,piVersion:pi.version,customerId:pi.customerId,orderId:pi.orderId||'',orderLineIds:[...new Set((pi.lines||[]).map((l:Entity)=>l.orderLineId).filter(Boolean))] as string[],receivableId:receivable?.id||'',currency,amountCents:valid?amount:null,receivedCents:valid?net:null,balanceCents:valid?balance:null,requiredDepositCents:valid?required:null,depositMet:valid&&required!==null&&net>=required,dueDate,overdue:valid&&day(dueDate)&&dueDate<today&&balance>0,problems:[...problems,...(!day(dueDate)?['付款到期日待核实']:[]),...(required===null?['PI约定定金比例待核实']:[])]};
 });
}
export function frameworkQueryMatch(query:string,values:unknown[]){const normalized=query.trim().toLocaleLowerCase();if(!normalized)return false;return values.some(v=>{const text=String(v||'').trim().toLocaleLowerCase();return !!text&&(text.includes(normalized)||text.length>=2&&normalized.includes(text));});}
export function frameworkFinancialTotals(rows:FrameworkFinancialAnswer[],mode:'deposit'|'overdue'){const result:Record<string,number>={};const seen=new Set<string>();for(const r of rows){if(!r.receivableId||seen.has(r.receivableId))continue;seen.add(r.receivableId);const value=mode==='deposit'?r.receivedCents:r.balanceCents;if(finiteCents(value))result[r.currency]=(result[r.currency]||0)+value;}return result;}
