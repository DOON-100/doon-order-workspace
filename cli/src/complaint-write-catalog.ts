const specs=[
 ['schema','schema','查询投诉、整改和客户确认原证据字段','local-read'],
 ['form','form <id> [--team <id>]','读取投诉原字段、版本及客户确认未知项','business-read-and-session-last-seen'],
 ['references','references [--team <id>] [--limit <number>] [--offset <number>]','查询原客户、订单和负责人及关联边界','business-read-and-session-last-seen'],
 ['revisions','revisions <id> [--team <id>] [--limit <number>] [--offset <number>]','读取投诉与整改历史及原客户证据','business-read-and-session-last-seen'],
 ['save','save --input <file> --version <number> --request-id <id> [--team <id>] [--replace-details]','增量保存投诉、整改或原状态动作并回读','business-write'],
];
export const complaintWriteCommands=specs.map(([action,usage,description,effect])=>({name:'finance complaints '+action,namespace:'finance',usage:'finance complaints '+usage,description,effect}));
