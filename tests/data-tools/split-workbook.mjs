import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
import {unzipSync,zipSync} from 'fflate';
import {splitWorkbook} from '../../scripts/data-tools/split-workbook.mjs';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-split-test-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
let passed=0;
try {
  const input=path.join(dir,'input with spaces');await fs.mkdir(input);
  const source=path.join(input,'source.xlsx'), owners=path.join(input,'owners.json'), configFile=path.join(input,'task.json');
  const wb=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([['Code','Amount','Calculated','Date','Error'],['TEST-A',12,null,45000],['OLD-A',18],['TEST-B',21],['UNKNOWN',4],['',5]]);
  sheet.C2={t:'n',v:24,f:'B2*2'};sheet.D2.z='yyyy-mm-dd';sheet.E2={t:'e',v:42};
  XLSX.utils.book_append_sheet(wb,sheet,"Source's rows");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Untouched']]),'Original notes');
  const sourceBytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});await fs.writeFile(source,sourceBytes);
  const ownership={customers:[{id:'test_customer_a',customerCode:'TEST-A',customer:'Synthetic A',acceptedIdentities:['OLD-A'],salesMembers:[{id:'test_member_a',name:'Synthetic member'}],serviceMembers:[]},{id:'test_customer_b',customerCode:'TEST-B',customer:'Synthetic B',acceptedIdentities:[],salesMembers:[],serviceMembers:[{id:'test_member_b',name:'Synthetic member B'}]}]};
  const ownerBytes=Buffer.from(JSON.stringify(ownership));await fs.writeFile(owners,ownerBytes);
  const config={schemaVersion:1,source:{path:'source.xlsx',sha256:sha(sourceBytes)},ownership:{path:'owners.json',sha256:sha(ownerBytes)},sheet:"Source's rows",customerColumn:1,groups:[{name:'Group A',memberIds:['test_member_a']},{name:'Group B',memberIds:['test_member_b']}],mappingSheet:'Mapping',unknownSheet:'Unassigned'};
  const write=async value=>fs.writeFile(configFile,JSON.stringify(value));await write(config);
  const output=path.join(dir,'output');const result=await splitWorkbook(configFile,output);
  assert.equal(result.rows,5);assert.equal(result.unassigned,2);passed++;
  const extra=XLSX.read(await fs.readFile(path.join(output,'extra.xlsx')),{type:'buffer',cellNF:true});
  assert.equal(extra.Sheets['Group A'].C2.f,"'Source''s rows'!C2");assert.equal(extra.Sheets['Group A'].C2.v,24);assert.equal(extra.Sheets['Group A'].D2.z,'yyyy-mm-dd');assert.equal(extra.Sheets['Group A'].E2.t,'e');assert.equal(extra.Sheets['Group A'].E2.v,42);passed++;
  const report=JSON.parse(await fs.readFile(path.join(output,'classification.json'),'utf8'));
  assert.deepEqual(report.summary[0].sourceRows,[2,3]);assert.deepEqual(report.sourceRows,[2,3,4,5,6]);passed++;
  assert.equal(sha(await fs.readFile(source)),sha(sourceBytes));assert.equal(sha(await fs.readFile(owners)),sha(ownerBytes));passed++;
  await assert.rejects(splitWorkbook(configFile,output),/exists/);await assert.rejects(splitWorkbook(configFile,input),/exists/);passed++;
  await write({...config,source:{...config.source,sha256:'0'.repeat(64)}});await assert.rejects(splitWorkbook(configFile,path.join(dir,'bad-hash')),/checksum/);passed++;
  await write({...config,groups:[...config.groups,{name:'Other',memberIds:['test_member_a']}]});await assert.rejects(splitWorkbook(configFile,path.join(dir,'bad-members')),/multiple groups/);passed++;
  await write({...config,unknownSheet:'Original notes'});await assert.rejects(splitWorkbook(configFile,path.join(dir,'collision')),/conflicts/);passed++;
  const ambiguous=structuredClone(ownership);ambiguous.customers[0].serviceMembers=[{id:'test_member_b'}];const ambiguousBytes=Buffer.from(JSON.stringify(ambiguous));await fs.writeFile(owners,ambiguousBytes);
  await write({...config,ownership:{path:'owners.json',sha256:sha(ambiguousBytes)}});await assert.rejects(splitWorkbook(configFile,path.join(dir,'ambiguous')),/multiple selected groups/);passed++;
  await fs.writeFile(owners,ownerBytes);await write({...config,requiredColumns:[1]});const filtered=await splitWorkbook(configFile,path.join(dir,'filtered'));assert.equal(filtered.rows,4);passed++;
  await write(config);const moved=path.join(dir,'moved');await fs.cp(input,moved,{recursive:true});assert.equal((await splitWorkbook(path.join(moved,'task.json'),path.join(dir,'moved-output'))).rows,5);passed++;
  const parts=unzipSync(sourceBytes), xml=new TextDecoder().decode(parts['xl/worksheets/sheet1.xml']);
  assert(xml.includes('<v>24</v>'));parts['xl/worksheets/sheet1.xml']=new TextEncoder().encode(xml.replace('<v>24</v>',''));
  const uncached=Buffer.from(zipSync(parts));await fs.writeFile(source,uncached);
  for(const requiredColumns of [[],[3]]) {
    await write({...config,source:{path:'source.xlsx',sha256:sha(uncached)},requiredColumns});
    await assert.rejects(splitWorkbook(configFile,path.join(dir,'uncached-'+requiredColumns.length)),/no saved value/);
  }
  assert.equal(sha(await fs.readFile(source)),sha(uncached));passed++;
  console.log(JSON.stringify({passed,syntheticOnly:true}));
} finally { await fs.rm(dir,{recursive:true,force:true}); }
