import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authorize} from '../oauth.mjs';
test('desktop OAuth uses PKCE, state and exact loopback callback without a client secret in URL',async()=>{
 let browser;
 const pending=authorize({clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret'},{launch:url=>{
  browser=(async()=>{
   const u=new URL(url);assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.match(u.searchParams.get('code_challenge'),/^[\w-]{43}$/);assert.ok(u.searchParams.get('scope').includes('gmail.modify'));assert.equal(u.searchParams.get('access_type'),'offline');assert.ok(!url.includes('synthetic-secret'));
   const callback=new URL(u.searchParams.get('redirect_uri'));assert.equal(callback.hostname,'127.0.0.1');assert.equal(callback.pathname,'/oauth/callback');
   callback.searchParams.set('state','wrong');callback.searchParams.set('error','access_denied');assert.equal((await fetch(callback)).status,400);
   callback.searchParams.set('state',u.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);
  })();
 },timeout:5000});
 await assert.rejects(pending,/取消/);await browser;
});
