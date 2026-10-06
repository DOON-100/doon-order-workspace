import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
XLSX.set_cptable(cptable);
import {AppError} from './store';
import {all,clean,email,fields,fieldLabels,normalizeField,businessKey,canRead,allowedFields,broad,mergeFields,newId,now,strictDate,type State,type Member,type Order,type Report,type PreviewRow} from './domain';
const aliases:Record<string,string[]>={orderNo:['订单号','销售订单号','订单编号'],customer:['客户','客户号','客户编号'],customerPO:['客户 PO','客户PO','客户订单号'],drawing:['图纸编号','图号','款号','产品'],color:['色号','L · 色号','圈色','颜色','颜色代码'],lens:['镜片类型','镜片'],productCode:['产品编码','物料编码','成品编码'],productType:['产品类型','品类'],specialRequirements:['特殊要求','客户特殊要求'],quantity:['订单数量','数量','订购数量'],requestedDate:['客户要求交期','客户交期','交货日期'],ownerEmail:['负责人邮箱'],batch:['交货批次'],stage:['计划阶段','生产状态'],plannedDate:['预计完工日'],shipDate:['预计可出货日'],promisedDate:['回复交期','承诺交期'],promiseConfirmed:['交期已确认'],notes:['内部跟进备注','备注'],customerNote:['对客备注'],arrangement:['分批交货安排'],sourceStatus:['订单来源状态']};
export function openWorkbook(bytes:ArrayBuffer){
 if(bytes.byteLength>10*1024*1024)throw new AppError('文件超过 10 MB，请分批上传。');
 const data=new Uint8Array(bytes),dv=new DataView(bytes);let inflated=0,entries=0;
 for(let i=0;i<data.length-46;i++){if(dv.getUint32(i,true)===0x02014b50){inflated+=dv.getUint32(i+24,true);entries++;i+=45+dv.getUint16(i+28,true)+dv.getUint16(i+30,true)+dv.getUint16(i+32,true);}}
 if(inflated>80*1024*1024||entries>2000)throw new AppError('工作簿展开后过大，请另存为仅包含数据的新表。');
 try{return XLSX.read(bytes,{type:'array',cellDates:false,cellFormula:true,nodim:true,sheetRows:10002,codepage:65001});}catch{throw new AppError('无法读取文件，请上传未加密的 XLSX、XLS 或 UTF-8 CSV。');}
}
export function sheetRows(book:XLSX.WorkBook,sheetName:string,headerRow:number){
 const sheet=book.Sheets[sheetName];if(!sheet)throw new AppError('请选择有效的工作表。');
 if(!Number.isInteger(headerRow)||headerRow<1||headerRow>50)throw new AppError('表头行必须介于 1 至 50。');
 const ref=XLSX.utils.decode_range(sheet['!ref']||'A1');if(ref.e.c>299||ref.e.r>=10001)throw new AppError('工作表超过 300 列或 10000 行，请分批导入。');
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false,blankrows:true,dateNF:'yyyy-mm-dd'}) as unknown[][];
 const headers=(rows[headerRow-1]||[]).map(clean);if(!headers.some(Boolean))throw new AppError('所选表头行为空。');
 const body=rows.slice(headerRow).map((r,i)=>({index:headerRow+i+1,values:r})).filter(r=>r.values.some(v=>clean(v)));
 return {headers,body,sheet};
}
export function suggestMapping(headers:string[]){return Object.fromEntries(fields.map(([k,label])=>[k,(aliases[k]||[label]).find(h=>headers.includes(h))||'']));}
export function isOriginalLedger(book:XLSX.WorkBook){const s=book.Sheets['动态表'];return !!s&&clean(s.I3?.v)==='订单号'&&clean(s.M3?.v)==='订单数量'&&clean(s.BF3?.v)==='包装入仓数量';}
export function detectHeader(book:XLSX.WorkBook,sheetName:string){
 const sheet=book.Sheets[sheetName];if(!sheet)return 1;
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',blankrows:true,range:0}).slice(0,50);
 let best=1,score=0;
 rows.forEach((row,i)=>{const headers=row.map(clean),mapped=suggestMapping(headers);const n=Object.values(mapped).filter(Boolean).length+(headers.includes('工序名称')?4:0)+(headers.includes('报工时间')?3:0)+(headers.includes('_明细编号')?4:0);if(n>score){best=i+1;score=n;}});
 return best;
}
export async function sha(value:string|ArrayBuffer){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
function rawCell(row:unknown[],headers:string[],name:string){const idx=headers.indexOf(name);if(idx<0)return '';return row[idx]??'';}
export async function previewOrders(s:State,m:Member,book:XLSX.WorkBook,sheetName:string,header:number,mapping:Record<string,string>,filename:string):Promise<PreviewRow[]>{
 const {headers,body,sheet}=sheetRows(book,sheetName,header);if(body.length>5000)throw new AppError('订单工作表最多 5000 条明细，系统会自动分批合并。');
 for(const key of ['orderNo','drawing','color','lens'])if(!mapping[key])throw new AppError(`请映射${fieldLabels[key]}。`);
 for(const h of Object.values(mapping).filter(Boolean))if(headers.filter(x=>x===h).length!==1)throw new AppError(`表头“${h}”重复或不存在，请更正映射。`);
 if(new Set(Object.values(mapping).filter(Boolean)).size!==Object.values(mapping).filter(Boolean).length)throw new AppError('同一列不能映射到多个字段。');
 const orders=all(s,'order') as Order[],result:PreviewRow[]=[];
 for(const row of body){try{
  const patch:Record<string,any>={};
  for(const [key] of fields){const h=mapping[key];if(!h)continue;const val=rawCell(row.values,headers,h);const cell=sheet[XLSX.utils.encode_cell({r:row.index-1,c:headers.indexOf(h)})];if(cell?.f)throw new Error(`${h}含公式，请先粘贴为值后导入。`);if(clean(val)!=='')patch[key]=normalizeField(key,val);}
  for(const key of ['orderNo','drawing','color','lens'])if(!patch[key]&&!clean(rawCell(row.values,headers,'_明细编号')))throw new Error(`${fieldLabels[key]}不能为空。`);
  const codes=['色号','L · 色号',...(headers.includes('_导出批次')?['圈色']:[])].filter(h=>headers.includes(h)).map(h=>clean(rawCell(row.values,headers,h))).filter(Boolean);if(new Set(codes).size>1)throw new Error('色号与旧版圈色/原表 L 色号不一致，请核对后保留正确的色号。');
  const rid=clean(rawCell(row.values,headers,'_明细编号')),exportId=clean(rawCell(row.values,headers,'_导出批次'));
  const matches=rid?orders.filter(o=>o.id===rid):orders.filter(o=>businessKey(o)===businessKey(patch));
  if(rid&&!matches.length)throw new Error('系统明细编号不存在，请核对来源。');if(matches.length>1)throw new Error('同键对应多条明细，请使用系统导出的明细编号消歧。');
  const before=matches[0];
  if(before&&!canRead(m,before))throw new Error('此明细不在你的授权范围内。');
  if(!before&&!broad(m)&&!(m.role==='sales'&&m.customers.includes(patch.customer)))throw new Error('新订单须由该客户的业务/客服、PMC 或管理员建立。');
  if(!before&&(!patch.customer||!Number.isInteger(patch.quantity)||patch.quantity<=0))throw new Error('新增明细必须有客户和大于零的订单数量。');
  if(patch.ownerEmail&&!all(s,'member').some(u=>u.email===patch.ownerEmail&&u.active))throw new Error('负责人邮箱尚未加入成员，请先添加成员或留空。');
  const baseExport=exportId?s.records.find(e=>e.id===exportId&&e.kind==='export'):undefined;
  const base=baseExport?.lines?.find((o:Order)=>o.id===before?.id);
  if(exportId&&!base)throw new Error('导出基线不存在或与明细不符，请重新导出。');
  if(before&&!broad(m)){const allowed=allowedFields(m,before);for(const k of Object.keys(patch))if(JSON.stringify(patch[k])!==JSON.stringify((base||before as any)[k])&&!allowed.includes(k))throw new Error(`你无权修改${fieldLabels[k]}。`);}
  const extras:Record<string,string>=Object.fromEntries(headers.map((h,i)=>[h,clean(row.values[i])]).filter(([h,v])=>h&&v&&!Object.values(mapping).includes(h)&&!h.startsWith('_')));
  let after:Order=before?{...before}:{id:newId('line'),kind:'order',version:0,createdAt:now(),updatedAt:now(),updatedBy:m.name,source:filename,orderNo:'',customer:'',customerPO:'',drawing:'',color:'',lens:'',batch:'',quantity:0,requestedDate:'',ownerEmail:m.role==='sales'?m.email:'',stage:'待下达',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'',sourceStatus:'待正式订单确认',workflowStatus:'业务待提交',extra:{}};
  let conflicts:string[]=[];
  if(before&&base){const merged=mergeFields(before,base,patch);after=merged.next;conflicts=merged.conflicts;for(const k of conflicts)(after as any)[k]=patch[k];}
  else{after={...after,...patch};if(before)conflicts=Object.keys(patch).filter(k=>JSON.stringify(patch[k])!==JSON.stringify((before as any)[k]));}
  if(broad(m)){after.extra={...after.extra};for(const [key,value] of Object.entries(extras)){if(base&&value===base.extra?.[key])continue;if(base&&before?.extra?.[key]!==base.extra?.[key]&&before?.extra?.[key]!==value&&!conflicts.includes('extra'))conflicts.push('extra');after.extra[key]=value;}}
  if(patch.promisedDate!==undefined&&patch.promisedDate!==(base||before)?.promisedDate&&after.promisedDate!==before?.promisedDate&&patch.promiseConfirmed!==true)after.promiseConfirmed=false;
  if(after.promiseConfirmed&&!after.promisedDate)throw new Error('确认交期前必须填写回复交期。');
  if(!broad(m)&&m.role!=='sales'&&after.promiseConfirmed!==before?.promiseConfirmed)throw new Error('交期确认须由 PMC、客服/销售或管理员操作。');
  const changes=[...fields.map(([k])=>k),'extra'].filter(k=>JSON.stringify((before as any)?.[k])!==JSON.stringify((after as any)[k]));
  result.push({index:row.index,status:!before?'new':!changes.length?'skip':conflicts.length?'conflict':'update',reason:conflicts.length?`需核对：${conflicts.map(k=>fieldLabels[k]||k).join('、')}${base?'（与导出后修改冲突）':'（原文件无可靠基线）'}`:'',before,after,changes,expectedVersion:before?.version||0});
 }catch(e){result.push({index:row.index,status:'error',reason:(e as Error).message});}}
 const byKey=new Map<string,PreviewRow[]>();for(const r of result)if(r.after){const key=businessKey(r.after);byKey.set(key,[...(byKey.get(key)||[]),r]);}
 for(const rows of byKey.values())if(rows.length>1&&!(rows.every(r=>r.before)&&new Set(rows.map(r=>r.after.id)).size===rows.length))for(const r of rows){r.status='error';r.reason='本文件存在相同订单/图纸/色号/镜片/批次，请补全交货批次或清除重复行。';}
 return result;
}
export async function previewReports(s:State,m:Member,book:XLSX.WorkBook,sheetName:string,header:number,lensMapping:Record<string,string>,filename:string):Promise<PreviewRow[]>{
 if(!broad(m))throw new AppError('仅 PMC 和管理员可导入 MES 报工。',403);
 const {headers,body,sheet}=sheetRows(book,sheetName,header);if(body.length>200)throw new AppError('单次最多导入 200 笔报工，请分批导出。');
 const official=headers.includes('工序名称');const needed=official?['开始时间','报工时间','工单号','工序编号','工序名称','生产任务号','产品','单位','产出良品数','生产批号','审批状态']:['报工编号','订单号','图纸编号','圈色','镜片类型','良品数','报工时间','审批状态'];
 for(const h of needed)if(headers.filter(v=>v===h).length!==1)throw new AppError(`MES 导出缺少或重复列：${h}`);
 const result:PreviewRow[]=[],reports=all(s,'report') as Report[];
 for(const row of body){try{
  const get=(h:string)=>clean(rawCell(row.values,headers,h));
  for(let c=0;c<headers.length;c++)if(sheet[XLSX.utils.encode_cell({r:row.index-1,c})]?.f)throw new Error('报工事实不能包含公式。');
  let orderNo=get('订单号'),drawing=get('图纸编号'),color=get('圈色'),lens=get('镜片类型'),process=get('工序名称')||'包装';
  if(official){const match=process.match(/^包装\(([^-]+)-(.+)-([^-]+)-([^-]+)\)$/);if(!match)throw new Error('此行不是可识别的包装工序，请导出包装明细。');if(!['副','付'].includes(get('单位')))throw new Error('数量单位必须为副或付。');orderNo=match[2];drawing=match[3];color=match[4].replace(/\(.*\)$/,'');lens=lensMapping[match[1]]||'';if(drawing.toUpperCase()!==get('产品').toUpperCase())throw new Error('工序与产品图号不一致。');}
  const reportedAt=strictDate(get('报工时间'),true),startedAt=official?strictDate(get('开始时间'),true):'',nativeId=get('报工编号');
  const identity=official?[get('工单号'),get('工序编号'),get('生产任务号'),get('生产批号'),startedAt,reportedAt]:[nativeId];
  if(identity.some(v=>!v))throw new Error('缺少稳定报工标识所需字段。');
  const id='mes_'+await sha(JSON.stringify(identity));const before=reports.find(r=>r.id===id);
  if(!before&&reports.some(r=>r.reportedAt===reportedAt&&r.workOrder===get('工单号')&&r.orderNo===orderNo&&r.drawing===drawing&&r.color===color&&r.identityType!==(official?'本地复合标识（非原生报工编号）':'MES 报工编号')))throw new Error('另一种导出格式中已有相同订单/工单/报工时间，请沿用原来源格式，避免同笔报工重复计数。');
  const candidates=lens?(all(s,'order') as Order[]).filter(o=>[o.orderNo,o.drawing,o.color,o.lens].map(v=>v.toUpperCase()).join('|')===[orderNo,drawing,color,lens].map(v=>v.toUpperCase()).join('|')):[];
  const after:Report={id,kind:'report',version:before?.version||0,lineId:before?.lineId||(candidates.length===1?candidates[0].id:''),orderNo,drawing,color,lens,workOrder:get('工单号'),task:get('生产任务号'),process,batch:get('生产批号'),startedAt,reportedAt,quantity:normalizeField('quantity',get(official?'产出良品数':'良品数')),approval:get('审批状态'),nativeId,identityType:official?'本地复合标识（非原生报工编号）':'MES 报工编号',source:filename,updatedAt:now(),updatedBy:m.name};
  if(!['审批完成','已审批','待审批','未审批','已撤销','已作废','已驳回','已反审核'].includes(after.approval))throw new Error('审批状态无法识别，请核对后按支持状态映射。');
  const compare=['lineId','quantity','approval','orderNo','drawing','color','lens','reportedAt'];const changes=compare.filter(k=>(before as any)?.[k]!== (after as any)[k]);
  result.push({index:row.index,status:!before?'new':!changes.length?'skip':'conflict',reason:before&&changes.length?'报工数量或状态有变，请核对更正/撤销来源。':!after.lineId?'未匹配：保留报工，关联明细后才计入包装数量。':'',before,after,changes,expectedVersion:before?.version||0});
 }catch(e){result.push({index:row.index,status:'error',reason:(e as Error).message});}}
 const ids=result.filter(r=>r.after).map(r=>r.after.id);for(const r of result)if(r.after&&ids.filter(id=>id===r.after.id).length>1){r.status='error';r.reason='文件中报工标识重复，无法区分，暂不导入。';}
 return result;
}
export function makeWorkbook(rows:Record<string,unknown>[],sheetName:string,columns?:string[]){
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows,{header:columns});sheet['!cols']=(columns||Object.keys(rows[0]||{})).map(k=>({wch:Math.min(36,Math.max(16,k.length*2))}));
 if(sheet['!ref'])sheet['!autofilter']={ref:sheet['!ref']};XLSX.utils.book_append_sheet(book,sheet,sheetName.slice(0,31));return XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
}
