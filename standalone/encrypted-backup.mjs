import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash, createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {DatabaseSync, backup} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';

const run = promisify(execFile);
const magic = Buffer.from('DOONBAK1');
const maxBytes = 95 * 1024 * 1024;
const archiveName = 'workspace.tar.gz.enc';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function inventory(root, prefix = '') {
  const entries = [];
  for (const item of await fs.readdir(path.join(root, prefix), {withFileTypes: true})) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error('备份不允许符号链接');
    if (item.isDirectory()) entries.push(...await inventory(root, name));
    else if (item.isFile()) entries.push({name, bytes: (await fs.stat(path.join(root, name))).size, sha256: await sha256(path.join(root, name))});
    else throw new Error('备份包含非普通文件');
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function checkDatabase(file) {
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const results = db.prepare('PRAGMA integrity_check').all();
    if (results.length !== 1 || Object.values(results[0])[0] !== 'ok') throw new Error('数据库完整性检查失败');
  } finally { db.close(); }
}

async function readKey(file, create = false) {
  if (create) {
    await fs.mkdir(path.dirname(file), {recursive: true});
    try { await fs.writeFile(file, randomBytes(32), {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const key = await fs.readFile(file);
  if (key.length !== 32) throw new Error('密钥文件必须包含 32 字节的随机密钥');
  return key;
}

async function temporaryWork(fn) {
  const parent = path.resolve(os.tmpdir());
  const work = await fs.mkdtemp(path.join(parent, 'doon-encrypted-backup-'));
  try { return await fn(work); }
  finally {
    if (path.dirname(work) !== parent || !path.basename(work).startsWith('doon-encrypted-backup-')) throw new Error('临时目录范围校验失败');
    await fs.rm(work, {recursive: true, force: true});
  }
}

export async function createBackup({dataDir, keyFile, outputDir}) {
  dataDir = path.resolve(dataDir); keyFile = path.resolve(keyFile); outputDir = path.resolve(outputDir);
  const relativeKey = path.relative(outputDir, keyFile);
  if (!relativeKey.startsWith(`..${path.sep}`) && relativeKey !== '..' && !path.isAbsolute(relativeKey)) throw new Error('密钥必须保存在备份上传目录之外');
  const key = await readKey(keyFile, true);
  await fs.mkdir(outputDir, {recursive: false}); // Never replace an existing snapshot.
  return temporaryWork(async work => {
    const snapshot = path.join(work, 'snapshot');
    await fs.mkdir(path.join(snapshot, 'files'), {recursive: true});
    const createdAt = new Date().toISOString();
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), {readOnly: true});
    try {
      db.exec('PRAGMA busy_timeout=5000');
      await backup(db, path.join(snapshot, 'workspace.sqlite'));
    } finally { db.close(); }
    // Runtime objects are immutable. Copy them after taking the WAL-aware DB snapshot.
    for (const entry of await fs.readdir(path.join(dataDir, 'files'), {withFileTypes: true})) {
      if (entry.name.endsWith('.tmp')) continue;
      if (!entry.isFile() || !/^[0-9a-f]{64}$/.test(entry.name)) throw new Error('附件目录包含不符合对象存储格式的文件');
      await fs.copyFile(path.join(dataDir, 'files', entry.name), path.join(snapshot, 'files', entry.name));
    }
    // The online backup is complete; make this copy standalone without WAL sidecars.
    // Only the temporary snapshot is opened writable, never the live database.
    const snapshotDb = new DatabaseSync(path.join(snapshot, 'workspace.sqlite'));
    try { snapshotDb.exec('PRAGMA journal_mode=DELETE'); }
    finally { snapshotDb.close(); }
    checkDatabase(path.join(snapshot, 'workspace.sqlite'));
    const entries = await inventory(snapshot);
    await fs.writeFile(path.join(snapshot, 'manifest.json'), JSON.stringify({format: 'DOON-SNAPSHOT-1', createdAt, entries}, null, 2));
    const plainArchive = path.join(work, 'snapshot.tar.gz');
    await run('tar', ['-czf', plainArchive, '-C', snapshot, 'workspace.sqlite', 'files', 'manifest.json'], {windowsHide: true});
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic);
    const encrypted = path.join(outputDir, archiveName);
    await fs.writeFile(encrypted, Buffer.concat([magic, iv]), {flag: 'wx'});
    await pipeline(createReadStream(plainArchive), cipher, createWriteStream(encrypted, {flags: 'a'}));
    await fs.appendFile(encrypted, cipher.getAuthTag());
    const bytes = (await fs.stat(encrypted)).size;
    if (bytes > maxBytes) throw new Error('加密文件超过 95 MiB，请分卷后再上传到 GitHub');
    const manifest = {format: 'DOONBAK1', createdAt, algorithm: 'AES-256-GCM', compression: 'gzip', keyId: createHash('sha256').update(key).digest('hex').slice(0, 16), archive: {name: archiveName, bytes, sha256: await sha256(encrypted)}};
    await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  });
}

export async function restoreBackup({backupDir, keyFile, destination}) {
  backupDir = path.resolve(backupDir); keyFile = path.resolve(keyFile); destination = path.resolve(destination);
  try { await fs.lstat(destination); throw new Error('还原目录已存在，不能覆盖运行中的数据'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = await readKey(keyFile);
  const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'DOONBAK1' || manifest.algorithm !== 'AES-256-GCM' || manifest.archive?.name !== archiveName) throw new Error('不支持的备份格式');
  if (manifest.keyId !== createHash('sha256').update(key).digest('hex').slice(0, 16)) throw new Error('密钥与备份不匹配');
  const encrypted = path.join(backupDir, archiveName), size = (await fs.stat(encrypted)).size;
  if (size < 36 || size !== manifest.archive.bytes || await sha256(encrypted) !== manifest.archive.sha256) throw new Error('加密备份校验失败');
  return temporaryWork(async work => {
    const file = await fs.open(encrypted, 'r');
    const header = Buffer.alloc(20), tag = Buffer.alloc(16);
    try { await file.read(header, 0, 20, 0); await file.read(tag, 0, 16, size - 16); }
    finally { await file.close(); }
    if (!header.subarray(0, 8).equals(magic)) throw new Error('加密备份文件头无效');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
    decipher.setAAD(magic); decipher.setAuthTag(tag);
    const archive = path.join(work, 'snapshot.tar.gz');
    await pipeline(createReadStream(encrypted, {start: 20, end: size - 17}), decipher, createWriteStream(archive, {flags: 'wx', mode: 0o600}));
    // Authenticate before extracting. Only our flat, hashed object paths are allowed.
    const {stdout} = await run('tar', ['-tzf', archive], {windowsHide: true, maxBuffer: 16 * 1024 * 1024});
    const names = stdout.trim().split(/\r?\n/);
    if (new Set(names).size !== names.length || names.some(name => !['workspace.sqlite', 'manifest.json', 'files/'].includes(name) && !/^files\/[0-9a-f]{64}$/.test(name))) throw new Error('备份包含不安全的归档路径');
    const snapshot = path.join(work, 'restored'); await fs.mkdir(snapshot);
    await run('tar', ['-xzf', archive, '-C', snapshot, '--no-same-owner'], {windowsHide: true});
    const actual = await inventory(snapshot);
    const inner = JSON.parse(await fs.readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
    if (inner.format !== 'DOON-SNAPSHOT-1' || JSON.stringify(actual.filter(e => e.name !== 'manifest.json')) !== JSON.stringify(inner.entries)) throw new Error('还原文件完整性校验失败');
    checkDatabase(path.join(snapshot, 'workspace.sqlite'));
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.mkdir(destination); // Exclusive creation also protects against a concurrent restore.
    for (const entry of await fs.readdir(snapshot)) {
      await fs.cp(path.join(snapshot, entry), path.join(destination, entry), {recursive: true, errorOnExist: true, force: false});
    }
    return {destination, integrity: 'ok', files: inner.entries.filter(e => e.name.startsWith('files/')).length};
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('参数格式：--参数名 值');
    options[args[i].slice(2)] = args[i + 1];
  }
  try {
    if (command === 'create') {
      const outputDir = options.output || path.join(project, 'encrypted-backups', new Date().toISOString().replace(/[:.]/g, '-'));
      await fs.mkdir(path.dirname(outputDir), {recursive: true});
      const result = await createBackup({dataDir: options.data || path.join(project, 'lan-data'), keyFile: options.key || path.join(project, 'lan-data', 'backup-keys', 'repository-backup.key'), outputDir});
      console.log(JSON.stringify({outputDir: path.resolve(outputDir), ...result}, null, 2));
    } else if (command === 'restore' && options.backup && options.key && options.destination) {
      console.log(JSON.stringify(await restoreBackup({backupDir: options.backup, keyFile: options.key, destination: options.destination}), null, 2));
    } else throw new Error('用法：create [--data 目录] [--key 本机密钥路径] [--output 新备份目录] 或 restore --backup 备份目录 --key 本机密钥路径 --destination 新还原目录');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
