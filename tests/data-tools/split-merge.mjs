import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import * as XLSX from 'xlsx';
import {splitWorkbook} from '../../scripts/data-tools/split-workbook.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const python=process.env.DOON_PYTHON||'python';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-pipeline-test-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
  const source=path.join(dir,'source.xlsx'), ownership=path.join(dir,'ownership.json');
  const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Customer','Quantity','Amount'],['TEST-1',4],['TEST-X',3]]);
  sheet.C2={t:'n',v:8,f:'B2*2',z:'0.00'};sheet.C3={t:'n',v:6,f:'B3*2',z:'0.00'};
  XLSX.utils.book_append_sheet(book,sheet,'Source rows');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Preserve','Original note']]),'Notes');
  const raw=XLSX.write(book,{type:'buffer',bookType:'xlsx'});await fs.writeFile(source,raw);
  const own=Buffer.from(JSON.stringify({customers:[{id:'test-customer',customerCode:'TEST-1',customer:'Synthetic',acceptedIdentities:[],salesMembers:[{id:'test-member',name:'Synthetic'}],serviceMembers:[]}]}));await fs.writeFile(ownership,own);
  const config=path.join(dir,'task.json');await fs.writeFile(config,JSON.stringify({schemaVersion:1,source:{path:'source.xlsx',sha256:hash(raw)},ownership:{path:'ownership.json',sha256:hash(own)},sheet:'Source rows',customerColumn:1,groups:[{name:'Selected',memberIds:['test-member']}]}));
  const parts=path.join(dir,'split parts');await splitWorkbook(config,parts);
  const output=path.join(dir,'merged.xlsx');
  const child=spawnSync(python,[path.join(root,'scripts/data-tools/merge_workbooks.py'),source,path.join(parts,'extra.xlsx'),output,'--omit-sheet','Source rows'],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.stderr||child.error?.message);
  const mergedRaw=await fs.readFile(output), originalParts=unzipSync(raw), mergedParts=unzipSync(mergedRaw);
  for(const [name,bytes] of Object.entries(originalParts)) if(name.startsWith('xl/worksheets/')||name.startsWith('xl/externalLinks/')) assert.deepEqual(mergedParts[name],bytes,'Original package parts changed');
  const result=XLSX.read(mergedRaw,{type:'buffer',cellNF:true});assert.deepEqual(result.SheetNames,['Source rows','Notes','Selected','Unassigned','Customer mapping']);
  assert.equal(result.Sheets.Selected.C2.f,"'Source rows'!C2");assert.equal(result.Sheets.Selected.C2.v,8);assert.equal(result.Sheets.Unassigned.C2.v,6);assert.equal(result.Sheets.Notes.B1.v,'Original note');
  assert.equal(hash(await fs.readFile(source)),hash(raw));assert.equal(hash(await fs.readFile(ownership)),hash(own));
  console.log(JSON.stringify({passed:5,syntheticOnly:true,originalPartsPreserved:true}));
} finally {await fs.rm(dir,{recursive:true,force:true});}
