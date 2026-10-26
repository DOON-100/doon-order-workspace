import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {StateStore} from '../dist/state.js';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export async function temporary() {
  const base = path.join(root, 'test-output'); await fs.mkdir(base, {recursive: true});
  return fs.mkdtemp(path.join(base, 'cli-test-'));
}
export function testCodec() {
  const values = new Map();
  return {async protect(text) { const id = randomUUID(); values.set(id, text); return id; }, async unprotect(id) { if (!values.has(id)) throw Error('Invalid synthetic vault entry'); return values.get(id); }};
}
export async function store() { return new StateStore(await temporary(), testCodec()); }
export const user = {username: 'synthetic', role: 'viewer', personnelType: 'internal', mustChange: false, identity: {id: 'synthetic_member', name: 'Synthetic Employee', email: 'synthetic@example.test'}};
export const token = 'X'.repeat(43);
export const signed = (value = user, secure = true) => Response.json({user: value}, {headers: {'Set-Cookie': `${secure ? 'doon_employee_session' : 'doon_session'}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`}});
export const session = origin => ({origin, cookie: `${origin.startsWith('https:') ? 'doon_employee_session' : 'doon_session'}=${token}`, expiresAt: Date.now() + 3600000});
