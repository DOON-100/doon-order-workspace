import {Command} from 'commander';
import {FoundationService} from './service.js';
import {serviceRecordWriteCommands} from './service-record-write-catalog.js';
export function registerServiceRecordWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const service=program.commands.find(row=>row.name()==='service')!,group=service.command('records'),team=(command:Command)=>command.option('--team <id>','业务组编号'),pages=(command:Command)=>command.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0'),name=(action:string)=>'service records '+action;
 group.command('schema').action(o=>result(name('schema'),foundation().serviceRecordWrite(o.type).schema()));
 team(pages(group.command('list'))).option('--customer <id>','客户编号').option('--order <id>','订单明细编号').action(async o=>result(name('list'),await foundation().serviceRecordWrite(o.type).list(o)));
 team(pages(group.command('references'))).option('--customer <id>','客户编号').action(async o=>result(name('references'),await foundation().serviceRecordWrite(o.type).references(o)));
 team(group.command('form <id>')).action(async(id,o)=>result(name('form'),await foundation().serviceRecordWrite(o.type).form(id,o.team)));
 team(pages(group.command('history <id>'))).action(async(id,o)=>result(name('history'),await foundation().serviceRecordWrite(o.type).history(id,o)));
 team(group.command('save')).requiredOption('--input <file>','UTF-8 JSON文件').requiredOption('--version <number>','新增0，修改当前版本').requiredOption('--request-id <uuid>','本次保存UUID').option('--order-version <number>','关联订单当前版本').action(async o=>result(name('save'),await foundation().serviceRecordWrite(o.type).save(o.input,o.version,o.requestId,o.orderVersion,o.team)));
 team(group.command('files <id>')).action(async(id,o)=>result(name('files'),await foundation().serviceRecordWrite(o.type).files(id,o.team)));
 team(group.command('file-upload')).requiredOption('--input <file>','recordId/note/category的JSON').requiredOption('--file <file>','10MiB以内原件').requiredOption('--version <number>','发运当前版本').action(async o=>result(name('file-upload'),await foundation().serviceRecordWrite(o.type).upload(o.input,o.file,o.version,o.team)));
 team(group.command('file-download <id> <fileId>')).requiredOption('--output <file>','新输出文件').action(async(id,fileId,o)=>result(name('file-download'),await foundation().serviceRecordWrite(o.type).download(id,fileId,o.output,o.team)));
 for(const spec of serviceRecordWriteCommands)group.commands.find(row=>spec.name.endsWith(' '+row.name()))!.requiredOption('--type <type>','customer_profile|followup|project|sample').description(spec.description);
}
