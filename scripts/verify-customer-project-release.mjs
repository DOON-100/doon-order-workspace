// Verifies public-code build and isolated-test evidence only. No business DB access.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyCustomerPriceBuildEvidence} from './customer-price-build-evidence.mjs';
const stage=path.resolve(process.argv[2]||'test-output/customer-project-build');
assert.equal(stage,path.resolve('test-output/customer-project-build'),'Unexpected stage');
const evidence=await verifyCustomerPriceBuildEvidence(stage);
const acceptance=JSON.parse(await fs.readFile('test-output/customer-project-release-validation.json','utf8'));
assert.equal(acceptance.manifestSha256,evidence.manifestSha256,'Tests must use this exact build');
assert.equal(acceptance.typescript,true);
assert.equal(acceptance.business,true);
assert.equal(acceptance.runtime,true);
assert.equal(acceptance.browser,true);
assert.equal(acceptance.productionWrites,0);
assert.equal(acceptance.errors.length,0);
assert(Date.now()-Date.parse(acceptance.at)<24*60*60*1000,'Acceptance evidence expired');
console.log(JSON.stringify({verified:true,...evidence}));
