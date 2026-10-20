// Isolated Windows orchestration tests. No production paths, services, tasks or HTTP requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {sha,fingerprint,sameFingerprint} from '../scripts/verify-planning-control-preservation.mjs';
import {captureCustomerPriceSourceHashes,writeCustomerPriceBuildEvidence,verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const project=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output=path.join(project,'test-output');
await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'planning-control-deployment-test-'));
const powershell=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const scriptName='部署生产计划增强.ps1';
const files=['server.mjs','workspace-api.mjs','runtime.mjs','auth.mjs','personnel.mjs','manage.mjs','supplier-gateway.mjs','employee-gateway.mjs','client/index.html'];
const scenarios=['success','served-page-failure','partial-copy-failure','frozen-data-change','stale-baseline','concurrent-release'];
const checks=[];
const put=async(name,data)=>{await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,data);};
const run=(file,args,cwd)=>new Promise((resolve,reject)=>{const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];env.PSModulePath=path.join(path.dirname(powershell),'Modules');const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']}),parts={out:[],err:[]};child.stdout.on('data',b=>parts.out.push(b));child.stderr.on('data',b=>parts.err.push(b));child.on('error',reject);const timer=setTimeout(()=>{child.kill();reject(new Error('Synthetic deployment test timed out'));},90000);child.on('close',code=>{clearTimeout(timer);resolve({code,out:Buffer.concat(parts.out).toString(),err:Buffer.concat(parts.err).toString()});});});

const mockScript=String.raw`param([string]$FixtureRoot,[string]$Scenario,[string]$ExpectedHash)
$ErrorActionPreference='Stop'
if (-not $FixtureRoot.Contains('planning-control-deployment-test-') -or -not (Test-Path -LiteralPath (Join-Path $FixtureRoot 'SYNTHETIC_ONLY'))) { throw 'Synthetic fixture guard failed' }
$global:MockRoot=$FixtureRoot
$global:MockScenario=$Scenario
$global:MockState=[ordered]@{running=$true;enabled=$true;starts=0;stops=0;healthCalls=0;httpCalls=0;processCalls=0;taskCalls=0;mutationCalls=0;copyFaulted=$false;expectedFailure=$false;realSystemCalls=0}
function Get-ScheduledTask { param($TaskName) $global:MockState.taskCalls++; if($TaskName -ne 'DOON-Order-Workspace'){throw 'Unexpected task'}; [pscustomobject]@{Settings=[pscustomobject]@{Enabled=$global:MockState.enabled};Actions=[pscustomobject]@{WorkingDirectory=$global:MockRoot;Arguments=(Join-Path $global:MockRoot 'standalone/service-host.mjs')}} }
function Disable-ScheduledTask { param($TaskName) $global:MockState.taskCalls++; $global:MockState.enabled=$false }
function Stop-ScheduledTask { param($TaskName) $global:MockState.taskCalls++; $global:MockState.stops++ }
function Enable-ScheduledTask { param($TaskName) $global:MockState.taskCalls++; $global:MockState.enabled=$true }
function Invoke-SyntheticMutation {
    $node=Join-Path $env:ProgramFiles 'nodejs/node.exe'
    & $node (Join-Path $global:MockRoot 'test-output/mutate-data.mjs') $global:MockRoot
    if($LASTEXITCODE -ne 0){throw 'Synthetic mutation failed'}
    $global:MockState.mutationCalls++
}
function Start-ScheduledTask {
    param($TaskName)
    $global:MockState.taskCalls++; $global:MockState.starts++; $global:MockState.running=$true
    if($global:MockState.starts -eq 1 -and $global:MockScenario -in @('success','served-page-failure','concurrent-release')) { Invoke-SyntheticMutation }
}
function Get-CimInstance { param($ClassName,$Filter) $global:MockState.processCalls++; [pscustomobject]@{ProcessId=1987654321;CommandLine=('node "'+(Join-Path $global:MockRoot 'lan-dist/server.mjs')+'"')} }
function Get-NetTCPConnection { [CmdletBinding()]param($LocalPort,$State) if($LocalPort -ne 8787){throw 'Unexpected mock port'}; if($global:MockState.running){[pscustomobject]@{OwningProcess=1987654321}} }
function Stop-Process { [CmdletBinding()]param($Id,[switch]$Force) if($Id -ne 1987654321){throw 'Unexpected mock process'}; $global:MockState.running=$false }
function Start-Sleep { param($Milliseconds,$Seconds) }
function Invoke-RestMethod { param($Uri,$TimeoutSec) $global:MockState.healthCalls++; if($Uri -ne 'http://127.0.0.1:8787/health'){throw 'Unexpected mock health URL'}; if(-not $global:MockState.running){throw 'Mock service stopped'}; [pscustomobject]@{ok=$true;service='度昂订单协作中台·内网版'} }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$TimeoutSec)
    $global:MockState.httpCalls++
    if($Uri -ne 'http://127.0.0.1:8787/production-planning'){throw 'Unexpected mock page URL'}
    if($global:MockScenario -eq 'concurrent-release') {
        $manifest=Join-Path $global:MockRoot 'lan-dist/customer-price-build-evidence.json'
        [IO.File]::AppendAllText($manifest,' ')
        throw 'Simulated concurrent release'
    }
    [pscustomobject]@{StatusCode=200;Content=if($global:MockScenario -eq 'served-page-failure'){'incorrect mock page'}else{[IO.File]::ReadAllText((Join-Path $global:MockRoot 'lan-dist/client/index.html'))}}
}
function Copy-Item {
    [CmdletBinding()]param([string]$LiteralPath,[string]$Destination,[switch]$Recurse,[switch]$Force)
    $stage=(Join-Path $global:MockRoot 'test-output/planning-control-build')
    $isRelease=$LiteralPath.StartsWith($stage,[StringComparison]::OrdinalIgnoreCase)
    if($global:MockScenario -eq 'partial-copy-failure' -and $isRelease -and $LiteralPath.EndsWith('server.mjs') -and -not $global:MockState.copyFaulted){$global:MockState.copyFaulted=$true;throw 'Simulated copy failure'}
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse:$Recurse -Force:$Force
    if($global:MockScenario -eq 'frozen-data-change' -and $isRelease -and -not $global:MockState.mutationCalls){Invoke-SyntheticMutation}
}
try {
    & (Join-Path $FixtureRoot 'standalone/部署生产计划增强.ps1') -ExpectedLiveManifestHash $ExpectedHash -BrowserAcceptancePath (Join-Path $FixtureRoot 'test-output/browser.json')
    if($Scenario -ne 'success'){throw 'Expected test failure did not occur'}
} catch {
    if($Scenario -eq 'success'){throw}
    if($_.Exception.Message -eq 'Expected test failure did not occur'){throw}
    $global:MockState.expectedFailure=$true
} finally {
    $global:MockState | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $FixtureRoot 'test-output/mock-result.json') -Encoding UTF8
}
`;

for(const scenario of scenarios){
 const fixture=path.join(root,scenario);await fs.mkdir(fixture);
 for(const dir of ['app','lib','components','build','public','scripts','standalone','test-output','lan-data/files','lan-dist','test-output/planning-control-build'])await fs.mkdir(path.join(fixture,dir),{recursive:true});
 await put(path.join(fixture,'SYNTHETIC_ONLY'),'isolated synthetic test');
 for(const name of ['package.json','tsconfig.json','postcss.config.mjs'])await put(path.join(fixture,name),name.endsWith('.json')?'{}':'export default {};');
 for(const name of ['verify-planning-control-preservation.mjs','backup-planning-control-release.mjs','customer-price-build-evidence.mjs'])await fs.copyFile(path.join(project,'scripts',name),path.join(fixture,'scripts',name));
 const deployment=await fs.readFile(path.join(project,'standalone',scriptName),'utf8');await put(path.join(fixture,'standalone',scriptName),'\ufeff'+deployment.replace(/^\ufeff/,''));
 await put(path.join(fixture,'test-output/mock.ps1'),'\ufeff'+mockScript);
 await put(path.join(fixture,'test-output/mutate-data.mjs'),`import fs from 'node:fs/promises';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';const root=process.argv[2];if(!root.includes('planning-control-deployment-test-'))throw Error('guard');await fs.access(path.join(root,'SYNTHETIC_ONLY'));const db=new DatabaseSync(path.join(root,'lan-data/workspace.sqlite'));db.exec("INSERT INTO records VALUES ('employee-new','synthetic','{\\"newWork\\":true}');UPDATE workspace_revision SET revision=revision+1 WHERE id='main'");db.close();await fs.writeFile(path.join(root,'lan-data/files/employee-new.bin'),'new-employee-file');`);
 const data=path.join(fixture,'lan-data'),db=new DatabaseSync(path.join(data,'workspace.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT); CREATE TABLE local_accounts(id TEXT PRIMARY KEY,username TEXT,member_id TEXT,must_change INTEGER,created_at TEXT,password_hash TEXT); CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER); INSERT INTO records VALUES('original','synthetic','{ "unchanged": true }'); INSERT INTO local_accounts VALUES('synthetic-account','synthetic-name','synthetic-member',0,'2026-01-01','synthetic-only'); INSERT INTO workspace_revision VALUES('main',1);`);db.close();
 await put(path.join(data,'files/original.bin'),'synthetic-original-file');const before=await fingerprint(data);
 const live=path.join(fixture,'lan-dist'),stage=path.join(fixture,'test-output/planning-control-build');
 for(const name of files){await put(path.join(live,name),'baseline-'+name);await put(path.join(stage,name),'release-'+name);}
 await put(path.join(live,'client/assets/index-OLD12345.js'),'baseline-hashed-asset');
 await put(path.join(stage,'client/assets/index-NEW12345.js'),'release-hashed-asset');
 await put(path.join(stage,'client/added-for-release.txt'),'release-only-public-file');
 const previous=process.cwd();process.chdir(fixture);
 let baselineHash,stageHash;
 try{
  const sources=await captureCustomerPriceSourceHashes();await writeCustomerPriceBuildEvidence(live,sources);baselineHash=sha(await fs.readFile(path.join(live,'customer-price-build-evidence.json')));
  // Reproduce a historical live build that retained an older asset outside its manifest.
  await put(path.join(live,'client/assets/index-LEGACY99.js'),'untracked-legacy-asset');
  await writeCustomerPriceBuildEvidence(stage,sources);stageHash=sha(await fs.readFile(path.join(stage,'customer-price-build-evidence.json')));
 }finally{process.chdir(previous);}
 await put(path.join(fixture,'test-output/planning-control-release-validation.json'),JSON.stringify({manifestSha256:stageHash,typescript:true,business:true,runtime:true,browser:true,preservation:true,productionWrites:0,errors:[],at:new Date().toISOString()}));
 await put(path.join(fixture,'test-output/browser.json'),JSON.stringify({buildEvidence:{manifestSha256:stageHash},passed:1,checks:['synthetic check'],scope:'synthetic database only',errors:[]}));
 const result=await run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(fixture,'test-output/mock.ps1'),'-FixtureRoot',fixture,'-Scenario',scenario,'-ExpectedHash',scenario==='stale-baseline'?'0'.repeat(64):baselineHash],fixture);
 await put(path.join(fixture,'test-output/process.log'),result.out+'\n'+result.err);
 assert.equal(result.code,0,`${scenario}: synthetic PowerShell failed; inspect private process.log`);
 const mock=JSON.parse((await fs.readFile(path.join(fixture,'test-output/mock-result.json'),'utf8')).replace(/^\ufeff/,''));
 assert.equal(mock.realSystemCalls,0);assert.equal(mock.running,true);assert.equal(mock.enabled,true);
 assert.equal(await fs.readFile(path.join(data,'files/original.bin'),'utf8'),'synthetic-original-file');
 const after=await fingerprint(data);assert.deepEqual(after.records[sha('original')],before.records[sha('original')]);assert.equal(after.accountsHash,before.accountsHash);assert.equal(after.schemaHash,before.schemaHash);
 if(['success','served-page-failure','concurrent-release','frozen-data-change'].includes(scenario)){assert.equal(mock.mutationCalls,1);assert.ok(after.records[sha('employee-new')]);assert.equal(await fs.readFile(path.join(data,'files/employee-new.bin'),'utf8'),'new-employee-file');}else sameFingerprint(before,after);
 const names=await fs.readdir(path.join(fixture,'test-output'));
 assert.ok(!names.includes('planning-control-release.lock'));
 const events=(await Promise.all(names.filter(n=>/^planning-control-release-.*\.jsonl$/.test(n)).map(n=>fs.readFile(path.join(fixture,'test-output',n),'utf8')))).join('\n');
 if(scenario==='success'||scenario==='concurrent-release')assert.equal(await fs.readFile(path.join(live,'server.mjs'),'utf8'),'release-server.mjs');
 else assert.equal(await fs.readFile(path.join(live,'server.mjs'),'utf8'),'baseline-server.mjs');
 if(['served-page-failure','partial-copy-failure','frozen-data-change'].includes(scenario)){assert.match(events,/code-only-rollback-complete/);assert.match(events,/service-recovered-data-retained/);await assert.rejects(fs.access(path.join(live,'client/added-for-release.txt')));}
 if(scenario==='stale-baseline'){assert.equal(mock.stops,0);assert.equal(mock.starts,0);assert.ok(!names.some(n=>n.startsWith('planning-control-data-backup-')));}
 else {
  const backups=names.filter(n=>n.startsWith('planning-control-data-backup-'));assert.equal(backups.length,1);sameFingerprint(before,await fingerprint(path.join(fixture,'test-output',backups[0])));
 }
 if(scenario==='concurrent-release'){assert.match(events,/recovery-needs-operator/);assert.doesNotMatch(events,/code-only-rollback-complete/);assert.equal(mock.starts,1);}
 else if(scenario!=='stale-baseline'){
  const previous=process.cwd();process.chdir(fixture);try{await verifyCustomerPriceBuildEvidence(live);}finally{process.chdir(previous);}
  const manifest=JSON.parse(await fs.readFile(path.join(live,'customer-price-build-evidence.json'),'utf8'));
  assert.ok(manifest.artifactHashes['client/assets/index-OLD12345.js']);assert.ok(manifest.artifactHashes['client/assets/index-LEGACY99.js']);
  if(scenario==='success'){assert.equal(manifest.deployment.testedManifestSha256,stageHash);assert.notEqual(sha(await fs.readFile(path.join(live,'customer-price-build-evidence.json'))),stageHash);assert.match(result.out,/deployedManifestSha256/);}
 }
 checks.push({scenario,passed:true,productionReads:0,productionWrites:0,realSystemCalls:0,originalRowsAndFilesPreserved:true,employeeWritesPreserved:mock.mutationCalls===1,mock});
 console.log('PASS '+scenario);
}
const sourceHashes={};for(const name of ['scripts/backup-planning-control-release.mjs','scripts/verify-planning-control-preservation.mjs','standalone/'+scriptName,'standalone/test-planning-control-deployment.mjs'])sourceHashes[name]=sha(await fs.readFile(path.join(project,name)));
const report={at:new Date().toISOString(),passed:checks.length,scope:'synthetic database only',productionReads:0,productionWrites:0,realSystemCalls:0,nodeVersion:process.version,sourceHashes,checks,root};
await put(path.join(root,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,result:path.join(root,'result.json')}));
