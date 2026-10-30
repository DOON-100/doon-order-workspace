import {broad,strictDate,type Member} from './domain';
import {AppError,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {kingdeeConfig,kingdeeRead,kingdeeDetails,object,sourceId,sourceText,type KingdeeConfig} from './kingdee-client';
import type {KingdeeQueryPage,KingdeeQueryRow} from './kingdee-readonly-types';
import {kingdeeSupplierDiagnosticGet} from './kingdee-supplier-diagnostic';

const pageSize=5;
const busy=new Set<string>();
const stateLabels:Record<string,string>={A:'未入库',Z:'部分入库',C:'全部入库'};
const closeLabels:Record<string,string>={C:'未关闭',S:'已关闭',H:'手动关闭'};
const lineCloseLabels:Record<string,string>={'0':'已关闭','1':'未关闭','2':'手动关闭'};
function integer(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new AppError('金蝶分页信息不完整，本次查询未完成。',502);return value;}
function label(value:unknown,labels:Record<string,string>){const code=sourceText(value);return labels[code]||`待核查${code?'（'+code+'）':''}`;}
function text(value:unknown){const result=sourceText(value);if(result.length>4000)throw new AppError('金蝶字段过长，请核对来源。',502);return result;}
function pagination(data:Record<string,unknown>,page:number){
 const count=integer(data.count),pages=integer(data.total_page);
 if(!Array.isArray(data.rows)||data.page!==page||data.page_size!==pageSize||data.current_page_size!==data.rows.length||pages!==Math.ceil(count/pageSize)&&!(count===0&&pages===1))throw new AppError('金蝶分页数量不一致，请重新查询。',409);
 if(page>Math.max(pages,1)||data.rows.length!==Math.min(pageSize,Math.max(0,count-(page-1)*pageSize)))throw new AppError('金蝶分页缺失或查询期间发生变化，请重新查询。',409);
 const rows=data.rows.map(object),ids=rows.map(row=>sourceId(row.id));
 if(new Set(ids).size!==ids.length)throw new AppError('金蝶当前页出现重复订单，请重新查询。',409);
 if(rows.some(row=>row.bill_status!=='C'))throw new AppError('金蝶审核状态与查询条件不一致，请重新查询。',409);
 return {count,pages,rows,ids};
}
function fingerprint(rows:Record<string,unknown>[]){return JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]))));}

export function kingdeeDetailRows(detail:Record<string,unknown>,orderId:string){
 if(sourceId(detail.id)!==orderId||detail.bill_status!=='C')throw new AppError('金蝶订单身份或审核状态已变化，请重新同步。',409);
 const rows:KingdeeQueryRow[]=[];let excludedComplete=0,unknown=0;
 if(!Array.isArray(detail.material_entity)||!detail.material_entity.length||detail.material_entity.length>2000)throw new AppError('金蝶商品行缺失或数量异常，本次查询未完成。',502);
 const lineIds=new Set<string>();
 for(const raw of detail.material_entity){
  const line=object(raw),lineId=sourceId(line.id);if(lineIds.has(lineId))throw new AppError('金蝶商品行标识重复，本次查询未完成。',409);lineIds.add(lineId);
  if(line.entry_realio_status==='C'){excludedComplete++;continue;}
  const uncertain=!['A','Z'].includes(sourceText(line.entry_realio_status));if(uncertain)unknown++;
  // qty is the source order quantity, never inferred as remaining quantity.
  // due_date is a settlement date; only delivery_date is shown as delivery date.
  const values=[text(detail.bill_no),text(detail.bill_date),text(detail.supplier_name),text(detail.emp_name),label(detail.bill_close_state,closeLabels),text(line.material_number),text(line.material_name),text(line.material_model),text(line.unit_name),text(line.qty),text(line.delivery_date),label(line.entry_realio_status,stateLabels),label(line.close_state,lineCloseLabels),text(line.comment),orderId,lineId];
  rows.push({id:orderId+':'+lineId,values,uncertain});
 }
 return {rows,excludedComplete,unknown};
}

/** Capture each order once. Optional page verification is for read-only diagnostics. */
export async function readKingdeePurchasePage(config:KingdeeConfig,page:number,signal:AbortSignal,options:{start?:string;end?:string;verifyPage?:boolean}={}):Promise<KingdeeQueryPage>{
 const startedAt=new Date().toISOString();
 const query={page:String(page),page_size:String(pageSize),bill_status:'C',...(options.start?{start_bill_date:options.start}:{}),...(options.end?{end_bill_date:options.end}:{})};
 const data=await kingdeeRead(config,'list',query,signal);
 const first=pagination(data,page),details=await kingdeeDetails(config,first.ids,signal);
 const rows:KingdeeQueryRow[]=[];let excludedComplete=0,unknown=0;
 for(let index=0;index<first.rows.length;index++){
  const summary=first.rows[index],orderId=first.ids[index],detail=details[index];
  if(sourceId(detail.id)!==orderId||detail.bill_status!=='C'||['bill_no','supplier_id','bill_close_state'].some(key=>sourceText(detail[key])!==sourceText(summary[key])))throw new AppError('金蝶订单身份或审核状态与列表不一致，本次未同步。',409);
  const mapped=kingdeeDetailRows(detail,orderId);rows.push(...mapped.rows);excludedComplete+=mapped.excludedComplete;unknown+=mapped.unknown;
 }
 if(options.verifyPage){
  const check=pagination(await kingdeeRead(config,'list',query,signal),page);
  if(check.count!==first.count||check.pages!==first.pages||fingerprint(first.rows)!==fingerprint(check.rows))throw new AppError('金蝶分页在查询期间发生变化，请重新查询。',409);
 }
 return {readOnly:true,page,pages:first.pages,count:first.count,orderIds:first.ids,rows,excludedComplete,unknown,startedAt,finishedAt:new Date().toISOString()};
}

/** Live read only: no commit(), bucket writes, audit records, import batches or timers. */
export async function kingdeeReadonlyGet(action:string,req:Request,m:Member):Promise<Response|null>{
 const supplier=await kingdeeSupplierDiagnosticGet(action,req,m);if(supplier)return supplier;
 if(!['kingdee-readonly-status','kingdee-readonly-query'].includes(action))return null;
 if(!m.active||!broad(m))throw new AppError('仅现有 PMC / 采购和管理员可查询金蝶采购原表。',403);
 // The API's customer-order mapping is not verified. Never bypass a selected group
 // by returning company-wide live records to a group-scoped request.
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('金蝶实时查询尚未建立业务小组关联，请在有全表权限的全部范围查询。',403);
 const config=kingdeeConfig();
 if(action==='kingdee-readonly-status')return json({readOnly:true,configured:!!config,message:config?'可按单据日期查询金蝶采购订单。':'尚未配置金蝶只读连接，请管理员在服务器私有运行配置中设置应用、正式实例及目标账套。'});
 if(!config)throw new AppError('金蝶只读连接尚未配置，当前总表未发生变化。',503);
 const params=new URL(req.url).searchParams;
 for(const key of params.keys())if(!['page','start','end'].includes(key)||params.getAll(key).length!==1)throw new AppError('不支持的金蝶查询参数。');
 const pageText=params.get('page')||'1';if(!/^[1-9]\d{0,5}$/.test(pageText))throw new AppError('查询页码无效。');
 const page=Number(pageText),start=params.get('start')||'',end=params.get('end')||'';
 for(const date of [start,end])if(date){try{if(strictDate(date)!==date)throw new Error();}catch{throw new AppError('请输入有效的单据日期。');}}
 if(start&&end&&start>end)throw new AppError('开始日期不能晚于结束日期。');
 if(busy.has(m.id)||busy.size>=2)throw new AppError('已有金蝶查询正在进行，请稍后重试。',429);
 busy.add(m.id);
 try{
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(60000)]);
  return json(await readKingdeePurchasePage(config,page,signal,{start,end,verifyPage:true}));
 }finally{busy.delete(m.id);}
}
