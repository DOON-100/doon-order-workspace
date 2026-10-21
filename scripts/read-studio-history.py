#!/usr/bin/env python3
"""Read-only Studio activity projection. No service imports, migrations or secrets."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import glob
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def date(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError('时间必须包含时区。')
    return parsed.astimezone(timezone.utc)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clean(value):
    text = str(value or "")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    # Defense in depth for accidental credentials in user-authored text. This is
    # not a guarantee that arbitrary conversation text contains no private data.
    text = re.sub(r"(?i)(Bearer\s+)[\w.\-]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)((?:password|api[_-]?key|secret|token|cookie)\s*[=:]\s*)[^\s,;]+", r"\1[REDACTED]", text)
    return text


def conversation(content):
    try:
        value = json.loads(content) if isinstance(content, str) else content
    except (ValueError, TypeError):
        return clean(content)
    if isinstance(value, str):
        return clean(value)
    if not isinstance(value, dict):
        return "[非文本消息]"
    parts = value.get("parts")
    if isinstance(parts, list):
        # Never print reasoning parts, raw tool arguments/results or attachments.
        text = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "text"]
        if text:
            return clean("\n".join(text))
        return "[工具调用或非文本消息；详见调用记录]"
    text = value.get("content")
    return clean(text) if isinstance(text, str) else "[非文本消息]"


def event(key, at, category, account, actor, action, target="", detail="", source=""):
    result = dict(id=key, time=at, category=category, account=account, actor=actor,
                  action=action, target=target, detail=detail, source=source)
    result = {k: clean(v) for k, v in result.items()}
    result["signature"] = digest(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return result


def pg(container, database, sql):
    command = ["docker", "exec", "-i", "-u", "postgres", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database]
    query = "BEGIN READ ONLY; SET LOCAL statement_timeout=15000; SET LOCAL TIME ZONE 'UTC'; " + sql + "; COMMIT;"
    process = subprocess.run(command, input=query, text=True, capture_output=True, timeout=25)
    if process.returncode:
        raise RuntimeError("PostgreSQL 只读查询失败，请检查容器、数据库及读取权限。")
    return json.loads(process.stdout.strip() or "[]")


def projection(container, database, since, until, observations=False):
    names = ["mastra_span_events"] if observations else ["mastra_agents", "mastra_agent_versions", "mastra_threads", "mastra_messages", "mastra_workflow_definitions", "mastra_workflow_snapshot"]
    requested = ",".join("'" + x + "'" for x in names)
    tables = pg(container, database, "SELECT coalesce(json_agg(t),'[]') FROM (SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema ~ '^agent_user_[a-f0-9]{32}$' AND table_name IN (" + requested + ")) t")
    queries = []
    for table in tables:
        schema, name = table["table_schema"], table["table_name"]
        if not re.fullmatch(r"agent_user_[a-f0-9]{32}", schema) or name not in names:
            raise ValueError("Unexpected schema")
        qualified = '"' + schema + '"."' + name + '"'
        created = 'coalesce(t."createdAtZ",t."createdAt" AT TIME ZONE \'UTC\')'
        updated = 'coalesce(t."updatedAtZ",t."updatedAt" AT TIME ZONE \'UTC\')'
        fields, at, filter_extra = "", created, ""
        if name == "mastra_agents":
            at = updated
            fields = 't.id,t.status,t."activeVersionId",' + created + ' AS created'
        elif name == "mastra_agent_versions":
            fields = 't.id,t."agentId",t.name,t."versionNumber",t."changeMessage"'
        elif name == "mastra_threads":
            at = updated
            fields = 't.id,t.title,' + created + ' AS created'
        elif name == "mastra_messages":
            fields = 't.id,t.thread_id,t.role,t.type,t.content'
        elif name == "mastra_workflow_definitions":
            fields = "t.id,t.metadata->>'category' AS category,t.metadata->>'entityId' AS target,t.metadata->>'revision' AS revision,t.metadata#>>'{payload,config,name}' AS name,t.metadata#>>'{payload,message}' AS message,t.metadata#>>'{payload,status}' AS status,t.metadata#>>'{payload,actor,name}' AS actor,t.metadata#>>'{payload,runId}' AS run,t.metadata#>>'{payload,enabled}' AS enabled,t.metadata#>>'{payload,audit,-1,action}' AS decision,t.metadata#>>'{payload,audit,-1,actor,name}' AS reviewer"
            filter_extra = " AND t.metadata->>'recordType'='doon-visual-workflow-ledger-v1'"
        elif name == "mastra_workflow_snapshot":
            at = updated
            fields = "t.run_id AS id,t.workflow_name,t.snapshot->>'status' AS status"
        elif name == "mastra_span_events":
            at = 'coalesce(t."endedAt",t."startedAt")'
            fields = 't."traceId" || \'/\' || t."spanId" AS id,t."spanType",t."entityName",t."entityId",t."name",t."threadId",t."endedAt",(t.error IS NOT NULL AND t.error <> \'null\'::jsonb) AS failed'
            qualified = '(SELECT DISTINCT ON ("traceId","spanId") * FROM ' + qualified + ' WHERE "startedAt" >= \'' + since + '\'::timestamptz ORDER BY "traceId","spanId","cursorId" DESC)'
            filter_extra = ' AND (t."spanType" IN (\'agent_run\',\'tool_call\',\'model_generation\',\'model_inference\') OR (t.error IS NOT NULL AND t.error <> \'null\'::jsonb))'
        # Only fixed field projections reach Python; never requestContext, secrets,
        # agent instructions or workflow snapshots containing business payloads.
        queries.append("SELECT '" + schema + "' AS owner,'" + name + "' AS origin," + at + " AS at," + "to_jsonb(v) AS data FROM " + qualified + " t CROSS JOIN LATERAL (SELECT " + fields + ") v WHERE " + at + " >= '" + since + "'::timestamptz AND " + at + " <= '" + until + "'::timestamptz" + filter_extra)
    if not queries:
        return []
    return pg(container, database, "SELECT coalesce(json_agg(r),'[]') FROM (" + " UNION ALL ".join(queries) + ") r")


def platform(path, since, until):
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        # Explicit columns only, never password hashes or session data.
        identities = db.execute("SELECT a.id,a.username,json_extract(r.data,'$.name') AS name,json_extract(r.data,'$.role') AS role FROM local_accounts a LEFT JOIN records r ON r.id=a.member_id AND r.kind='member'").fetchall()
        owners = {"agent_user_" + digest(r["id"])[:32]: (r["username"], r["name"] or "") for r in identities}
        events = []
        for row in db.execute("SELECT id,json_extract(data,'$.createdAt') AS at,json_extract(data,'$.username') AS username,json_extract(data,'$.actor') AS actor,json_extract(data,'$.action') AS action,json_extract(data,'$.source') AS source,json_extract(data,'$.ip') AS ip,json_extract(data,'$.reason') AS reason FROM records WHERE kind='auth_event' AND julianday(json_extract(data,'$.createdAt')) BETWEEN julianday(?) AND julianday(?)", (since, until)):
            events.append(event("auth:"+row["id"], row["at"], "平台鉴权", row["username"], row["actor"], row["action"], detail="IP="+(row["ip"] or "")+" "+(row["reason"] or ""), source="平台共用登录；不能据此确认进入Studio / "+(row["source"] or "")))
        return owners, events
    finally:
        db.close()


def storage_events(rows, owners):
    events = []
    categories = {"config":"工作流配置", "proposal":"工作流提案", "review":"人工审核", "execution":"工作流执行", "delivery":"调度投递", "schedule-control":"调度启停", "schedule-attempt":"调度检查", "schedule-slot":"调度时点", "schedule-batch":"调度批次", "cursor":"调度游标"}
    for row in rows:
        d, table, at = row["data"], row["origin"], row["at"]
        account, owner = owners.get(row["owner"], (row["owner"], "未匹配当前账号"))
        key = row["owner"] + ":" + table + ":" + d["id"]
        actor, target, detail = "未单独留痕", d["id"], ""
        if table == "mastra_agents":
            action = "创建Agent配置" if d["id"].startswith("visual-") else "内置Agent初始化"
            events.append(event(key+":create", d["created"], "Agent", account, actor, action, target, source="配置创建时间；账号为存储归属"))
            category, action = "Agent", "当前配置状态"
            detail = "状态="+str(d.get("status"))+"；发布版本="+str(d.get("activeVersionId") or "未发布")
        elif table == "mastra_agent_versions":
            category, action, target = "Agent版本", "保存版本 v"+str(d["versionNumber"]), d["agentId"]
            detail = str(d.get("name") or "")+"；"+str(d.get("changeMessage") or "首次留存或未备注")
        elif table == "mastra_threads":
            events.append(event(key+":create", d["created"], "对话会话", account, actor, "创建会话", target, source="会话创建时间；账号为存储归属"))
            category, action, detail = "对话会话", "会话更新", d.get("title") or "未命名"
        elif table == "mastra_messages":
            category, action, target = "对话", {"user":"用户消息","assistant":"Agent回复","tool":"工具消息"}.get(d.get("role"), "其他消息"), d.get("thread_id") or ""
            actor = owner if d.get("role") == "user" else "Agent/工具"
            detail = conversation(d.get("content"))
        elif table == "mastra_workflow_definitions":
            category, action = "工作流", categories.get(d.get("category"), d.get("category") or "工作流记录")
            target = d.get("target") or target
            actor = d.get("reviewer") or d.get("actor") or "未单独留痕"
            detail = "；".join(str(d[k]) for k in ["name","message","status","decision"] if d.get(k))
            if d.get("enabled") is not None:
                detail += "；enabled="+str(d["enabled"])
            detail += "；版本="+str(d.get("revision") or "")
        elif table == "mastra_workflow_snapshot":
            category, action = "工作流运行", "运行状态"
            detail = str(d.get("workflow_name") or "")+"；状态="+str(d.get("status") or "未知")
        elif table == "mastra_span_events":
            category = {"agent_run":"Agent运行","tool_call":"工具调用","model_inference":"模型推理","model_generation":"模型生成"}.get(d.get("spanType"), "运行轨迹")
            action = "失败" if d.get("failed") else "已结束" if d.get("endedAt") else "运行中"
            detail = str(d.get("entityName") or d.get("name") or "")+"；会话="+str(d.get("threadId") or "")
            target = d.get("entityId") or target
            actor = "Agent/工具"
        else:
            continue
        events.append(event(key, at, category, account, actor, action, target, detail, "Studio存储/轨迹；所属账号不等于单独操作审计"))
    return events


ACCESS = re.compile(r'^(\S+) .*?\[([^]]+)\] "(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) ([^ ]+) [^"]+" (\d{3}) ')


def access_events(path, since, until, all_requests=False):
    result, repeats = [], Counter()
    files = sorted(glob.glob(str(path)+"*"), key=lambda p: Path(p).stat().st_mtime)
    for name in files:
        if not re.fullmatch(re.escape(str(path))+r"(?:\.\d+(?:\.gz)?)?", name):
            continue
        if Path(name).stat().st_mtime < since.timestamp():
            continue
        opener = gzip.open if name.endswith('.gz') else open
        with opener(name, 'rt', encoding='utf-8', errors='replace') as handle:
            for line in handle:
                match = ACCESS.match(line)
                if not match:
                    continue
                ip, at, method, raw_path, status = match.groups()
                route = raw_path.split('?', 1)[0]
                if route != '/studio' and not route.startswith('/studio/'):
                    continue
                try:
                    instant = datetime.strptime(at, '%d/%b/%Y:%H:%M:%S %z')
                except ValueError:
                    continue
                if not since <= instant <= until:
                    continue
                code = int(status)
                entry = route in ('/studio', '/studio/')
                if not all_requests and not entry and method in ('GET','HEAD','OPTIONS') and code < 400:
                    continue
                identifier = digest(line.rstrip('\n'))
                repeats[identifier] += 1
                action = '访问Studio' if entry else 'Studio操作请求'
                if code in (401,403):
                    action = '访问鉴权拒绝'
                elif code >= 400:
                    action = 'Studio请求失败'
                result.append(event('http:'+identifier+':'+str(repeats[identifier]),stamp(instant),'Studio访问','未记录账号',ip,action,route,method+' HTTP '+status,'代理访问日志；请求状态不等于业务结果'))
    return result


def read(args):
    since, until = date(args.since), date(args.until)
    if since > until:
        raise ValueError('开始时间不能晚于结束时间。')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+',args.container):
        raise ValueError('容器名称无效。')
    if not 1 <= args.page_size <= 200 or args.offset < 0:
        raise ValueError('分页参数无效。')
    warnings, events, owners = [], [], {}
    try:
        owners, auth = platform(args.platform_db, stamp(since), stamp(until))
        events.extend(auth)
    except Exception:
        warnings.append('平台登录或账号映射读取失败；此来源本轮不完整。')
    for database, observation in [('doon_agent_studio',False),('doon_agent_studio_observability',True)]:
        try:
            events.extend(storage_events(projection(args.container,database,stamp(since),stamp(until),observation),owners))
        except Exception:
            warnings.append(database+' 读取失败；此来源本轮不完整，将在下一轮重新读取。')
    try:
        if not Path(args.access_log).is_file():
            raise FileNotFoundError()
        events.extend(access_events(args.access_log,since,until,args.all_requests))
    except Exception:
        warnings.append('Studio代理访问日志读取失败；此来源本轮不完整。')
    events = [e for e in events if e['time'] and since <= date(e['time']) <= until]
    if args.username:
        events = [e for e in events if e['account'].lower() == args.username.lower()]
        warnings.append('已按账号筛选；未记录账号的代理访问日志不参与此筛选，不能用IP猜测人员。')
    if args.category != 'all':
        events = [e for e in events if e['category'] == args.category]
    events.sort(key=lambda e:(date(e['time']),e['id']))
    page = events[args.offset:args.offset+args.page_size]
    return dict(events=page, more=args.offset+len(page)<len(events), nextOffset=args.offset+len(page), total=len(events), warnings=warnings)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container',required=True)
    parser.add_argument('--platform-db',required=True)
    parser.add_argument('--access-log',required=True)
    parser.add_argument('--since',required=True)
    parser.add_argument('--until',required=True)
    parser.add_argument('--offset',type=int,default=0)
    parser.add_argument('--page-size',type=int,default=50)
    parser.add_argument('--username',default='')
    parser.add_argument('--category',default='all')
    parser.add_argument('--all-requests',action='store_true')
    args=parser.parse_args()
    print(json.dumps(read(args),ensure_ascii=False,separators=(',',':')))


if __name__=='__main__':
    main()
