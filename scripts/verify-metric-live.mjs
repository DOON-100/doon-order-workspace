import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await build({entryPoints:['lib/metric-details.ts'],outfile:'test-output/metric-rules.mjs',bundle:true,platform:'node',format:'esm'});
const {metricSource,metricRows,metricValue}=await import('../test-output/metric-rules.mjs');
const db=new DatabaseSync('lan-data/workspace.sqlite',{readOnly:true});db.exec('PRAGMA query_only=ON; BEGIN');
const records=db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data)),revision=db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const accounts=db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();db.exec('ROLLBACK');db.close();
const source=metricSource({records,revision},records.find(r=>r.kind==='member'&&r.role==='admin'&&r.active));
const metrics=Object.fromEntries(['orders','progress','warehouse','review'].map(key=>{const rows=metricRows(key,source);return [key,{value:metricValue(key,rows),detailRows:rows.length}];}));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const result={at:new Date().toISOString(),revision,metrics,businessHash:digest(records),accountMetadataHash:digest(accounts),orders:source.orders.length,readOnly:true};
if(process.argv[2]==='before')await fs.writeFile('test-output/metric-live-before.json',JSON.stringify(result,null,2));
if(process.argv[2]==='after'){const previous=JSON.parse(await fs.readFile('test-output/metric-live-before.json','utf8'));assert.equal(result.businessHash,previous.businessHash,'业务记录部署前后必须一致');assert.equal(result.accountMetadataHash,previous.accountMetadataHash,'账号元信息部署前后必须一致');await fs.writeFile('test-output/metric-live-after.json',JSON.stringify({...result,preserved:true},null,2));}
console.log(JSON.stringify(result,null,2));
