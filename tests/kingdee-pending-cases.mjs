import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';

const headers=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
function fixture(note='合成源备注',formula=false){
 const rows=[
  ['SYN-PENDING-01',46280,'合成供应商 A','合成采购员','已审核','未关闭','2026-10-20','000001','合成板材','公斤',1.25,note,5,'SYN-PENDING-CUSTOMER-A'],
  ['SYN-PENDING-01',46280,'合成供应商 A','合成采购员','已审核','未关闭','2026-10-20','000001','合成板材','公斤',1.25,note,5,'SYN-PENDING-CUSTOMER-A'],
  ['SYN-PENDING-02','2026-10-01','合成供应商 B','合成采购员','已审核','手动关闭','2026-10-25','000002','合成铰链','件',100,'逐行保留',10,'SYN-PENDING-CUSTOMER-B'],
  [],
  ['','','','','','','','','合计','',102.5,'','',''],
 ];
 const body=[Array(14).fill('合成采购订单跟踪表'),Array(14).fill('合成筛选：未入库、部分入库'),headers,...rows];
 const sheet=XLSX.utils.aoa_to_sheet(body);sheet.B4.z='yyyy-mm-dd';sheet.B5.z='yyyy-mm-dd';
 if(formula)sheet.K4={t:'n',f:'1+1',v:2};
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'合成来源');
 return {bytes:XLSX.write(book,{type:'buffer',bookType:'xlsx'}),rows};
}

export async function testKingdeePending({ok,call,api,identity,admin,rawRecords,rawInsert,files,pass}){
 const before=rawRecords().map(row=>[row.id,JSON.stringify(row)]),source=fixture();
 const form=(bytes=source.bytes,date='2026-10-15')=>{const data=new FormData();data.set('file',new File([bytes],'合成金蝶采购.xlsx'));data.set('sourceAsOf',date);data.set('sourceFilter','网页导出筛选核对');data.set('sourceAccount','合成测试账套');return data;};
 assert.equal((await ok('kingdee-pending-data')).snapshot,null);
 const job=await ok('kingdee-pending-preview',form());
 assert.equal(job.status,'待确认');assert.equal(job.metadata.rowCount,3);assert.equal(job.metadata.sourceRowCount,5);assert.equal(job.metadata.orderCount,2);assert.equal(job.metadata.supplierCount,2);assert.equal(job.metadata.sourceAccount,'合成测试账套');
 assert.equal(job.metadata.sourceFilter,'合成采购订单跟踪表；合成筛选：未入库、部分入库；网页导出筛选核对');
 assert.deepEqual(job.headers,headers);assert.equal((await ok('kingdee-pending-data')).snapshot,null);
 const done=await ok('kingdee-pending-commit',{id:job.id});assert.equal(done.status,'已完成');
 const data=await ok('kingdee-pending-data'),snapshot=data.snapshot;assert.equal(snapshot.id,done.snapshotId);assert.equal(data.canImport,true);
 assert.deepEqual(snapshot.rows.map(row=>row.sourceRow),[4,5,6,7,8]);assert.deepEqual(snapshot.rows.map(row=>row.rowType),['data','data','data','blank','summary']);
 assert.deepEqual(snapshot.rows[0].values,source.rows[0]);assert.deepEqual(snapshot.rows[0].values,snapshot.rows[1].values);
 assert.equal(snapshot.rows[2].values[5],'手动关闭');assert.equal(snapshot.rows[4].values[10],102.5);assert.match(snapshot.rows[0].displayValues[1],/^\d{4}-\d{2}-\d{2}$/);
 assert(!('remaining' in snapshot.rows[0]));assert.match(snapshot.metadata.quantityMeaning,/未推定/);
 // Read the preserved fixture once; repeatedly decoding the entire SQLite
 // database for each earlier record makes this assertion quadratic in I/O.
 const preservedAfter=new Map(rawRecords().map(row=>[row.id,JSON.stringify(row)]));
 assert(before.every(([id,value])=>preservedAfter.get(id)===value));
 pass('金蝶未上货独立快照逐值保存重复明细、关闭行、空行及源合计，不覆盖原采购或其他记录');

 const repeated=await ok('kingdee-pending-preview',form());assert.equal(repeated.id,job.id);assert.equal(repeated.status,'已完成');
 await ok('kingdee-pending-commit',{id:job.id});assert.equal((await ok('kingdee-pending-data')).history.length,1);
 const download=await call('kingdee-pending-file?id='+snapshot.id);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),source.bytes);
 assert.equal(snapshot.metadata.hash,createHash('sha256').update(source.bytes).digest('hex'));
 pass('同源文件重复预览提交幂等，原件下载与来源 SHA-256 一致');

 const update=fixture('第二次合成快照'),nextJob=await ok('kingdee-pending-preview',form(update.bytes,'2026-10-16'));
 await ok('kingdee-pending-commit',{id:nextJob.id});const next=await ok('kingdee-pending-data');assert.equal(next.history.length,2);assert.notEqual(next.snapshot.id,snapshot.id);
 assert.equal(next.snapshot.rows[0].values[11],'第二次合成快照');assert.deepEqual((await ok('kingdee-pending-data?id='+snapshot.id)).snapshot.rows,snapshot.rows);
 assert.equal((await call('kingdee-pending-data?id=missing')).status,404);
 pass('后续同步生成完整独立快照，最新来源可读且旧快照和原文件完整保留');

 const prefix='synthetic_kingdee_pending_',readerUser={userId:prefix+'user',email:'pending-reader@test.invalid',displayName:'合成授权查看者'};
 const reader={id:prefix+'member',kind:'member',...readerUser,name:readerUser.displayName,role:'viewer',customers:['PENDING-A'],orderScope:'assigned',active:true,createdAt:'2026-10-15T00:00:00Z'};
 const sampleOrder=rawRecords().find(row=>row.kind==='order');assert(sampleOrder);
 const account={id:prefix+'customer',kind:'customer_account',customer:'PENDING-A',customerCode:'PENDING-A',active:true,version:1};
 for(const row of [reader,{...sampleOrder,id:prefix+'order',orderNo:'SYN-PENDING-CUSTOMER-A',customer:'PENDING-A',ownerEmail:''},account,{id:prefix+'team',kind:'customer_project_team',name:'合成采购组',active:true,customerIds:[account.id],leaderIds:[],salesMemberIds:[],serviceMemberIds:[]}])rawInsert(row);
 const restricted=await ok('kingdee-pending-data',undefined,readerUser);assert.equal(restricted.canImport,false);assert.equal(restricted.snapshot.rows.length,2);assert.equal(restricted.snapshot.metadata.rowCount,2);assert.equal(restricted.snapshot.metadata.supplierCount,1);assert.equal(restricted.snapshot.metadata.scope,'authorized');assert.deepEqual(restricted.history,[]);assert(!restricted.snapshot.metadata.sourceFilter.includes('网页导出筛选核对'));
 assert.equal((await call('kingdee-pending-preview',form(),readerUser)).status,403);assert.equal((await call('kingdee-pending-commit',{id:job.id},readerUser)).status,403);assert.equal((await call('kingdee-pending-file?id='+snapshot.id,undefined,readerUser)).status,403);
 const teamRead=async(action,teamId)=>identity.run(admin,()=>api.GET(new Request('https://orders.test/api/workspace/'+action,{headers:{'X-Workspace-Team':teamId}}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const scopedResponse=await teamRead('kingdee-pending-data',prefix+'team');assert.equal(scopedResponse.status,200);const scoped=await scopedResponse.json();assert.equal(scoped.snapshot.rows.length,2);assert.equal(scoped.snapshot.metadata.scope,'authorized');assert.deepEqual(scoped.history,[]);
 assert.equal((await teamRead('kingdee-pending-file?id='+snapshot.id,prefix+'team')).status,403);assert.equal((await teamRead('kingdee-pending-data','missing-team')).status,403);
 pass('采购源表沿用订单与小组范围，受限查看不泄露源合计、全表统计、历史目录或完整原件');

 assert.equal((await call('kingdee-pending-preview',form(fixture('公式测试',true).bytes))).status,400);
 assert.equal((await call('kingdee-pending-preview',form(source.bytes,'2026-02-30'))).status,400);
 const missing=new FormData();missing.set('file',new File(['invalid'],'bad.xlsx'));missing.set('sourceAsOf','2026-10-15');assert.equal((await call('kingdee-pending-preview',missing)).status,400);
 assert.equal((await call('kingdee-pending-data',undefined,null)).status,401);
 pass('采购源表拒绝公式、非法日期、缺失报表表头和匿名读取');

 const concurrent=fixture('并发快照'),race=await Promise.all([call('kingdee-pending-preview',form(concurrent.bytes,'2026-10-17')),call('kingdee-pending-preview',form(concurrent.bytes,'2026-10-17'))]);
 assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);const raceJob=await ok('kingdee-pending-preview',form(concurrent.bytes,'2026-10-17'));
 const commits=await Promise.all([call('kingdee-pending-commit',{id:raceJob.id}),call('kingdee-pending-commit',{id:raceJob.id})]);assert.deepEqual(commits.map(response=>response.status).sort(),[200,409]);
 await ok('kingdee-pending-commit',{id:raceJob.id});assert.equal((await ok('kingdee-pending-data')).history.length,3);
 pass('同源并发同步只有一个预览和快照写入成功，重试保持幂等');

 if(files){
  const pending=await ok('kingdee-pending-preview',form(fixture('断点恢复快照').bytes,'2026-10-18')),stored=rawRecords().find(row=>row.id===pending.id),savedRows=files.get(stored.rowsKey),savedSource=files.get(stored.fileKey);
  files.delete(stored.fileKey);assert.equal((await call('kingdee-pending-commit',{id:pending.id})).status,503);assert.equal((await ok('kingdee-pending-preview',form(fixture('断点恢复快照').bytes,'2026-10-18'))).id,pending.id);assert.equal((await ok('kingdee-pending-data')).history.length,3);
  files.set(stored.fileKey,savedSource);files.set(stored.rowsKey,'[]');assert.equal((await call('kingdee-pending-commit',{id:pending.id})).status,409);files.set(stored.rowsKey,savedRows);
  await ok('kingdee-pending-commit',{id:pending.id});assert.equal((await ok('kingdee-pending-data')).history.length,4);const completed=rawRecords().find(row=>row.id==='kingdee_pending_snapshot_'+pending.hash);assert(Number.isSafeInteger(completed.committedRevision));
  files.set(stored.rowsKey,'[]');assert.equal((await call('kingdee-pending-data')).status,409);files.set(stored.rowsKey,savedRows);
  pass('未完成预览可重试，缺失原件或明细哈希异常不提交、不展示损坏快照');
 }
}
