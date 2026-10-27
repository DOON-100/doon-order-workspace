export const projectFinanceWriteCommands=[
 ['schema','schema --type <type>','查询项目收费、独立登记及正式账务动作字段','local-read'],
 ['form','form <id> --kind <kind>','读取授权完整表单及服务器实际版本','read'],
 ['references','references [--kind <kind>] [--customer <id>] [--project <id>] [--limit <number>] [--offset <number>]','查询授权客户、项目、轮次与账务关联','read'],
 ['save','save --type <type> --input <file> --version <number> --request-id <uuid>','新增或指定字段修改收费、独立记录、通知及单据','write'],
 ['action','action --type <type> --input <file> [--version <number>] --request-id <uuid>','按原权限核实、分配、释放、调整、抵扣及单据动作','write'],
 ['history','history <id> --kind <kind> [--limit <number>] [--offset <number>]','查询项目财务原版本与留痕','read'],
 ['print','print <id> --version <number> --output <file.html>','导出授权版本生成的HTML，不实际打印或发送','read'],
].map(([action,usage,description,effect])=>({name:'finance project '+action,namespace:'finance',usage:'finance project '+usage,description,effect:effect==='write'?'business-write':effect==='local-read'?'local-read':'business-read-and-session-last-seen'}));
