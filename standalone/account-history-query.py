"""Read-only metadata timeline for an operator's saved history, never raw snapshots."""
import base64
import collections
import datetime
import hashlib
import json
import pathlib
import re
import sqlite3


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def text(value):
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))[:240]


def local_time(value):
    try:
        date = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if date.tzinfo is None:
            date = date.replace(tzinfo=datetime.timezone.utc)
        return date.astimezone(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec="seconds")
    except (ValueError, TypeError):
        return ""


def history_for(directory, username):
    database = pathlib.Path(directory).resolve() / "workspace.sqlite"
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        accounts = db.execute("SELECT id,username,member_id FROM local_accounts").fetchall()
        subject = next((row for row in accounts if row[1] == username), None)
        if subject is None:
            raise ValueError("Login account not found; no other account scope was substituted.")
        identifiers = {value: row[2] for row in accounts for value in (row[0], row[2])}
        usernames = {row[2]: row[1] for row in accounts}
        names = collections.defaultdict(set)
        records = [(row[0], row[1], json.loads(row[2])) for row in db.execute("SELECT id,kind,data FROM records ORDER BY rowid")]
        for record_id, kind, record in records:
            if kind == "member" and record.get("name"):
                names[record["name"]].add(record_id)
            if kind in ("audit", "auth_event") and record.get("actorId") and record.get("actor"):
                names[record["actor"]].add(identifiers.get(record["actorId"], record["actorId"]))

        def operator(event):
            snapshot = event.get("snapshot") if isinstance(event.get("snapshot"), dict) else {}
            actor_id = event.get("actorId") or event.get("updatedById") or snapshot.get("updatedById")
            if not actor_id:
                actor_id = next((event.get(person) for person, stamp in (("reviewerId", "reviewedAt"), ("issuedById", "issuedAt")) if event.get(person) and event.get(stamp)), None)
            name = event.get("actor") or event.get("actorName") or event.get("updatedBy") or snapshot.get("updatedBy") or event.get("createdBy")
            if actor_id:
                member_id = identifiers.get(actor_id, actor_id)
                return member_id, usernames.get(member_id) or text(name) or text(actor_id), "id"
            matches = names.get(name, set())
            if len(matches) == 1:
                member_id = next(iter(matches))
                return member_id, usernames.get(member_id) or text(name), "unique-name"
            return None, text(name) or "未确认操作人", "unresolved"

        events = []

        def emit(record_id, kind, event, category, key, target=None):
            member_id, actor, match = operator(event)
            target_id = target or event.get("targetId") or event.get("recordId") or event.get("quoteId") or event.get("sopId") or event.get("taskId")
            if not target_id and isinstance(event.get("snapshot"), dict):
                target_id = event["snapshot"].get("id")
            target_id = target_id or record_id
            authentication = kind == "auth_event" and event.get("username") == username
            targeted = target_id in (subject[0], subject[2])
            if member_id != subject[2] and not targeted and not authentication:
                return
            if kind == "auth_event":
                relation = "登录认证尝试" if event.get("event") == "login_failure" else "登录认证"
                if event.get("event") == "login_failure":
                    actor, match = "未认证访问者", "unauthenticated"
            else:
                relation = "本人操作" if member_id == subject[2] else "账号被修改"
            fields = []
            before, after = event.get("before"), event.get("after")
            if isinstance(before, dict) and isinstance(after, dict):
                fields = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
                if "ledger" in fields and isinstance(before.get("ledger"), dict) and isinstance(after.get("ledger"), dict):
                    bc, ac = before["ledger"].get("columns", {}), after["ledger"].get("columns", {})
                    if isinstance(bc, dict) and isinstance(ac, dict):
                        fields += ["ledger.columns." + k for k in sorted(set(bc) | set(ac)) if bc.get(k) != ac.get(k)]
            elif before is None and isinstance(after, dict):
                fields = sorted(after)
            elif isinstance(event.get("changes"), list):
                fields = [c["field"] for c in event["changes"] if isinstance(c, dict) and isinstance(c.get("field"), str)]
            stamp = event.get("createdAt") or event.get("at") or event.get("updatedAt") or event.get("reviewedAt") or event.get("issuedAt")
            version = event.get("version")
            if version is None and isinstance(event.get("snapshot"), dict):
                version = event["snapshot"].get("version")
            if version is None and isinstance(after, dict):
                version = after.get("version")
            events.append({"key": key, "time": local_time(stamp), "operator": actor, "action": text(event.get("action") or event.get("decision") or category), "target": text(target_id), "source": kind, "category": category, "relation": relation, "identityMatch": match, "ip": text(event.get("ip")), "version": version if isinstance(version, (int, float)) else None, "fields": [text(k) for k in fields], "eventId": text(event.get("id") or record_id), "sha256": digest(event)})

        for record_id, kind, record in records:
            technical_request = kind.endswith("_request") and any(k in record for k in ("hash", "fingerprint", "requestFingerprint"))
            if kind.endswith("_mutation") or technical_request or kind == "member":
                continue
            historical = bool(re.search(r"_(history|revision|event|review|decision|confirmation|application|identity|issue|upload)$", kind))
            evidence = kind in ("import", "export", "ledger_import", "factory_import", "attachment", "collaboration_template", "customer_quote_media", "customer_quote_send") or kind.endswith("_attachment")
            evidence = evidence or bool(record.get("actorId") and (record.get("createdAt") or record.get("at") or record.get("updatedAt")))
            if kind in ("audit", "auth_event") or historical or evidence:
                category = "操作审计" if kind == "audit" else "登录历史" if kind == "auth_event" else "独立版本与模块事件" if historical else "模块操作与文件凭据"
                emit(record_id, kind, record, category, record_id)
            for field, entries in record.items():
                if not isinstance(entries, list) or not (field.lower().endswith(("history", "events")) or field in ("reviews", "decisions", "revisions")):
                    continue
                for index, event in enumerate(entries):
                    if not isinstance(event, dict) or not (event.get("at") or event.get("createdAt") or event.get("updatedAt")):
                        continue
                    key = record_id + ":" + field + ":" + str(event.get("id") or index)
                    emit(record_id, kind, event, "内嵌审核与协作历史", key, record_id)
        events.sort(key=lambda e: (e["time"], e["key"]))
        return {"events": events, "count": len(events), "sourceCounts": dict(collections.Counter(e["source"] for e in events))}
    finally:
        db.close()


if __name__ == "__main__":
    settings = json.loads(base64.b64decode("__SETTINGS__"))
    print(json.dumps(history_for(settings["directory"], settings["username"]), ensure_ascii=False))
