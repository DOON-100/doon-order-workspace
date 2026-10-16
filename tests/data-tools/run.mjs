import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const python=process.env.DOON_PYTHON||'python';
const jobs=[
  [python,['tests/data-tools/test_workbook_tools.py']],
  [python,['tests/data-tools/test_merge_workbooks.py']],
  [process.execPath,['tests/data-tools/split-workbook.mjs']],
  [process.execPath,['tests/data-tools/split-merge.mjs']],
  [process.execPath,['tests/data-tools/prepare-export.mjs']],
  [process.execPath,['tests/data-tools/quote-maintenance.mjs']],
];
const results=[];
const reportFile=path.join(root,'test-output/data-tools-result.json');
await fs.mkdir(path.dirname(reportFile),{recursive:true});
await fs.writeFile(reportFile,JSON.stringify({at:new Date().toISOString(),syntheticOnly:true,passed:false,running:true,suites:[]},null,2)+'\n');
for(const [command,args] of jobs) {
  const start=Date.now();
  const execution=await new Promise(resolve=>{
    const child=spawn(command,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
    child.once('error',error=>resolve({exitCode:1,errorCode:error.code||'PROCESS_START_FAILED'}));
    child.once('exit',code=>resolve({exitCode:code??1}));
  });
  results.push({test:args[0],...execution,elapsedMs:Date.now()-start});
  if(execution.exitCode!==0) break;
}
const report={at:new Date().toISOString(),syntheticOnly:true,passed:results.length===jobs.length&&results.every(row=>row.exitCode===0),suites:results};
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,suites:results.length}));
if(!report.passed)process.exitCode=1;
