import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {bucket,AppError} from './store';
import type {Entity,Order} from './domain';
import type {AcetateMaterialSnapshot} from './acetate-materials';

const xml=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships',pkg='http://schemas.openxmlformats.org/package/2006/relationships';
/** Append a separate adoption sheet without rewriting the customer's original sheets, formulas or drawings. */
export async function appendAcetateAdoptions(bytes:ArrayBuffer|Uint8Array,orders:Order[],latest:Map<string,Entity>){
 const adopted=orders.flatMap(o=>(latest.get(o.id)?.materials||[]).flatMap((r:{snapshot?:AcetateMaterialSnapshot})=>r.snapshot?[{o,v:r.snapshot}]:[]));
 if(!adopted.length)return bytes instanceof Uint8Array?new Uint8Array(bytes).buffer:bytes;if(adopted.length>1000)throw new AppError('本次采用的板料超过1000项，请分批导出订单，避免漏图。');
 const z=unzipSync(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)),wb=strFromU8(z['xl/workbook.xml']),rels=strFromU8(z['xl/_rels/workbook.xml.rels']);
 let id=1;while(z[`xl/worksheets/sheet${id}.xml`])id++;let rid='acetateAdoptions';while(rels.includes(`Id="${rid}"`))rid+='x';
 let name='采用板料',n=2;while(wb.includes(`name="${name}"`))name='采用板料'+n++;
 const sheetId=Math.max(0,...Array.from(wb.matchAll(/sheetId="(\d+)"/g),m=>Number(m[1])))+1;
 z['xl/workbook.xml']=strToU8(wb.replace('</sheets>',`<sheet name="${name}" sheetId="${sheetId}" r:id="${rid}"/></sheets>`));
 z['xl/_rels/workbook.xml.rels']=strToU8(rels.replace('</Relationships>',`<Relationship Id="${rid}" Type="${rel}/worksheet" Target="worksheets/sheet${id}.xml"/></Relationships>`));
 const prefix='acetate-'+id,media=new Map<string,{path:string;type:string}>(),drawings:string[]=[],drawRels:string[]=[],rows:string[]=[];
 const cell=(c:string,r:number,v:unknown)=>`<c r="${c}${r}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
 const headers=['订单号','图纸编号','供应商','板料编号','中文颜色','尺寸 mm','采用厚度 mm','颜色图','图示类型','材料','金蝶物料编码','资料版本','资料日期','原文颜色','来源','使用部位'];
 rows.push('<row r="1">'+headers.map((v,i)=>cell(String.fromCharCode(65+i),1,v)).join('')+'</row>');
 for(let i=0;i<adopted.length;i++){
  const {o,v}=adopted[i],row=i+2;rows.push(`<row r="${row}" ht="85" customHeight="1">`+[o.orderNo,o.drawing,v.supplier,v.code,v.descriptionZh||'中文颜色待核对',v.size,v.selectedThickness??'待选',v.imageKey?'':'原资料缺图',v.imageKind,v.material,v.erpCode,v.catalogVersion,v.sourceDate,v.descriptionOriginal,v.source,v.selectedPart].map((x,j)=>cell(String.fromCharCode(65+j),row,x)).join('')+'</row>');
  if(!v.imageKey)continue;
  // File keys come only from server-resolved immutable snapshots.
  if(!/^acetate-image-[a-f0-9]{64}\.(jpg|png)$/.test(v.imageKey))throw new AppError('采用板料图片标识无效。');
  let image=media.get(v.imageKey);if(!image){const obj=await bucket().get(v.imageKey);if(!obj)throw new AppError('采用时的板料图片缺失，未生成不完整订单。');const raw=new Uint8Array(await new Response(obj.body).arrayBuffer());const type=v.imageKey.endsWith('.png')?'png':'jpeg',path=`xl/media/${prefix}-${media.size}.${type==='png'?'png':'jpg'}`;image={path,type};media.set(v.imageKey,image);z[path]=raw;}
  const imageRid='image'+i;drawRels.push(`<Relationship Id="${imageRid}" Type="${rel}/image" Target="../media/${image.path.split('/').at(-1)}"/>`);
  drawings.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row-1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1524000" cy="914400"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="${xml(v.code)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${imageRid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
 }
 const hasImages=drawings.length>0;
 z[`xl/worksheets/sheet${id}.xml`]=strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${main}" xmlns:r="${rel}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="7" width="24" customWidth="1"/><col min="8" max="8" width="24" customWidth="1"/><col min="9" max="16" width="32" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:P${adopted.length+1}"/>${hasImages?'<drawing r:id="adoptedDrawing"/>':''}</worksheet>`);
 if(hasImages){z[`xl/worksheets/_rels/sheet${id}.xml.rels`]=strToU8(`<Relationships xmlns="${pkg}"><Relationship Id="adoptedDrawing" Type="${rel}/drawing" Target="../drawings/${prefix}.xml"/></Relationships>`);z[`xl/drawings/${prefix}.xml`]=strToU8(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}">${drawings.join('')}</xdr:wsDr>`);z[`xl/drawings/_rels/${prefix}.xml.rels`]=strToU8(`<Relationships xmlns="${pkg}">${drawRels.join('')}</Relationships>`);}
 let types=strFromU8(z['[Content_Types].xml']);const additions=[`<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,...(hasImages?[`<Override PartName="/xl/drawings/${prefix}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`]:[])];
 for(const m of media.values()){const ext=m.type==='png'?'png':'jpg';if(!types.includes(`Extension="${ext}"`)){types=types.replace('</Types>',`<Default Extension="${ext}" ContentType="image/${m.type}"/></Types>`);}}
 z['[Content_Types].xml']=strToU8(types.replace('</Types>',additions.join('')+'</Types>'));return new Uint8Array(zipSync(z)).buffer;
}
