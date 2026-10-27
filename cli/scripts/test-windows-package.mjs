// Accept a downloaded distribution, install it in a new private test directory,
// exercise every supported command against a synthetic local server, then remove all test state.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventory} from './package-windows.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
function argument(name){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error('Missing '+name);return process.argv[i+1];}
if(process.platform!=='win32')throw Error('Windows package acceptance requires Windows');
const archive=path.resolve(argument('--archive')),reference=JSON.parse(await fs.readFile(argument('--reference-manifest'),'utf8')),expectedCommit=argument('--expected-commit'),report=path.resolve(argument('--report'));
assert.match(expectedCommit,/^[a-f0-9]{40}$/);assert.equal(reference.commit,expectedCommit);assert.equal(reference.sourceDirty,false);
const acceptance=await fs.mkdtemp(path.join(os.tmpdir(),'doon-cli-acceptance-')),extracted=path.join(acceptance,'extracted'),installed=path.join(acceptance,'installed');
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const run=(program,args,env=process.env)=>execFileSync(program,args,{cwd:acceptance,env,windowsHide:true,stdio:'pipe',encoding:'utf8',maxBuffer:2*1024*1024});
const archiveSha256=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
let result;
try{
  const expand=path.join(acceptance,'expand.ps1');await fs.writeFile(expand,`param([string]$Archive,[string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $Names=@{}
  foreach ($Entry in $Zip.Entries) {
    $Name=$Entry.FullName.Replace('\\','/')
    if ($Name -notmatch '^[a-zA-Z0-9._/-]+$' -or ($Name -split '/') -contains '..' -or $Name.StartsWith('/') -or $Names.ContainsKey($Name)) { throw 'Unsafe or duplicate archive entry.' }
    $Names[$Name]=$true
  }
} finally { $Zip.Dispose() }
Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
`);
  run(shell,['-NoProfile','-NonInteractive','-File',expand,'-Archive',archive,'-Destination',extracted]);
  const manifest=JSON.parse(await fs.readFile(path.join(extracted,'release.json'),'utf8'));
  assert.equal(manifest.commit,expectedCommit);assert.equal(manifest.version,reference.version);assert.equal(manifest.sourceDirty,false);
  // Independently generated local package is the trust baseline for every shipped byte, not the download service.
  assert.deepEqual(manifest.files,reference.files);assert.deepEqual(await inventory(extracted),manifest.files);
  const environment={...process.env,DOON_CLI_HOME:path.join(acceptance,'config')};delete environment.NODE_PATH;delete environment.NODE_OPTIONS;
  run(shell,['-NoProfile','-NonInteractive','-File',path.join(extracted,'install.ps1'),'-InstallRoot',installed,'-SkipPathUpdate'],environment);
  const versions=await fs.readdir(path.join(installed,'programs'));assert.equal(versions.length,1);const cliRoot=path.join(installed,'programs',versions[0]);
  run(shell,['-NoProfile','-NonInteractive','-File',path.join(root,'cli/scripts/test-installed.ps1'),'-InstallRoot',installed],environment);
  const output=run(process.execPath,[path.join(root,'cli/tests/integration/sales-api.mjs'),'--cli-root',cliRoot,...(process.argv.includes('--skip-kingdee')?['--skip-kingdee']:[])],environment);
  result=JSON.parse(output.trim().split(/\r?\n/).at(-1));assert(result.testDirectoryRemoved);assert.equal(result.productionRequests,0);assert(result.testedCommands.length>0);
  assert.deepEqual(await inventory(extracted),manifest.files); // Running and installation did not mutate the original package.
}finally{
  const base=path.resolve(os.tmpdir()),target=path.resolve(acceptance);
  if(path.dirname(target)!==base||!path.basename(target).startsWith('doon-cli-acceptance-'))throw Error('Unsafe test cleanup target');
  await fs.rm(target,{recursive:true,force:true});assert.equal(await fs.stat(target).then(()=>true,()=>false),false);
}
const summary={schema:'doon-cli-package-acceptance-v1',commit:expectedCommit,version:reference.version,archiveSha256,...result,localInstallAndCredentialsRemoved:true,userPathChanged:false};
await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
