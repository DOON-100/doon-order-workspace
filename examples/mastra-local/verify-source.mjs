import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve, relative, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const exec = promisify(execFile);
const commit = 'f88217d19b63d362ff97723c1a339fbf89a1bbb0';
const source = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node verify-source.mjs <local Mastra clone>');
const {stdout: head} = await exec('git', ['-C', source, 'rev-parse', 'HEAD']);
assert.equal(head.trim(), commit, 'Source must match the pinned stable release.');
const {stdout: tree} = await exec('git', ['-C', source, 'ls-tree', '-r', 'HEAD', 'packages/core/src'], {maxBuffer: 4 * 1024 * 1024});
const expected = new Map(tree.trim().split('\n').map(line => {
  const match = /^\d+ blob ([a-f0-9]{40})\t(.+)$/.exec(line);
  return match ? [match[2], match[1]] : ['', ''];
}));
const packageRoot = dirname(fileURLToPath(import.meta.resolve('@mastra/core/package.json')));
const distribution = join(packageRoot, 'dist');
const restored = new Set();
function blobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

// GitHub's blob endpoint can be unavailable even after a partial clone succeeds.
// Published source maps contain original TS: restore only bytes whose Git blob
// hash EXACTLY matches this clone's pinned tree. No generated substitute is used.
for (const name of await readdir(distribution, {recursive: true})) {
  if (!name.endsWith('.js.map')) continue;
  const mapPath = join(distribution, name), map = JSON.parse(await readFile(mapPath, 'utf8'));
  for (let i = 0; i < (map.sources || []).length; i++) {
    if (typeof map.sourcesContent?.[i] !== 'string') continue;
    const rel = relative(join(packageRoot, 'src'), resolve(dirname(mapPath), map.sources[i]));
    if (isAbsolute(rel) || rel.startsWith('..')) continue;
    const gitPath = `packages/core/src/${rel.replaceAll('\\', '/')}`;
    if (restored.has(gitPath) || !expected.has(gitPath)) continue;
    const bytes = Buffer.from(map.sourcesContent[i]);
    if (blobHash(bytes) !== expected.get(gitPath)) continue;
    const target = join(source, gitPath);
    try { assert.equal(blobHash(await readFile(target)), expected.get(gitPath), `Existing source changed: ${gitPath}`); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(dirname(target), {recursive: true}); await writeFile(target, bytes);
    }
    restored.add(gitPath);
  }
}
assert(restored.size > 100, 'Expected substantial hash-verified original core sources.');
// Cache the exact blobs in the local partial clone so Git can inspect them offline.
await new Promise((accept, reject) => {
  const writer = spawn('git', ['-C', source, 'hash-object', '-w', '--stdin-paths'], {stdio: ['pipe', 'ignore', 'pipe']});
  let error = ''; writer.stderr.on('data', bytes => { error += bytes; });
  writer.on('error', reject); writer.on('close', code => code === 0 ? accept() : reject(new Error(error)));
  writer.stdin.end([...restored].join('\n') + '\n');
});
const rowDiffPath = join(source, 'packages/core/src/schedules/row-diff.ts');
assert(restored.has('packages/core/src/schedules/row-diff.ts'));
const {targetsEqual, metadataEqual} = await import(pathToFileURL(rowDiffPath));
const target = {type: 'agent', inputData: {agentId: 'synthetic-duty', prompt: 'Daily check'}};
assert.equal(targetsEqual(structuredClone(target), target), true);
assert.equal(targetsEqual({...target, inputData: {...target.inputData, prompt: 'Changed check'}}, target), false);
assert.equal(targetsEqual(undefined, target), false);
assert.equal(metadataEqual(null, undefined), true);
assert.equal(metadataEqual({version: 1}, {version: 2}), false);
console.log(JSON.stringify({commit, verifiedOriginalCoreFiles: restored.size, directSourceChecks: 5,
  scope: 'Original TS source checks plus separate released-SDK integration tests; not a full monorepo build.'}, null, 2));
