// Public code/build evidence only. This gate never opens a business database.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyCustomerPriceBuildEvidence} from './customer-price-build-evidence.mjs';
const stage=path.resolve(process.argv[2]||'test-output/ar-workspace-build');
assert.equal(stage,path.resolve('test-output/ar-workspace-build'),'Unexpected receivables staging directory');
const evidence=await verifyCustomerPriceBuildEvidence(stage);
// The shared evidence helper recursively hashes app/lib/components/build/public/
// scripts/standalone, not only customer-price code. Require this release's key
// source and bundled entries explicitly as an additional stale-build safeguard.
const manifest=JSON.parse(await fs.readFile(path.join(stage,'customer-price-build-evidence.json'),'utf8'));
for(const filename of ['app/ar-workspace-panel.tsx','app/ar-workspace.css','app/payment-terms-panel.tsx','lib/ar-workspace.ts','lib/ar-workspace-api.ts','lib/ar-document-issue.ts','lib/payment-terms.ts','lib/payment-terms-api.ts','app/api/workspace/[action]/route.ts','standalone/main.tsx','standalone/server.mjs'])assert(manifest.sourceHashes[filename],`Required source absent from build evidence: ${filename}`);
for(const filename of ['client/index.html','workspace-api.mjs','server.mjs','runtime.mjs','auth.mjs'])assert(manifest.artifactHashes[filename],`Required artifact absent from build evidence: ${filename}`);
assert(Object.keys(manifest.artifactHashes).some(filename=>filename.startsWith('client/assets/')&&filename.endsWith('.js')),'Client bundle absent from build evidence');
const acceptance=JSON.parse(await fs.readFile('test-output/ar-workspace-release-validation.json','utf8'));
assert.equal(acceptance.manifestSha256,evidence.manifestSha256,'Acceptance must refer to this exact source/build');
for(const key of ['typescript','business','runtime','browser'])assert.equal(acceptance[key],true,`${key} acceptance is incomplete`);
assert.equal(acceptance.productionWrites,0,'Acceptance must use isolated data');
assert.deepEqual(acceptance.errors,[]);
const age=Date.now()-Date.parse(acceptance.at);
assert(Number.isFinite(age)&&age>=-5*60*1000&&age<24*60*60*1000,'Acceptance evidence is missing, future-dated or expired');
console.log(JSON.stringify({verified:true,...evidence}));
