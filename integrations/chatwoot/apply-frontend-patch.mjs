import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||path.basename(source)!=='chatwoot-v4.19.1')throw Error('Specify the dedicated Chatwoot v4.19.1 source checkout');
const base='caab07a8f00032d5205b5a5d7e2eb0ba2f3d2d82';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()!==base)throw Error('Expected the pinned official source commit');
const normalize=text=>text.replace(/\r\n/g,'\n');
const files=['app/javascript/dashboard/i18n/index.js','app/javascript/widget/i18n/index.js','app/javascript/survey/i18n/index.js','app/javascript/dashboard/App.vue','app/helpers/application_helper.rb'];
const changes=new Map();
for(const filename of files){
 const original=normalize(execFileSync('git',['show','HEAD:'+filename],{cwd:source,encoding:'utf8'}));
 if(normalize(await readFile(path.join(source,filename),'utf8'))!==original)throw Error('Source already has changes: '+filename);
 changes.set(filename,original);
}
function replaceOnce(text,old,next){if(text.split(old).length!==2)throw Error('Unexpected upstream source');return text.replace(old,next);}
for(const filename of files.slice(0,3)){
 const extension=filename.includes('/dashboard/')?'':'.json';
 if(!changes.get(filename).includes("from './locale/zh_CN"+extension+"'")||!changes.get(filename).includes("from './locale/en"+extension+"'"))throw Error('Unexpected language manifest');
 changes.set(filename,`import en from './locale/en${extension}';\nimport zh_CN from './locale/zh_CN${extension}';\n\nexport default { en, zh_CN };\n`);
}
const app=files[3],helper=files[4];
changes.set(app,replaceOnce(changes.get(app),'this.$root.$i18n.locale = locale;',"this.$root.$i18n.locale = ['en', 'zh_CN'].includes(locale) ? locale : 'en';"));
changes.set(helper,replaceOnce(changes.get(helper),'LANGUAGES_CONFIG.map { |_key, val| val.slice(:name, :iso_639_1_code) }',"LANGUAGES_CONFIG.select { |_key, val| %w[en zh_CN].include?(val[:iso_639_1_code]) }.map { |_key, val| val.slice(:name, :iso_639_1_code) }"));
if(!process.argv.includes('--apply')){console.log('Pinned source verified. Add --apply to retain only Chinese and English.');process.exit(0);}
for(const [filename,content] of changes)await writeFile(path.join(source,filename),content);
console.log(JSON.stringify({patched:true,base,files,languages:['en','zh_CN'],otherLanguagePacksBuilt:false}));
