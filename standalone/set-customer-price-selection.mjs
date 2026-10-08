// Reviewed per-customer invoice selection. Dry-run never loads the writable runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i++){const k=args[i];if(!['--build-dir','--config','--dry-run','--apply'].includes(k)||Object.hasOwn(options,k))throw new Error('Unknown or repeated option');if(['--apply','--dry-run'].includes(k))options[k]=true;else{const v=args[++i];if(!v||v.startsWith('--'))throw new Error('Missing option value');options[k]=v;}}
if(!options['--build-dir']||!options['--config']||options['--apply']&&options['--dry-run'])throw new Error('Usage: --build-dir <validated build> --config <private reviewed JSON> [--dry-run|--apply]');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const config=JSON.parse((await fs.readFile(options['--config'],'utf8')).replace(/^\uFEFF/,''));
if(!config.expectedCustomer||config.expectedCustomer.id!==config.customerAccountId||typeof config.expectedCustomer.customer!=='string'||typeof config.expectedCustomer.customerCode!=='string'||![null,'rx','solar','highest'].includes(config.invoicePreference)||!Number.isInteger(config.expectedVersion)||config.expectedVersion<0||!(config.expectedSelectionSha256===null||/^[a-f0-9]{64}$/.test(config.expectedSelectionSha256)))throw new Error('Supply exact stable customer metadata, invoicePreference, expectedVersion and expectedSelectionSha256');
const dataDir=path.resolve(process.env.DOON_DATA_DIR||'lan-data'),buildDir=path.resolve(options['--build-dir']),apply=!!options['--apply'];
let db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
try{
 const baseline=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),entities=baseline.map(r=>JSON.parse(r.data)),customer=entities.find(r=>r.kind==='customer_account'&&r.id===config.customerAccountId);
 if(!customer?.active||customer.customer!==config.expectedCustomer.customer||(customer.customerCode||'')!==config.expectedCustomer.customerCode)throw new Error('Reviewed customer identity differs or is inactive');
 const selections=entities.filter(r=>r.kind==='customer_price_selection'&&r.customerAccountId===customer.id);if(selections.length>1)throw new Error('Duplicate customer selection records');const before=selections[0]||null;
 if((before?.version||0)!==config.expectedVersion||(before?hash(before):null)!==config.expectedSelectionSha256)throw new Error('Expected selection version/hash differs; no rule replaced');
 const accounts=db.prepare('SELECT id,username,member_id FROM local_accounts ORDER BY id').all(),owners=entities.filter(r=>r.kind==='member'&&r.active&&r.owner&&r.role==='admin');
 if(owners.length!==1||!accounts.some(a=>a.member_id===owners[0].id&&a.id===owners[0].userId))throw new Error('Exactly one existing independently bound owner administrator is required');
 const report={mode:apply?'apply':'dry-run',expectedVersion:config.expectedVersion,expectedSelectionSha256:config.expectedSelectionSha256,invoicePreference:config.invoicePreference,preserved:false};
 if(apply){db.close();const runtime=await import(pathToFileURL(path.join(buildDir,'runtime.mjs'))),api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')));db=runtime.db;if(path.resolve(runtime.dataDir)!==dataDir)throw new Error('Runtime directory differs');const m=owners[0],payload=Object.fromEntries(['customerAccountId','invoicePreference','expectedVersion','expectedSelectionSha256'].map(k=>[k,config[k]])),req=new Request('http://localhost:8787/api/workspace/customer-price-selection-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),response=await runtime.context.run({identity:{userId:m.userId,email:m.email,displayName:m.name}},()=>api.POST(req,{params:Promise.resolve({action:'customer-price-selection-save'})})),result=await response.json();if(!response.ok)throw new Error('Selection API rejected update ('+response.status+'): '+(result.error||''));report.alreadyPresent=result.alreadyPresent;}
 const after=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),byId=new Map(after.map(r=>[r.id,r])),oldIds=new Set(baseline.map(r=>r.id));
 for(const old of baseline){const current=byId.get(old.id);if(!current||current.kind!==old.kind||old.data!==current.data&&(!apply||old.id!==before?.id))throw new Error('Unrelated record changed during selection maintenance');}
 for(const row of after.filter(r=>!oldIds.has(r.id))){const value=JSON.parse(row.data);if(!apply||!(row.kind==='customer_price_selection'&&value.customerAccountId===customer.id||row.kind==='audit'&&value.action==='设置客户 SKU 发票价格规则'&&value.after?.customerAccountId===customer.id))throw new Error('Unexpected selection-maintenance addition');}
 if(JSON.stringify(accounts)!==JSON.stringify(db.prepare('SELECT id,username,member_id FROM local_accounts ORDER BY id').all()))throw new Error('Local account identity metadata changed');report.preserved=true;console.log(JSON.stringify(report));
}finally{db.close();}
