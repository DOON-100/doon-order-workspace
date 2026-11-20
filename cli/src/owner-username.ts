import {CliError} from './errors.js';

const usernamePattern = /^[a-z][a-z0-9._-]{2,31}$/;

export function normalizeOwnerUsername(value: unknown): string {
  if (typeof value !== 'string' || !usernamePattern.test(value.trim().toLowerCase()))
    throw new CliError('INVALID_INPUT', '跟单员请填写登录账号名（例如 Tina），不接受邮箱或姓名。', 2);
  return value.trim().toLowerCase();
}

// Login names are supplied by the account directory, never inferred from email.
export function ownerUsername(member: {username?: unknown}): string | null {
  return typeof member.username==='string' && usernamePattern.test(member.username) ? member.username : null;
}

export function resolveOwnerUsername(username: string, members: unknown): string {
  const normalized = normalizeOwnerUsername(username);
  if (!Array.isArray(members)) throw new CliError('INVALID_RESPONSE', '服务器未返回成员目录，未提交修改。', 5);
  const matches = members.filter(member => member && member.active !== false && ownerUsername(member) === normalized);
  if (matches.length !== 1)
    throw new CliError('INVALID_INPUT', matches.length ? '跟单账号匹配不唯一，未提交修改。' : '未找到该有效跟单账号，请核对登录账号名。', 2);
  return matches[0].username;
}
