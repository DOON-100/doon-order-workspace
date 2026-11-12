import {build} from 'esbuild';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=fileURLToPath(new URL('.',import.meta.url)),root=path.resolve(source,'../..');
const output=path.join(root,'test-output/gmail-desktop-connector/client');
await mkdir(output,{recursive:true});
const filename=path.join(output,'connector.mjs');
await build({entryPoints:[path.join(source,'cli.mjs')],outfile:filename,bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as __doonRequire} from 'node:module';const require=__doonRequire(import.meta.url);"}});
const lock=JSON.parse(await readFile(path.join(source,'package-lock.json'))),licenses=[];
for(const name of Object.keys(lock.packages).filter(v=>v.startsWith('node_modules/'))){
 const directory=path.join(source,name),manifest=JSON.parse(await readFile(path.join(directory,'package.json')));
 licenses.push(`${manifest.name}@${manifest.version} (${manifest.license||'see license'})`);
 const candidates=(await readdir(directory)).filter(v=>/^licen[cs]e(?:\.|$)/i.test(v));
 for(const license of candidates)licenses.push(await readFile(path.join(directory,license),'utf8'));
}
await writeFile(path.join(output,'THIRD_PARTY_LICENSES.txt'),licenses.join('\n\n'));
await writeFile(path.join(output,'release.json'),JSON.stringify({format:'doon-gmail-client-v1',version:'0.1.0',node:'24.14.0',sha256:createHash('sha256').update(await readFile(filename)).digest('hex')},null,2));
console.log('Built standalone Gmail Windows connector; credentials excluded.');
