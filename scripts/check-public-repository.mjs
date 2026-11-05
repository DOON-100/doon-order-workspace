import {execFileSync} from 'node:child_process';

// Inspect Git paths only. Never open working-tree files or ignored private data.
// This guard is not a content, credential or personal-information scanner.
const privateDirectories = new Set([
  'lan-data', 'lan-dist', 'private-data-tools', 'test-output', 'node_modules',
  '.codex', '.agents', '.sites-runtime', '.workbuddy', '.wrangler', '.next',
  '.vinext', '.vercel', '.npm-cache', 'backup-keys', 'outputs', 'work',
]);
const privatePaths = new Set([
  '.openai/hosting.local.json', 'deploy-tool/local-config.json',
  'originals-manifest.json', 'import-expectations.json',
  'scripts/setup-jinbo-pilot.mjs',
  '协作修复说明-20260917.md',
]);
const privateExtension = /\.(?:key|pem|p12|pfx|sqlite(?:3)?(?:[-.].*)?|db(?:[-.].*)?|env|enc|xlsx|xls|xlsm|xlsb|csv|tsv|pdf|zip|tar|gz|bak|dump|bundle)$/i;

function reasonFor(name) {
  const normalized = name.toLowerCase();
  const parts = normalized.split('/');
  if (parts.some(part => privateDirectories.has(part))) {
    return 'private data, runtime output or local tool directory';
  }
  if (privatePaths.has(normalized)) return 'private configuration or retired one-off business script';
  if ((normalized === 'encrypted-backups' || normalized.startsWith('encrypted-backups/')) && name !== 'encrypted-backups/README.md') {
    return 'public encrypted backups are retired; only encrypted-backups/README.md is allowed';
  }
  if (/^\.env(?:\..*)?$/i.test(parts.at(-1)) || privateExtension.test(normalized)) {
    return 'credential, database, original business file or archive extension';
  }
  return null;
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024});
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/check-public-repository.mjs [--ref <tree-ish>]');
    console.log('Checks paths in the Git index by default, or a committed tree with --ref.');
    console.log('Does not read file contents, ignored files, credentials or databases. This is not a full secret scan.');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--ref' || !args[1])) {
    throw new Error('Usage: node scripts/check-public-repository.mjs [--ref <tree-ish>]');
  }
  let names;
  let source = 'Git index';
  if (args.length) {
    const tree = git(['rev-parse', '--verify', '--end-of-options', args[1] + '^{tree}']).trim();
    names = git(['ls-tree', '-r', '-z', '--name-only', tree]).split('\0').filter(Boolean);
    source = 'requested Git tree';
  } else {
    names = [...new Set(git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)
      .map(entry => entry.slice(entry.indexOf('\t') + 1)))];
  }
  const blocked = names.map(name => ({name, reason: reasonFor(name)})).filter(item => item.reason);
  for (const {name, reason} of blocked) console.error('BLOCKED ' + JSON.stringify(name) + ': ' + reason);
  console.log(`Public repository path check: ${names.length} paths in ${source}; ${blocked.length} blocked.`);
  console.log('Paths only; file contents and Git history were not scanned for secrets or personal information.');
  if (blocked.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error('Public repository path check could not complete: ' + error.message);
  process.exitCode = 2;
}
