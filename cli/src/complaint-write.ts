import {StateStore} from './state.js';import {ProcessRecordService} from './process-write.js';
const semantics='已完成、关口通过或内部回访完成均不等同客户已确认；客户确认只如实显示customerConfirmation原证据，无内容保持未知。投诉流程不自动退款、补发、关闭售后或发送消息。';
export class ComplaintWriteService{
 private process:ProcessRecordService;
 constructor(store:StateStore,transport:typeof fetch=fetch){this.process=new ProcessRecordService(store,transport);}
 private summary(record:any){const evidence=typeof record.details?.customerConfirmation==='string'?record.details.customerConfirmation:'';return {state:evidence.trim()?'recorded':'unknown',evidence,semantics:'recorded只表示有原文字段，仍须人工核对；不推断同意或拒绝'};}
 schema(){return {...this.process.schema('complaint'),semantics,associations:{customerId:'服务端校验的真实客户关联',orderId:'服务端校验的真实订单关联',projectId:'本表没有机器关联字段；请用现有项目查询核对后在inputBasis/documentRef/notes记原引用',afterSaleId:'本表没有机器关联字段；不得把文字引用当作已关联项目售后或退款'},existingFollowupCommands:['sales customers followup-add','sales customers schedule-set','sales followups create','sales followups update'],unknown:'客户确认等文字字段显式留空；按键增量保存，--replace-details明确整对象替换，不猜测补齐'};}
 async form(id:string,team?:string){const data=await this.process.form('complaint',id,team);return {...data,customerConfirmation:this.summary(data.record),semantics};}
 async references(options:{team?:string;limit?:string;offset?:string}={}){const data=await this.process.references('complaint',options);return {...data,associations:this.schema().associations,followupSemantics:'W1客户工作流跟进只关联customerId；W1项目跟进可机器关联customerId/projectId，但没有complaintId/orderId/afterSaleId。文字记录引用须保留原ID、版本及来源，不能宣称接口已建立新关联'};}
 async history(id:string,options:{team?:string;limit?:string;offset?:string}={}){const data=await this.process.history('complaint',id,options);return {...data,page:{...data.page,rows:data.page.rows.map((row:any)=>({...row,customerConfirmation:this.summary(row.record)}))},semantics};}
 async save(file:string,version:string,requestId:string,team?:string,replaceDetails=false){const data=await this.process.save('complaint',file,version,requestId,team,replaceDetails);return {...data,customerConfirmation:this.summary(data.record),semantics};}
}
