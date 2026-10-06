import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createBackup, restoreBackup} from './encrypted-backup.mjs';

await fs.mkdir('test-output', {recursive: true});
const root = await fs.mkdtemp(path.resolve('test-output', 'encrypted-backup-'));
const data = path.join(root, 'data'), keyFile = path.join(root, 'local', 'backup.key'), output = path.join(root, 'encrypted');
await fs.mkdir(path.join(data, 'files'), {recursive: true});
const objectName = createHash('sha256').update('synthetic/attachment.xlsx').digest('hex');
const content = Buffer.from('合成测试附件\n');
await fs.writeFile(path.join(data, 'files', objectName), content);
await fs.writeFile(path.join(data, 'files', `${objectName}.pending.tmp`), 'incomplete upload');
const live = new DatabaseSync(path.join(data, 'workspace.sqlite'));
try {
  live.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT); CREATE TABLE local_sessions(id TEXT);');
  live.prepare('INSERT INTO records VALUES(?,?)').run('synthetic-order', 'committed-in-WAL');
  live.prepare('INSERT INTO local_sessions VALUES(?)').run('synthetic-session');
  assert((await fs.stat(path.join(data, 'workspace.sqlite-wal'))).size > 0);
  await createBackup({dataDir: data, keyFile, outputDir: output});
  live.prepare('INSERT INTO records VALUES(?,?)').run('later-order', 'after-snapshot');
  const destination = path.join(root, 'restored');
  const result = await restoreBackup({backupDir: output, keyFile, destination});
  assert.equal(result.files, 1);
  const restored = new DatabaseSync(path.join(destination, 'workspace.sqlite'), {readOnly: true});
  try {
    assert.deepEqual(restored.prepare('SELECT id,value FROM records').all().map(r => [r.id,r.value]), [['synthetic-order','committed-in-WAL']]);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM local_sessions').get().n, 1);
  } finally { restored.close(); }
  assert.deepEqual(await fs.readFile(path.join(destination, 'files', objectName)), content);
  assert.equal(live.prepare('SELECT COUNT(*) AS n FROM records').get().n, 2);
  assert.equal(live.prepare('SELECT COUNT(*) AS n FROM local_sessions').get().n, 1);
  assert.equal((await fs.readFile(keyFile)).length, 32);
  assert.deepEqual((await fs.readdir(output)).sort(), ['manifest.json','workspace.tar.gz.enc']);
  console.log('PASS WAL 中已提交数据及附件完整还原，生产数据不修改，未完成上传和密钥不进入归档');

  const wrongKey = path.join(root, 'wrong.key'); await fs.writeFile(wrongKey, randomBytes(32));
  const wrongDestination = path.join(root, 'wrong-restore');
  await assert.rejects(restoreBackup({backupDir: output, keyFile: wrongKey, destination: wrongDestination}), /密钥/);
  await assert.rejects(fs.stat(wrongDestination), {code: 'ENOENT'});
  await assert.rejects(restoreBackup({backupDir: output, keyFile, destination}), /已存在/);
  await assert.rejects(createBackup({dataDir: data, keyFile, outputDir: output}), {code: 'EEXIST'});
  console.log('PASS 错误密钥、重复备份及已有还原目录均被拒绝');

  const encrypted = path.join(output, 'workspace.tar.gz.enc'), bytes = await fs.readFile(encrypted);
  bytes[24] ^= 1; await fs.writeFile(encrypted, bytes);
  // Rewrite the public hash: GCM must still reject a forged ciphertext.
  const manifestFile = path.join(output, 'manifest.json'), manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.archive.sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const tamperedDestination = path.join(root, 'tampered-restore');
  await assert.rejects(restoreBackup({backupDir: output, keyFile, destination: tamperedDestination}));
  await assert.rejects(fs.stat(tamperedDestination), {code: 'ENOENT'});
  console.log('PASS 篡改密文即使修改公开校验值也无法通过认证，失败时不生成还原目录');
} finally { live.close(); }
