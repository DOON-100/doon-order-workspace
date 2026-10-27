export const purchaseWriteCommands=[
 ['schema','schema [--type <type>]','查询采购跟进、核数及存档字段','local-read'],
 ['form','form <id>','读取采购明细及当前版本','business-read-and-session-last-seen'],
 ['save','save --input <file> --version <number>','修改指定采购跟进字段并回读','business-write'],
 ['action','action --type <type> --input <file> [--version <number>] [--request-id <uuid>]','登记采购核数、退补或齐货存档并回读','business-write'],
].map(([action,usage,description,effect])=>({name:'purchasing purchases '+action,namespace:'purchasing',usage:'purchasing purchases '+usage,description,effect}));
