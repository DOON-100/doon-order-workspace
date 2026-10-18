import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=path.resolve(process.env.DOON_DATA_DIR||''),marker=JSON.parse(await fs.readFile(path.join(dir,'autonomy-sandbox.json'),'utf8'));
if(marker.kind!=='doon-autonomy-synthetic-v1'||process.env.DOON_SYNTHETIC_ONLY!=='1')throw Error('只允许初始化独立合成验证目录');
const {db}=await import(pathToFileURL(path.join(process.env.DOON_BUILD_DIR,'runtime.mjs')).href);
try{
 const id='SYN-PURCHASE-001',old=db.prepare('SELECT data FROM records WHERE id=?').get(id);
 if(old){if(JSON.parse(old.data).syntheticFixture!=='autonomy-chain-v1')throw Error('已有非夹具采购，拒绝覆盖');}
 else{const record={id,kind:'purchase',syntheticFixture:'autonomy-chain-v1',version:1,sourceVersion:1,po:'SYN-PO-001',supplier:'合成验证供应商',buyer:'合成采购审核员',itemCode:'SYN-MATERIAL-001',itemName:'合成眼镜配件',quantity:160,received:100,returnPending:0,balanceKnown:true,unit:'件',orderDate:'2026-10-01',dueDate:'2026-10-16',promisedDate:'2026-10-16',expectedDate:'',nextFollowupDate:'',followupNote:'',sourceAsOf:'2026-10-17',sourceHash:'synthetic-chain-v1',sourceRow:1,sourceFile:'',sourceSheet:'合成夹具',sourceFilter:'',raw:{},sourceNote:'',customerOrder:'',auditStatus:'已审核',closeStatus:'未关闭',lifecycle:'active'};db.prepare('INSERT INTO records VALUES(?,?,?)').run(id,'purchase',JSON.stringify(record));}
}finally{db.close();}
