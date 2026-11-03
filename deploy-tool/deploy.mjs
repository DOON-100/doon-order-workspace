// DOON 一键部署工具（交互式命令行向导）
// 零依赖，系统自带 Node 运行：node deploy.mjs [包.zip]
//
// 流程：
//   1. 解析并校验 CI 下载的部署包（格式 / commit / tar 名 / sha256 / 文件清单）
//   2. 展示校验结果，识别错误包
//   3. 交互确认后，经 workbench CLI 上传到阿里云 ECS 并切换服务
//   4. 实时输出进度，最后验证上线
//
// 安全边界：
//   - 只监听/执行固定白名单流程，不接受任意 shell 注入
//   - 关键动作（写 drop-in / 重启服务）前必须用户明确确认
//   - 全程只读包文件 + 新增版本目录，不触碰既有数据与旧版本

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {deploymentPaths,pythonCommand,reserveReleaseProgram,snapshotProgram,writeDropinProgram,effectiveReleaseProgram,verifyReleaseProgram} from './safety.mjs';
import {loadConfig,validateConfig} from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ 配置 ============
const deploymentConfig=loadConfig();
const WB=deploymentConfig.workbench;
const PYTHON=process.env.DOON_DEPLOY_PYTHON||(process.platform==='win32'?'python':'python3');
const DEFAULT_INSTANCE=deploymentConfig.instance||'';
const DEFAULT_REGION=deploymentConfig.region||'';
const RELEASES_DIR=deploymentConfig.releasesDir;
const DROPIN_DIR=deploymentConfig.dropinDir;
const NODE_BIN=deploymentConfig.nodeBin;
const ENV_FILE=deploymentConfig.envFile;
const SERVICE=deploymentConfig.service;
const DATA_DIR=deploymentConfig.dataDir;

// ============ 终端彩色输出 ============
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ok = (s) => console.log(C.green + '✓ ' + s + C.reset);
const bad = (s) => console.log(C.red + '✗ ' + s + C.reset);
const warn = (s) => console.log(C.yellow + '⚠ ' + s + C.reset);
const info = (s) => console.log(C.cyan + '• ' + s + C.reset);
const head = (s) => console.log(C.bold + C.blue + '\n== ' + s + ' ==' + C.reset);
const dim = (s) => console.log(C.dim + s + C.reset);
const title = (s) => console.log(C.bold + C.magenta + s + C.reset);

// ============ 交互输入 ============
let rl;
function ask(q) {
  rl ||= createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(C.cyan + q + C.reset + ' ', (a) => res(a.trim()));
  });
}
// stdin 关闭（EOF/Ctrl+C）时，让未完成的 question 返回空串并优雅结束，
// 而不是抛出 ERR_USE_AFTER_CLOSE。
let stdinClosed = false;
process.stdin.on('end', () => { stdinClosed = true; });
process.stdin.on('close', () => {
  if (!stdinClosed) { stdinClosed = true; console.log(C.gray + '\n已退出。' + C.reset); }
  rl?.close();
});
process.on('SIGINT', () => {
  console.log(C.gray + '\n已取消。' + C.reset);
  process.exit(130);
});
async function confirm(q, def = false) {
  const hint = def ? '[Y/n]' : '[y/N]';
  const a = await ask(q + ' ' + hint);
  if (a === '') return def;
  return /^(y|yes)$/i.test(a);
}

// ============ 工具函数 ============
function sha256File(fp) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(fp);
    s.on('data', (d) => h.update(d));
    s.on('end', () => res(h.digest('hex')));
    s.on('error', rej);
  });
}
function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// 用 python3 解 zip（Node 无内置 unzip，python 有 zipfile 模块）
function pyUnzip(zipPath, outDir) {
  return runCmd(PYTHON, ['-c',
    `import zipfile,sys;zipfile.ZipFile(${JSON.stringify(zipPath)}).extractall(${JSON.stringify(outDir)})`],
    { silent: true });
}
function pyListZip(zipPath) {
  return new Promise((res, rej) => {
    const p = spawn(PYTHON, ['-c',
      `import zipfile,json;z=zipfile.ZipFile(${JSON.stringify(zipPath)});print(json.dumps([{"n":i.filename,"s":i.file_size} for i in z.infolist()]))`]);
    let out = '', err = '';
    p.stdout.on('data', (d) => out += d);
    p.stderr.on('data', (d) => err += d);
    p.on('close', (c) => c === 0 ? res(JSON.parse(out)) : rej(new Error(err || 'zip list failed')));
    p.on('error', rej);
  });
}

// 运行本地命令，返回 stdout
function runCmd(cmd, args, { silent = false, onLine } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', rej);
    p.on('close', (c) => {
      if (!silent) process.stdout.write(out);
      if (c === 0) res(out);
      else rej(new Error(err || out || `${cmd} 退出码 ${c}`));
    });
  });
}

// 运行 workbench 命令，逐行回传输出
function runWb(args, { onLine, timeoutMs = 0 } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(WB, args, { windowsHide: true, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
    let buf = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs) : null;
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (line.trim()) onLine?.(line);
      }
    });
    p.stderr.on('data', (d) => onLine?.(d.toString().replace(/\r?\n$/, '')));
    p.on('error', (e) => { if (timer) clearTimeout(timer); rej(e); });
    p.on('close', (c) => {
      if (timer) clearTimeout(timer);
      if (buf.trim()) onLine?.(buf.replace(/\r?\n$/, ''));
      if (timedOut) rej(new Error('超时 ' + timeoutMs + 'ms'));
      else res(c);
    });
  });
}

async function wbExec(instance, region, command, { onLine = () => {}, timeoutMs = 60000 } = {}) {
  const code = await runWb(['exec', '--instance-id', instance, '--region', region, '--command', command,
    '--timeout', String(Math.max(30, Math.ceil(timeoutMs / 1000)))], { onLine, timeoutMs });
  if (code !== 0) throw new Error('workbench exec 退出码 ' + code);
}

// ============ 校验包（本地） ============
async function validatePackage(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error('文件不存在：' + zipPath);
  if (path.extname(zipPath).toLowerCase() !== '.zip') throw new Error('不是 .zip 文件：' + zipPath);

  info('读取 zip 内文件清单…');
  const list = await pyListZip(zipPath);
  if (!list.length) throw new Error('zip 为空或无法解析');

  const relEntry = list.find((e) => e.n === 'release.json');
  const sumsEntry = list.find((e) => e.n === 'SHA256SUMS');
  const tarEntry = list.find((e) => e.n.endsWith('.tar.gz'));
  if (!relEntry) throw new Error('包内缺少 release.json —— 不是有效的 DOON 部署包');
  if (!sumsEntry) throw new Error('包内缺少 SHA256SUMS，不能验证部署包');
  if (!tarEntry) throw new Error('包内缺少 .tar.gz 部署文件');

  // 解到临时目录
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doon-validate-'));
  await pyUnzip(zipPath, tmp);
  const relPath = path.join(tmp, 'release.json');
  const tarPath = path.join(tmp, tarEntry.n);
  const sumsPath = sumsEntry ? path.join(tmp, 'SHA256SUMS') : null;

  let release;
  try { release = JSON.parse(fs.readFileSync(relPath, 'utf8')); }
  catch (e) { throw new Error('release.json 解析失败：' + e.message); }

  // 计算 tar sha256
  info('计算 tar.gz 的 SHA-256（约 115MB，几秒）…');
  const tarSha = await sha256File(tarPath);

  let sumsText = '';
  if (sumsPath && fs.existsSync(sumsPath)) sumsText = fs.readFileSync(sumsPath, 'utf8');

  const commit = release.commit || '';
  const commitOk = /^[0-9a-f]{40}$/.test(commit);
  const formatOk = release.format === 'doon-native-release-v1';
  const arch = release.architecture || release.arch || '';
  const platOk = release.platform === 'linux' && arch === 'x64';
  const expectedTarName = 'doon-native-' + commit + '-linux-x64-node24.tar.gz';
  const tarNameOk = tarEntry.n === expectedTarName;

  let tarShaExpected = '';
  if (sumsText) {
    const m = sumsText.match(/([0-9a-f]{64})\s+.*\.tar\.gz/);
    if (m) tarShaExpected = m[1];
  }
  const tarShaOk = tarShaExpected ? tarSha === tarShaExpected : null;

  // 统计清单
  let fileCount = 0, symlinks = 0;
  for (const k in release.files) {
    if (release.files[k].type === 'file') fileCount++;
    else if (release.files[k].type === 'symlink') symlinks++;
  }

  const problems = [];
  if (!formatOk) problems.push('格式不是 doon-native-release-v1');
  if (!commitOk) problems.push('commit 不是 40 位 hex');
  if (!platOk) problems.push('不是 linux/x64 目标包（当前 ' + release.platform + '/' + (release.architecture || release.arch || '?') + '）');
  if (!tarNameOk) problems.push('tar 文件名与 commit 不匹配（期望 ' + expectedTarName + '，实际 ' + tarEntry.n + '）');
  if (tarShaOk !== true) problems.push('tar SHA-256 缺失或与 SHA256SUMS 不一致');

  return {
    zipPath, tmp, tarPath, relPath,
    release, commit, commitOk, formatOk, platOk,
    tarName: tarEntry.n, tarNameOk, tarSha, tarShaExpected, tarShaOk,
    fileCount, symlinks, problems,
    zipSize: fs.statSync(zipPath).size,
    overallOk: problems.length === 0,
  };
}

function printValidation(v) {
  head('包校验结果');
  console.log('  文件        ' + path.basename(v.zipPath));
  console.log('  大小        ' + (v.zipSize / 1048576).toFixed(1) + ' MB');
  console.log('  commit      ' + (v.commit || '(无)'));
  console.log('  格式        ' + (v.release.format || '(无)'));
  console.log('  平台/架构   ' + (v.release.platform || '?') + ' / ' + (v.release.architecture || v.release.arch || '?'));
  console.log('  Node 版本   ' + (v.release.nodeVersion || '?'));
  console.log('  构建时间    ' + (v.release.builtAt || '?'));
  console.log('  CI run      ' + (v.release.runId || '?') + ' (attempt ' + (v.release.runAttempt || '?') + ')');
  console.log('  tar 文件    ' + v.tarName);
  console.log('  清单文件数  ' + v.fileCount + ' 文件 / ' + v.symlinks + ' 符号链接');
  console.log('  tar SHA256  ' + v.tarSha.slice(0, 16) + '…');

  if (v.problems.length) {
    bad('发现 ' + v.problems.length + ' 个问题：');
    for (const p of v.problems) console.log('    ' + C.red + '· ' + p + C.reset);
  } else {
    ok('所有校验通过，包正确');
  }
  console.log('');
}

// ============ 部署编排 ============
async function deploy(v, instance, region) {
  validateConfig({...deploymentConfig,instance,region});
  const {stamp,releaseDir,stageDir,uploadZip}=deploymentPaths(v.commit,RELEASES_DIR);
  // Keep the exact attempt for rollback; never reconstruct it from the commit.
  v.deployment={stamp,releaseDir,dropinPath:null};
  const tarName = v.tarName;

  const echo = (l) => dim('    ' + l);

  head('0. 连接服务器');
  await wbExec(instance, region, 'hostname && systemctl is-active ' + SERVICE + ' && df -h ' + RELEASES_DIR, { onLine: echo });
  ok('服务器可达');

  head('1. 上传部署包（走 OSS，约 115MB，请耐心等待）');
  const upCode = await runWb(['upload', v.zipPath, uploadZip, '--instance-id', instance, '--region', region],
    { onLine: echo, timeoutMs: 20 * 60 * 1000 });
  if (upCode !== 0) throw new Error('上传失败，退出码 ' + upCode);
  ok('上传完成');

  head('2. 解压 zip');
  await wbExec(instance, region,
    'mkdir ' + stageDir + ' && python3 -m zipfile -e ' + uploadZip + ' ' + stageDir + ' && echo UNZIP_OK',
    { onLine: echo, timeoutMs: 120000 });
  ok('解压完成');

  head('3. 服务器端校验 tar SHA-256');
  let remoteSha = '';
  await wbExec(instance, region,
    'cd ' + stageDir + ' && python3 -c "import hashlib;print(hashlib.sha256(open(\'' + tarName + '\',\'rb\').read()).hexdigest())"',
    { onLine: (l) => { echo(l); const m = l.match(/^([0-9a-f]{64})$/); if (m) remoteSha = m[1]; }, timeoutMs: 120000 });
  if (remoteSha !== v.tarSha) {
    bad('服务器端 sha256 不匹配：期望 ' + v.tarSha.slice(0, 16) + '，实际 ' + (remoteSha || '(空)').slice(0, 16));
    throw new Error('sha256 mismatch');
  }
  ok('tar SHA-256 一致');

  head('4. 解压到版本目录 ' + releaseDir);
  await wbExec(instance,region,pythonCommand(reserveReleaseProgram,{root:RELEASES_DIR,target:releaseDir}),{onLine:echo});
  await wbExec(instance, region,
    'tar -xzf ' + stageDir + '/' + tarName + ' -C ' + releaseDir + ' && chown -R doon:doon ' + releaseDir + ' && echo EXTRACT_OK',
    { onLine: echo, timeoutMs: 180000 });
  ok('解压完成');

  head('5. 核对文件数');
  let files = null, symlinks = null;
  await wbExec(instance, region,
    'echo FILES=$(find ' + releaseDir + ' -type f | wc -l); echo SYMLINKS=$(find ' + releaseDir + ' -type l | wc -l)',
    { onLine: (l) => { echo(l); const f = l.match(/FILES=(\d+)/); const s = l.match(/SYMLINKS=(\d+)/); if (f) files = Number(f[1]); if (s) symlinks = Number(s[1]); }, timeoutMs: 120000 });
  // 磁盘文件数 = 清单文件数 + 1（release.json 是最后写入的元数据，不在 files 清单里）
  const expectedDiskFiles = v.fileCount + 1;
  if (files !== expectedDiskFiles || symlinks !== v.symlinks) {
    bad('文件数不匹配：清单文件 ' + v.fileCount + ' + release.json(1) = ' + expectedDiskFiles + '，实际 ' + files);
    throw new Error('file count mismatch');
  }
  ok('文件数一致（' + files + ' 文件，含 release.json / ' + symlinks + ' 符号链接）');

  head('6. 停机前在线快照');
  const snapName = 'predeploy-' + stamp + '.sqlite';
  let verifiedSnapshot=false;
  await wbExec(instance,region,pythonCommand(snapshotProgram,{source:DATA_DIR+'/workspace.sqlite',target:DATA_DIR+'/backups/'+snapName}),{onLine:line=>{echo(line);try{const report=JSON.parse(line);verifiedSnapshot=report.snapshot==='verified'&&/^[0-9a-f]{64}$/.test(report.sha256);}catch{}},timeoutMs:120000});
  if(!verifiedSnapshot)throw Error('未取得完整性校验通过的在线备份，停止切换服务');
  ok('在线快照及完整性校验通过');

  head('7. 切换服务（写 drop-in + 重启）');
  const dropin = '[Service]\nWorkingDirectory=' + releaseDir + '\nExecStart=\nExecStart=' + NODE_BIN + ' ' + releaseDir + '/lan-dist/server.mjs\nEnvironmentFile=' + ENV_FILE + '\n';
  let dropinPath='';
  await wbExec(instance,region,pythonCommand(writeDropinProgram,{directory:DROPIN_DIR,stamp,content:dropin}),{onLine:line=>{echo(line);try{const value=JSON.parse(line).dropin;if(typeof value==='string'&&value.startsWith(DROPIN_DIR+'/')&&/^[a-zA-Z0-9_.-]+$/.test(value.slice(DROPIN_DIR.length+1)))dropinPath=value;}catch{}}});
  if(!dropinPath)throw Error('未确认本次服务配置路径，请人工核查；未重启服务');
  v.deployment.dropinPath=dropinPath;
  await wbExec(instance,region,'systemctl daemon-reload',{onLine:echo});
  await wbExec(instance,region,pythonCommand(effectiveReleaseProgram,{service:SERVICE,releaseDir}),{onLine:echo});
  await wbExec(instance, region,
    'systemctl restart ' + SERVICE + ' && echo RESTART_OK',
    { onLine: echo, timeoutMs: 120000 });
  ok('服务已切换');

  head('8. 验证上线');
  let verifiedDeployment=false;
  await wbExec(instance,region,pythonCommand(verifyReleaseProgram,{service:SERVICE,releaseDir,commit:v.commit,origin:'http://127.0.0.1:8787',host:deploymentConfig.healthHost,proxyHttps:deploymentConfig.proxyHttps===true}),{onLine:line=>{echo(line);if(line==='DEPLOYMENT_VERIFIED')verifiedDeployment=true;},timeoutMs:120000});
  if(!verifiedDeployment)throw Error('未确认运行版本和HTTP健康状态，不能报告部署成功');
  ok('验证完成');

  console.log('');
  title('✅ 部署完成');
  console.log('  版本目录  ' + releaseDir);
  console.log('  drop-in   ' + dropinPath);
  console.log('  commit    ' + v.commit);
  console.log('  快照      ' + DATA_DIR + '/backups/' + snapName);
  console.log(C.gray + '  回退：删除 ' + dropinPath + ' 后 systemctl daemon-reload && restart' + C.reset);
}

// ============ 回退 ============
async function rollback(v, instance, region) {
  const dropinPath=v.deployment?.dropinPath;
  if(!dropinPath){info('本次尚未写入已确认的服务配置，没有可自动撤销的切换。');return;}
  head('回退：删除新 drop-in 并重启');
  await wbExec(instance, region,
    'rm -f ' + dropinPath + ' && systemctl daemon-reload && systemctl restart ' + SERVICE + ' && echo ROLLBACK_OK',
    { onLine: (l) => dim('    ' + l), timeoutMs: 120000 });
  ok('回退完成，服务已回到上一版本');
}

// ============ 主流程 ============
async function main() {
  title('\nDOON 一键部署工具（交互式向导）\n');

  let zipPath = process.argv[2];
  if (!zipPath) {
    zipPath = await ask('请输入 CI 下载的 .zip 包路径（可直接拖入）：');
    zipPath = zipPath.replace(/^["']|["']$/g, '');  // 去掉拖入时可能带上的引号
  }
  if (!zipPath) { bad('未提供包路径'); process.exit(1); }

  let v;
  try {
    v = await validatePackage(zipPath);
  } catch (e) {
    bad('包校验失败：' + e.message);
    process.exit(1);
  }

  printValidation(v);

  if (!v.overallOk) {
    bad('这是错误的包，已拒绝部署。请重新从 CI 下载正确产物。');
    process.exit(1);
  }

  let instance, region;
  if (AUTO) {
    instance = DEFAULT_INSTANCE;
    region = DEFAULT_REGION;
  } else {
    instance = (await ask('服务器实例 ID [' + DEFAULT_INSTANCE + ']：')) || DEFAULT_INSTANCE;
    region = (await ask('区域 [' + DEFAULT_REGION + ']：')) || DEFAULT_REGION;
  }

  if (AUTO) {
    console.log('  实例  ' + instance + '  区域  ' + region + '   (--yes 自动确认)');
  } else {
    console.log('');
    if (!await confirm('确认部署 commit ' + v.commit.slice(0, 7) + ' 到 ' + instance + ' 并切换服务？')) {
      warn('已取消');
      process.exit(0);
    }
  }

  try {
    await deploy(v, instance, region);
  } catch (e) {
    bad('部署中断：' + e.message);
    if (await confirm('是否立即回退到上一版本？')) {
      try { await rollback(v, instance, region); }
      catch (e2) { bad('回退失败：' + e2.message); }
    }
    process.exit(1);
  } finally {
    // 清理本地临时解包目录
    if (v && v.tmp) { try { fs.rmSync(v.tmp, { recursive: true, force: true }); } catch {} }
    rl?.close();
  }
}

// 非交互模式：node deploy.mjs <zip> --yes  （跳过所有确认，直接部署）
const AUTO = process.argv.includes('--yes') || process.argv.includes('-y');

export { validatePackage, deploy, rollback, printValidation, DEFAULT_INSTANCE, DEFAULT_REGION };

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
