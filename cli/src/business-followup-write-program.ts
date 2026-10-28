import {Command} from 'commander';import {FoundationService} from './service.js';import {businessFollowupWriteCommands} from './business-followup-write-catalog.js';
export function registerBusinessFollowupWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const system=program.commands.find(c=>c.name()==='system')||program.command('system'),group=system.command('followups'),api=()=>foundation().businessFollowupWrite(),name=(a:string)=>'system followups '+a,scope=(c:Command)=>c.requiredOption('--input <file>','目标四元组JSON').option('--team <id>','原业务组范围'),pages=(c:Command)=>c.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0');
 group.command('schema').action(()=>result(name('schema'),api().schema()));
 pages(group.command('targets')).requiredOption('--module <module>','schema列出的固定栏目').option('--project <id>','明确项目编号').option('--team <id>','原业务组范围').action(async o=>result(name('targets'),await api().targets(o.module,o)));
 pages(scope(group.command('list'))).action(async o=>result(name('list'),await api().list(o.input,o)));
 scope(group.command('show <id>')).action(async(id,o)=>result(name('show'),await api().show(o.input,id,o.team)));
 scope(group.command('save')).requiredOption('--request-id <uuid>','本次UUID').option('--files <paths...>','最多10个非空原件').action(async o=>result(name('save'),await api().save(o.input,o.requestId,o.files,o.team)));
 scope(group.command('files <entryId>')).action(async(id,o)=>result(name('files'),await api().files(o.input,id,o.team)));
 scope(group.command('file-download <entryId> <fileId>')).requiredOption('--output <file>','新输出文件').action(async(entryId,fileId,o)=>result(name('file-download'),await api().download(o.input,entryId,fileId,o.output,o.team)));
 for(const row of businessFollowupWriteCommands)group.commands.find(c=>row.name.endsWith(' '+c.name()))!.description(row.description);
}
