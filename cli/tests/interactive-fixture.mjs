// Manual PTY smoke test. Only the explicitly named synthetic password is accepted.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {StateStore} from '../dist/state.js';
import {temporary, root, user, token} from './helpers.mjs';

const home = await temporary();
const server = http.createServer(async (req, res) => {
  if (req.url !== '/api/auth/login') { res.writeHead(404); res.end(); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  if (input.username !== 'synthetic' || input.password !== 'Synthetic-Only-2026!') { res.writeHead(401); res.end(); return; }
  res.writeHead(200, {'Content-Type': 'application/json', 'Set-Cookie': `doon_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
  res.end(JSON.stringify({user}));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const state = new StateStore(home); await state.setup(`http://127.0.0.1:${server.address().port}`, true);
console.log('Synthetic interactive test: enter Synthetic-Only-2026! at the hidden prompt.');
const child = spawn(process.execPath, [path.join(root, 'cli/dist/index.js'), 'login', '--username', 'synthetic'], {stdio: 'inherit', windowsHide: true, env: {...process.env, DOON_CLI_HOME: home}});
try {
  const code = await new Promise(resolve => child.once('exit', resolve)); assert.equal(code, 0);
  assert.equal((await state.session(await state.config())).cookie, 'doon_session=' + token);
  await state.clearSession(); console.log('PASS interactive login and encrypted persistence');
} finally { server.closeAllConnections(); server.close(); }
