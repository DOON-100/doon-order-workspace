export const adminWriteCommands=[
 ['schema','schema --type <type>','查询人员、授权、配置和离岗动作字段','local-read'],
 ['references','references --type <type> [--id <id>] [--member <id>] [--incoming] [--limit <number>] [--offset <number>]','查询有权维护的资料和真实人员候选','business-read-and-session-last-seen'],
 ['form','form --type <type> [--id <id>]','读取完整可编辑资料及版本或原配置哈希','business-read-and-session-last-seen'],
 ['save','save --type <type> --input <file> --request-id <uuid>','按完整表单维护业务资料、授权和固定配置','business-write'],
 ['action','action --type <type> --input <file> --request-id <uuid>','显式草拟、本人接收、取消或完成离岗交接','business-write'],
 ['history','history --type <type> [--id <id>] [--limit <number>] [--offset <number>]','读取有权限的管理资料和离岗原件历史','business-read-and-session-last-seen'],
].map(([action,usage,description,effect])=>({name:'admin management '+action,namespace:'admin',usage:'admin management '+usage,description,effect}));
