import {Command} from 'commander';
import {FoundationService} from './service.js';
import {planningWriteCommands} from './planning-write-catalog.js';
import {CliError} from './errors.js';
export function registerPlanningWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const planning=program.commands.find(c=>c.name()==='planning')!,group=(name:string)=>planning.commands.find(c=>c.name()===name)||planning.command(name),orders=group('orders'),pmc=group('pmc'),rounds=group('rounds'),control=group('control');
 const input=(c:Command)=>c.requiredOption('--input <file>','UTF-8 JSON文件'),pages=(c:Command)=>c.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0'),version=(c:Command)=>c.requiredOption('--version <number>','新建0，修改当前版本').requiredOption('--request-id <uuid>','操作UUID');
 orders.command('schema').action(()=>result('planning orders schema',foundation().planningWrite().schema('orders')));
 orders.command('form <id>').action(async id=>result('planning orders form',await foundation().planningWrite().order(id)));
 input(orders.command('save')).requiredOption('--version <number>','订单当前版本').action(async o=>result('planning orders save',await foundation().planningWrite().saveOrder(o.input,o.version)));
 pmc.command('schema').action(()=>result('planning pmc schema',foundation().planningWrite().schema('pmc')));
 input(pmc.command('save')).action(async o=>result('planning pmc save',await foundation().planningWrite().savePmc(o.input)));
 rounds.command('schema').option('--type <type>','round|review','round').action(o=>{if(!['round','review'].includes(o.type))throw new CliError('INVALID_ARGUMENT','type须为round或review。',2);result('planning rounds schema',foundation().planningWrite().schema(o.type));});
 input(rounds.command('start')).requiredOption('--request-id <uuid>','轮次操作UUID').action(async o=>result('planning rounds start',await foundation().planningWrite().startRound(o.input,o.requestId)));
 input(rounds.command('review')).requiredOption('--version <number>','订单当前版本').option('--scope <scope>','internal|external','internal').action(async o=>result('planning rounds review',await foundation().planningWrite().reviewRound(o.input,o.version,o.scope)));
 control.command('schema').option('--type <type>','record|calculation|window|allocation|transition|allocation-transition','record').option('--scenario <id>','网站计划场景ID').option('--module <id>','场景内模块ID').option('--tool <type>','capacityGap|setupVariance').action(o=>result('planning control schema',foundation().planningWrite().schema(o.type,o)));
 pages(control.command('references')).action(async o=>result('planning control references',await foundation().planningWrite().references(o)));
 pages(control.command('list')).requiredOption('--type <type>','record|calculation|window|allocation').option('--scenario <id>','场景ID').action(async o=>result('planning control list',await foundation().planningWrite().list(o.type,o)));
 control.command('form <id>').requiredOption('--type <type>','record|calculation|window|allocation').action(async(id,o)=>result('planning control form',await foundation().planningWrite().form(o.type,id)));
 pages(control.command('history <id>')).requiredOption('--type <type>','record|calculation|window|allocation').action(async(id,o)=>result('planning control history',await foundation().planningWrite().history(o.type,id,o)));
 version(input(control.command('save'))).requiredOption('--type <type>','record|calculation|window|allocation').action(async o=>result('planning control save',await foundation().planningWrite().save(o.type,o.input,o.version,o.requestId)));
 version(input(control.command('action'))).requiredOption('--type <type>','record|allocation').action(async o=>result('planning control action',await foundation().planningWrite().action(o.type,o.input,o.version,o.requestId)));
 for(const spec of planningWriteCommands){const [,resource,action]=spec.name.split(' ');planning.commands.find(c=>c.name()===resource)!.commands.find(c=>c.name()===action)!.description(spec.description);}
}
