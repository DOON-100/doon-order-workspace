import {clean,type Order,type OrderIdentity} from './domain';

type IdentitySource=Partial<OrderIdentity>;
type IdentityOptions={ignoreBatch?:boolean};
const keys=['orderNo','drawing','color','lens','batch'] as const;

// These are server-owned historical identities, not replacement order IDs.
// Retaining the full key prevents an old workbook from recreating a corrected line.
export function captureOrderIdentity(order:IdentitySource):OrderIdentity{
 return {orderNo:order.orderNo||'',drawing:order.drawing||'',color:order.color||'',lens:order.lens||'',batch:order.batch||''};
}
export function sameOrderIdentity(a:IdentitySource,b:IdentitySource,options:IdentityOptions={}){
 return keys.every(key=>options.ignoreBatch&&key==='batch'||clean(a[key]).toUpperCase()===clean(b[key]).toUpperCase());
}
export function orderIdentityKey(identity:IdentitySource,options:IdentityOptions={}){
 return JSON.stringify(keys.filter(key=>!options.ignoreBatch||key!=='batch').map(key=>clean(identity[key]).toUpperCase()));
}
export const isLedgerDrawingExtra=(key:string)=>/^J\s*·/.test(clean(key));
export function orderIdentities(order:IdentitySource&{identityHistory?:OrderIdentity[]}):OrderIdentity[]{
 const identities:OrderIdentity[]=[];
 for(const identity of [captureOrderIdentity(order),...(order.identityHistory||[])])if(!identities.some(prior=>sameOrderIdentity(prior,identity)))identities.push(captureOrderIdentity(identity));
 return identities;
}
export function matchesOrderIdentity(order:IdentitySource&{identityHistory?:OrderIdentity[]},identity:IdentitySource,options:IdentityOptions={}){
 return orderIdentities(order).some(candidate=>sameOrderIdentity(candidate,identity,options));
}
export function orderIdentitiesOverlap(a:Pick<Order,'orderNo'|'drawing'|'color'|'lens'|'batch'|'identityHistory'>,b:Pick<Order,'orderNo'|'drawing'|'color'|'lens'|'batch'|'identityHistory'>,options:IdentityOptions={}){
 return orderIdentities(a).some(identity=>matchesOrderIdentity(b,identity,options));
}
