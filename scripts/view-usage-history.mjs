#!/usr/bin/env node
// Standalone administrator tool: never import runtime.mjs (it initializes/writes data).
import {DatabaseSync} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const help = `查看中台已留存的登录与业务操作记录（Node.js >= 22.13）
用法: node scripts/view-usage-history.mjs --db /实际数据目录/workspace.sqlite [选项]
  --days 7             最近天数，默认 7；按当前时刻向前计算
  --username NAME      精确匹配登录账号，并关联其业务操作
  --member-id ID       精确匹配成员编号（与账号筛选同时使用时取交集）
  --kind all|login|audit  默认 all；login 包括成功、失败和主动退出
  --limit 100          最多显示条数，1 到 10000，按时间倒序
  --json               输出 JSON，默认输出中文表格（北京时间）
  --help               显示帮助，不打开数据库
必须显式提供数据库路径；仅供有服务器数据库读取权限的管理员使用。`;

function positive(value, max, label) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${label} 必须是 1 到 ${max} 的整数。`);
  }
  return Number(value);
}

export function readUsageHistory(options, now = Date.now()) {
  if (!options.db || typeof options.db !== 'string') throw new Error('必须通过 --db 明确指定现有数据库文件。');
  const days = positive(options.days ?? '7', 36500, 'days');
  const limit = positive(options.limit ?? '100', 10000, 'limit');
  const kind = options.kind ?? 'all';
  if (!['all', 'login', 'audit'].includes(kind)) throw new Error('kind 只能是 all、login 或 audit。');
  const username = options.username?.trim().toLowerCase();
  const memberId = options['member-id']?.trim();
  if (options.username !== undefined && !/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new Error('username 格式无效。');
  if (options['member-id'] !== undefined && (!memberId || memberId.length > 200)) throw new Error('member-id 格式无效。');
  const since = new Date(now - days * 86400000).toISOString();
  const until = new Date(now).toISOString();
  const db = new DatabaseSync(resolve(options.db), {readOnly: true});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    const hasAccounts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_accounts'").get();
    // Explicit identity columns only: never fetch password hashes or session tables.
    const accounts = hasAccounts ? db.prepare('SELECT username, member_id FROM local_accounts').all() : [];
    const account = accounts.find(row => row.username === username);
    const names = new Map(accounts.map(row => [row.member_id, row.username]));
    const conditions = ["kind IN ('auth_event','audit')", 'json_valid(data)'];
    const args = [];
    if (kind !== 'all') { conditions.push('kind=?'); args.push(kind === 'login' ? 'auth_event' : 'audit'); }
    // CASE also prevents malformed historical JSON from being evaluated.
    const data = "CASE WHEN json_valid(data) THEN data ELSE '{}' END";
    const field = name => `json_extract(${data}, '$.${name}')`;
    conditions.push(`julianday(${field('createdAt')}) >= julianday(?)`, `julianday(${field('createdAt')}) <= julianday(?)`);
    args.push(since, until);
    if (username) {
      conditions.push(`((kind='auth_event' AND ${field('username')}=?) OR (kind='audit' AND ${field('actorId')}=?))`);
      args.push(username, account?.member_id ?? '');
      // No account match must not associate events with an empty actorId.
      if (!account) { conditions.push("kind='auth_event'"); }
    }
    if (memberId) {
      conditions.push(`((kind='audit' AND ${field('actorId')}=?) OR (kind='auth_event' AND (${field('actorId')}=? OR ${field('targetId')}=?)))`);
      args.push(memberId, memberId, memberId);
    }
    const columns = ['createdAt','event','action','username','actorId','actor','targetId','ip','source','reason'];
    const rows = db.prepare(`SELECT id, kind, ${columns.map(name => `${field(name)} AS ${name}`).join(', ')}
      FROM records WHERE ${conditions.join(' AND ')}
      ORDER BY julianday(${field('createdAt')}) DESC, rowid DESC LIMIT ?`).all(...args, limit + 1);
    const events = rows.slice(0, limit).map(row => ({...row, username: row.username || names.get(row.actorId) || ''}));
    const hasLoginHistory = !!db.prepare("SELECT 1 FROM records WHERE kind='auth_event' LIMIT 1").get();
    const warnings = [
      '仅包含已保存的 auth_event 与 audit；不代表所有页面访问、完整登录历史或在线时长。',
      '登录失败的账号是尝试登录的目标，不证明该员工本人发起；当前账号映射不替代历史身份依据。',
    ];
    if (!hasLoginHistory) warnings.push('该库没有登录事件：可能尚未部署记录功能或尚无事件，不能据此判断无人登录。');
    if (username && !account) warnings.push('未找到该账号的当前成员映射，仅按历史登录账号查询，业务操作请使用 --member-id。');
    if (!hasAccounts) warnings.push('该库无本地账号表，不能通过账号关联业务操作；可使用 --member-id。');
    return {since, until, timezone: 'Asia/Shanghai', returned: events.length, truncated: rows.length > limit, warnings, events};
  } finally {
    db.close();
  }
}

// Remove terminal control characters in human-readable output; JSON stays escaped.
const display = value => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ');
export function main(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {
    db: {type: 'string'}, days: {type: 'string'}, username: {type: 'string'},
    'member-id': {type: 'string'}, kind: {type: 'string'}, limit: {type: 'string'},
    json: {type: 'boolean'}, help: {type: 'boolean'},
  }});
  if (values.help) { console.log(help); return; }
  const report = readUsageHistory(values);
  if (values.json) { console.log(JSON.stringify(report, null, 2)); return; }
  const time = value => new Date(value).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});
  console.log(`查询范围：${time(report.since)} 至 ${time(report.until)}（北京时间）`);
  console.table(report.events.map(row => ({
    时间: time(row.createdAt), 类型: row.kind === 'auth_event' ? '登录/退出' : '业务操作',
    账号: display(row.username), 操作人: display(row.actor), 操作: display(row.action || row.event),
    目标编号: display(row.targetId), IP: display(row.ip), 来源: display(row.source), 原因: display(row.reason),
  })));
  console.log(`显示 ${report.returned} 条${report.truncated ? '，结果已截断，请缩小时间/员工范围或提高 --limit' : ''}。`);
  for (const warning of report.warnings) console.log('说明：' + warning);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error('查询失败：' + display(error.message));
    process.exitCode = 1;
  }
}
