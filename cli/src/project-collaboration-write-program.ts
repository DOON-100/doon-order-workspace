import {Command} from 'commander';import {FoundationService} from './service.js';import {projectCollaborationWriteCommands} from './project-collaboration-write-catalog.js';
export function registerProjectCollaborationWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const system=program.commands.find(c=>c.name()==='system')||program.command('system'),group=system.command('collaboration'),name=(a:string)=>'system collaboration '+a,pages=(c:Command)=>c.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0');
 group.command('schema').option('--type <type>','save|followup|complete|cancel|acknowledge','save').action(o=>result(name('schema'),foundation().projectCollaborationWrite().schema(o.type)));
 pages(group.command('list')).option('--project <id>','明确项目编号；省略仅取本人任务与待阅完成反馈').action(async o=>result(name('list'),await foundation().projectCollaborationWrite().list(o)));
 group.command('references').requiredOption('--project <id>','明确项目编号').action(async o=>result(name('references'),await foundation().projectCollaborationWrite().references(o.project)));
 group.command('form <id>').action(async id=>result(name('form'),await foundation().projectCollaborationWrite().form(id)));
 pages(group.command('history <id>')).action(async(id,o)=>result(name('history'),await foundation().projectCollaborationWrite().history(id,o)));
 group.command('save').requiredOption('--input <file>','完整JSON字段').requiredOption('--version <number>','新增0，更新真实版本').requiredOption('--request-id <uuid>','操作UUID').action(async o=>result(name('save'),await foundation().projectCollaborationWrite().save(o.input,o.version,o.requestId)));
 group.command('action').requiredOption('--type <action>','followup|complete|cancel|acknowledge').requiredOption('--input <file>','目标id与明确说明').requiredOption('--version <number>','真实版本').requiredOption('--request-id <uuid>','操作UUID').action(async o=>result(name('action'),await foundation().projectCollaborationWrite().action(o.type,o.input,o.version,o.requestId)));
 for(const spec of projectCollaborationWriteCommands)group.commands.find(c=>spec.name.endsWith(' '+c.name()))!.description(spec.description);
}
