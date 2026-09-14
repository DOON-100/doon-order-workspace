import {type Order,type Report,packed,strictDate} from './domain';
export const colLabels:Record<string,string>={A:'生产厂',B:'跟单员',C:'客户号',D:'客户等级',E:'质量等级',F:'订单类',G:'订单类型',H:'镜片类型',I:'订单号',J:'图纸编号 / 款号',K:'客款号',L:'色号',M:'订单数量',N:'投产数量',O:'业务下单日期',P:'原表出货欠数',Q:'半成品数',R:'采购收单日期',S:'收单月',T:'客原交货期',U:'PMC排期',V:'交期月',W:'产品类型',X:'圈色',Y:'腿色',Z:'金属色',AA:'其它色',AB:'状态备注',AC:'配件齐日期',AD:'板料齐期',AE:'配套齐料期',AF:'投产日',AG:'焊完成数',AH:'焊完成日',AI:'打磨出电数量',AJ:'打磨出电日期',AK:'焊磨备注',AL:'电回数量',AM:'电回日期',AN:'电镀备注',AO:'钛配套发成品数',AP:'钛齐套日',AQ:'钛配套发成品日',AR:'脾完成数',AS:'脾完成日',AT:'脾出桶数',AU:'脾出桶日',AV:'车房下桶数',AW:'车房下桶日',AX:'车房出桶数',AY:'车房出桶日',AZ:'车房备注',BA:'配套发钉胶数',BB:'胶齐套日',BC:'配套发钉胶日',BD:'钉装完成数',BE:'钉装完成日',BF:'包装入仓数量',BG:'包装入仓日期',BH:'结单日',BI:'成品备注',BJ:'是否准时',BK:'订单周期'};
export const quantityCols=['N','Q','AG','AI','AL','AO','AR','AT','AV','AX','BA','BD','BF'];
export const dateCols=['O','R','T','U','AC','AD','AE','AF','AH','AJ','AM','AP','AQ','AS','AU','AW','AY','BB','BC','BE','BG','BH'];
export const editableCols=[...quantityCols,...dateCols.filter(c=>!['O','T','R'].includes(c)),'AB','AK','AN','AZ','BI'];
export const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export function numeric(v:unknown):number|null{if(v===undefined||v===null||String(v).trim()===''||String(v).trim()==='-')return null;const t=String(v).trim().replace(/,/g,'');return /^-?\d+(\.\d+)?$/.test(t)&&Number.isFinite(+t)?+t:null;}
export function dateValue(v:unknown){const t=String(v??'').trim();if(!t||t==='-')return '';const n=numeric(t);if(n!==null&&n>36525&&n<73416)return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);try{return strictDate(t);}catch{return '';}}
export function countValue(v:unknown){const n=numeric(v);return n!==null&&Number.isSafeInteger(n)&&n>=0?n:null;}
export function automaticDates(c:Record<string,string>){const max=(keys:string[])=>keys.map(k=>dateValue(c[k])).filter(Boolean).sort().pop()||'';return {AP:c.AM&&c.AM!=='-'&&(c.AU||c.AU==='-')?max(['AM','AU']):'',BB:c.AM&&c.AU&&c.AY?max(c.AM==='-'?['AU','AY']:['AM','AU','AY']):''};}
export function warehouse(o:Order):number|null{if(!o.ledger)return null;const v=o.ledger.columns.BF;return !v?0:countValue(v);}
export function outstanding(o:Order){const n=warehouse(o);return n===null?null:o.quantity-n;}
export function balance(o:Order,reports:Report[]){return o.ledger?outstanding(o):o.quantity-packed(o,reports);}
export const ownerLabel=(o:Order)=>o.ledger?.ownerName||o.ownerEmail||'待分配';
export const active=(o:Order)=>o.lifecycle!=='archived'&&o.sourceStatus!=='已取消';
export const promisedDue=(o:Order)=>o.plannedDate||o.requestedDate;
export const overdue=(o:Order)=>active(o)&&(outstanding(o)??o.quantity)>0&&!!promisedDue(o)&&promisedDue(o)<today();
export const days=(date:string,end=today())=>date?Math.floor((Date.parse(end)-Date.parse(date))/86400000):null;
export const stageDefs=[
 {id:'procurement',name:'采购 / 齐料',done:'AE',prev:'M',start:'O',end:'AE',limit:30},
 {id:'welding',name:'钛焊',done:'AG',prev:'M',start:'AF',end:'AH',limit:8},
 {id:'polishing',name:'打磨 / 出电',done:'AI',prev:'AG',start:'AH',end:'AJ',limit:8},
 {id:'plating',name:'电镀回货',done:'AL',prev:'AI',start:'AJ',end:'AM',limit:10},
 {id:'titanium',name:'钛配套',done:'AO',prev:'AL',start:'AM',end:'AQ',limit:3},
 {id:'temple',name:'脾加工',done:'AR',prev:'M',start:'AF',end:'AS',limit:10},
 {id:'cnc',name:'车房',done:'AV',prev:'M',start:'AF',end:'AW',limit:10},
 {id:'kit',name:'出桶 / 配套',done:'BA',prev:'AV',start:'AW',end:'BC',limit:10},
 {id:'assembly',name:'钉装 / 磨胶',done:'BD',prev:'BA',start:'BC',end:'BE',limit:3},
 {id:'packing',name:'包装入仓',done:'BF',prev:'PACK',start:'BE',end:'BG',limit:3},
] as const;
export function stageNumbers(o:Order,def:typeof stageDefs[number]){
 const c=o.ledger?.columns;if(!c)return {debt:null,wip:null,age:null,invalid:false};
 if(c[def.done]==='-'||(def.id==='plating'&&c.AI==='-')||(def.id==='titanium'&&c.AL==='-')||(def.id==='kit'&&c.AV==='-')||(def.id==='assembly'&&c.BA==='-'))return {debt:null,wip:null,age:null,invalid:false};
 const raw=def.id==='procurement'?(dateValue(c.AE)?o.quantity:0):(!c[def.done]?0:countValue(c[def.done]));
 const prev=def.prev==='M'?(dateValue(c[def.start])?o.quantity:null):def.prev==='PACK'?Math.max(countValue(c.AO)||0,countValue(c.BD)||0):countValue(c[def.prev]);
 const debt=raw===null?null:Math.max(0,o.quantity-raw),w=def.id==='procurement'?(dateValue(c.AE)&&!dateValue(c.AF)?o.quantity:0):prev===null||raw===null?null:prev-raw;
 return {debt,wip:w===null||w<0?null:w,age:debt&&dateValue(c[def.start])?days(dateValue(c[def.start])):null,invalid:raw===null||(w!==null&&w<0)};
}
export function issues(o:Order){
 const a:string[]=[];if(!o.drawing)a.push('缺款号');if(!o.lens||o.lens==='-')a.push('镜片待核对');if(!o.ownerEmail)a.push('跟单账号未绑定');
 if(o.quantity<0)a.push('原表负数调整');if(!o.quantity||!Number.isSafeInteger(o.quantity))a.push('订单数量待核对');
 if(!promisedDue(o)&&active(o))a.push('未排交期');if(overdue(o))a.push('交期逾期');
 if(o.ledger){const c=o.ledger.columns,n=outstanding(o),p=numeric(o.ledger.originalOutstanding);if(n===null)a.push('入仓数量无效');if(n!==null&&n<0&&o.quantity>=0)a.push('超量入仓');if(p!==null&&n!==null&&p!==n)a.push('原表欠数不一致');
 if(Object.values(c).some(v=>/^#(VALUE|REF|DIV|N\/A|NUM|NAME|NULL)/.test(v)))a.push('原表计算错误');
 for(const k of quantityCols)if(c[k]&&c[k]!=='-'&&(countValue(c[k])===null)){a.push('工序数量待核对');break;}
 if(o.lifecycle==='archived'&&n!==null&&n>0)a.push('归档有余欠');if(o.lifecycle==='archived'&&!o.closedDate)a.push('缺结单日期');
 if(o.ledger.issues.includes('同键多行'))a.push('同键多行');}
 return [...new Set(a)];
}
export function currentStage(o:Order){if(o.lifecycle==='archived')return '已归档';if(!o.ledger)return o.stage;const n=outstanding(o);if(n!==null&&n<=0)return '入仓足量 · 待结单';for(const d of [...stageDefs].reverse()){const s=stageNumbers(o,d);if((s.wip||0)>0)return d.name;}return '待齐料 / 核对';}
