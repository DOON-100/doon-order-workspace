import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {root, temporary} from './helpers.mjs';

test('source audit accepts supported stage-only routes but rejects unknown and stale mappings', async () => {
  const dir = await temporary();
  const sources = ['cli/scripts/audit-navigation-coverage.mjs', 'lib/department-workspace-navigation.ts', 'app/business-process-panel.tsx', 'cli/src/catalog.ts', 'cli/src/routes.ts', 'cli/package.json', 'app/[section]/page.tsx', 'app/workspace.tsx'];
  const original = Object.fromEntries(await Promise.all(sources.map(async name => [name, await fs.readFile(path.join(root, name), 'utf8')])));
  for (const [name, text] of Object.entries(original)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), {recursive: true});
    await fs.writeFile(path.join(dir, name), text);
  }
  await fs.cp(path.join(root, 'cli/dist'), path.join(dir, 'cli/dist'), {recursive: true});
  // CI installs CLI dependencies only; the isolated script must not rely on an
  // unrelated installation in the repository root's node_modules directory.
  const typescript = path.dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
  await fs.cp(typescript, path.join(dir, 'cli/node_modules/typescript'), {recursive: true});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DOON_|^NODE_OPTIONS$|^NODE_PATH$/i.test(key)));
  async function audit(name, expectedCode) {
    const output = path.join(dir, 'test-output', name + '.json'); let code = 0, failure = '';
    try { execFileSync(process.execPath, [path.join(dir, 'cli/scripts/audit-navigation-coverage.mjs'), '--output', output], {cwd: dir, env, windowsHide: true, stdio: 'pipe'}); }
    catch (error) { code = error.status; failure = String(error.stderr || ''); }
    assert.equal(code, expectedCode, name + (failure ? ': ' + failure : ''));
    return JSON.parse(await fs.readFile(output, 'utf8'));
  }
  const report = await audit('supported-stage-only', 0);
  assert(!report.navigation.some(entry => entry.entryId === 'service-workspace'));
  const service = report.stages.find(stage => stage.id === 'S13').entries.find(entry => entry.entryId === 'service-workspace');
  assert.equal(service.status, 'family-linked'); assert.equal(service.mappingSource, 'stage-only-route');
  assert.deepEqual(service.families, ['service records', 'service shipments', 'finance receivables']);
  assert.equal(service.routeSource.path, 'app/[section]/page.tsx'); assert.equal(service.renderSource.path, 'app/workspace.tsx');
  assert(report.sourceHashes[service.routeSource.path]); assert(report.sourceHashes[service.renderSource.path]);
  assert(report.limitations.some(text => text.includes('不代表逐按钮')));

  const stagePath = 'app/business-process-panel.tsx';
  assert(original[stagePath].includes("view:'service-workspace'"));
  await fs.writeFile(path.join(dir, stagePath), original[stagePath].replace("view:'service-workspace'", "view:'synthetic-unknown-stage'"));
  const unknown = await audit('unknown-stage', 2);
  assert.equal(unknown.stages.find(stage => stage.id === 'S13').entries.find(entry => entry.entryId === 'synthetic-unknown-stage').status, 'needs-review');
  await fs.writeFile(path.join(dir, stagePath), original[stagePath]);

  const pagePath = 'app/[section]/page.tsx';
  assert(original[pagePath].includes("'service-workspace'"));
  await fs.writeFile(path.join(dir, pagePath), original[pagePath].replace("'service-workspace'", "'synthetic-unavailable'"));
  const removedRoute = await audit('mapped-without-route', 2);
  assert.equal(removedRoute.stages.find(stage => stage.id === 'S13').entries.find(entry => entry.entryId === 'service-workspace').status, 'needs-review');
  await fs.writeFile(path.join(dir, pagePath), original[pagePath]);

  const viewPath = 'app/workspace.tsx';
  assert(original[viewPath].includes("view==='service-workspace'&&"));
  await fs.writeFile(path.join(dir, viewPath), original[viewPath].replace("view==='service-workspace'&&", "view==='synthetic-unavailable'&&"));
  const removedView = await audit('mapped-without-view', 2);
  assert.equal(removedView.stages.find(stage => stage.id === 'S13').entries.find(entry => entry.entryId === 'service-workspace').status, 'needs-review');
});
