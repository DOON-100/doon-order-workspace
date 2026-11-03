import {randomUUID} from 'node:crypto';

// Programs are passed as base64 on stdin: no business values are shell code.
export function pythonCommand(program,config){
 const data=Buffer.from(JSON.stringify(config)).toString('base64');
 const source=`import json,base64\ncfg=json.loads(base64.b64decode('${data}'))\n${program}`;
 return `printf ${Buffer.from(source).toString('base64')} | base64 -d | python3`;
}
export function deploymentPaths(commit,releasesDir='/opt/app/releases'){
 if(!/^[0-9a-f]{40}$/.test(commit))throw Error('Invalid release commit');
 if(!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(releasesDir)||releasesDir.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid releases directory');
 const stamp=new Date().toISOString().replace(/[-:.]/g,'')+'-main-'+commit.slice(0,7)+'-'+randomUUID().slice(0,8);
 const parent=releasesDir.slice(0,releasesDir.lastIndexOf('/'));
 return {stamp,releaseDir:releasesDir+'/'+stamp,stageDir:parent+'/stage-'+stamp,uploadZip:parent+'/'+stamp+'.zip'};
}
export const reserveReleaseProgram=String.raw`
from pathlib import Path
import os
root=Path(cfg['root']).resolve(strict=True)
target=Path(cfg['target'])
assert target.parent.resolve(strict=True)==root, 'Release outside expected root'
assert not target.is_symlink(), 'Release cannot be a symlink'
# mkdir without exist_ok refuses an existing or active version. Never remove it.
target.mkdir(mode=0o755)
print('RELEASE_RESERVED')
`;
export const snapshotProgram=String.raw`
import sqlite3,hashlib,os,time
from pathlib import Path
source=Path(cfg['source']).resolve(strict=True)
target=Path(cfg['target'])
assert target.parent.resolve(strict=True)!=source, 'Invalid backup destination'
deadline=time.monotonic()+90
def progress(status,remaining,total):
 if time.monotonic()>deadline: raise TimeoutError('Online backup timed out')
# Exclusive create prevents a retry from overwriting an earlier rollback snapshot.
fd=os.open(str(target),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
os.close(fd)
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=10) as live:
 with sqlite3.connect(str(target)) as backup:
  live.backup(backup,pages=256,progress=progress,sleep=0.05)
  assert backup.execute('PRAGMA integrity_check').fetchall()==[('ok',)], 'Invalid backup'
with target.open('rb') as stream:
 digest=hashlib.file_digest(stream,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else None
if digest is None:
 h=hashlib.sha256()
 with target.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
 digest=h.hexdigest()
print(json.dumps({'snapshot':'verified','sha256':digest}))
`;
export const writeDropinProgram=String.raw`
from pathlib import Path
import os,re
directory=Path(cfg['directory']).resolve(strict=True)
# Sort after existing ASCII names without concatenating all previous filenames.
names=[p.name for p in directory.glob('*.conf')]
assert all(re.fullmatch(r'[A-Za-z0-9_.-]+',name) for name in names), 'Review nonstandard service config filenames first'
prefix='z'*(max([len(re.match(r'z*',name).group()) for name in names],default=0)+1)
name=prefix+'-doon-'+cfg['stamp']+'.conf'
assert len(name.encode())<=255, 'Drop-in filename too long; reconcile old configuration first'
target=directory/name
with target.open('x',encoding='utf8') as stream: stream.write(cfg['content'])
os.chmod(target,0o600)
print(json.dumps({'dropin':str(target)}))
`;
export const effectiveReleaseProgram=String.raw`
import subprocess
from pathlib import Path
actual=subprocess.check_output(['systemctl','show',cfg['service'],'--property=WorkingDirectory','--value'],text=True).strip()
assert Path(actual).resolve(strict=True)==Path(cfg['releaseDir']).resolve(strict=True), 'Effective service release mismatch'
print('EFFECTIVE_RELEASE_OK')
`;
export const verifyReleaseProgram=String.raw`
import subprocess,urllib.request,time
from pathlib import Path
release=Path(cfg['releaseDir']).resolve(strict=True)
assert json.loads((release/'release.json').read_text())['commit']==cfg['commit'], 'Release manifest mismatch'
actual=subprocess.check_output(['systemctl','show',cfg['service'],'--property=WorkingDirectory','--value'],text=True).strip()
assert Path(actual).resolve(strict=True)==release, 'Effective service release mismatch'
pid=int(subprocess.check_output(['systemctl','show',cfg['service'],'--property=MainPID','--value'],text=True).strip())
assert pid>0 and Path('/proc/'+str(pid)+'/cwd').resolve(strict=True)==release, 'Running process release mismatch'
assert str(release/'lan-dist'/'server.mjs').encode() in Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(bytes([0])), 'Running entrypoint mismatch'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def probe():
 for endpoint in ['/health','/']:
  url=cfg['origin']+endpoint
  headers={'Host':cfg['host']}
  if cfg.get('proxyHttps'):
   assert cfg['origin'].startswith('http://127.0.0.1:'), 'Proxy health probe must use loopback'
   headers.update({'X-Forwarded-Host':cfg['host'],'X-Forwarded-Proto':'https','X-Forwarded-For':'127.0.0.1'})
  request=urllib.request.Request(url,headers=headers)
  with opener.open(request,timeout=5) as response:
   assert response.status==200 and response.geturl()==url, 'HTTP verification failed'
   if endpoint=='/health': assert json.load(response).get('ok') is True, 'Unhealthy response'
attempts=cfg.get('attempts',15)
for attempt in range(attempts):
 try:
  probe()
  break
 except Exception:
  if attempt==attempts-1: raise RuntimeError('HTTP verification failed; deployment not confirmed') from None
  time.sleep(1)
print('DEPLOYMENT_VERIFIED')
`;
