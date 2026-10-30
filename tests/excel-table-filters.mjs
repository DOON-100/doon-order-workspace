import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const output=path.resolve('test-output','excel-table-filters-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'filters.mjs');
await build({entryPoints:['app/excel-table.tsx'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},loader:{'.css':'empty'}});
const {normalizeExcelValue,matchesExcelFilters}=await import(pathToFileURL(outfile).href);

assert.equal(normalizeExcelValue(null),'');
assert.equal(normalizeExcelValue(undefined),'');
assert.equal(normalizeExcelValue('  合成甲\n  第一组  '),'合成甲 第一组');
assert.equal(normalizeExcelValue(0),'0','Numeric zero is a filterable value, not blank.');
assert.equal(normalizeExcelValue(-12.5),'-12.5');
assert.equal(matchesExcelFilters(['甲','进行中',0],{}),true);
assert.equal(matchesExcelFilters(['甲','进行中',0],{2:['0']}),true);
assert.equal(matchesExcelFilters(['甲','进行中',0],{2:['']}),false);
assert.equal(matchesExcelFilters(['甲',null,0],{1:['']}),true);
assert.equal(matchesExcelFilters(['甲','进行中',0],{0:['甲','乙'],1:['进行中']}),true);
assert.equal(matchesExcelFilters(['甲','进行中',0],{0:['甲'],1:['已完成']}),false,'Columns combine with AND.');
assert.equal(matchesExcelFilters(['甲','进行中',0],{0:[]}),false,'Selecting no values must show no rows.');
assert.equal(matchesExcelFilters(['甲','进行中',0],{0:['甲'],4:['']}),true,'An absent optional field is blank.');

const records=Array.from({length:65},(_,index)=>({id:index+1,values:[index===64?'末页客户':'普通客户',index%2?'进行中':'已完成',index]}));
const original=JSON.stringify(records);
const filtered=records.filter(row=>matchesExcelFilters(row.values,{0:['末页客户']}));
assert.deepEqual(filtered.slice(0,10).map(row=>row.id),[65],'Filtering the complete dataset finds a record beyond the initial page.');
assert.deepEqual(records.filter(row=>matchesExcelFilters(row.values,{2:['0']})).map(row=>row.id),[1]);
assert.equal(JSON.stringify(records),original,'Filtering does not mutate original records.');
const refreshed=[...records,{id:66,values:['刷新客户','进行中',99]}];
assert.deepEqual(refreshed.filter(row=>matchesExcelFilters(row.values,{0:['刷新客户']})).map(row=>row.id),[66]);
assert.equal(records.filter(row=>matchesExcelFilters(row.values,{0:[]})).length,0);
assert.equal(records.filter(row=>matchesExcelFilters(row.values,{})).length,65,'Clearing filters restores every record.');
console.log('PASS Excel filters: blank and zero values, multi-selection, column intersection, full-data pagination, refresh, source immutability.');
