// Read-only diagnosis; do not inspect or print password hashes or session tokens.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const db=new DatabaseSync(path.resolve('lan-data/workspace.sqlite'),{readOnly:true});
const accounts=db.prepare("SELECT a.username,json_extract(r.data,'$.active') active FROM local_accounts a LEFT JOIN records r ON r.id=a.member_id").all();
console.log(JSON.stringify({accounts:accounts.length,activeAccounts:accounts.filter(a=>a.active===1).length,inactiveOrMissing:accounts.filter(a=>a.active!==1).map(a=>a.username),unexpiredLoginFailureBuckets:db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE until_at>?').get(Date.now()).n,database:db.prepare('PRAGMA quick_check').get()},null,2));
db.close();
