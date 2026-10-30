// Synthetic browser acceptance only; never opens the live data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const dist=path.resolve('test-output/ar-workspace-build');
const dir=await fs.mkdtemp(path.resolve('test-output/ar-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const port=process.env.AR_QA_PORT||'18835';assert(/^1883[5-9]$/.test(port));
for(const name of Object.keys(process.env))if(/^DOON_KINGDEE_/i.test(name))delete process.env[name];
process.env.DOON_KINGDEE_SUPPLIER_SYNC_ENABLED='0';process.env.DOON_KINGDEE_READONLY_ENABLED='0';
process.env.DOON_DATA_DIR=dir;process.env.DOON_HOST='127.0.0.1';process.env.DOON_PORT=port;process.env.DOON_NO_AUTO_BACKUP='1';
const runtime=await import(pathToFileURL(path.join(dist,'runtime.mjs'))),auth=await import(pathToFileURL(path.join(dist,'auth.mjs')));
const acct=await auth.createAccount({username:'ar-qa',name:'合成验收业务',password:'Synthetic-AR-2026!',role:'admin'},null,{owner:true});
runtime.db.prepare('UPDATE local_accounts SET must_change=0 WHERE username=?').run('ar-qa');
const at=new Date().toISOString(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),past=new Date(Date.now()-7*86400000).toISOString().slice(0,10),c='ar-synthetic-customer',p='ar-synthetic-project',t='ar-synthetic-team';
const one=[{id:'one',label:'全额预收',percent:100,trigger:'issue',days:0}],bulk=[{id:'deposit',label:'订金',percent:30,trigger:'issue',days:0},{id:'balance',label:'尾款',percent:70,trigger:'after_shipment',days:30}];
runtime.saveRecords([
 {id:c,kind:'customer_account',customer:'合成验收客户',customerCode:'SYN-AR',salesName:'合成验收业务',serviceName:'',pmcName:'',salesMemberIds:[acct.memberId],serviceMemberIds:[],active:true,notes:'合成测试',version:1,createdAt:at,updatedAt:at,directory:{defaultPaymentTermId:'ar-synthetic-term'}},
 {id:t,kind:'customer_project_team',name:'合成一组',active:true,customerIds:[c],leaderIds:[acct.memberId],salesMemberIds:[acct.memberId],serviceMemberIds:[],version:1,createdAt:at,updatedAt:at},
 {id:p,kind:'customer_project',customerId:c,teamId:t,code:'SYN-PROJECT',title:'合成项目',status:'active',salesMemberId:acct.memberId,serviceMemberIds:[],serviceMemberId:'',version:1,createdAt:at,updatedAt:at},
 {id:'ar-synthetic-term',kind:'payment_term',familyId:'ar-synthetic-family',termVersion:1,version:2,status:'active',name:'合成 30/70 条件',bulk,sample:one,mold:one,note:'仅用于隔离浏览器验收',createdAt:at,createdById:acct.memberId,updatedAt:at,updatedById:acct.memberId,authorizedAt:at,authorizedById:acct.memberId},
 {id:'payment_term_authority_company',kind:'payment_term_authority',authorizerMemberIds:[acct.memberId],version:1,updatedAt:at,updatedById:acct.memberId,reason:'合成测试'},
 ...[['ar-synthetic-open',20000],['ar-synthetic-settled',10000]].map(([id,amountCents])=>({id,kind:'project_charge',customerId:c,projectId:p,roundId:'',attributionTeamId:t,title:id.includes('open')?'合成样办应收':'合成已结清应收',currency:'USD',category:'sample',amountCents,prepayCents:amountCents,dueDate:past,plan:[],status:'confirmed',version:1,createdAt:at,updatedAt:at})),
 {id:'ar-synthetic-receipt',kind:'project_receipt',customerId:c,projectId:p,attributionTeamId:t,currency:'USD',amountCents:15000,date:day,reference:'SYN-RECEIPT',account:'合成账户',createdAt:at},
 ...[['ar-synthetic-open',5000],['ar-synthetic-settled',10000]].map(([chargeId,amountCents],i)=>({id:'ar-synthetic-allocation-'+i,kind:'project_allocation',receiptId:'ar-synthetic-receipt',chargeId,customerId:c,projectId:p,attributionTeamId:t,currency:'USD',entryType:'allocate',amountCents,createdAt:at})),
 {id:'ar-synthetic-pi',kind:'project_billing_document',documentType:'PI',documentNo:'PI-SYN-001',customerId:c,projectId:p,currency:'USD',date:day,terms:'待业务审核',lines:[{title:'合成大货',projectId:p,amountCents:12345}],chargeIds:[],status:'draft',version:1,createdAt:at,createdById:acct.memberId},
 {id:'ar-synthetic-legacy',kind:'ar_legacy_pending',sourceSheet:'应收',sourceRow:2,customerLabel:'SYN-LEGACY',customerId:'',teamId:'',title:'INV-SYN',amountCents:15000,originalAmountDecimal:'150.00',paymentTermsRaw:'合成历史条件，待授权',currency:'USD',status:'pending',contributesToProductionBalance:false,issues:['所属组待核对','原凭证待核实'],createdAt:at}
]);
console.log(JSON.stringify({url:`http://127.0.0.1:${port}/ar-workspace`,synthetic:true,dataDirectory:dir}));
await import(pathToFileURL(path.join(dist,'server.mjs')));
