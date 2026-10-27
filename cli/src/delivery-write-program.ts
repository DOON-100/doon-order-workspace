import {Command} from 'commander';
import {FoundationService} from './service.js';
import {deliveryWriteCommands} from './delivery-write-catalog.js';
export function registerDeliveryWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const service=program.commands.find(row=>row.name()==='service')!,group=service.command('shipments'),team=(command:Command)=>command.option('--team <id>','业务组编号'),pages=(command:Command)=>command.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0'),name=(action:string)=>'service shipments '+action;
 group.command('schema').action(()=>result(name('schema'),foundation().deliveryWrite().schema()));
 team(pages(group.command('list'))).option('--customer <id>','客户编号').option('--order <id>','订单明细编号').action(async o=>result(name('list'),await foundation().deliveryWrite().list(o)));
 team(pages(group.command('references'))).option('--customer <id>','客户编号').action(async o=>result(name('references'),await foundation().deliveryWrite().references(o)));
 team(group.command('form <id>')).action(async(id,o)=>result(name('form'),await foundation().deliveryWrite().form(id,o.team)));
 team(pages(group.command('history <id>'))).action(async(id,o)=>result(name('history'),await foundation().deliveryWrite().history(id,o)));
 team(group.command('save')).requiredOption('--input <file>','UTF-8 JSON文件').requiredOption('--version <number>','新增0，修改当前版本').requiredOption('--request-id <uuid>','本次保存UUID').option('--order-version <number>','关联订单当前版本').action(async o=>result(name('save'),await foundation().deliveryWrite().save(o.input,o.version,o.requestId,o.orderVersion,o.team)));
 team(group.command('files <id>')).action(async(id,o)=>result(name('files'),await foundation().deliveryWrite().files(id,o.team)));
 team(group.command('file-upload')).requiredOption('--input <file>','recordId/note/category的JSON').requiredOption('--file <file>','10MiB以内原件').requiredOption('--version <number>','发运当前版本').action(async o=>result(name('file-upload'),await foundation().deliveryWrite().upload(o.input,o.file,o.version,o.team)));
 team(group.command('file-download <id> <fileId>')).requiredOption('--output <file>','新输出文件').action(async(id,fileId,o)=>result(name('file-download'),await foundation().deliveryWrite().download(id,fileId,o.output,o.team)));
 for(const spec of deliveryWriteCommands)group.commands.find(row=>spec.name.endsWith(' '+row.name()))!.description(spec.description);
}
