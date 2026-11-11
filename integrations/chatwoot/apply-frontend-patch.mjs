import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||path.basename(source)!=='chatwoot-v4.19.1')throw Error('Specify the dedicated Chatwoot v4.19.1 source checkout');
const base='caab07a8f00032d5205b5a5d7e2eb0ba2f3d2d82';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()!==base)throw Error('Expected the pinned official source commit');
const indexPath='app/javascript/dashboard/i18n/index.js',appPath='app/javascript/dashboard/App.vue';
const normalize=text=>text.replace(/\r\n/g,'\n');
const original=filename=>normalize(execFileSync('git',['show','HEAD:'+filename],{cwd:source,encoding:'utf8'}));
const index=normalize(await readFile(path.join(source,indexPath),'utf8')),app=normalize(await readFile(path.join(source,appPath),'utf8'));
if(index!==original(indexPath)||app!==original(appPath))throw Error('Source already has changes; review before applying the patch');
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
let appNext=replaceOnce(app,"import { mapGetters } from 'vuex';","import { mapGetters } from 'vuex';\nimport { useI18n } from 'vue-i18n';\nimport { loadDashboardLocale } from './i18n';");
appNext=replaceOnce(appNext,'    const { uiSettings } = useUISettings();',`    const { uiSettings } = useUISettings();
    const composer = useI18n({ useScope: 'global' });
    const localeTarget = {
      get locale() { return composer.locale.value; },
      set locale(value) { composer.locale.value = value; },
      setLocaleMessage: composer.setLocaleMessage,
    };`);
appNext=replaceOnce(appNext,'    return {\n      router,','    return {\n      localeTarget,\n      router,');
appNext=replaceOnce(appNext,`    setLocale(locale) {
      if (locale) {
        this.$root.$i18n.locale = locale;
      }
    },`,`    async setLocale(locale) {
      try {
        await loadDashboardLocale(this.localeTarget, locale);
      } catch {
        console.warn('Language resources could not be loaded; keeping the current language.');
      }
    },`);
if(!process.argv.includes('--apply')){console.log('Pinned source verified. Add --apply to patch only Chatwoot locale loading.');process.exit(0);}
await writeFile(path.join(source,indexPath),indexNext);
await writeFile(path.join(source,appPath),appNext);
await writeFile(path.join(source,'app/javascript/dashboard/i18n/doonLocaleLoader.mjs'),helper);
console.log(JSON.stringify({patched:true,base,files:[indexPath,appPath,'app/javascript/dashboard/i18n/doonLocaleLoader.mjs'],loaderSha256:createHash('sha256').update(helper).digest('hex'),allOtherLanguagesRemainAvailable:true}));
