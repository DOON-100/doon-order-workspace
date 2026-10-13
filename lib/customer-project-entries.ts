import {z} from 'zod';
import {all,canRead,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {sha} from './workbooks';
import {projectAccess,projectKey,type CustomerProject} from './customer-projects';
import {serviceOrderCustomerKeys} from './service-workspace';
import {canReadCustomerQuote,type CustomerQuote} from './customer-quotes';

// Independent entries use the existing project entities. Optional relationships
// are checked when supplied; saving an entry never releases production or money.
const text=z.string().trim(),id=text.min(1).max(160),ref=text.max(160),number=z.number().finite().nonnegative(),ids=z.array(id);
const optionalAmount=z.union([z.string(),z.number()]).transform(value=>typeof value==='string'&&!value.trim()?0:Number(value)).pipe(number);
const choice=<T extends string>(options:[T,...T[]],fallback:T)=>z.preprocess(value=>value===''?fallback:value,z.enum(options));
const day=text.refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'日期须为有效 YYYY-MM-DD');
const scope=z.array(z.object({itemId:ref.default(''),quantity:number.default(0)}).strict());
const orderLinks=z.array(z.object({itemId:ref.default(''),orderId:ref.default(''),quantity:number.default(0),orderVersion:z.number().int().nonnegative().optional()}).strict());
const fields={
 item:{model:text,customerModel:text,drawing:text,color:text,lens:text,material:text,requirements:text,quantity:number},
 round:{title:text,type:choice(['development','revision','sales_sample','preproduction','bulk'],'development'),parentRoundId:ref,scope,stage:text,requiredDrawingTypes:z.array(z.enum(['2d','3d'])),requireQuote:z.boolean(),requiredSampleIds:ids,sampleGateStage:choice(['order','before_production','not_required'],'not_required'),sampleGateNote:text,dueDate:day,reason:text,status:choice(['open','partial','transferred','cancelled'],'open')},
 communication:{channel:text,contact:text,occurredAt:day,content:text,nextAction:text,ownerId:ref,dueDate:day,visibility:choice(['internal','customer'],'internal'),attachmentIds:ids},
 task:{title:text,description:text,ownerId:ref,serviceReviewerId:ref,salesReviewerId:ref,waitingFor:text,dueDate:day,status:choice(['open','service_review','sales_review','returned','done','cancelled'],'open'),result:text,changeReason:text},
 drawing:{itemIds:ids,type:choice(['customer','2d','3d','artwork','packing'],'2d'),drawingNo:text,revision:text,previousId:ref,pairedDrawingId:ref,attachmentIds:ids,changeNote:text,status:choice(['submitted','withdrawn'],'submitted')},
 confirmation:{drawingId:ref,itemIds:ids,decision:choice(['','approved','conditional','rejected'],''),contact:text,date:day,evidence:text,conditions:text,attachmentIds:ids},
 quote:{quoteId:ref,quoteVersion:z.number().int().nonnegative(),quoteNo:text,itemIds:ids,lineIds:ids,acceptedBy:text,acceptedDate:day,evidence:text,title:text,currency:text,amount:optionalAmount,cost:z.union([text,z.number().finite()]).transform(String),note:text},
 sample:{sampleNo:text,purpose:choice(['development','revision','color','sales_sample','preproduction'],'development'),scope,drawingIds:ids,quoteLinkId:ref,ownerId:ref,requiredDate:day,plannedDate:day,promisedDate:day,promiseNote:text,status:choice(['pending','accepted','making','qc','ready','closed','cancelled'],'pending'),note:text},
 dispatch:{sampleId:ref,lines:scope,carrier:text,trackingNo:text,recipient:text,address:text,shipDate:day,receivedDate:day,note:text,attachmentIds:ids},
 feedback:{sampleId:ref,itemId:ref,decision:choice(['','approved','conditional','revise','rejected'],''),contact:text,date:day,evidence:text,note:text,attachmentIds:ids},
 handover:{type:choice(['sample','bulk'],'bulk'),title:text,scope,sampleId:ref,orderLinks,drawingIds:ids,quoteLinkId:ref,orderNo:text,quantity:number,note:text},
 attachment:{filename:text,note:text},
};
export type CustomerProjectEntryType=keyof typeof fields;
const kindFor:Record<CustomerProjectEntryType,string>={item:'customer_project_item',round:'customer_project_round',communication:'customer_project_communication',task:'customer_project_task',drawing:'customer_project_drawing',confirmation:'customer_project_confirmation',quote:'customer_project_quote_link',sample:'customer_project_sample',dispatch:'customer_project_dispatch',feedback:'customer_project_feedback',handover:'customer_project_handover',attachment:'customer_project_attachment'};
const common={entryType:z.enum(Object.keys(fields) as [CustomerProjectEntryType,...CustomerProjectEntryType[]]),token:z.string().uuid(),projectId:id,roundId:ref.optional(),id:id.optional(),version:z.number().int().positive().optional()};
const defaults:Record<CustomerProjectEntryType,Record<string,any>>={
 item:{model:'未命名款色',customerModel:'',drawing:'',color:'',lens:'',material:'',requirements:'',quantity:0},
 round:{title:'未命名轮次',type:'development',parentRoundId:'',scope:[],stage:'',requiredDrawingTypes:[],requireQuote:false,requiredSampleIds:[],sampleGateStage:'not_required',sampleGateNote:'',dueDate:'',reason:'',status:'open'},
 communication:{channel:'',contact:'',occurredAt:'',content:'',nextAction:'',ownerId:'',dueDate:'',visibility:'internal',attachmentIds:[]},
 task:{title:'未命名待办',description:'',ownerId:'',serviceReviewerId:'',salesReviewerId:'',waitingFor:'',dueDate:'',status:'open',result:''},
 drawing:{itemIds:[],type:'2d',drawingNo:'未命名图纸',revision:'',previousId:'',pairedDrawingId:'',attachmentIds:[],changeNote:'',status:'submitted'},
 confirmation:{drawingId:'',itemIds:[],decision:'',contact:'',date:'',evidence:'',conditions:'',attachmentIds:[]},
 quote:{quoteId:'',quoteVersion:0,quoteNo:'',itemIds:[],lineIds:[],acceptedBy:'',acceptedDate:'',evidence:'',title:'未命名报价',currency:'',amount:0,cost:'',note:''},
 sample:{sampleNo:'',purpose:'development',scope:[],drawingIds:[],quoteLinkId:'',ownerId:'',requiredDate:'',plannedDate:'',promisedDate:'',promiseNote:'',status:'pending',note:'',itemSnapshot:[],paymentSnapshot:null},
 dispatch:{sampleId:'',lines:[],carrier:'',trackingNo:'',recipient:'',address:'',shipDate:'',receivedDate:'',note:'',attachmentIds:[]},
 feedback:{sampleId:'',itemId:'',decision:'',contact:'',date:'',evidence:'',note:'',attachmentIds:[]},
 handover:{type:'bulk',title:'未命名交接',scope:[],sampleId:'',orderLinks:[],drawingIds:[],quoteLinkId:'',orderNo:'',quantity:0,note:'',paymentSnapshot:null},
 attachment:{filename:'未命名资料',note:'',contentType:'application/octet-stream',size:0,hash:'',fileKey:''},
};
export function projectEntryPublic(row:Entity){const {fileKey,requestFingerprint,paymentSnapshot,executionSnapshot,...safe}=row;return row.kind==='customer_project_sample'?((({quoteLinkId,...sample})=>sample)(safe)):safe;}
function quoteReadable(s:State,m:Member,row:Entity){if(!row.quoteId)return true;const quote=all(s,'customer_quote').find(q=>q.id===row.quoteId) as CustomerQuote|undefined;return !!quote&&canReadCustomerQuote(s,m,quote);}
function projectReference(s:State,p:CustomerProject,kind:string,recordId:string){if(!recordId)return;const found=all(s,kind).find(row=>row.id===recordId&&row.projectId===p.id&&row.customerId===p.customerId);if(!found)throw new AppError('关联记录不存在或不属于当前客户项目。');return found;}
function validateReferences(s:State,m:Member,p:CustomerProject,item:Entity,before?:Entity){
 if(item.kind==='customer_project_attachment'&&item.category==='original-communication'&&item.roundId)throw new AppError('原始沟通文档保存在项目级，不能关联开发轮次。');
 projectReference(s,p,'customer_project_round',item.roundId||'');
 projectReference(s,p,'customer_project_round',item.parentRoundId||'');
 if(item.kind==='customer_project_round'&&item.parentRoundId===item.id)throw new AppError('源轮次不能是当前轮次。');
 for(const itemId of [...(item.itemIds||[]),...(item.scope||[]).map((line:any)=>line.itemId),...(item.lines||[]).map((line:any)=>line.itemId),item.itemId||''])projectReference(s,p,'customer_project_item',itemId);
 for(const attachmentId of item.attachmentIds||[])projectReference(s,p,'customer_project_attachment',attachmentId);
 for(const drawingId of [...(item.drawingIds||[]),item.drawingId||'',item.previousId||'',item.pairedDrawingId||''])projectReference(s,p,'customer_project_drawing',drawingId);
 for(const sampleId of [...(item.requiredSampleIds||[]),item.sampleId||''])projectReference(s,p,'customer_project_sample',sampleId);
 const linkedQuote=projectReference(s,p,'customer_project_quote_link',item.quoteLinkId||'');if(linkedQuote&&item.quoteLinkId!==before?.quoteLinkId&&!quoteReadable(s,m,linkedQuote))throw new AppError('没有关联报价的读取权限。',403);
 for(const memberId of [item.ownerId,item.serviceReviewerId,item.salesReviewerId].filter(Boolean))if(!all(s,'member').some(member=>member.id===memberId&&member.active&&member.role!=='supplier'))throw new AppError('关联成员不存在或已停用。');
 if(item.quoteId){
  const quote=all(s,'customer_quote').find(row=>row.id===item.quoteId&&row.customerAccountId===p.customerId) as CustomerQuote|undefined;if(!quote||!canReadCustomerQuote(s,m,quote))throw new AppError('报价不属于当前客户或没有读取权限。',403);
  const version=item.quoteVersion?quote.version===item.quoteVersion?quote:all(s,'customer_quote_revision').find(row=>row.quoteId===quote.id&&row.snapshot?.version===item.quoteVersion&&row.snapshot?.customerAccountId===p.customerId)?.snapshot:quote;
  if(!version)throw new AppError('关联报价版本不存在。');
  if((item.lineIds||[]).some((lineId:string)=>!version.lines.some((line:any)=>line.id===lineId)))throw new AppError('关联报价行不属于选定版本。');
 }else if((item.lineIds||[]).length)throw new AppError('关联报价行须属于已选择的报价。');
 const customer=projectAccess(s,m,p.customerId).customer!,keys=serviceOrderCustomerKeys(s,customer).map(projectKey);
 for(const link of item.orderLinks||[]){projectReference(s,p,'customer_project_item',link.itemId);if(link.orderId){const order=all(s,'order').find(row=>row.id===link.orderId);if(!order||!canRead(m,order as any)||!keys.includes(projectKey(order.customer)))throw new AppError('关联订单不属于当前客户或没有读取权限。',403);}}
}

export async function saveCustomerProjectEntry(req:Request,s:State,m:Member){
 const raw=await req.json(),base=z.object(common).passthrough().safeParse(raw);if(!base.success)throw new AppError(base.error.issues.slice(0,4).map(issue=>issue.path.join('.')+'：'+issue.message).join('；'));
 const entryType=base.data.entryType,schema=z.object({...common,...Object.fromEntries(Object.entries(fields[entryType]).map(([key,value])=>[key,value.optional()]))}).strict(),parsed=schema.safeParse(raw);
 if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(issue=>issue.path.join('.')+'：'+issue.message).join('；'));
 const input:any=parsed.data,p=all(s,'customer_project').find(row=>row.id===input.projectId) as CustomerProject|undefined;
 if(!p||!projectAccess(s,m,p.customerId).write)throw new AppError('项目不存在或不在你负责的客户范围内。',403);
 const kind=kindFor[entryType],before=input.id?all(s,kind).find(row=>row.id===input.id):undefined;
 if(input.id&&(!before||before.projectId!==p.id||before.customerId!==p.customerId))throw new AppError('记录不存在或不属于当前客户项目。',403);
 if(before?.kind==='customer_project_quote_link'&&!quoteReadable(s,m,before))throw new AppError('没有当前报价的读取权限。',403);
 const action='customer-project-entry-save',hash=await sha(JSON.stringify({action,input})),requestId='customer_project_request_'+input.token,prior=all(s,'customer_project_request').find(row=>row.id===requestId);
 if(prior){if(prior.actorId!==m.id||prior.action!==action||prior.hash!==hash)throw new AppError('请求编号已用于其他内容，请刷新核对。',409);const found=all(s,kind).find(row=>row.id===prior.resultId&&row.projectId===p.id&&row.customerId===p.customerId);if(!found)throw new AppError('原操作结果不存在。',409);if(kind==='customer_project_quote_link'&&!quoteReadable(s,m,found))throw new AppError('当前报价授权已变更。',403);return json({ok:true,item:projectEntryPublic(found),idempotent:true});}
 if(before&&before.version!==input.version)throw new AppError('记录已更新，请刷新后重试；旧版本未覆盖。',409);
 if(!before&&input.version)throw new AppError('新增记录不能带已有版本。');
 const {entryType:_,token:__,id:___,version:____,projectId:_____,changeReason,...values}=input;
 const item:Entity={...structuredClone(defaults[entryType]),roundId:'',...before,...values,id:before?.id||newId(kind),kind,projectId:p.id,customerId:p.customerId,independentEntry:before?.independentEntry??!before,version:(before?.version||0)+1,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};
 const names:Partial<Record<CustomerProjectEntryType,string>>={item:'model',round:'title',task:'title',drawing:'drawingNo',quote:'title',handover:'title',attachment:'filename'};const name=names[entryType];if(name&&!item[name])item[name]=defaults[entryType][name];
 if(entryType==='sample'&&!item.sampleNo)item.sampleNo='SP-'+item.id.slice(-8).toUpperCase();
 if(entryType==='task'){item.reviewCycle=before?.reviewCycle||0;item.reviewHistory=[...(before?.reviewHistory||[]),{id:newId('customer_project_task_event'),action:'reconfigure',stage:'configuration',actorId:m.id,actorName:m.name,at:now(),comment:changeReason||'独立登记或修改待办资料。',cycle:item.reviewCycle}];}
 if(entryType==='handover'&&before&&!before.independentEntry&&!before.executionSnapshot){const {executionSnapshot,...original}=before;item.executionSnapshot=structuredClone(original);}
 validateReferences(s,m,p,item,before);
 const safe=projectEntryPublic(item),updates=[item,audit(m,item,before?projectEntryPublic(before):null,'客户项目 · 独立登记保存','客户项目',safe),{id:requestId,kind:'customer_project_request',projectId:p.id,customerId:p.customerId,action,actorId:m.id,hash,resultId:item.id,createdAt:now()}];
 await commit(s.revision,updates);return json({ok:true,item:safe});
}
