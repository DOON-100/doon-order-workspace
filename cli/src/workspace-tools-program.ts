import {Command} from 'commander';import {FoundationService} from './service.js';
export function registerWorkspaceTools(program:Command,foundation:()=>FoundationService,result:(name:string,data:any)=>void){
 const system=program.commands.find(c=>c.name()==='system')||program.command('system'),group=system.command('workspace'),service=()=>foundation().workspaceTools(),name=(v:string)=>'system workspace '+v,input=(c:Command)=>c.requiredOption('--input <file>','明确字段的JSON'),typed=(c:Command)=>c.requiredOption('--type <type>','固定类型'),pages=(c:Command)=>c.option('--limit <number>','条数').option('--offset <number>','偏移');
 typed(group.command('schema')).action(o=>result(name('schema'),service().schema(o.type)));
 pages(typed(group.command('list'))).action(async o=>result(name('list'),await service().list(o.type,o)));
 typed(group.command('form <id>')).action(async(id,o)=>result(name('form'),await service().form(o.type,id)));
 typed(group.command('references')).action(async o=>result(name('references'),await service().references(o.type)));
 typed(group.command('history <id>')).action(async(id,o)=>result(name('history'),await service().history(o.type,id)));
 input(typed(group.command('save'))).requiredOption('--request-id <uuid>','UUID').action(async o=>result(name('save'),await service().save(o.type,o.input,o.requestId)));
 input(typed(group.command('action'))).option('--request-id <uuid>','财务任务UUID；费用决定使用原job/previewHash').action(async o=>result(name('action'),await service().action(o.type,o.input,o.requestId)));
 input(group.command('inspect')).requiredOption('--file <file>','原工作表').action(async o=>result(name('inspect'),await service().inspect(o.input,o.file)));
 input(typed(group.command('preview'))).option('--file <file>','原工作表').action(async o=>result(name('preview'),await service().preview(o.type,o.input,o.file)));
 input(typed(group.command('commit'))).action(async o=>result(name('commit'),await service().commit(o.type,o.input)));
 input(group.command('workbook')).requiredOption('--file <file>','10MiB内XLSX').action(async o=>result(name('workbook'),await service().workbook(o.input,o.file)));
 input(group.command('ownership')).action(async o=>result(name('ownership'),await service().ownership(o.input)));
 input(group.command('report')).requiredOption('--output <file.xlsx>','新输出文件').action(async o=>result(name('report'),await service().report(o.input,o.output)));
 typed(group.command('template')).requiredOption('--output <file.xlsx>','新模板文件').action(async o=>result(name('template'),await service().template(o.type,o.output)));
 typed(group.command('file-download <id>')).requiredOption('--output <file>','新输出文件').action(async(id,o)=>result(name('file-download'),await service().download(o.type,id,o.output)));
}
