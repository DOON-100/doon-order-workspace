import type {WriteField,WriteSchema} from './write-input.js';
const str=(max=160,required=true):WriteField=>({type:'string',max,required}),arr=(max=300,required=true):WriteField=>({type:'array',required,max,items:str()}),bool:WriteField={type:'boolean',required:true},ver=(min=0,required=true):WriteField=>({type:'number',integer:true,min,required}),choice=(values:string[],required=true):WriteField=>({...str(),enum:values,required}),edit={id:str(160,false),version:ver(1,false)};
export const adminSaveSchemas:Record<string,WriteSchema>={
 member:{id:str(160,false),expectedSha256:{...str(64),nullable:true},name:str(100),email:str(240),role:choice(['admin','pmc','production','clerk','sales','finance','programmer','viewer','supplier']),personnelType:choice(['internal','external'],false),supplierId:str(160,false),orderScope:choice(['all','assigned'],false),customers:{...arr(1000),items:str(100)},departments:{...arr(9),items:choice(['pmc','titanium','outsourcing','plating','semifinished','plastic','finished','engineering','engineering_review'])},active:bool},
 team:{...edit,name:str(),leaderIds:arr(),salesMemberIds:arr(),serviceMemberIds:arr(),customerIds:arr(),active:bool},
 'project-roster':{...edit,serviceFollowerIds:arr(),salesReviewerIds:arr()},
 'ar-grant':{...edit,memberId:str(),scopeType:choice(['company','team']),teamIds:arr(100),capabilities:{...arr(2),min:1,items:choice(['read','export'])},readOnly:bool,active:bool,reason:str(1000)},
 'project-finance-grant':{...edit,memberId:str(),customerIds:arr(),active:bool},
 'payment-authorizers':{version:ver(),authorizerMemberIds:arr(100),reason:str(3000)},
 'ie-policy':{version:ver(),engineerMemberId:str(120),reviewerMemberId:str(120),finalApproverMemberId:str(120)},
 'quote-policy':{expectedPolicySha256:{...str(64),nullable:true},memberIds:arr(1000),aliasesByMember:{type:'json',required:true},administratorMemberIds:arr(1000,false),internalMemberIds:arr(1000,false),writableMemberIds:arr(1000,false),customerMemberIds:{type:'json',required:false}},
 'drawing-policy':{expectedVersion:ver(),drawingLeadMemberId:str(),engineeringSupervisorMemberId:str()},
 'framework-config':{type:choice(['agent','method','flow','template']),key:str(),expectedVersion:ver(),ownerId:str(),modelMode:choice(['待选择','共用公司模型','独立模型']),modelName:str(),extraRules:str(12000),templateLocation:str(2000),integrationNotes:str(6000)},
 'service-location':{expectedVersion:ver(),drawingRoot:str(3000),quoteRoot:str(3000),leadDays:{...ver(1),max:90}},
};
export const adminActionSchemas:Record<string,WriteSchema>={
 'offboarding-draft':{id:str(160,false),expectedVersion:ver(),memberId:str(),reason:str(3000),assignments:{type:'array',required:true,max:30000,items:{type:'object',properties:{key:str(800),recipientId:str()}}}},
 'offboarding-accept':{id:str(),expectedVersion:ver(1),keys:{...arr(30000),min:1,items:str(800)},note:str(3000)},
 'offboarding-cancel':{id:str(),expectedVersion:ver(1),reason:str(3000)},
 'offboarding-finalize':{id:str(),expectedVersion:ver(1),reason:str(3000)},
};
export const adminRoutes={member:'/api/workspace/admin-member-save',team:'/api/workspace/customer-project-team-save','project-roster':'/api/workspace/customer-project-assignment-roster-save','ar-grant':'/api/workspace/ar-access-grant-save','project-finance-grant':'/api/workspace/project-finance-grant-save','payment-authorizers':'/api/workspace/payment-terms-authorizers-save','ie-policy':'/api/workspace/ie-quote-policy','quote-policy':'/api/workspace/customer-quote-access-update','drawing-policy':'/api/workspace/handoff-business-review-policy','framework-config':'/api/workspace/framework-config-save','service-location':'/api/workspace/handoff-business-service-config','offboarding-draft':'/api/workspace/framework-offboarding-draft','offboarding-accept':'/api/workspace/framework-offboarding-accept','offboarding-cancel':'/api/workspace/framework-offboarding-cancel','offboarding-finalize':'/api/workspace/framework-offboarding-finalize'} as const;
