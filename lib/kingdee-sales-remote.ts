import {AppError} from './store';
import {kingdeeSalesRequest,object,sourceId,sourceText,type KingdeeConfig} from './kingdee-client';
import {finishedSalesCode,salesLineAmounts} from './kingdee-sales-core';
import type {KingdeeSalesDraft} from './kingdee-sales-types';

type Json=Record<string,unknown>;
const enabled=(value:unknown)=>value===true||value===1||value==='1';
const on=(value:unknown)=>value===true||value===1||value==='1'||value==='true';
const off=(value:unknown)=>value===false||value===0||value==='0'||value==='false';
/** GET errors never prove absence. Enumerate every matching page with all bill
 * states included, then compare exact numbers before allowing a create request. */
export async function assertNoRemoteSalesOrder(config:KingdeeConfig,billNo:string,signal:AbortSignal){
 const query={bill_no:billNo,page_size:'100',bill_status:'',bill_close_state:'',io_status:'',real_io_status:''};
 const read=async(page:number)=>{
  const data=await kingdeeSalesRequest(config,'salesList',{...query,page:String(page)},signal),pages=Number(data.total_page),count=Number(data.count);
  if(!Array.isArray(data.rows)||!Number.isSafeInteger(pages)||pages<0||pages>30||!Number.isSafeInteger(count)||count<0||count>3000||Number(data.page)!==page)throw new AppError('金蝶已有订单查询分页不完整，不能证明单据不存在。',502);
  return {rows:data.rows.map(object),pages,count};
 };
 const first=await read(1),ids=new Set<string>();
 const collect=(rows:Json[])=>{for(const row of rows){const id=sourceId(row.id);if(ids.has(id))throw new AppError('金蝶订单分页含重复记录，须重新核查。',502);ids.add(id);if(sourceText(row.bill_no).trim().toLowerCase()===billNo.trim().toLowerCase())throw new AppError('金蝶已存在相同单据编号；系统禁止覆盖或再建，请先核查原订单。',409);}};
 collect(first.rows);
 for(let page=2;page<=first.pages;page++){const next=await read(page);if(next.pages!==first.pages||next.count!==first.count)throw new AppError('金蝶订单列表在核查期间变化，本次未上传。',409);collect(next.rows);}
 if(ids.size!==first.count)throw new AppError('金蝶订单列表数量核对不一致，本次未上传。',409);
 const check=await read(1);if(check.pages!==first.pages||check.count!==first.count||JSON.stringify(check.rows.map(v=>[v.id,v.bill_no]))!==JSON.stringify(first.rows.map(v=>[v.id,v.bill_no])))throw new AppError('金蝶订单列表在核查期间变化，本次未上传。',409);
}
async function namedMaster(config:KingdeeConfig,operation:'unit'|'currency'|'employee',name:string,signal:AbortSignal){
 const matches:Json[]=[],seen=new Set<string>();
 for(let page=1;page<=30;page++){
  const data=await kingdeeSalesRequest(config,operation,{search:name,enable:'1',page:String(page),page_size:'100'},signal);
  if(!Array.isArray(data.rows))throw new AppError('金蝶基础资料查询没有返回完整列表。',502);
  const pages=Number(data.total_page);if(!Number.isInteger(pages)||pages<0||pages>30)throw new AppError('金蝶基础资料分页无法核实，不能确认映射。',502);
  for(const raw of data.rows){const row=object(raw),id=sourceId(row.id);if(seen.has(id))throw new AppError('金蝶基础资料分页重复，不能确认唯一映射。',502);seen.add(id);if(sourceText(row.name)===name&&(operation==='unit'||enabled(row.enable)))matches.push(row);}
  if(page>=pages)break;
 }
 if(matches.length!==1)throw new AppError(`金蝶${{unit:'单位',currency:'币别',employee:'业务员'}[operation]}“${name}”未精确匹配到唯一启用记录，请核对。`);
 return {id:sourceId(matches[0].id),name:sourceText(matches[0].name),number:sourceText(matches[0].number)};
}
export async function salesRemotePayload(config:KingdeeConfig,draft:KingdeeSalesDraft,signal:AbortSignal){
 const input=draft.inputs,customer=await kingdeeSalesRequest(config,'customer',{number:input.customerNumber},signal);
 if(sourceText(customer.number)!==input.customerNumber||!enabled(customer.enable))throw new AppError('金蝶客户编码没有精确匹配到启用客户。');
 const customerId=sourceId(customer.id),currency=await namedMaster(config,'currency',input.currencyName,signal),employee=await namedMaster(config,'employee',input.employeeName,signal),units=new Map<string,Awaited<ReturnType<typeof namedMaster>>>(),materials=new Map<string,Json>();
 const material_entity:Json[]=[];
 for(const line of input.lines){
  let unit=units.get(line.unitName);if(!unit){unit=await namedMaster(config,'unit',line.unitName,signal);units.set(line.unitName,unit);}
  const code=finishedSalesCode(input,line);let material=materials.get(code);if(!material){material=await kingdeeSalesRequest(config,'material',{number:code},signal);materials.set(code,material);}
  if(sourceText(material.number)!==code||!enabled(material.enable)||!enabled(material.is_sale))throw new AppError(`成品编码 ${code} 未精确匹配金蝶启用且可销售的商品。`);
  for(const key of ['is_asst_attr','is_multi_unit','is_batch','is_kf_period','is_serial'])if(!off(material[key]))throw new AppError(`成品编码 ${code} 的辅助属性、多单位或库存管理条件不适用普通订单入口，请核对商品档案。`);
  if(sourceId(material.base_unit_id)!==unit.id)throw new AppError(`成品编码 ${code} 的金蝶基本单位与草稿单位不一致；本入口不会换算数量。`);
  material_entity.push({material_id:sourceId(material.id),unit_id:unit.id,qty:Number(line.quantity),...(input.taxMode==='inclusive'?{tax_price:Number(line.unitPrice)}:{price:Number(line.unitPrice)}),cess:line.taxRate,is_free:line.isFree,delivery_date:line.deliveryDate,cus_bill_no:input.customerPO,comment:line.remark,regain_price:false,...Object.fromEntries(Object.entries(salesLineAmounts(line,input.taxMode)).map(([key,value])=>[key,Number(value)]))});
 }
 return {bill_no:draft.orderNo,bill_date:input.billDate,customer_id:customerId,emp_id:employee.id,currency_id:currency.id,exchange_rate:Number(input.exchangeRate),biz_mode:0,ignore_warn:false,reverse_condition_calculate:false,remark:input.remark,material_entity};
}
function numericEqual(actual:unknown,expected:unknown){const canonical=(value:unknown)=>{const text=String(value);if(!/^\d+(?:\.\d+)?$/.test(text))return null;const [whole,fraction='']=text.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.replace(/0+$/,'');};const a=canonical(actual),b=canonical(expected);return a!==null&&b!==null&&a===b;}
/** Read-back is authoritative only when every header and line matches the approved payload. */
export function verifySalesReadback(detail:Json,payload:Json){
 const id=sourceId(detail.id);
 for(const key of ['bill_no','bill_date','customer_id','emp_id','currency_id','remark'] as const)if(sourceText(detail[key])!==sourceText(payload[key]))throw new AppError('金蝶订单回读的单头字段与确认内容不一致，须人工核查。',409);
 if(!numericEqual(detail.exchange_rate,payload.exchange_rate)||!numericEqual(detail.biz_mode,payload.biz_mode))throw new AppError('金蝶订单回读的汇率或业务模式不一致，须人工核查。',409);
 if(!Array.isArray(detail.material_entity)||detail.material_entity.length!==(payload.material_entity as Json[]).length)throw new AppError('金蝶订单回读的明细数量不一致，须人工核查。',409);
 const remaining=detail.material_entity.map(object),lineIds:string[]=[],seen=new Set<string>();
 for(const row of remaining){const lineId=sourceId(row.id);if(seen.has(lineId))throw new AppError('金蝶回读包含重复明细标识，须人工核查。',409);seen.add(lineId);}
 for(const wanted of payload.material_entity as Json[]){
  const i=remaining.findIndex(row=>['material_id','unit_id','delivery_date','cus_bill_no','comment'].every(k=>sourceText(row[k])===sourceText(wanted[k]))&&['qty','cess','amount','all_amount','tax_amount',wanted.tax_price!==undefined?'tax_price':'price'].every(k=>numericEqual(row[k],wanted[k]))&&(on(row.is_free)||off(row.is_free))&&on(row.is_free)===wanted.is_free);
  if(i<0)throw new AppError('金蝶订单回读的商品、单位、数量、价格、金额、税率、备注或交期与确认内容不一致，须人工核查。',409);lineIds.push(sourceId(remaining[i].id));remaining.splice(i,1);
 }
 return {id,number:sourceText(detail.bill_no),lineIds};
}
