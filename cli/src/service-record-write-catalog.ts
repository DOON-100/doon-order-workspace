const specs=[
 ['schema','schema','查询客服记录登记字段及来源版本规则','local-read'],
 ['list','list [--team <id>] [--customer <id>] [--order <id>] [--limit <number>] [--offset <number>]','查询授权客服记录及物流跟进记录','business-read-and-session-last-seen'],
 ['references','references [--team <id>] [--customer <id>] [--limit <number>] [--offset <number>]','查询客服记录关联订单、版本与责任候选','business-read-and-session-last-seen'],
 ['form','form <id> [--team <id>]','读取当前客服记录字段和来源版本','business-read-and-session-last-seen'],
 ['history','history <id> [--team <id>] [--limit <number>] [--offset <number>]','读取客服记录原记录历史','business-read-and-session-last-seen'],
 ['save','save --input <file> --version <number> --request-id <uuid> [--order-version <number>] [--team <id>]','保存客服记录或物流跟进事实并回读','business-write'],
 ['files','files <id> [--team <id>]','查询客服记录附件原件目录','business-read-and-session-last-seen'],
 ['file-upload','file-upload --input <file> --file <file> --version <number> [--team <id>]','保存不可变客服记录证据原件并回读','business-write'],
 ['file-download','file-download <id> <fileId> --output <file> [--team <id>]','核验摘要并下载客服记录原件到新文件','local-file-and-session-last-seen'],
];
export const serviceRecordWriteCommands=specs.map(([action,usage,description,effect])=>({name:'service records '+action,namespace:'service',usage:'service records '+usage+' --type <customer_profile|followup|project|sample>',description,effect}));
