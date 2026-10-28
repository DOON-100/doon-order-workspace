import type {WriteField,WriteSchema} from './write-input.js';
const text=(max=3000,required=false,min=0):WriteField=>({type:'string',max,required,min}),id=text(160,true,1),version:WriteField={type:'number',integer:true,min:0,required:true},positive={...version,min:1},hash={...text(64,true,64)},ids:WriteField={type:'array',items:id,max:100},selection:WriteField={type:'array',required:true,min:1,max:500,items:{type:'object',properties:{id,version:positive}}};
export const workspaceSchemas:Record<string,WriteSchema>={
 comment:{lineId:id,orderVersion:positive,text:text(3000,true,1),dueDate:text(10)},task:{id,expectedVersion:version,expectedHash:hash,done:{type:'boolean',required:true}},
 owner:{orders:selection,email:text(254,true,1)},'owner-assign':{orders:selection,email:text(254,true,1),previewHash:hash},
 'orders-preview':{sheet:text(200),header:{type:'number',integer:true,min:1,max:1048576},mapping:{type:'json'}},
 'orders-commit':{id,selected:{type:'array',required:true,min:1,max:5000,items:{type:'number',integer:true,min:0}},reason:text(1000),offset:version,sourceHash:hash},
 'ledger-preview':{mode:{type:'string',required:true,enum:['active','archived']}},'ledger-commit':{id,offset:version,sourceHash:hash,rowsHash:hash},
 report:{type:{type:'string',required:true,enum:['working','summary','customer','completion','progress']},filters:{type:'object',properties:Object.fromEntries(['q','customer','owner','mine','status','from','to','businessTeamId'].map(k=>[k,text(200)]))}},
 'finance-task':{id:{...id,required:false},expectedVersion:version,customerId:id,orderId:id,type:{type:'string',required:true,enum:['收款核对','对账','退款核对']},recipientId:id,due:text(10,true,10),body:text(12000,true,1),evidence:text(12000,true),sourceRequestId:text(160)},
 'finance-action':{id,expectedVersion:version,note:text(12000,true,1)},'finance-return':{id,expectedVersion:version,note:text(12000,true,1),path:text(2000,true,1)},
 'fixed-workbook':{requestKey:text(120,true,8),operation:{type:'string',required:true,enum:['inspect','rows']},sheet:text(200),range:text(40),headerRow:{type:'number',integer:true,min:0,max:1048576},includeEmpty:{type:'boolean'}},
 'fixed-ownership':{requestKey:text(120,true,8),customerIds:{...ids,required:true,min:1},memberIds:ids},
 'fixed-fees':{requestKey:text(120,true,8),quoteId:text(100,true,1),version:positive,lines:{type:'array',required:true,min:1,max:200,items:{type:'object',properties:{id:text(100,true,1),toolingFee:{type:'number',nullable:true,required:true,min:0,max:1e9}}}},customerCharges:{type:'array',required:true,max:50,items:{type:'object',properties:{id:text(100,true,1),amount:{type:'number',nullable:true,required:true,min:0,max:1e9}}}}},
 'fixed-decision':{id,previewHash:hash,decision:{type:'string',required:true,enum:['approve','reject','defer']}},
};
