import {Command} from 'commander';
import {FoundationService} from './service.js';
import {CliError} from './errors.js';
import {qualityProcessTypes,warehouseProcessTypes} from './process-write.js';
import {processWriteCommands} from './process-write-catalog.js';
export function registerProcessWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 for(const namespace of ['quality','warehouse'] as const){
  const parent=program.commands.find(row=>row.name()===namespace)||program.command(namespace),group=parent.command('records'),types=namespace==='quality'?qualityProcessTypes:warehouseProcessTypes;
  const allowed=(type:string)=>{if(!(types as readonly string[]).includes(type))throw new CliError('UNSUPPORTED_OPERATION','此栏目不支持该流程类型。',2);return type;};
  const typed=(command:Command)=>command.requiredOption('--type <type>',types.join('|')),team=(command:Command)=>command.option('--team <id>','业务组编号'),pages=(command:Command)=>command.option('--limit <number>','每页1至100','20').option('--offset <number>','起始偏移','0'),name=(action:string)=>`${namespace} records ${action}`;
  typed(group.command('schema')).action(o=>result(name('schema'),foundation().processRecords().schema(allowed(o.type))));
  team(pages(typed(group.command('list')))).option('--customer <id>','客户编号').option('--order <id>','订单明细编号').action(async o=>result(name('list'),await foundation().processRecords().list(allowed(o.type),o)));
  team(typed(group.command('form <id>'))).action(async(id,o)=>result(name('form'),await foundation().processRecords().form(allowed(o.type),id,o.team)));
  team(pages(typed(group.command('references')))).action(async o=>result(name('references'),await foundation().processRecords().references(allowed(o.type),o)));
  team(pages(typed(group.command('history <id>')))).action(async(id,o)=>result(name('history'),await foundation().processRecords().history(allowed(o.type),id,o)));
  team(typed(group.command('save'))).requiredOption('--input <file>','UTF-8 JSON文件').requiredOption('--version <number>','新增0，修改当前版本').requiredOption('--request-id <id>','本次操作标识').option('--replace-details','显式整对象替换details，省略数值表示未知').action(async o=>result(name('save'),await foundation().processRecords().save(allowed(o.type),o.input,o.version,o.requestId,o.team,o.replaceDetails===true)));
  for(const spec of processWriteCommands.filter(row=>row.namespace===namespace))group.commands.find(row=>spec.name.endsWith(' '+row.name()))!.description(spec.description);
 }
}
