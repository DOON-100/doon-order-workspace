const specs=[
 ['orders','schema','schema','查询订单排期回填字段','local-read'],
 ['orders','form','form <id>','读取授权订单当前排期及PMC原表字段','read'],
 ['orders','save','save --input <file> --version <number>','增量回填订单排期、物料状态及交期','write'],
 ['pmc','schema','schema','查询PMC总表可编辑单元格及限制','local-read'],
 ['pmc','save','save --input <file>','按来源版本批量保存PMC指定单元格','write'],
 ['rounds','schema','schema [--type <type>]','查询PMC核对轮次或进度字段','local-read'],
 ['rounds','start','start --input <file> --request-id <uuid>','开始本人指定范围的PMC核对轮次','write'],
 ['rounds','review','review --input <file> --version <number> [--scope <scope>]','按订单当前版本登记本人轮次的核对进度','write'],
 ['control','schema','schema [--type <type>] [--scenario <id>] [--module <id>] [--tool <type>]','查询人工计划、齐套、测算及有限产能字段','local-read'],
 ['control','references','references [--limit <number>] [--offset <number>]','查询授权负责人、来源订单、产能窗口及场景','read'],
 ['control','list','list --type <type> [--scenario <id>] [--limit <number>] [--offset <number>]','查询授权计划、测算或有限产能方案','read'],
 ['control','form','form <id> --type <type>','读取当前计划、测算或产能表单','read'],
 ['control','history','history <id> --type <type> [--limit <number>] [--offset <number>]','读取计划资料的不可变历史及来源版本','read'],
 ['control','save','save --type <type> --input <file> --version <number> --request-id <uuid>','新增或增量修改计划、测算、窗口及产能草案','write'],
 ['control','action','action --type <type> --input <file> --version <number> --request-id <uuid>','推进、退回、归档计划或确认取消产能方案','write'],
];
export const planningWriteCommands=specs.map(([resource,action,usage,description,effect])=>({name:'planning '+resource+' '+action,namespace:'planning',usage:'planning '+resource+' '+usage,description,effect:effect==='write'?'business-write':effect==='local-read'?'local-read':'business-read-and-session-last-seen'}));
