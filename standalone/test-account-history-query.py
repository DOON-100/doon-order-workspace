"""Synthetic-only coverage of full-history metadata and updates to existing rows."""
import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("history_query", pathlib.Path(__file__).with_name("account-history-query.py"))
query = importlib.util.module_from_spec(spec)
spec.loader.exec_module(query)


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.path = self.root / "workspace.sqlite"
        self.db = sqlite3.connect(self.path)
        self.db.executescript("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT); CREATE TABLE local_accounts(id TEXT,username TEXT,member_id TEXT,password_hash TEXT);")
        self.db.executemany("INSERT INTO local_accounts VALUES(?,?,?,?)", [("account-a", "alice", "member-a", "SYNTHETIC-HASH-SECRET"), ("account-b", "bob", "member-b", "SYNTHETIC-HASH-SECRET")])
        self.put({"id": "member-a", "kind": "member", "name": "Synthetic Alice"})
        self.put({"id": "member-b", "kind": "member", "name": "Synthetic Bob"})

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def put(self, row):
        self.db.execute("INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (row["id"], row["kind"], json.dumps(row)))
        self.db.commit()

    def read(self):
        return query.history_for(self.root, "alice")["events"]

    def test_all_saved_sources_and_safe_summary(self):
        for row in [
            {"id": "audit-a", "kind": "audit", "actorId": "member-a", "targetId": "order-a", "action": "update", "before": {"notes": "SYNTHETIC-PRIVATE-BEFORE"}, "after": {"notes": "SYNTHETIC-PRIVATE-AFTER"}},
            {"id": "reset-a", "kind": "audit", "actorId": "member-b", "targetId": "member-a", "action": "reset"},
            {"id": "login-a", "kind": "auth_event", "username": "alice", "actor": "未认证访问者", "event": "login_failure", "action": "login-failure"},
            {"id": "revision-a", "kind": "customer_quote_revision", "updatedBy": "Synthetic Alice", "snapshot": {"id": "quote-a", "updatedById": "member-a", "password": "SYNTHETIC-SNAPSHOT-SECRET"}, "version": 3},
            {"id": "finance-a", "kind": "project_finance_history", "actorId": "member-a", "targetId": "charge-a"},
            {"id": "export-a", "kind": "export", "actorId": "member-a", "fileKey": "SYNTHETIC-FILE-SECRET"},
            {"id": "task-a", "kind": "customer_project_task", "reviewHistory": [{"id": "review-a", "actorId": "member-a", "at": "2026-01-02T01:00:00Z", "action": "approve", "comment": "SYNTHETIC-COMMENT-SECRET"}]},
            {"id": "request-a", "kind": "customer_project_request", "actorId": "member-a", "hash": "SYNTHETIC-TOKEN-SECRET"},
            {"id": "bob-only", "kind": "audit", "actorId": "member-b", "targetId": "order-b"},
        ]:
            row.setdefault("createdAt", "2026-01-01T01:00:00Z")
            self.put(row)
        events = self.read()
        self.assertEqual(len(events), 7)
        self.assertEqual(next(e for e in events if e["eventId"] == "reset-a")["operator"], "bob")
        self.assertEqual(next(e for e in events if e["eventId"] == "login-a")["identityMatch"], "unauthenticated")
        self.assertEqual(next(e for e in events if e["eventId"] == "audit-a")["fields"], ["notes"])
        self.assertTrue(any(e["time"] == "2026-01-02T09:00:00+08:00" for e in events))
        self.assertNotIn("SYNTHETIC-", json.dumps(events))
        self.assertTrue(all(len(e["sha256"]) == 64 for e in events))

    def test_business_requests_and_named_approval_identities(self):
        for row in [
            {"id": "pool-a", "kind": "customer_workflow_pool_request", "actorId": "member-a", "createdAt": "2026-01-01"},
            {"id": "review-a", "kind": "ar_document_review", "reviewerId": "member-a", "reviewedAt": "2026-01-02"},
            {"id": "issue-a", "kind": "ar_document_issue", "issuedById": "member-a", "issuedAt": "2026-01-03"},
            {"id": "detail-a", "kind": "engineering_drawing_detail", "actorId": "member-a", "createdAt": "2026-01-04"},
        ]:
            self.put(row)
        events = self.read()
        self.assertEqual(len(events), 4)
        self.assertTrue(all(e["operator"] == "alice" and e["time"] for e in events))

    def test_no_first_page_truncation(self):
        for index in range(501):
            self.put({"id": "audit-" + str(index), "kind": "audit", "actorId": "member-a", "createdAt": "2026-01-01T00:00:00Z"})
        self.assertEqual(len(self.read()), 501)

    def test_nested_history_growth_without_new_parent_rowid(self):
        task = {"id": "task", "kind": "customer_project_collaboration_task", "history": [{"id": "first", "actorId": "member-a", "at": "2026-01-01T00:00:00Z", "action": "create"}]}
        self.put(task)
        before = self.read()
        rowid = self.db.execute("SELECT rowid FROM records WHERE id='task'").fetchone()[0]
        task["history"].append({"id": "second", "actorId": "member-a", "at": "2026-01-02T00:00:00Z", "action": "complete"})
        self.put(task)
        after = self.read()
        self.assertEqual(self.db.execute("SELECT rowid FROM records WHERE id='task'").fetchone()[0], rowid)
        self.assertEqual(len(after), 2)
        self.assertEqual(before[0], after[0])
        task["history"][0]["comment"] = "SYNTHETIC-UPDATED-PRIVATE-COMMENT"
        self.put(task)
        updated = self.read()
        self.assertEqual(updated[0]["key"], before[0]["key"])
        self.assertNotEqual(updated[0]["sha256"], before[0]["sha256"])

    def test_ambiguous_names_and_explicit_other_actor_do_not_impersonate(self):
        self.put({"id": "member-b", "kind": "member", "name": "Synthetic Alice"})
        self.put({"id": "ambiguous", "kind": "service_revision", "updatedBy": "Synthetic Alice", "createdAt": "2026-01-01"})
        self.put({"id": "wrong-id", "kind": "service_revision", "actorId": "member-b", "actor": "Synthetic Alice", "createdAt": "2026-01-01"})
        self.assertEqual(self.read(), [])
        with self.assertRaises(ValueError):
            query.history_for(self.root, "missing")

    def test_readonly_and_terminal_controls(self):
        self.put({"id": "safe", "kind": "audit", "actorId": "member-a", "action": "hello\n\x1b[31m", "createdAt": "invalid"})
        before = hashlib.sha256(self.path.read_bytes()).hexdigest()
        event = self.read()[0]
        self.assertNotIn("\x1b", event["action"])
        self.assertNotIn("\n", event["action"])
        self.assertEqual(event["time"], "")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
