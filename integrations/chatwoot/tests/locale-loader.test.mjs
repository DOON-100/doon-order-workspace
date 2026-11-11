import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocaleLoader} from '../frontend/locale-loader.mjs';
const target=()=>({locale:'en',messages:{},setLocaleMessage(locale,messages){this.messages[locale]=messages;}});
test('bundled Chinese and English switch without downloading another pack',async()=>{
 const state=target(),load=createLocaleLoader({bundled:{en:{},zh_CN:{}},loaders:{}});
 assert.equal(await load(state,'zh_CN'),true);assert.equal(state.locale,'zh_CN');assert.equal(await load(state,'en'),true);assert.deepEqual(state.messages,{});
});
test('other languages load once and keep all translations intact',async()=>{
 let requests=0;const messages={title:'Français',nested:{blank:'',count:0}},state=target();const load=createLocaleLoader({bundled:{en:{}},loaders:{fr:async()=>{requests++;return {default:messages};}}});
 await load(state,'fr');await load(state,'en');await load(state,'fr');assert.equal(requests,1);assert.deepEqual(state.messages.fr,messages);assert.equal(state.locale,'fr');
});
test('late earlier language response cannot replace the newer selection',async()=>{
 let resolve;const pack=new Promise(r=>resolve=r),state=target(),load=createLocaleLoader({bundled:{en:{},zh_CN:{}},loaders:{fr:()=>pack}});
 const earlier=load(state,'fr');await load(state,'zh_CN');resolve({default:{title:'French'}});assert.equal(await earlier,false);assert.equal(state.locale,'zh_CN');
});
test('failed imports keep current language and can be retried',async()=>{
 let attempts=0;const state=target(),load=createLocaleLoader({bundled:{en:{}},loaders:{fr:async()=>{if(!attempts++)throw Error('synthetic network failure');return {default:{title:'French'}};}}});
 await assert.rejects(load(state,'fr'));assert.equal(state.locale,'en');await load(state,'fr');assert.equal(attempts,2);assert.equal(state.locale,'fr');
});
test('parallel consumers share the download but retain their own selection',async()=>{
 let requests=0;const a=target(),b=target(),load=createLocaleLoader({bundled:{en:{}},loaders:{fr:async()=>{requests++;return {default:{title:'French'}};}}});
 assert.deepEqual(await Promise.all([load(a,'fr'),load(b,'fr')]),[true,true]);assert.equal(requests,1);assert.equal(a.locale,'fr');assert.equal(b.locale,'fr');
});
test('unknown or malformed resources never replace the current language',async()=>{
 const state=target(),load=createLocaleLoader({bundled:{en:{}},loaders:{fr:async()=>({default:null})}});
 assert.equal(await load(state,'../private'),false);assert.equal(state.locale,'en');
 await assert.rejects(load(state,'fr'));assert.equal(state.locale,'en');
});
