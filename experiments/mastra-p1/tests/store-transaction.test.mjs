import test from 'node:test';
import assert from 'node:assert/strict';
import {link,unlink,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createSandbox,openSuggestionStore,removeSandbox,validateSandbox,sandboxDigest} from '../sandbox.mjs';

test('suggestion batch commits once, retries idempotently, and rolls back all earlier inserts on a later conflict',async()=>{
  const directory=await createSandbox();let store;
  try {
    store=await openSuggestionStore(directory,{readOnly:false});
    const one={id:'syn-one',actorId:'syn-employee-a',title:'SYNTHETIC ONE',runId:'syn-first'},two={id:'syn-two',actorId:'syn-employee-a',title:'SYNTHETIC TWO',runId:'syn-first'};
    assert.deepEqual(store.addBatch([one,two]),[true,true]);
    const before=store.list('syn-employee-a'),digest=await sandboxDigest(directory);
    assert.deepEqual(store.addBatch([{...one,runId:'syn-retry'},{...two,runId:'syn-retry'}]),[false,false]);
    assert.equal(await sandboxDigest(directory),digest);
    assert.throws(()=>store.addBatch([{id:'syn-new',actorId:'syn-employee-a',title:'SYNTHETIC NEW'},{...two,title:'CONFLICT'}]),/冲突/);
    assert.equal(store.count(),2);assert.deepEqual(store.list('syn-employee-a'),before);
    assert.equal(await sandboxDigest(directory),digest);
    assert.throws(()=>store.addBatch(Array(51).fill(one)),/批次/);
  } finally {store?.close();await removeSandbox(directory);}
});

test('read-only store rejects batch creation without changing database bytes',async()=>{
  const directory=await createSandbox();let store;
  try {store=await openSuggestionStore(directory);const digest=await sandboxDigest(directory);assert.throws(()=>store.addBatch([]),/只读/);assert.equal(await sandboxDigest(directory),digest);}
  finally {store?.close();await removeSandbox(directory);}
});

test('sandbox validation refuses hard-linked marker, database and SQLite sidecars before any open or cleanup',async()=>{
  const directory=await createSandbox(),sentinel=path.join(directory,'test-sentinel.txt');
  try {
    for(const name of ['synthetic-sandbox.json','suggestions.sqlite']) {
      const alias=path.join(directory,'test-alias');await link(path.join(directory,name),alias);
      try {await assert.rejects(validateSandbox(directory),/链接/);await assert.rejects(openSuggestionStore(directory,{readOnly:false}),/链接/);}
      finally {await unlink(alias);}
    }
    await writeFile(sentinel,'SYNTHETIC SENTINEL');
    for(const suffix of ['-journal','-wal','-shm']) {
      const alias=path.join(directory,'suggestions.sqlite'+suffix);await link(sentinel,alias);
      try {await assert.rejects(validateSandbox(directory),/链接/);assert.equal(await readFile(sentinel,'utf8'),'SYNTHETIC SENTINEL');}
      finally {await unlink(alias);}
    }
  } finally {await removeSandbox(directory);}
});
