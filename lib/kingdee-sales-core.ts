import {z} from 'zod';
import {all,clean,personnelTypeOf,strictDate,type CustomerAccount,type Member,type State} from './domain';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {KINGDEE_SALES_CATEGORIES,type KingdeeSalesInputs,type KingdeeSalesValidation} from './kingdee-sales-types';
import type {SalesOrderSourceRecord} from './sales-order-sources';

const text=(max=300)=>z.string().trim().max(max);
export const kingdeeSalesInputSchema=z.object({billDate:text(10),customerNumber:text(100),employeeName:text(200),currencyName:text(100),exchangeRate:text(40),businessType:text(30),taxMode:z.enum(['','exclusive','inclusive']),customerPO:text(1000),remark:text(2000),lines:z.array(z.object({sourceLineId:text(160).min(1),categoryCode:text(30),drawing:text(100),customerModel:text(100),finishCode:text(200),color:text(100),quantity:text(40),unitName:text(80),unitPrice:text(40),taxRate:text(40),isFree:z.boolean(),deliveryDate:text(10),remark:text(1000)}).strict()).min(1).max(1000)}).strict();
export function salesCustomer(s:State,customer:string){
 const key=clean(customer).toLowerCase(),accounts=all(s,'customer_account') as CustomerAccount[];
 const direct=accounts.filter(a=>[a.customer,a.customerCode].some(v=>clean(v).toLowerCase()===key));
 if(direct.length>1)return undefined;
 const matches=accounts.filter(a=>serviceOrderCustomerKeys(s,a).some(v=>clean(v).toLowerCase()===key));
 return matches.length===1?matches[0]:undefined;
}
export function salesPermissions(s:State,m:Member,customer:string){
 const internal=m.active&&personnelTypeOf(m)==='internal',account=salesCustomer(s,customer);
 const readable=internal&&(m.role==='admin'||!!account&&assignedServiceCustomer(s,m,account));
 const policy=customerQuoteAccessPolicy(s),aliases=policy?.aliasesByMember[m.id]||[];
 const service=!!account&&matchesCustomerResponsibility(account,m,'service',aliases);
 return {read:!!readable,prepare:!!readable&&['admin','sales','clerk','pmc'].includes(m.role),confirm:!!readable&&(m.role==='admin'||['clerk','pmc'].includes(m.role)&&service)};
}
export function sourceInputs(s:State,record:SalesOrderSourceRecord):KingdeeSalesInputs{
 const account=salesCustomer(s,record.customer);
 const original=(line:SalesOrderSourceRecord['source']['lines'][number],label:string)=>{const matches=line.rawFields.filter(v=>v.label===label&&!v.formula);return matches.length===1?matches[0].value?.trim()||'':'';};
 const head=(label:string)=>{const values=[...new Set(record.source.lines.map(line=>original(line,label)))];return values.length===1?values[0]:'';},priceBasis=head('计价方式');
 return {billDate:/^\d{4}-\d{2}-\d{2}$/.test(head('单据日期'))?head('单据日期'):'',customerNumber:account?.customerCode||'',employeeName:head('业务员名称')||account?.salesName||'',currencyName:head('币别名称'),exchangeRate:head('汇率'),businessType:head('业务类型'),taxMode:priceBasis==='不含税'?'exclusive':priceBasis==='含税'?'inclusive':'',customerPO:record.source.customerPO,remark:'',lines:record.source.lines.map(line=>({sourceLineId:line.id,categoryCode:original(line,'成品类别码'),drawing:line.drawing,customerModel:line.model,finishCode:original(line,'板料编码或电镀颜色'),color:line.color,quantity:String(line.quantity),unitName:line.unit,unitPrice:line.unitPrice,taxRate:original(line,'税率（%）'),isFree:original(line,'是否赠品')==='是',deliveryDate:/^\d{4}-\d{2}-\d{2}$/.test(line.deliveryText)?line.deliveryText:'',remark:original(line,'备注')}))};
}
export function finishedSalesCode(input:KingdeeSalesInputs,line:KingdeeSalesInputs['lines'][number]){
 const parts=[line.categoryCode,input.customerNumber,line.drawing,line.customerModel,line.finishCode,line.color];
 return parts.every(Boolean)?parts.join('-'):'';
}
const scale=BigInt('1000000');
function decimal(value:string,max=BigInt('1000000000000')){
 if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.'),result=BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0'));
 return result<=max*scale?result:null;
}
const rounded=(numerator:bigint,denominator:bigint)=>(numerator+denominator/BigInt('2'))/denominator;
function format(value:bigint,digits=2){const divisor=BigInt('10')**BigInt(digits);return `${value/divisor}.${String(value%divisor).padStart(digits,'0')}`;}
export function salesLineAmounts(line:KingdeeSalesInputs['lines'][number],taxMode:KingdeeSalesInputs['taxMode']){
 const qty=decimal(line.quantity),price=decimal(line.unitPrice),rate=decimal(line.taxRate,BigInt('100'));
 if(qty===null||price===null||rate===null||!taxMode)throw new Error('金额计算前须校验数量、价格、税率及计价方式。');
 const amount=rounded(qty*price*BigInt('100'),scale*scale),net=taxMode==='inclusive'?rounded(amount*BigInt('100')*scale,BigInt('100')*scale+rate):amount,tax=taxMode==='inclusive'?amount-net:rounded(net*rate,BigInt('100')*scale);
 return {amount:format(net),tax_amount:format(tax),all_amount:format(net+tax)};
}
export function validateSalesInputs(source:SalesOrderSourceRecord,input:KingdeeSalesInputs):KingdeeSalesValidation{
 const issues:KingdeeSalesValidation['issues']=[],warnings:string[]=[],codes:KingdeeSalesValidation['codes']=[];
 const issue=(field:string,message:string,sourceLineId?:string)=>issues.push({field,message,...(sourceLineId?{sourceLineId}:{})});
 const required=(field:keyof Omit<KingdeeSalesInputs,'lines'>,label:string)=>{if(!input[field])issue(field,`${label}待填写`);};
 for(const [field,label] of [['billDate','单据日期'],['customerNumber','客户编码'],['employeeName','金蝶业务员名称'],['currencyName','金蝶币别名称'],['exchangeRate','汇率'],['businessType','业务类型'],['customerPO','客户订单号']] as const)required(field,label);
 if(!input.taxMode)issue('taxMode','请选择并核对单价为含税还是不含税');
 const date=(value:string,field:string,id?:string)=>{try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||strictDate(value)!==value)throw new Error();}catch{issue(field,'须填写有效的 YYYY-MM-DD 日期',id);}};
 date(input.billDate,'billDate');
 if(!decimal(input.exchangeRate)||decimal(input.exchangeRate)!>BigInt('1000000')*scale)issue('exchangeRate','汇率须为大于 0 且不超过 1,000,000 的数值，最多 6 位小数');
 if(input.businessType&&!['现销','赊销'].includes(input.businessType))issue('businessType','成品销售订单仅支持现销或赊销，其他业务类型须另行核对');
 if(!/^[A-Za-z0-9]+$/.test(input.customerNumber))issue('customerNumber','客户编码须是明确的字母数字代码');
 const sourceIds=new Set(source.source.lines.map(l=>l.id)),seen=new Set<string>(),categories=new Set<string>();
 if(input.lines.length!==source.source.lines.length)issue('lines','草稿必须包含销售原单的全部明细，不能遗漏或增行');
 let quantityTotal=BigInt('0'),netTotal=BigInt('0'),taxTotal=BigInt('0'),grossTotal=BigInt('0');
 for(const line of input.lines){
  const id=line.sourceLineId;if(seen.has(id)||!sourceIds.has(id))issue('sourceLineId','来源明细重复或不属于本原单',id);seen.add(id);
  if(!(KINGDEE_SALES_CATEGORIES as readonly string[]).includes(line.categoryCode))issue('categoryCode','请选择已核定的成品类别码',id);else categories.add(line.categoryCode);
  for(const [key,label] of [['drawing','图纸号'],['customerModel','客款号'],['finishCode','板料编码或电镀颜色'],['color','完整色号'],['unitName','金蝶单位名称']] as const)if(!line[key])issue(key,`${label}待填写`,id);
  for(const key of ['drawing','customerModel','finishCode','color'] as const)if(/[\r\n\t]/.test(line[key]))issue(key,'成品编码字段不能包含换行或制表符',id);
  const code=finishedSalesCode(input,line);codes.push({sourceLineId:id,productCode:code});if(code.length>300)issue('productCode','成品编码超过 300 字符，须核对来源',id);
  const q=decimal(line.quantity,BigInt('1000000000')),price=decimal(line.unitPrice,BigInt('1000000000')),rate=decimal(line.taxRate,BigInt('100'));
  if(q===null||q<=BigInt('0'))issue('quantity','数量必须大于 0，最多 6 位小数',id);else quantityTotal+=q;
  if(price===null||(!line.isFree&&price<=BigInt('0')))issue('unitPrice','非赠品单价必须大于 0，最多 6 位小数',id);
  if(line.isFree&&price!==BigInt('0'))issue('unitPrice','赠品单价必须明确填写为 0',id);
  if(rate===null)issue('taxRate','税率须明确填写 0—100 的百分数，最多 6 位小数',id);
  date(line.deliveryDate,'deliveryDate',id);if(input.billDate&&line.deliveryDate&&line.deliveryDate<input.billDate)issue('deliveryDate','交货日期不能早于单据日期',id);
  if(q!==null&&price!==null&&rate!==null){
   const amount=rounded(q*price*BigInt('100'),scale*scale),net=input.taxMode==='inclusive'?rounded(amount*BigInt('100')*scale,BigInt('100')*scale+rate):amount,tax=input.taxMode==='inclusive'?amount-net:rounded(net*rate,BigInt('100')*scale),gross=net+tax;
   netTotal+=net;taxTotal+=tax;grossTotal+=gross;
  }
  const original=source.source.lines.find(v=>v.id===id);if(original&&(String(original.quantity)!==line.quantity||original.unitPrice!==line.unitPrice||original.unit!==line.unitName))warnings.push(`原单第 ${original.sourceRow} 行数量、价格或单位有草稿调整，客服须逐项核对原值。`);
 }
 if(categories.size>1)issue('categoryCode','编码规则要求不同成品类别分开做销售订单，请先按类别拆分原单资料');
 if(new Set(input.lines.map(line=>line.unitName).filter(Boolean)).size>1)issue('unitName','同一销售订单须采用同一计量单位；不同单位请先拆单，系统不会相加或自动换算');
 if(netTotal>BigInt('99999999999900')||grossTotal>BigInt('99999999999900'))issue('amount','订单金额超过支持上限，须拆单核对');
 return {valid:issues.length===0,issues,warnings,codes,totalQuantity:format(quantityTotal,6),netAmount:format(netTotal),taxAmount:format(taxTotal),grossAmount:format(grossTotal),checkedAt:new Date().toISOString(),remoteVerified:false};
}
