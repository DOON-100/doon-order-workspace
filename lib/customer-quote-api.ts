import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {
 canCreateCustomerQuote,canEditCustomerQuote,canReadCustomerQuote,canUseCustomerQuotes,changedQuoteCustomer,customerQuoteInput,mayChangeQuoteCustomer,publicCustomerQuote,quoteAccount,
 type CustomerQuote,type CustomerQuoteRevision,
} from './customer-quotes';

function allowed(m:Member){if(!canUseCustomerQuotes(m))throw new AppError('没有客户报价权限。',403);}
function quoteFor(s:State,id:string){const q=all(s,'customer_quote').find(v=>v.id===id) as CustomerQuote|undefined;if(!q)throw new AppError('客户报价不存在。',404);return q;}
function editable(s:State,m:Member,q:CustomerQuote){if(!canEditCustomerQuote(s,m,q))throw new AppError('仅获分配的业务 / 客服、创建人、PMC 或管理员可编辑该报价。',403);if(q.status!=='draft')throw new AppError('仅可编辑待确认报价草稿。',409);}
function current(q:CustomerQuote,version:number){if(q.version!==version)throw new AppError('报价已由其他同事更新，你的输入未覆盖新版本；请刷新核对后再保存。',409);}
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const result=schema.safeParse(value);if(!result.success)throw new AppError(result.error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).slice(0,4).join('；'));return result.data;}
async function persist(s:State,m:Member,q:CustomerQuote,before:CustomerQuote|null,action:string){
 // The current pointer may advance, but each snapshot has a new ID and is never overwritten.
 const revision:CustomerQuoteRevision={id:newId('customer_quote_revision'),kind:'customer_quote_revision',quoteId:q.id,version:q.version,action,updatedAt:q.updatedAt,updatedBy:m.name,snapshot:structuredClone(q)};
 const withoutStorageKey=(value:CustomerQuote|null)=>{if(!value)return null;const {sourceFileKey,...safe}=value;return safe;};
 const records:Entity[]=[q,revision,audit(m,q,withoutStorageKey(before),action,'客户报价工作台',withoutStorageKey(q))];
 await commit(s.revision,records);
 return json({ok:true,quote:publicCustomerQuote({...s,records:[...s.records.filter(v=>v.id!==q.id),...records]},m,q)});
}

export async function customerQuoteGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-quotes','customer-quote-file'].includes(action))return null;
 allowed(m);
 if(action==='customer-quotes')return json({quotes:(all(s,'customer_quote') as CustomerQuote[]).filter(q=>canReadCustomerQuote(s,m,q)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(q=>publicCustomerQuote(s,m,q)),canCreate:canCreateCustomerQuote(m)});
 const q=quoteFor(s,new URL(req.url).searchParams.get('id')||'');
 if(!canReadCustomerQuote(s,m,q))throw new AppError('无权读取该客户报价的原附件。',403);
 if(!q.sourceFileKey)throw new AppError('该报价尚未上传原附件。',404);
 const object=await bucket().get(q.sourceFileKey);if(!object)throw new AppError('原报价附件暂不可用，请联系管理员核对存储。',404);
 return new Response(object.body,{headers:{'Content-Type':q.sourceContentType||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(q.sourceFilename||'quotation.xlsx')}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export async function customerQuotePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-quote-save','customer-quote-upload'].includes(action))return null;
 allowed(m);
 if(!canCreateCustomerQuote(m))throw new AppError('当前角色仅可查看客户报价。',403);
 if(action==='customer-quote-save'){
  const input=parse(customerQuoteInput,await req.json()),{id,version,...fields}=input;
  const before=id?quoteFor(s,id):null;
  if(before){editable(s,m,before);current(before,version!);if(changedQuoteCustomer(before,fields)&&!mayChangeQuoteCustomer(s,m,fields))throw new AppError('无权将报价改为其他客户，请由 PMC 或管理员核对客户归属。',403);}
  if(fields.customerAccountId){const account=quoteAccount(s,fields.customerAccountId);if(!account||!account.active)throw new AppError('选定的客户档案不存在或已停用。');if(fields.customerName!==account.customer||(account.customerCode&&fields.customerCode!==account.customerCode))throw new AppError('报价客户名称 / 编号与所选档案不一致，请先核对；系统不会自动修改客户档案。');if(m.role==='sales'&&!mayChangeQuoteCustomer(s,m,fields))throw new AppError('无权关联该客户档案。',403);}
  const at=now(),quote:CustomerQuote={...before,...fields,id:before?.id||newId('customer_quote'),kind:'customer_quote',status:'draft',version:(before?.version||0)+1,createdAt:before?.createdAt||at,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name,updatedById:m.id};
  return persist(s,m,quote,before,before?'更新客户报价草稿':'创建客户报价草稿');
 }
 const form=await req.formData(),input=parse(z.object({quoteId:z.string().min(1),version:z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger)}),{quoteId:form.get('quoteId'),version:form.get('version')}),before=quoteFor(s,input.quoteId);
 editable(s,m,before);current(before,input.version);
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的原报价单。');
 const ext=file.name.match(/\.(xlsx|xls|pdf)$/i)?.[1].toLowerCase();if(!ext)throw new AppError('原报价单支持 XLSX、XLS 或 PDF。');
 const bytes=await file.arrayBuffer(),header=new Uint8Array(bytes).slice(0,8);
 const valid=ext==='xlsx'?header[0]===0x50&&header[1]===0x4b:ext==='xls'?[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>header[i]===v):[0x25,0x50,0x44,0x46,0x2d].every((v,i)=>header[i]===v);
 if(!valid)throw new AppError('文件内容与扩展名不匹配，请上传原始 Excel 或 PDF 文件。');
 const hash=await sha(bytes),fileKey=newId('customer_quote_source'),at=now();
 const quote:CustomerQuote={...before,version:before.version+1,sourceFileKey:fileKey,sourceFilename:file.name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,180),sourceHash:hash,sourceContentType:ext==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':ext==='xls'?'application/vnd.ms-excel':'application/pdf',updatedAt:at,updatedBy:m.name,updatedById:m.id};
 // Write a new immutable object. A failed optimistic commit cannot replace any prior file.
 await bucket().put(fileKey,bytes);
 return persist(s,m,quote,before,'上传客户报价原附件');
}
