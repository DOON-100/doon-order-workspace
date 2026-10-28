import {Command} from 'commander';import {FoundationService} from './service.js';import {adminWriteCommands} from './admin-write-catalog.js';
export function registerAdminWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const admin=program.commands.find(c=>c.name()==='admin')||program.command('admin'),group=admin.command('management'),writer=()=>foundation().adminWrite(),type=(c:Command)=>c.requiredOption('--type <type>','schema列出的固定资料或动作类型'),pages=(c:Command)=>c.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0');
 type(group.command('schema')).action(o=>result('admin management schema',writer().schema(o.type)));
 pages(type(group.command('references')).option('--id <id>','资料ID').option('--member <id>','离岗来源成员').option('--incoming','仅本人接收清单')).action(async o=>result('admin management references',await writer().references(o.type,o)));
 type(group.command('form')).option('--id <id>','既有资料ID').action(async o=>result('admin management form',await writer().form(o.type,o.id)));
 for(const name of ['save','action'] as const)type(group.command(name)).requiredOption('--input <file>','完整UTF-8 JSON表单').requiredOption('--request-id <uuid>','原请求去重编号').action(async o=>result('admin management '+name,await writer()[name](o.type,o.input,o.requestId)));
 pages(type(group.command('history')).option('--id <id>','资料或离岗计划ID')).action(async o=>result('admin management history',await writer().history(o.type,o.id,o)));
 for(const spec of adminWriteCommands)group.commands.find(c=>c.name()===spec.name.split(' ').at(-1))!.description(spec.description);
}
