import {z} from 'zod';
import type {Entity} from './domain';

export const customerStages=['待核实','新建','研究中','需求了解','可行性','报价','打样','样品反馈','商务确认','合作中','暂缓'] as const;
export const customerTypes=['待确认','OEM','ODM','White Label'] as const;
export const customerSources=['收到询盘','主动开发','其他','移交表快照'] as const;
export const customerOrderHistories=['待核实','从未下单','有历史订单'] as const;
export const customerFollowupChannels=['邮件','孚盟（历史）','WhatsApp Business','个人微信','会议','电话','其他'] as const;
export const customerFileCategories=['NDA 原件','长期合作协议','公司资料','银行资料证明','固定地址资料','其他客户通用正式附件'] as const;
export const projectFolders=['00_项目资料.md','01_询单','02_样办','03_图纸','04_工程报价','05_销售报价','06_订单_PI','07_付款','08_生产','09_出货','10_沟通','11_品质','99_旧版本'] as const;
export const projectFileTypes:Record<string,string[]>={
 '06_订单_PI':['客户正式订单或 PO','订单确认','PI'],
 '07_付款':['定金通知','尾款单','尾款通知','付款申请','客户付款凭证','财务到账资料','对账单','Credit Note','Debit Note','国内税务发票'],
 '08_生产':['生产单','生产进度资料','生产出货单'],
 '09_出货':['Packing List','Commercial Invoice','运单','箱唛','出货照片','签收证明'],
 '10_沟通':['重要邮件 PDF 或 EML','电话沟通记录','线上会议纪要','客户来访资料','价格、交期、品质、扣款或订单变更的重要确认'],
 '11_品质':['品质报告','检验资料','客户投诉图片和视频','问题分析','改善方案','补货或返工资料','品质相关扣款资料'],
};
export const workflowToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function validWorkflowDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export const workflowDate=z.string().max(10).refine(value=>!value||validWorkflowDate(value),'请填写有效的 YYYY-MM-DD 日期');
const historicalDate=workflowDate.refine(value=>!value||value<=workflowToday(),'历史日期不能晚于今天');
const short=z.string().trim().max(300),long=z.string().max(12000);
export const customerProfileSchema=z.object({
 legalName:short.optional(),shortName:short.optional(),website:short.optional(),brandIntroduction:long.optional(),backgroundResearch:long.optional(),
 contactPerson:short.optional(),contactTitle:short.optional(),phone:short.optional(),email:z.string().trim().max(300).refine(value=>!value||z.string().email().safeParse(value).success,'邮箱格式不正确').optional(),whatsapp:short.optional(),wechat:short.optional(),contacts:long.optional(),
 companyAddress:long.optional(),billingAddress:long.optional(),shippingAddress:long.optional(),
 bankPaymentInfo:long.optional(),defaultPaymentMethod:short.optional(),defaultTradeTerms:short.optional(),courierAccount:long.optional(),
 ndaStatus:z.enum(['待核实','未签署','签署中','已签署','不适用']).optional(),packagingRequirements:long.optional(),documentRequirements:long.optional(),longTermNotes:long.optional(),
 type:z.enum(customerTypes).optional(),source:z.enum(customerSources).optional(),stage:z.enum(customerStages).optional(),
 orderHistory:z.enum(customerOrderHistories).optional(),firstListedOn:historicalDate.optional(),lastOrderOn:historicalDate.optional(),
}).strict();
export type CustomerProfileData=z.infer<typeof customerProfileSchema>;
export type ProfileField={key:keyof CustomerProfileData;label:string;type?:'textarea'|'email'|'date';options?:readonly string[];sensitive?:boolean};
export const customerContactFields:ProfileField[]=[{key:'contactPerson',label:'联系人'},{key:'whatsapp',label:'WhatsApp'},{key:'wechat',label:'WeChat'},{key:'email',label:'Email',type:'email'},{key:'website',label:'Website'},{key:'phone',label:'电话 / 其他即时通讯'},{key:'contacts',label:'其他联系方式 / 原表记录',type:'textarea'}];
export const customerGeneralGroups:{title:string;fields:ProfileField[]}[]=[
 {title:'公司资料与背景',fields:[{key:'legalName',label:'客户公司法定名称'},{key:'shortName',label:'客户简称'},{key:'website',label:'网站'},{key:'brandIntroduction',label:'品牌介绍与定位',type:'textarea'},{key:'backgroundResearch',label:'背景调查',type:'textarea'}]},
 {title:'主要联系人与地址',fields:[{key:'contactPerson',label:'主要联系人'},{key:'contactTitle',label:'职位'},{key:'phone',label:'电话'},{key:'email',label:'邮箱',type:'email'},{key:'whatsapp',label:'WhatsApp'},{key:'wechat',label:'WeChat'},{key:'companyAddress',label:'公司地址',type:'textarea'},{key:'billingAddress',label:'Billing Address',type:'textarea'},{key:'shippingAddress',label:'Shipping Address',type:'textarea'}]},
 {title:'付款与贸易',fields:[{key:'bankPaymentInfo',label:'银行及付款资料',type:'textarea',sensitive:true},{key:'defaultPaymentMethod',label:'默认付款方式'},{key:'defaultTradeTerms',label:'默认贸易条款'},{key:'courierAccount',label:'快递账号',type:'textarea'}]},
 {title:'NDA 与长期要求',fields:[{key:'ndaStatus',label:'NDA 状态',options:['待核实','未签署','签署中','已签署','不适用']},{key:'packagingRequirements',label:'通用包装要求',type:'textarea'},{key:'documentRequirements',label:'通用文件要求',type:'textarea'},{key:'longTermNotes',label:'其他长期有效信息',type:'textarea'}]},
];
export const customerBusinessFields:ProfileField[]=[{key:'type',label:'客户类型',options:customerTypes},{key:'source',label:'来源',options:customerSources},{key:'stage',label:'当前阶段',options:customerStages},{key:'orderHistory',label:'历史订单情况',options:customerOrderHistories},{key:'firstListedOn',label:'首次进入正式清单日期',type:'date'},{key:'lastOrderOn',label:'最后正式订单日期',type:'date'}];
export type CustomerWorkflowProfile=Entity&{kind:'customer_workflow_profile';customerId:string;version:number;fields:CustomerProfileData;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
export type CustomerWorkflowState=Entity&{kind:'customer_workflow_state';customerId:string;version:number;next:string;nextDate:string;followState:'待安排'|'已安排'|'暂停';latestFollowupOn:string;updatedAt:string;updatedBy:string};
export type CustomerWorkflowFollowup=Entity&{kind:'customer_workflow_followup';customerId:string;at:string;authorId:string;author:string;channel:string;content:string;result:string;disposition:'继续跟进'|'暂停跟进';next:string;nextDate:string;evidence:string;createdAt:string};
export function customerReminder(state:Pick<CustomerWorkflowState,'nextDate'|'followState'>|null,today=workflowToday()){
 if(state?.followState==='暂停')return '已暂停';if(!state?.nextDate)return '待安排';return state.nextDate<today?'已逾期':state.nextDate===today?'今日跟进':'已安排';
}
export function customerPoolEligibility(profile:CustomerProfileData,today=workflowToday()){
 if(!['有历史订单','从未下单'].includes(profile.orderHistory||''))return {eligible:false,status:'待补订单情况',basis:'',start:'',due:''};
 const basis=profile.orderHistory==='有历史订单'?'最后正式订单日期':'首次进入正式清单日期',start=(profile.orderHistory==='有历史订单'?profile.lastOrderOn:profile.firstListedOn)||'';
 if(!validWorkflowDate(start)||start>today)return {eligible:false,status:'待补'+basis,basis,start,due:''};
 const [year,month,day]=start.split('-').map(Number),last=new Date(Date.UTC(year+2,month,0)).getUTCDate(),due=`${year+2}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
 return {eligible:due<=today,status:due<=today?'两年未下单 · 待确认':'未到两年',basis,start,due};
}
export const workflowId=z.string().trim().min(1).max(160);
export const workflowToken=z.string().uuid();
export const workflowVersion=z.number().int().min(0);
export const customerWorkflowSchemas={
 profile:z.object({token:workflowToken,customerId:workflowId,version:workflowVersion,patch:customerProfileSchema}).strict(),
 followup:z.object({token:workflowToken,customerId:workflowId,version:workflowVersion,at:historicalDate.refine(Boolean,'请填写跟进日期'),channel:z.enum(customerFollowupChannels),content:long.refine(value=>!!value.trim(),'请填写沟通内容'),result:long.refine(value=>!!value.trim(),'请填写跟进结果或暂停原因'),disposition:z.enum(['继续跟进','暂停跟进']),next:short,nextDate:workflowDate,evidence:long}).strict().superRefine((value,ctx)=>{
  if(value.disposition==='继续跟进'&&!value.next.trim())ctx.addIssue({code:z.ZodIssueCode.custom,path:['next'],message:'继续跟进时请填写下一步'});
  if(value.disposition==='继续跟进'&&value.nextDate&&value.nextDate<value.at)ctx.addIssue({code:z.ZodIssueCode.custom,path:['nextDate'],message:'下次跟进日期不能早于本次日期'});
 }),
 schedule:z.object({token:workflowToken,customerId:workflowId,version:workflowVersion,next:short.refine(value=>!!value,'请填写下一步'),nextDate:workflowDate.refine(Boolean,'请填写下次日期')}).strict(),
};
