import {broad,type Member} from './domain';
import {AppError,json} from './store';
import {businessTeamHeader} from './business-team-scope';
import {kingdeeConfig,kingdeeSupplierDiagnostic,object,sourceId} from './kingdee-client';

const busy=new Set<string>();
function integer(value:unknown){
 const v=typeof value==='number'?value:typeof value==='string'&&/^\d{1,12}$/.test(value)?Number(value):NaN;
 if(!Number.isSafeInteger(v)||v<0)throw new AppError('金蝶供应商列表分页信息无效，请核对接口。',502);
 return v;
}
function field(value:unknown,max:number){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new AppError('金蝶供应商列表身份字段无效，请核对接口。',502);
 return value;
}

/** A bounded diagnostic: no import, modifications, timer, contacts or banking details. */
export async function kingdeeSupplierDiagnosticGet(action:string,req:Request,m:Member):Promise<Response|null>{
 if(action!=='kingdee-supplier-diagnostic')return null;
 if(!m.active||!broad(m))throw new AppError('仅有效 PMC / 采购和管理员可检查金蝶供应商连接。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('供应商连接检查须在有全表权限的全部范围操作。',403);
 if(new URL(req.url).search)throw new AppError('供应商连接检查不接受查询参数。');
 const config=kingdeeConfig();if(!config)throw new AppError('金蝶只读连接尚未配置，未读取或写入供应商资料。',503);
 if(busy.has(m.id)||busy.size>=2)throw new AppError('已有供应商连接检查正在进行，请稍后重试。',429);
 busy.add(m.id);
 try{
  const data=await kingdeeSupplierDiagnostic(config,AbortSignal.any([req.signal,AbortSignal.timeout(30000)]));
  if(!Array.isArray(data.rows)||data.rows.length>10)throw new AppError('金蝶供应商列表格式无效，请核对接口。',502);
  const count=integer(data.count);
  if(count<data.rows.length||(data.page!==undefined&&integer(data.page)!==1)||(data.page_size!==undefined&&integer(data.page_size)!==10)||(data.current_page_size!==undefined&&integer(data.current_page_size)!==data.rows.length))throw new AppError('金蝶供应商列表分页信息无效，请核对接口。',502);
  const rows=data.rows.map(value=>{const row=object(value);return {id:sourceId(row.id),code:field(row.number,100),name:field(row.name,200),status:'未知'};});
  if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.code)).size!==rows.length)throw new AppError('金蝶供应商列表存在重复标识，请核对接口。',409);
  return json({readOnly:true,page:1,pageSize:10,count,rows,checkedAt:new Date().toISOString()});
 }finally{busy.delete(m.id);}
}
