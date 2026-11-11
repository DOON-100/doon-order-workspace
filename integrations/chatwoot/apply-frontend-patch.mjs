import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||path.basename(source)!=='chatwoot-v4.19.1')throw Error('Specify the dedicated Chatwoot v4.19.1 source checkout');
const base='caab07a8f00032d5205b5a5d7e2eb0ba2f3d2d82';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()!==base)throw Error('Expected the pinned official source commit');
const indexPath='app/javascript/dashboard/i18n/index.js',entryPath='app/javascript/entrypoints/dashboard.js';
const normalize=text=>text.replace(/\r\n/g,'\n');
const original=filename=>normalize(execFileSync('git',['show','HEAD:'+filename],{cwd:source,encoding:'utf8'}));
const index=normalize(await readFile(path.join(source,indexPath),'utf8')),entry=normalize(await readFile(path.join(source,entryPath),'utf8'));
if(index!==original(indexPath)||entry!==original(entryPath))throw Error('Source already has changes; review before applying the patch');
const helper=await readFile(fileURLToPath(new URL('./frontend/locale-loader.mjs',import.meta.url)));
const localePaths=[...index.matchAll(/^import\s+\w+\s+from\s+'(\.\/locale\/[^']+)';$/gm)].map(match=>match[1]);
if(localePaths.length<40||!localePaths.includes('./locale/en')||!localePaths.includes('./locale/zh_CN'))throw Error('Unexpected upstream language manifest');
const lazyPaths=localePaths.filter(filename=>!['./locale/en','./locale/zh_CN'].includes(filename)).map(filename=>filename+'/index.js');
const indexNext=`import en from './locale/en';
import zh_CN from './locale/zh_CN';
import { createLocaleLoader } from './doonLocaleLoader.mjs';

const messages = { en, zh_CN };
const modules = import.meta.glob(${JSON.stringify(lazyPaths)});
const loaders = Object.fromEntries(
  Object.entries(modules).map(([filename, load]) => [filename.split('/')[2], load])
);
export const loadDashboardLocale = createLocaleLoader({ bundled: messages, loaders });
export default messages;
`;
function replaceOnce(text,old,next){if(text.split(old).length!==2)throw Error('Unexpected upstream source');return text.replace(old,next);}
let entryNext=replaceOnce(entry,"import { createApp } from 'vue';","import { createApp, watch } from 'vue';");
entryNext=replaceOnce(entryNext,"import i18nMessages from 'dashboard/i18n';","import i18nMessages, { loadDashboardLocale } from 'dashboard/i18n';");
entryNext=replaceOnce(entryNext,'sync(store, router);',`// Cover both initial account locale and later profile/account language changes.
const localeTarget = {
  get locale() { return i18n.global.locale.value; },
  set locale(value) { i18n.global.locale.value = value; },
  setLocaleMessage: i18n.global.setLocaleMessage,
};
watch(i18n.global.locale, async (locale, previous) => {
  try {
    await loadDashboardLocale(localeTarget, locale);
  } catch {
    if (i18n.global.locale.value === locale) i18n.global.locale.value = previous;
    console.warn('Language resources could not be loaded; keeping the previous language.');
  }
}, { flush: 'sync' });

sync(store, router);`);
if(!process.argv.includes('--apply')){console.log('Pinned source verified. Add --apply to patch only Chatwoot locale loading.');process.exit(0);}
await writeFile(path.join(source,indexPath),indexNext);
await writeFile(path.join(source,entryPath),entryNext);
await writeFile(path.join(source,'app/javascript/dashboard/i18n/doonLocaleLoader.mjs'),helper);
console.log(JSON.stringify({patched:true,base,files:[indexPath,entryPath,'app/javascript/dashboard/i18n/doonLocaleLoader.mjs'],loaderSha256:createHash('sha256').update(helper).digest('hex'),allOtherLanguagesRemainAvailable:true}));
