import {CliError} from './errors.js';

const usernamePattern = /^[a-z][a-z0-9._-]{2,31}$/;

export function normalizeOwnerUsername(value: unknown): string {
  if (typeof value !== 'string' || !usernamePattern.test(value.trim().toLowerCase()))
    throw new CliError('INVALID_INPUT', '跟单员请填写登录账号名（例如 Tina），不接受邮箱或姓名。', 2);
  return value.trim().toLowerCase();
}

// Native accounts created by the server use username@doon.local. Resolve only
// against the current member directory; never invent an email or strip a real
// email domain to guess a login. Existing external-email members need a server
// username reference before this CLI can assign them by login.
export function ownerUsername(member: {email?: unknown}): string | null {
  if (typeof member.email !== 'string') return null;
  const match = /^([a-z][a-z0-9._-]{2,31})@doon\.local$/i.exec(member.email);
  return match ? match[1].toLowerCase() : null;
}

export function resolveOwnerEmail(username: string, members: unknown): string {
  const normalized = normalizeOwnerUsername(username);
  if (!Array.isArray(members)) throw new CliError('INVALID_RESPONSE', '服务器未返回成员目录，未提交修改。', 5);
  const matches = members.filter(member => member && member.active !== false && ownerUsername(member) === normalized);
  if (matches.length !== 1)
    throw new CliError('INVALID_INPUT', matches.length ? '跟单账号匹配不唯一，未提交修改。' : '未找到该有效跟单账号，请核对登录账号名。', 2);
  return matches[0].email;
}
