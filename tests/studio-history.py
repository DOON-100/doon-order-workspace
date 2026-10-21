import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import gzip

spec = importlib.util.spec_from_file_location('studio_history', Path(__file__).resolve().parents[1] / 'scripts/read-studio-history.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class HistoryTests(unittest.TestCase):
    def test_conversation_text_is_complete_but_reasoning_and_tool_payloads_are_not_exposed(self):
        text = '完整长对话' * 500 + 'END'
        content = json.dumps({'parts':[{'type':'text','text':text},{'type':'reasoning','text':'PRIVATE_REASONING'},{'type':'tool-invocation','args':{'secret':'PRIVATE_TOOL'}}]})
        self.assertEqual(reader.conversation(content), text)
        self.assertNotIn('PRIVATE', reader.conversation(content))
        self.assertNotIn('secret-value', reader.clean('api_key=secret-value'))
        self.assertEqual(reader.conversation('plain message'), 'plain message')

    def test_read_only_platform_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.sqlite'
            db = sqlite3.connect(path)
            db.executescript('CREATE TABLE records(id TEXT,kind TEXT,data TEXT); CREATE TABLE local_accounts(id TEXT,username TEXT,member_id TEXT,password_hash TEXT);')
            db.execute('INSERT INTO local_accounts VALUES(?,?,?,?)',('u1','alice','m1','PRIVATE_HASH'))
            db.execute('INSERT INTO records VALUES(?,?,?)',('m1','member',json.dumps({'name':'合成人员','role':'admin'})))
            db.execute('INSERT INTO records VALUES(?,?,?)',('a1','auth_event',json.dumps({'createdAt':'2026-10-21T01:00:00Z','action':'登录成功','username':'alice','actor':'合成人员'})))
            db.commit(); db.close()
            original = path.read_bytes()
            owners, events = reader.platform(path,'2026-10-21T00:00:00Z','2026-10-22T00:00:00Z')
            self.assertEqual(owners['agent_user_'+reader.digest('u1')[:32]][0], 'alice')
            self.assertEqual(len(events),1)
            self.assertIn('不能据此确认进入Studio',events[0]['source'])
            self.assertNotIn('PRIVATE_HASH',json.dumps(events))
            self.assertEqual(path.read_bytes(), original)
            missing=Path(directory)/'missing.sqlite'
            with self.assertRaises(sqlite3.Error): reader.platform(missing,'a','b')
            self.assertFalse(missing.exists())

    def test_rotated_access_logs_and_no_query_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'access.log'
            line='127.0.0.1 - - [21/Oct/2026:11:00:00 +0800] "POST /studio/api/agents?token=PRIVATE HTTP/1.1" 201 10 "-" "test"\n'
            path.write_text(line+line+'127.0.0.1 - - [21/Oct/2026:11:00:01 +0800] "GET /studio/refresh-events HTTP/1.1" 204 0 "-" "test"\n')
            with gzip.open(str(path)+'.1.gz','wt') as handle: handle.write(line.replace('11:00:00','10:00:00'))
            events=reader.access_events(path,reader.date('2026-10-21T00:00:00Z'),reader.date('2026-10-22T00:00:00Z'))
            self.assertEqual(len(events),3)
            self.assertEqual(len({e['id'] for e in events}),3)
            self.assertNotIn('PRIVATE',json.dumps(events))
            self.assertTrue(all(e['account']=='未记录账号' for e in events))

    def test_paging_no_cap_and_state_change_signature(self):
        events=[reader.event(str(i),'2026-10-21T01:00:00Z','对话','alice','合成人员','消息',detail=str(i)) for i in range(251)]
        args=SimpleNamespace(since='2026-10-21T00:00:00Z',until='2026-10-22T00:00:00Z',container='synthetic-pg',platform_db='synthetic',access_log=__file__,page_size=30,offset=0,username='',category='all',all_requests=False)
        with patch.object(reader,'platform',return_value=({},events)), patch.object(reader,'projection',return_value=[]), patch.object(reader,'access_events',return_value=[]):
            found=[]
            while True:
                page=reader.read(args); found.extend(page['events'])
                if not page['more']: break
                args.offset=page['nextOffset']
            self.assertEqual(len(found),251)
            self.assertEqual(len({e['id'] for e in found}),251)
        updated=reader.event('0','2026-10-21T01:00:00Z','对话','alice','合成人员','消息',detail='updated')
        self.assertNotEqual(updated['signature'],events[0]['signature'])

    def test_builtin_creation_is_distinguished_from_user_creation(self):
        rows=[dict(owner='schema',origin='mastra_agents',at='2026-10-21T00:00:00Z',data={'id':key,'created':'2026-10-21T00:00:00Z','status':'draft'}) for key in ['supervisor','visual-example']]
        events=reader.storage_events(rows,{})
        self.assertEqual(events[0]['action'],'内置Agent初始化')
        self.assertEqual(events[2]['action'],'创建Agent配置')


if __name__ == '__main__':
    unittest.main()
