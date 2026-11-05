import * as XLSX from 'xlsx';
import {z} from 'zod';
import {type State,type Member,type Entity,newId,now} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canReadReceiptLedger,receiptConfirmer} from './receipt-ledger';
import {arReadOnly} from './ar-workspace';

export const collectionSheets=['度昂香港HSBC 收款记录','按客户汇总应收款','paypal收款记录'];
export const collectionEntities=['doon_hk','moni_cn','doon_cn'] as const;
export const collectionChannels=['unknown','hk_hsbc','paypal','moni_mainland'] as const;
const text=z.string().trim().max(1000),money=z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents=(v:string)=>{const [a,b='']=v.split('.');return Number(a)*100+Number(b.padEnd(2,'0'));};
const validDay=(v:string)=>{if(!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new AppError('日期无效。');return v;};
const rows=(s:State,k:string)=>s.records.filter(r=>r.kind===k);
const hash=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
function read(s:State,m:Member){if(!canReadReceiptLedger(s,m))throw new AppError('仅在职管理员、财务与固定确认人可查看完整公司收款资料。',403);}
function write(s:State,m:Member){read(s,m);if(m.role!=='admin'||arReadOnly(s,m))throw new AppError('当前账号不能维护公司收款资料。',403);}
function confirmer(s:State,m:Member){if(receiptConfirmer(s)?.id!==m.id||arReadOnly(s,m))throw new AppError('仅朱了青本人可最终确认。',403);}
export function parseCollectionWorkbook(bytes:ArrayBuffer){
 const a=new Uint8Array(bytes),v=new DataView(bytes);let expanded=0,entries=0;
 for(let i=0;i<a.length-46;i++)if(v.getUint32(i,true)===0x02014b50){expanded+=v.getUint32(i+24,true);entries++;i+=45+v.getUint16(i+28,true)+v.getUint16(i+30,true)+v.getUint16(i+32,true);}
 if(!entries||expanded>100*1024*1024||entries>4000)throw new AppError('工作簿包大小超出读取范围。');
 let w:XLSX.WorkBook;try{w=XLSX.read(bytes,{type:'array',cellFormula:true,cellText:true,cellDates:false,sheetRows:5001});}catch{throw new AppError('无法读取XLSX工作簿。');}
 if(w.SheetNames.length!==3||collectionSheets.some(n=>!w.Sheets[n]))throw new AppError('请选择含香港HSBC、PayPal及按客户汇总三个原工作表的货款明细。');
 return w.SheetNames.map(name=>{
  const s=w.Sheets[name];if(s['!fullref']&&XLSX.utils.decode_range(s['!fullref']).e.r>=5000)throw new AppError('原工作表超过5000行，不能只导入前部。');
  const cells=Object.entries(s).filter(([k,c])=>!k.startsWith('!')&&(c.v!==undefined||c.f));
  if(cells.length>100000||cells.some(([k])=>XLSX.utils.decode_cell(k).r>=5000))throw new AppError('工作表超过5000行或100000个非空单元格。');
  const byRow=new Map<number,Record<string,unknown>>();let maxCol=0;
  for(const [address,c] of cells){const p=XLSX.utils.decode_cell(address),r=byRow.get(p.r+1)||{};maxCol=Math.max(maxCol,p.c);r[XLSX.utils.encode_col(p.c)]={address,value:c.v??null,formula:c.f||'',formatted:c.w||'',type:c.t};byRow.set(p.r+1,r);}
  if(maxCol>100)throw new AppError('实际数据列超过101列，请核对工作簿范围。');
  const headers=byRow.get(1)||{};
  for(const [r,cells] of byRow)if(r>1)for(const [column,cell] of Object.entries(cells)){
   const c=cell as any,h=(headers[column] as any)?.value;
   if(typeof c.value==='number'&&/日期|Date/i.test(String(h))){const d=XLSX.SSF.parse_date_code(c.value,{date1904:!!w.Workbook?.WBProps?.date1904});if(d)c.datePreview=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
  }
  return {name,headers,columns:Array.from({length:maxCol+1},(_,i)=>XLSX.utils.encode_col(i)),rows:[...byRow].filter(([r])=>r>1).sort((a,b)=>a[0]-b[0]).map(([sourceRow,cells])=>({sourceRow,cells,rowType:Object.values(cells).some((c:any)=>typeof c.value==='string'&&/汇总|总计|合计/.test(c.value))?'subtotal':'detail'}))};
 });
}
async function uploaded(form:FormData,xlsx=false){
 const f=form.get('file');if(!(f instanceof File)||!f.size||f.size>20*1024*1024)throw new AppError('请选择20MB以内的原文件。');
 const bytes=await f.arrayBuffer(),a=new Uint8Array(bytes),ext=f.name.split('.').at(-1)?.toLowerCase();
 const mime=ext==='xlsx'&&a[0]===80&&a[1]===75?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':ext==='pdf'&&new TextDecoder().decode(a.slice(0,5))==='%PDF-'?'application/pdf':ext==='png'&&a.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':['jpg','jpeg'].includes(ext||'')&&a[0]===255&&a[1]===216?'image/jpeg':'';
 if(!mime||xlsx&&ext!=='xlsx')throw new AppError('文件内容或格式无效，请上传XLSX、PDF、PNG或JPEG原件。');
 return {bytes,hash:await hash(bytes),filename:f.name.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,240),mime,size:f.size};
}
function dto({fileKey,...r}:Entity){return r;}
export function collectionInvoiceBalances(s:State){return rows(s,'collection_invoice').map(i=>{const links=rows(s,'collection_allocation').filter(a=>a.invoiceId===i.id&&a.status==='confirmed');const receivedCents=links.reduce((n,a)=>n+a.amountCents,0);return {...dto(i),receivedCents,balanceCents:i.amountCents-receivedCents,paymentStatus:receivedCents===0?'未收':receivedCents<i.amountCents?'部分收款':'已收齐'};});}
export async function collectionGet(action:string,req:Request,s:State,m:Member){
 if(!['collection-data','collection-file'].includes(action))return null;read(s,m);
 if(action==='collection-file'){const r=s.records.find(r=>['collection_workbook','collection_invoice','collection_intercompany'].includes(r.kind)&&r.id===new URL(req.url).searchParams.get('id'));if(!r?.fileKey)throw new AppError('原件不存在。',404);const f=await bucket().get(r.fileKey);if(!f)throw new AppError('原件文件不存在。',404);return new Response(f.body,{headers:{'Content-Type':r.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 return json({workbooks:rows(s,'collection_workbook').map(dto),invoices:collectionInvoiceBalances(s),allocations:rows(s,'collection_allocation'),agency:rows(s,'collection_agency'),intercompany:rows(s,'collection_intercompany').map(dto),customers:rows(s,'customer_account').filter(c=>c.active!==false).map(c=>({id:c.id,code:c.customerCode,name:c.customer})),receipts:rows(s,'receipt_master_entry').map(r=>({id:r.id,version:r.version,category:r.category,duplicateOf:r.duplicateOf,finalStatus:r.finalStatus,lines:r.lines,channel:r.channel||'unknown',legalEntity:r.legalEntity||'',customerId:r.customerId||'',note:r.note})),canWrite:m.role==='admin'&&!arReadOnly(s,m),canConfirm:receiptConfirmer(s)?.id===m.id&&!arReadOnly(s,m)});
}
export async function collectionPost(action:string,req:Request,s:State,m:Member){
 if(!['collection-import','collection-invoice','collection-receipt-route','collection-agency-confirm','collection-allocate','collection-allocation-confirm','collection-intercompany'].includes(action))return null;
 read(s,m);let item:Entity;
 if(action==='collection-import'){
  write(s,m);const form=await req.formData(),file=await uploaded(form,true),asOf=validDay(day.parse(form.get('asOf'))),basis=text.min(1).parse(form.get('basis'));
  const old=rows(s,'collection_workbook').find(r=>r.hash===file.hash);if(old){if(old.asOf!==asOf)throw new AppError('同一原件已归档，截至日不同请核对，不覆盖原批次。',409);return json({item:dto(old),duplicate:true});}
  const sheets=parseCollectionWorkbook(file.bytes);item={id:newId('collection_workbook'),kind:'collection_workbook',version:1,asOf,basis,sheets,...file,fileKey:newId('collection_file'),createdAt:now(),actorId:m.id};delete item.bytes;
  await bucket().put(item.fileKey,file.bytes);
 }else if(action==='collection-invoice'){
  write(s,m);const form=await req.formData(),file=await uploaded(form),v=z.object({customerId:text.min(1),seller:z.enum(collectionEntities),invoiceNo:text.min(1),obligationRef:text.min(1),invoiceDate:day,dueDate:day,currency:z.enum(['USD','CNY','HKD','EUR','GBP','AUD','CAD','JPY']),amount:money,relation:z.enum(['new','reference']),existingReceivableRef:text,note:text}).strict().parse(JSON.parse(String(form.get('metadata')||'{}')));
  validDay(v.invoiceDate);validDay(v.dueDate);if(!cents(v.amount))throw new AppError('发票金额须大于零。');if(!rows(s,'customer_account').some(c=>c.id===v.customerId&&c.active!==false))throw new AppError('请选择有效客户。');
  if(v.relation==='reference'&&!v.existingReceivableRef)throw new AppError('已有应收请填写准确原应收编号，不能再次计入新增。');
  const old=rows(s,'collection_invoice').find(r=>r.seller===v.seller&&r.invoiceNo===v.invoiceNo);if(old){if(old.hash===file.hash&&Object.entries(v).every(([k,value])=>old[k]===value))return json({item:dto(old),duplicate:true});throw new AppError('同销售主体同票号已存在，保留旧版，修订票须先核对原应收关系。',409);}
  if(v.relation==='new'&&rows(s,'collection_invoice').some(r=>r.customerId===v.customerId&&r.seller===v.seller&&r.obligationRef===v.obligationRef&&r.relation==='new'))throw new AppError('该应收义务已登记，请选择引用已有应收，避免PI和商业发票重复。',409);
  item={id:newId('collection_invoice'),kind:'collection_invoice',version:1,...v,amountCents:cents(v.amount),...file,fileKey:newId('collection_file'),createdAt:now(),actorId:m.id};delete item.bytes;await bucket().put(item.fileKey,file.bytes);
 }else if(action==='collection-intercompany'){
  write(s,m);const form=await req.formData(),file=await uploaded(form),v=z.object({type:z.enum(['sale','transfer','refund_material']),from:z.enum(collectionEntities),to:z.enum(collectionEntities),date:day,currency:z.enum(['USD','CNY','HKD','EUR','GBP','AUD','CAD','JPY']),amount:money,reference:text.min(1),kingdeeOrder:text,exportDeclaration:text,taxRefundReference:text,note:text}).strict().parse(JSON.parse(String(form.get('metadata')||'{}')));
  validDay(v.date);const allowed=v.type==='sale'?[['doon_cn','moni_cn'],['moni_cn','doon_hk']]:v.type==='transfer'?[['doon_hk','moni_cn'],['moni_cn','doon_cn']]:[['moni_cn','doon_hk']];if(!allowed.some(([a,b])=>a===v.from&&b===v.to)||!cents(v.amount))throw new AppError('公司往来方向或金额无效。');
  const old=rows(s,'collection_intercompany').find(r=>r.type===v.type&&r.from===v.from&&r.reference===v.reference);if(old){if(old.hash===file.hash&&Object.entries(v).every(([k,value])=>old[k]===value))return json({item:dto(old),duplicate:true});throw new AppError('该往来编号已登记，不能覆盖原记录。',409);}
  item={id:newId('collection_intercompany'),kind:'collection_intercompany',version:1,...v,amountCents:cents(v.amount),...file,fileKey:newId('collection_file'),status:'资料已归档，待核对',createdAt:now(),actorId:m.id};delete item.bytes;await bucket().put(item.fileKey,file.bytes);
 }else{
  const raw=await req.json();
  if(action==='collection-receipt-route'){
   write(s,m);const v=z.object({id:text,version:z.number().int(),channel:z.enum(collectionChannels),legalEntity:z.enum(collectionEntities),customerId:text,note:text.min(1)}).strict().parse(raw),r=rows(s,'receipt_master_entry').find(r=>r.id===v.id);
   if(!r||r.version!==v.version||r.finalStatus==='confirmed')throw new AppError('实收已变化或已最终确认，不能修改归属。',409);if(v.customerId&&!rows(s,'customer_account').some(c=>c.id===v.customerId&&c.active!==false))throw new AppError('客户不存在。');
   if(v.channel==='hk_hsbc'&&v.legalEntity!=='doon_hk'||v.channel==='moni_mainland'&&v.legalEntity!=='moni_cn')throw new AppError('收款渠道与实际持款主体不一致。');
   item={...r,channel:v.channel,legalEntity:v.legalEntity,customerId:v.customerId,routeBasis:v.note,version:r.version+1,updatedAt:now(),updatedBy:m.id};
  }else if(action==='collection-agency-confirm'){
   confirmer(s,m);const v=z.object({id:text,version:z.number().int(),reason:text.min(1)}).strict().parse(raw),r=rows(s,'receipt_master_entry').find(r=>r.id===v.id);
   if(!r||r.version!==v.version||r.finalStatus!=='confirmed'||r.category!=='receipt'||r.duplicateOf||r.channel!=='moni_mainland'||r.legalEntity!=='moni_cn'||!r.customerId)throw new AppError('须先确认魔你代收实收及准确客户。',409);
   const old=rows(s,'collection_agency').find(a=>a.receiptId===r.id&&a.receiptVersion===r.version);if(old)return json({item:dto(old),duplicate:true});
   item={id:newId('collection_agency'),kind:'collection_agency',version:1,receiptId:r.id,receiptVersion:r.version,customerId:r.customerId,holder:'moni_cn',principal:'doon_hk',reason:v.reason,status:'confirmed',settlementStatus:'公司间代收结算待核对',confirmedBy:m.id,confirmedAt:now()};
  }else if(action==='collection-allocate'){
   write(s,m);const v=z.object({invoiceId:text,receiptId:text,lineIndex:z.number().int().nonnegative(),amount:money,reason:text.min(1)}).strict().parse(raw);const i=rows(s,'collection_invoice').find(r=>r.id===v.invoiceId),r=rows(s,'receipt_master_entry').find(r=>r.id===v.receiptId),l=r?.lines[v.lineIndex];
   if(!i||i.relation!=='new'||!r||r.finalStatus!=='confirmed'||r.category!=='receipt'||r.duplicateOf||!l||!r.customerId||r.customerId!==i.customerId||l.currency!==i.currency||!r.channel||r.channel==='unknown'||!r.legalEntity)throw new AppError('须选择同客户、同币种、已最终确认且渠道归属完整的实收与独立应收。');
   const agency=rows(s,'collection_agency').find(a=>a.receiptId===r.id&&a.receiptVersion===r.version&&a.customerId===i.customerId&&a.principal===i.seller&&a.holder===r.legalEntity&&a.status==='confirmed');
   if(r.legalEntity!==i.seller&&!agency)throw new AppError('持款主体与销售主体不同，请先由朱了青确认代收结算依据，不直接核销。');
   const repeated=rows(s,'collection_allocation').find(a=>a.invoiceId===v.invoiceId&&a.receiptId===v.receiptId&&a.lineIndex===v.lineIndex&&a.amount===v.amount&&a.reason===v.reason);if(repeated)return json({item:dto(repeated),duplicate:true});
   const used=rows(s,'collection_allocation').filter(a=>a.receiptId===r.id&&a.lineIndex===v.lineIndex),applied=rows(s,'collection_allocation').filter(a=>a.invoiceId===i.id);const amountCents=cents(v.amount);
   if(!amountCents||used.reduce((n,a)=>n+a.amountCents,0)+amountCents>cents(l.amount)||applied.reduce((n,a)=>n+a.amountCents,0)+amountCents>i.amountCents)throw new AppError('分配金额超出实收未分配额或发票未收额（含待确认分配）。');
   item={id:newId('collection_allocation'),kind:'collection_allocation',version:1,...v,amountCents,agencyId:agency?.id||'',invoiceVersion:i.version,receiptVersion:r.version,status:'pending',createdAt:now(),actorId:m.id};
  }else{
   confirmer(s,m);const v=z.object({id:text,version:z.number().int()}).strict().parse(raw),r=rows(s,'collection_allocation').find(r=>r.id===v.id);if(!r||r.version!==v.version||r.status!=='pending')throw new AppError('分配资料已更新。',409);
   const i=rows(s,'collection_invoice').find(i=>i.id===r.invoiceId),p=rows(s,'receipt_master_entry').find(p=>p.id===r.receiptId);if(!i||!p||i.version!==r.invoiceVersion||p.version!==r.receiptVersion||p.finalStatus!=='confirmed')throw new AppError('分配依据已变化，不能确认。',409);
   item={...r,status:'confirmed',version:r.version+1,confirmedBy:m.id,confirmedAt:now()};
  }
 }
 await commit(s.revision,[item,audit(m,{id:item.id,kind:item.kind},null,action,'收款对账中心',{id:item.id,version:item.version})]);return json({item:dto(item)});
}
