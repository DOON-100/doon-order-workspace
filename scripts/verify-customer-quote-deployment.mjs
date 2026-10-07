// Read-only preservation gate. Never select passwords, tokens, or session records.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const mode=process.argv[2],checkpoint=process.argv[3];
const unchanged=process.argv[4]==='--unchanged';
if(!['before','after'].includes(mode)||!checkpoint||(process.argv[4]&&!unchanged)||process.argv.length>5)throw new Error('Usage: before|after <private checkpoint path> [--unchanged]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=path.resolve('lan-data'),db=new DatabaseSync(path.join(root,'workspace.sqlite'),{readOnly:true});
const rows=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const accountMeta=db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];
db.close();if(integrity!=='ok')throw new Error('Database integrity check failed.');
const records=Object.fromEntries(rows.map(r=>[r.id,{kind:r.kind,hash:sha(r.data)}]));
const files={};for(const entry of await fs.readdir(path.join(root,'files'),{withFileTypes:true})){if(!entry.isFile())throw new Error('Unexpected non-file in object storage.');files[entry.name]=sha(await fs.readFile(path.join(root,'files',entry.name)));}
const current={at:new Date().toISOString(),records,accountsHash:sha(JSON.stringify(accountMeta)),files};
if(mode==='before')await fs.writeFile(checkpoint,JSON.stringify(current));
else{
 const prior=JSON.parse(await fs.readFile(checkpoint,'utf8'));
 for(const [id,r] of Object.entries(prior.records))if(records[id]?.kind!==r.kind||records[id]?.hash!==r.hash)throw new Error('An existing record changed or disappeared; stop and investigate.');
 if(prior.accountsHash!==current.accountsHash)throw new Error('Existing account metadata changed.');
 for(const [name,hash] of Object.entries(prior.files))if(files[name]!==hash)throw new Error('An existing attachment changed or disappeared.');
 const additions=rows.filter(r=>!prior.records[r.id]);
 if(unchanged&&(additions.length||Object.keys(files).length!==Object.keys(prior.files).length))throw new Error('Code-only deployment added records or attachments.');
 const newQuoteIds=new Set(additions.filter(r=>r.kind==='customer_quote').map(r=>r.id));
 for(const row of additions){const value=JSON.parse(row.data);if(row.kind==='customer_quote'){if(value.status!=='draft'||value.customerAccountId)throw new Error('Only unbound new quote drafts may be seeded.');}else if(row.kind==='customer_quote_revision'){if(!newQuoteIds.has(value.quoteId))throw new Error('Unexpected historical revision target.');}else if(row.kind==='audit'){if(!newQuoteIds.has(value.targetId))throw new Error('Unexpected audit target.');}else throw new Error('Unexpected new record kind.');}
}
console.log(JSON.stringify({mode,integrity,preserved:mode==='after',unchanged:mode==='after'&&unchanged,recordCount:rows.length,fileCount:Object.keys(files).length,accountCount:accountMeta.length}));
