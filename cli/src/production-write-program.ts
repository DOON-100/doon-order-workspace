import {Command} from 'commander';
import {FoundationService} from './service.js';
import {productionWriteCommands} from './production-write-catalog.js';
export function registerProductionWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const operations=program.commands.find(c=>c.name()==='operations')!,group=(name:string)=>operations.commands.find(c=>c.name()===name)||operations.command(name),ledger=group('ledger'),losses=group('losses'),reports=group('reports'),corrections=group('corrections'),receipts=group('receipts'),service=()=>foundation().productionWrite();
 const input=(c:Command)=>c.requiredOption('--input <file>','UTF-8 JSON文件'),pages=(c:Command)=>c.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0'),operation=(c:Command)=>c.requiredOption('--version <number>','原订单、报工或更正的当前版本').requiredOption('--request-id <uuid>','操作UUID');
 ledger.command('schema').option('--type <type>','ledger|lifecycle','ledger').action(o=>result('operations ledger schema',service().schema(o.type)));
 ledger.command('form <id>').action(async id=>result('operations ledger form',await service().ledgerForm(id)));
 pages(ledger.command('history <id>')).action(async(id,o)=>result('operations ledger history',await service().history('ledger',id,o)));
 input(ledger.command('save')).requiredOption('--version <number>','原订单当前版本').action(async o=>result('operations ledger save',await service().saveLedger(o.input,o.version)));
 input(ledger.command('lifecycle')).requiredOption('--version <number>','原订单当前版本').action(async o=>result('operations ledger lifecycle',await service().ledgerLifecycle(o.input,o.version)));
 losses.command('schema').action(()=>result('operations losses schema',service().schema('loss')));
 pages(losses.command('list')).option('--order <id>','原订单明细ID').option('--process <id>','工序ID').option('--month <month>','确认月份YYYY-MM').action(async o=>result('operations losses list',await service().losses(o)));
 losses.command('form <id>').action(async id=>result('operations losses form',await service().lossForm(id)));
 pages(losses.command('history <orderId>')).option('--process <id>','工序ID').action(async(id,o)=>result('operations losses history',await service().lossHistory(id,o)));
 operation(input(losses.command('save'))).action(async o=>result('operations losses save',await service().saveLoss(o.input,o.version,o.requestId)));
 losses.command('export').requiredOption('--month <month>','确认月份YYYY-MM').requiredOption('--output <file>','新XLSX文件').option('--department <id>','责任部门ID').option('--customer <code>','精确客户原值').option('--search <text>','摘要搜索').action(async o=>result('operations losses export',await service().exportLosses(o.output,o)));
 reports.command('schema').requiredOption('--type <type>','match|correction|review|mes-preview|mes-commit').action(o=>result('operations reports schema',service().schema(o.type)));
 reports.command('form <id>').action(async id=>result('operations reports form',await service().reportForm('report',id)));
 pages(reports.command('history <id>')).action(async(id,o)=>result('operations reports history',await service().history('report',id,o)));
 operation(input(reports.command('action'))).requiredOption('--type <type>','match|correction|review').action(async o=>result('operations reports action',await service().reportAction(o.type,o.input,o.version,o.requestId)));
 input(reports.command('import-preview')).requiredOption('--file <file>','10MiB内原始MES XLSX/XLS/CSV').action(async o=>result('operations reports import-preview',await service().mesPreview(o.input,o.file)));
 reports.command('import-show <id>').action(async id=>result('operations reports import-show',await service().mesJob(id)));
 input(reports.command('import-commit')).action(async o=>result('operations reports import-commit',await service().mesCommit(o.input)));
 reports.command('source-download <id>').requiredOption('--output <file>','新本地文件').action(async(id,o)=>result('operations reports source-download',await service().mesSource(id,o.output)));
 pages(corrections.command('list')).option('--order <id>','原订单明细ID').action(async o=>result('operations corrections list',await service().corrections(o)));
 corrections.command('form <id>').action(async id=>result('operations corrections form',await service().reportForm('correction',id)));
 pages(corrections.command('history <id>')).action(async(id,o)=>result('operations corrections history',await service().history('correction',id,o)));
 receipts.command('schema').action(()=>result('operations receipts schema',service().schema('receipt')));
 receipts.command('file-upload').requiredOption('--file <file>','10MiB内PNG/JPEG/WebP/PDF').action(async o=>result('operations receipts file-upload',await service().receiptUpload(o.file)));
 input(receipts.command('save')).requiredOption('--request-id <uuid>','操作UUID').action(async o=>result('operations receipts save',await service().receiptSave(o.input,o.requestId)));
 receipts.command('file-download <id>').requiredOption('--output <file>','新本地文件').action(async(id,o)=>result('operations receipts file-download',await service().receiptSource(id,o.output)));
 for(const spec of productionWriteCommands){const [,resource,action]=spec.name.split(' ');operations.commands.find(c=>c.name()===resource)!.commands.find(c=>c.name()===action)!.description(spec.description);}
}
