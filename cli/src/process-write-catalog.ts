const specs=[
 ['schema','schema --type <type>','查询流程凭据表单及未知数量规则','local-read'],
 ['list','list --type <type> [--team <id>] [--customer <id>] [--order <id>] [--limit <number>] [--offset <number>]','查询权限内流程记录','business-read-and-session-last-seen'],
 ['form','form <id> --type <type> [--team <id>]','读取流程当前字段、权限及版本','business-read-and-session-last-seen'],
 ['references','references --type <type> [--team <id>] [--limit <number>] [--offset <number>]','查询关联客户、订单和现有负责人','business-read-and-session-last-seen'],
 ['history','history <id> --type <type> [--team <id>] [--limit <number>] [--offset <number>]','查询原类型和关联下的流程历史','business-read-and-session-last-seen'],
 ['save','save --type <type> --input <file> --version <number> --request-id <id> [--team <id>] [--replace-details]','新增或增量保存流程凭据并回读','business-write'],
];
export const processWriteCommands=['quality','warehouse'].flatMap(namespace=>specs.map(([action,usage,description,effect])=>({name:`${namespace} records ${action}`,namespace,usage:`${namespace} records ${usage}`,description,effect})));
