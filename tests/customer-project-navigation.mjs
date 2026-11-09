import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/handoff-navigation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {readWorkspaceContext}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.deepEqual(readWorkspaceContext('?projectId=synthetic-project&recordId=old-assignment-nonce&tab=assign-task'),{projectId:'synthetic-project',tab:'directory'},'Old assignment links must open records without replaying a create command');
for(const tab of ['project-task','followup','drawings','quotes','finance','progress'])assert.deepEqual(readWorkspaceContext('?projectId=synthetic-project&recordId=synthetic-record&tab='+tab),{projectId:'synthetic-project',recordId:'synthetic-record',tab},'Keep real record links and their permissions unchanged');
assert.deepEqual(readWorkspaceContext('?projectId=p&assignmentNonce=ignored'),{projectId:'p'},'An assignment nonce is never imported from a shared link');
console.log('PASS project navigation preserves record links without replaying assignment intents');
