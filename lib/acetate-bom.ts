import {z} from 'zod';

export const ACETATE_RULE_VERSION='acetate-bom-20261110-v1';
export const ACETATE_SUPPLIERS=[{name:'金余',url:'https://www.jinyuplastic.com/Col/Col1/Index.aspx'},{name:'华意',url:'https://www.mazzucchelli1849.it/'},{name:'怡亮',url:'https://www.la-es.com/it'},{name:'集美',url:'https://www.jimei123.com/'},{name:'山宗 / TAKIRON ROWLAND',url:'https://www.takiron-rowland.co.jp/'}] as const;
export const normalizeAcetateThickness=(value:unknown)=>value===40||value==='40'?4:value===60||value==='60'?6:value;
const number=z.number().finite().nonnegative().max(100000).nullable();
const text=z.string().trim().max(160);
export const acetateComponentSchema=z.object({
 id:text.min(1),name:text.min(1),part:z.enum(['frame','temple','endpiece']),process:z.enum(['frame','punch','cnc','manual']),
 supplier:text,color:text,materialCode:text,stockId:text,stockSource:text.max(500),
 length:number,width:number,thickness:z.preprocess(normalizeAcetateThickness,z.number().finite().positive().max(30).nullable()),quantity:number,
 basis:z.enum(['net','blank']),extraLength:number,extraWidth:number,reason:text.max(500),
 stockLength:number,stockWidth:number,trimLength:number,trimWidth:number,kerf:number,rawKerf:number,
 pattern:z.enum(['mono','stripe','gradient']),rotation:z.enum(['best','0','90']),segmentAxis:z.enum(['length','width']),segmentLength:number,
 blockLength:number,blockWidth:number,blockTrimLength:number,blockTrimWidth:number,blockRotation:z.enum(['best','0','90']),
 yieldPercent:number,weightMode:z.enum(['density','history','confirmed']),density:number,weightKg:number,pricePerKg:number,notes:text.max(1000),
}).strict();
export type AcetateComponent=z.infer<typeof acetateComponentSchema>;
export const acetateBomFields=z.object({customerAccountId:text.min(1),model:text.min(1),drawingRevision:text.min(1),orderQuantity:z.number().int().positive().max(10000000),notes:text.max(2000),components:z.array(acetateComponentSchema).min(1).max(100)}).strict().superRefine((v,ctx)=>{if(new Set(v.components.map(c=>c.id)).size!==v.components.length)ctx.addIssue({code:'custom',message:'组件编号重复'});});
export type AcetateBomFields=z.infer<typeof acetateBomFields>;
export const acetateStockSchema=z.object({id:text.min(1),specification:text.min(1),originalSpecification:text,supplier:text,length:z.number().positive().max(10000),width:z.number().positive().max(10000),thickness:z.preprocess(normalizeAcetateThickness,z.number().positive().max(30)),usableLength:number,usableWidth:number,weightKg:z.number().positive().max(10000),source:text.min(1).max(500)}).strict().superRefine((s,c)=>{if(s.usableLength!==null&&(s.usableLength<=0||s.usableLength>s.length)||s.usableWidth!==null&&(s.usableWidth<=0||s.usableWidth>s.width))c.addIssue({code:'custom',message:'有效尺寸超出采购尺寸'});});
export type AcetateStock=z.infer<typeof acetateStockSchema>;
export const ACETATE_ALLOWANCES={frame:{length:10,width:6,label:'圈料：左右各5，上下各3'},punch:{length:10,width:4,label:'冲脾：长度总加10，上下各2'},cnc:{length:10,width:10,label:'拼脾精雕：长度总加10，上下各5'}} as const;
export function newAcetateComponent(id:string,part:AcetateComponent['part']='frame'):AcetateComponent{return {id,name:part==='frame'?'圈主料':part==='temple'?'左右脾料':'左右庄头拼料',part,process:part==='frame'?'frame':part==='temple'?'punch':'manual',supplier:'',color:'',materialCode:'',stockId:'',stockSource:'',length:null,width:null,thickness:null,quantity:part==='frame'?1:2,basis:'net',extraLength:null,extraWidth:null,reason:'',stockLength:1400,stockWidth:160,trimLength:null,trimWidth:null,kerf:null,rawKerf:null,pattern:'mono',rotation:'best',segmentAxis:'length',segmentLength:null,blockLength:null,blockWidth:null,blockTrimLength:null,blockTrimWidth:null,blockRotation:'best',yieldPercent:100,weightMode:'confirmed',density:1.38,weightKg:null,pricePerKg:null,notes:''};}
type Pack={count:number;columns:number;rows:number;length:number;width:number;itemLength:number;itemWidth:number;rotation:'0'|'90'};
function grid(length:number,width:number,a:number,b:number,kerf:number,rotation:'0'|'90'):Pack{if(rotation==='90')[a,b]=[b,a];const columns=Math.max(0,Math.floor((length+kerf+1e-9)/(a+kerf))),rows=Math.max(0,Math.floor((width+kerf+1e-9)/(b+kerf)));return {count:columns*rows,columns,rows,length,width,itemLength:a,itemWidth:b,rotation};}
function pack(length:number,width:number,a:number,b:number,kerf:number,rotation:'0'|'90'|'best'){const normal=grid(length,width,a,b,kerf,'0'),rotated=grid(length,width,a,b,kerf,'90');return {normal,rotated,chosen:rotation==='90'||rotation==='best'&&rotated.count>normal.count?rotated:normal};}
export function calculateAcetateComponent(c:AcetateComponent,orderQuantity:number){
 const issues:string[]=[],warnings:string[]=[],stages:{name:string;description:string}[]=[];
 const required=(key:keyof AcetateComponent,label:string,positive=false)=>{const v=c[key];if(typeof v!=='number'||!Number.isFinite(v)||positive&&v<0.01||!positive&&v<0)issues.push(label+'待填写或无效（正尺寸最小0.01）');return typeof v==='number'?v:0;};
 const l=required('length','零件长',true),w=required('width','零件最高/最宽',true),t=required('thickness','厚度',true),q=required('quantity','每副件数',true);
 if(!Number.isInteger(q))issues.push('每副件数必须为整数');
 const stockL=required('stockLength','采购板长',true),stockW=required('stockWidth','采购板宽',true),trimL=required('trimLength','总扣长'),trimW=required('trimWidth','总扣宽'),k=required('kerf','毛坯独立切缝');
 let addL=0,addW=0;
 if(c.basis==='net'){if(c.process==='manual'){addL=required('extraLength','独立长度余量');addW=required('extraWidth','独立宽度余量');if(!c.reason)issues.push('独立拼料余量须填写工艺依据');}else{addL=ACETATE_ALLOWANCES[c.process].length;addW=ACETATE_ALLOWANCES[c.process].width;}}
 const a=l+addL,b=w+addW;let L=stockL-trimL,W=stockW-trimW,multiplier=1;
 if(L<=0||W<=0)issues.push('扣边后的有效板材尺寸须大于0');
 if(!c.supplier||!c.color)issues.push('须填写供应商和色号，才能汇总同料');
 if(c.stockSource.includes('同组参考'))warnings.push('有效尺寸采用同组参考，正式采用前核图');
 if(!c.materialCode)warnings.push('缺ERP物料编码，仅可生成BOM复核结果');
 if(c.pattern!=='mono'&&c.rotation==='best')issues.push('条纹/渐变料必须指定批准的开料方向');
 stages.push({name:'原板有效区',description:`${L} × ${W} mm；采购尺寸只扣一次边料`});
 const hasBlock=c.blockLength!==null||c.blockWidth!==null;
 if(c.pattern==='stripe'||hasBlock){const rawK=required('rawKerf','分段/开块切缝');
  if(c.pattern==='stripe'){const segment=required('segmentLength','条纹分段长',true),span=c.segmentAxis==='length'?L:W;multiplier=segment>0?Math.max(0,Math.floor((span+rawK+1e-9)/(segment+rawK))):0;if(c.segmentAxis==='length')L=segment;else W=segment;stages.push({name:'条纹分段',description:`${multiplier}段，每段${L} × ${W}；尾段未重复利用`});}
  if(hasBlock){const bl=required('blockLength','拼料投料块长',true),bw=required('blockWidth','拼料投料块宽',true),btL=required('blockTrimLength','块内扣长'),btW=required('blockTrimWidth','块内扣宽');if(c.pattern!=='mono'&&c.blockRotation==='best')issues.push('有纹向拼料块不得自动旋转');const outer=bl>0&&bw>0?pack(Math.max(0,L),Math.max(0,W),bl,bw,rawK,c.blockRotation):null;multiplier*=outer?.chosen.count||0;L=bl-btL;W=bw-btW;if(L<=0||W<=0)issues.push('拼料块有效区须大于0');stages.push({name:'开块与拼后有效区',description:`每区域${outer?.chosen.count||0}块；拼后有效${L} × ${W} mm`});}
 }
 const y=required('yieldPercent','后续综合良率',true);if(y>100)issues.push('良率不得超过100%');
 let result:ReturnType<typeof pack>|null=null;if(!issues.length){result=pack(L,W,a,b,k,c.rotation);if(!result.chosen.count||!multiplier)issues.push('当前原板/分段/模具尺寸不能开出毛坯');}
 const count=result?result.chosen.count*multiplier:0,usage=!issues.length&&count?q/count:null,standard=usage===null?null:usage/(y/100);
 let weight:number|null=null;if(c.weightMode==='density'){if(c.density!==null&&c.density>0)weight=stockL*stockW*t*c.density/1000000;else warnings.push('密度缺失，公斤用量不可得');warnings.push('采用密度理论重量');}else if(c.weightKg!==null&&c.weightKg>0){weight=c.weightKg;if(c.weightMode==='history')warnings.push('采用历史单条重量');}else warnings.push('单条重量未确认，公斤用量不可得');
 if(k===0)warnings.push('毛坯切缝为0，须确认刀路是否已计入余量');
 const kg=standard!==null&&weight!==null?standard*weight:null,cost=kg!==null&&c.pricePerKg!==null?kg*c.pricePerKg:null;
 stages.push({name:'零件毛坯',description:`${a} × ${b} × ${t} mm；每副${q}件；当前区域${result?.chosen.count||0}件`});
 return {id:c.id,name:c.name,issues,warnings,blankLength:a,blankWidth:b,count,normalCount:result?result.normal.count*multiplier:0,rotatedCount:result?result.rotated.count*multiplier:0,layout:result?.chosen||null,stages,usage,standard,weight,kg,cost,orderSheets:standard===null?null:Math.ceil(Math.ceil(orderQuantity*q/(y/100))/count)};
}
export function calculateAcetateBom(fields:AcetateBomFields){
 const components=fields.components.map(c=>calculateAcetateComponent(c,fields.orderQuantity));
 const groups=new Map<string,{key:string;supplier:string;color:string;materialCode:string;specification:string;componentIds:string[];standard:number|null;kg:number|null;cost:number|null;orderSheets:number|null}>();
 fields.components.forEach((c,i)=>{const r=components[i],key=c.supplier&&c.color?JSON.stringify([c.materialCode,c.supplier,c.color,c.stockLength,c.stockWidth,c.thickness]):'incomplete:'+c.id;
  const group=groups.get(key)||{key,supplier:c.supplier,color:c.color,materialCode:c.materialCode,specification:`${c.stockLength??'?'} × ${c.stockWidth??'?'} × ${c.thickness??'?'} mm`,componentIds:[],standard:0,kg:0,cost:0,orderSheets:0};
  group.componentIds.push(c.id);for(const k of ['standard','kg','cost','orderSheets'] as const)group[k]=group[k]===null||r[k]===null?null:group[k]!+r[k]!;groups.set(key,group);
 });
 const missingParts=(['frame','temple','endpiece'] as const).filter(p=>!fields.components.some(c=>c.part===p));
 const issues=components.flatMap(r=>r.issues.map(message=>r.name+'：'+message));
 if(missingParts.includes('frame'))issues.push('尚未加入圈料');if(missingParts.includes('temple'))issues.push('尚未加入脾料');
 const warnings=components.flatMap(r=>r.warnings.map(message=>r.name+'：'+message));
 if(missingParts.includes('endpiece'))warnings.push('当前无庄头拼料行；无拼料款可忽略，有拼料款须逐层加入');
 const rows=[...groups.values()],sum=(key:'kg'|'cost')=>rows.some(r=>r[key]===null)?null:rows.reduce((s,r)=>s+r[key]!,0);
 return {ruleVersion:ACETATE_RULE_VERSION,components,materials:rows,issues,warnings,totalKg:sum('kg'),totalCost:sum('cost'),scope:'整副板材BOM（圈料、脾料、庄头各层；其他配件另列）',orderMethod:'各组件独立排版领料合计，未假定不同组件可混排或抵扣同一块余料'};
}
