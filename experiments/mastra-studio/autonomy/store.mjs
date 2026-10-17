import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const problem=(message,status=409)=>Object.assign(new Error(message),{status});
export class Store{
 constructor(file){
  this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS documents(kind TEXT,id TEXT,data TEXT NOT NULL,PRIMARY KEY(kind,id));');this.inside=false;
 }
 get(kind,id){const row=this.db.prepare('SELECT data FROM documents WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.data):null;}
 list(kind){return this.db.prepare('SELECT data FROM documents WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(row.data));}
 put(kind,row){this.db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,row.id,JSON.stringify(row));return row;}
 transaction(fn){if(this.inside)return fn();this.db.exec('BEGIN IMMEDIATE');this.inside=true;try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.inside=false;}}
 close(){this.db.close();}
}

export const defaultRoles=[
 {id:'supervisor',name:'总管 Agent',capabilities:['coordinate'],routes:['pmc','procurement','service'],tools:['readTaskFacts','completeTask']},
 {id:'pmc',name:'PMC Agent',capabilities:['material-risk'],routes:['procurement','supervisor'],tools:['readTaskFacts','submitTask','completeTask','escalateTask']},
 {id:'procurement',name:'采购 Agent',capabilities:['purchase-check'],routes:['supervisor'],tools:['readTaskFacts','requestHumanReview','waitForTime','completeTask','escalateTask']},
 {id:'service',name:'客服 Agent',capabilities:['customer-impact'],routes:['pmc','supervisor'],tools:['readTaskFacts','submitTask','completeTask','escalateTask']},
];

export class RoleRegistry{
 constructor(roles=defaultRoles){this.roles=new Map();for(const role of roles)this.register(role);}
 register(role){if(!/^[a-z][a-z-]{1,31}$/.test(role.id)||this.roles.has(role.id)||!role.capabilities?.length)throw problem('岗位登记无效');this.roles.set(role.id,structuredClone(role));}
 get(id){const role=this.roles.get(id);if(!role)throw problem('岗位未注册',403);return role;}
 route(from,to,capability){if(!this.get(from).routes.includes(to)||!this.get(to).capabilities.includes(capability))throw problem('岗位路由或任务能力未授权',403);}
 catalog(){return [...this.roles.values()].map(({id,name,capabilities,routes})=>({id,name,capabilities,routes}));}
}
