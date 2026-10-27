import {Command} from 'commander';
import {FoundationService} from './service.js';
import {purchaseWriteCommands} from './purchase-write-catalog.js';
export function registerPurchaseWrites(program:Command,foundation:()=>FoundationService,result:(name:string,data:unknown)=>void){
 const purchasing=program.commands.find(row=>row.name()==='purchasing')!,purchases=purchasing.commands.find(row=>row.name()==='purchases')!;
 purchases.command('schema').option('--type <type>','followup|opening|correction|receipt|return|replacement|archive','followup').action(o=>result('purchasing purchases schema',foundation().purchaseWrite().schema(o.type)));
 purchases.command('form <id>').action(async id=>result('purchasing purchases form',await foundation().purchaseWrite().form(id)));
 purchases.command('save').requiredOption('--input <file>','UTF-8 JSON文件').requiredOption('--version <number>','当前明细版本').action(async o=>result('purchasing purchases save',await foundation().purchaseWrite().save(o.input,o.version)));
 purchases.command('action').requiredOption('--type <type>','opening|correction|receipt|return|replacement|archive').requiredOption('--input <file>','UTF-8 JSON文件').option('--version <number>','核数动作的当前版本').option('--request-id <uuid>','核数动作的UUID').action(async o=>result('purchasing purchases action',await foundation().purchaseWrite().action(o.type,o.input,o.version,o.requestId)));
 for(const spec of purchaseWriteCommands)purchases.commands.find(row=>spec.name.endsWith(' '+row.name()))!.description(spec.description);
}
