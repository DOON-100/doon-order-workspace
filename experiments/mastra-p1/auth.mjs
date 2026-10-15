import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const derive = promisify(scrypt);
const actorIds = ['syn-employee-a', 'syn-employee-b', 'syn-disabled', 'syn-supplier'];
const permittedActors = new Set(['syn-employee-a', 'syn-employee-b']);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const scryptOptions = {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
function fail(message, status, retryAfterSeconds) {
  throw Object.assign(new Error(message), {status, ...(retryAfterSeconds ? {retryAfterSeconds} : {})});
}
function validInteger(value, maximum) {return Number.isInteger(value) && value > 0 && value <= maximum;}

/**
 * Trusted synthetic-only provisioning. Credentials leave this function only in
 * the returned private value; no public endpoint, file, environment, or business
 * account is read. This is not an integration with production authentication.
 */
export async function createSyntheticIdentity({adapter, now = Date.now, sessionTtlMs = 15 * 60_000, maxFailures = 5, rateWindowMs = 60_000} = {}) {
  if (!adapter || typeof adapter.actor !== 'function' || typeof now !== 'function' || !validInteger(sessionTtlMs, 86_400_000) || !validInteger(maxFailures, 100) || !validInteger(rateWindowMs, 3_600_000)) {
    throw new TypeError('合成认证配置无效');
  }
  const accounts = new Map(), sessions = new Map(), failures = new Map();
  let closed = false, hashing = 0;
  const credentials = await Promise.all(actorIds.map(async actorId => {
    const username = 'p1-' + randomBytes(12).toString('hex'), password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16), hash = await derive(password, salt, 64, scryptOptions);
    accounts.set(username, {actorId, salt, hash, revoked: false});
    return Object.freeze({actorId, username, password});
  }));
  const dummySalt = randomBytes(16), dummyHash = await derive(randomBytes(32).toString('base64url'), dummySalt, 64, scryptOptions);

  function revokeSessions(actorId) {
    for (const [token, session] of sessions) if (session.actorId === actorId) sessions.delete(token);
  }
  function currentActor(account) {
    if (closed || !account || account.revoked || !permittedActors.has(account.actorId)) fail('合成账号当前不可用', 403);
    let actor;
    try {actor = adapter.actor(account.actorId);} catch {
      revokeSessions(account.actorId);
      fail('合成账号当前不可用', 403);
    }
    // A change to admin/finance must not expand a previously issued sales session.
    if (actor.id !== account.actorId || actor.role !== 'sales') {
      revokeSessions(account.actorId);
      fail('合成账号当前不可用', 403);
    }
    return {id: actor.id, name: actor.name, role: actor.role};
  }
  function accountForActor(actorId) {return [...accounts.values()].find(account => account.actorId === actorId);}
  function sessionDigest(token) {return createHash('sha256').update(token).digest('hex');}
  function prune(at) {
    for (const [key, value] of failures) if (value.until <= at) failures.delete(key);
    for (const [key, value] of sessions) if (value.expiresAt <= at) sessions.delete(key);
  }
  function rateKeys(clientKey, username) {
    const client = typeof clientKey === 'string' && clientKey.length <= 200 ? clientKey : 'local-unknown';
    const key = createHash('sha256').update(client).digest('hex');
    return ['peer:' + key, 'account:' + key + ':' + createHash('sha256').update(username).digest('hex')];
  }
  function checkRate(keys, at) {
    prune(at);
    for (const key of keys) {
      const entry = failures.get(key);
      if (entry && entry.count >= maxFailures) fail('登录尝试过多，请稍后重试', 429, Math.max(1, Math.ceil((entry.until - at) / 1000)));
    }
    if (hashing >= 4) fail('合成登录当前繁忙，请稍后重试', 429, 1);
  }
  function failedAttempt(keys, at) {
    for (const key of keys) {
      const entry = failures.get(key) || {count: 0, until: at + rateWindowMs};
      entry.count++;
      failures.set(key, entry);
    }
    // Bound attacker-controlled metadata even if the function is reused behind
    // a different trusted transport in a future synthetic test.
    while (failures.size > 1024) failures.delete(failures.keys().next().value);
  }

  const identity = Object.freeze({
    sessionTtlMs,
    async login(input, clientKey = 'loopback') {
      if (closed) fail('合成认证已关闭', 403);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || typeof input.username !== 'string' || typeof input.password !== 'string' || !input.username.length || input.username.length > 128 || !input.password.length || input.password.length > 256) fail('登录请求字段无效', 400);
      const username = input.username.trim().toLowerCase(), keys = rateKeys(clientKey, username), at = now();
      checkRate(keys, at);
      const account = accounts.get(username), salt = account?.salt || dummySalt, expected = account?.hash || dummyHash;
      let actual;
      hashing++;
      try {actual = await derive(input.password, salt, 64, scryptOptions);} finally {hashing--;}
      const matches = timingSafeEqual(actual, expected);
      actual.fill(0);
      if (!account || !matches) {failedAttempt(keys, now()); fail('合成账号或密码不正确', 401);}
      const actor = currentActor(account);
      prune(now());
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('base64url'), expiresAt = now() + sessionTtlMs;
      sessions.set(sessionDigest(token), {actorId: account.actorId, expiresAt});
      return {token, actor: {...actor, sessionExpiresAt: expiresAt}};
    },
    resolveSession(token) {
      if (closed || typeof token !== 'string' || !tokenPattern.test(token)) fail('合成会话无效，请重新登录', 401);
      const digest = sessionDigest(token), session = sessions.get(digest);
      if (!session || session.expiresAt <= now()) {sessions.delete(digest); fail('合成会话已失效，请重新登录', 401);}
      const actor = currentActor(accountForActor(session.actorId));
      return {...actor, sessionExpiresAt: session.expiresAt};
    },
    logout(token) {if (typeof token === 'string' && tokenPattern.test(token)) sessions.delete(sessionDigest(token));},
    revokeActor(actorId) {
      const account = accountForActor(actorId);
      if (account) account.revoked = true;
      revokeSessions(actorId);
    },
    close() {closed = true; sessions.clear(); failures.clear();},
  });
  return {identity, credentials: Object.freeze(credentials)};
}
