import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

export async function testFactoryOrderTable({ok,call,state,pass,admin,clerk}){
 const count=16,total=136;
 const make=()=>{
  const b=XLSX.utils.book_new(),rows=Array.from({length:count},(_,i)=>[i+1,'TABLE-DN'+(i||''),'M'+(i+1),'C'+(i+1),'METAL','TI','Black MT55','005E IP黑+哑胶','','','','','','','','','','','L9000','','白片','',i+1,'副','','']);
  const s=XLSX.utils.aoa_to_sheet(Array.from({length:19},()=>[]).concat([['件号#','图纸编号','款号','色号','系列','材质','Front','中文前框','Insert','中文角花','Pad','中文叶子','Temple','中文金脾','House','中文底座','Cover','中文盖','Manchon / tip','胶脾','主架镜片','销售办数量','大货数量','单位','要求交货期','备注'],...rows]));
  s.B13={v:'测试客户甲',t:'s'};s.Y13={v:'OLD-PRIVATE-ORDER',t:'s'};s.G18={t:'s',v:'header picture'};for(const a of ['G19','H19'])s[a]={t:'e',v:'#NAME?',f:'_xlfn.DISPIMG("ID_SYNTHETIC_CELL_IMAGE",1)'};s['!cols']=[{wch:15},{wch:20}];
  XLSX.utils.book_append_sheet(b,s,'032R2');XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['PRIVATE-OLD-QUANTITY',999]]),'旧销售办');
  const files=unzipSync(new Uint8Array(XLSX.write(b,{type:'array',bookType:'xlsx'}))),relNS='http://schemas.openxmlformats.org/package/2006/relationships',imageType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  files['xl/worksheets/sheet1.xml']=strToU8(strFromU8(files['xl/worksheets/sheet1.xml']).replace(/<sheetView\b[^>]*\/>/,'<sheetView workbookViewId="0" tabSelected="1"/>').replace('</worksheet>','<drawing r:id="rIdSyntheticDrawing"/></worksheet>'));
  files['xl/worksheets/_rels/sheet1.xml.rels']=strToU8(`<Relationships xmlns="${relNS}"><Relationship Id="rIdSyntheticDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/synthetic-original.xml"/></Relationships>`);
  const pic=name=>`<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdSyntheticPng"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="95250" cy="95250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
  const namespaces='xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  files['xl/cellimages.xml']=strToU8(`<etc:cellImages ${namespaces} xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"><etc:cellImage>${pic('ID_SYNTHETIC_CELL_IMAGE')}</etc:cellImage></etc:cellImages>`);
  files['xl/_rels/cellimages.xml.rels']=strToU8(`<Relationships xmlns="${relNS}"><Relationship Id="rIdSyntheticPng" Type="${imageType}" Target="media/synthetic-pixel.png"/></Relationships>`);
  files['xl/drawings/synthetic-original.xml']=strToU8(`<xdr:wsDr ${namespaces}><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>17</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="95250" cy="95250"/>${pic('SYNTHETIC_STANDARD')}<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
  files['xl/drawings/_rels/synthetic-original.xml.rels']=strToU8(`<Relationships xmlns="${relNS}"><Relationship Id="rIdSyntheticPng" Type="${imageType}" Target="../media/synthetic-pixel.png"/></Relationships>`);
  files['xl/media/synthetic-pixel.png']=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
  files['xl/_rels/workbook.xml.rels']=strToU8(strFromU8(files['xl/_rels/workbook.xml.rels']).replace('</Relationships>','<Relationship Id="rIdSyntheticCellImages" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/></Relationships>'));
  files['[Content_Types].xml']=strToU8(strFromU8(files['[Content_Types].xml']).replace('</Types>','<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/cellimages.xml" ContentType="application/vnd.wps-officedocument.cellimage+xml"/><Override PartName="/xl/drawings/synthetic-original.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  const bytes=zipSync(files);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 };
 const form=bytes=>{const f=new FormData();f.set('file',new File([bytes],'synthetic.xlsx'));f.set('customer','测试客户甲');f.set('orderNo','TABLE-NEW');f.set('customerPO','PO-TABLE');f.set('reference','TABLE-OLD');return f;};
 const write=b=>XLSX.write(b,{type:'array',bookType:'xlsx'});
 const qty=s=>Array.from({length:count},(_,i)=>Number(s['W'+(21+i)]?.v||0)).reduce((a,b)=>a+b,0);
 const items=async()=> (await ok('factory-orders')).items;
 const latestFor=async id=>(await items()).filter(x=>x.lineId===id).at(-1);
 const exported=async orders=>{const query=orders.map(o=>'lineId='+encodeURIComponent(o.id)).join('&'),r=await call('factory-order-table-export?'+query);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/xlsx/);return r.arrayBuffer();};
 const verifySplit=(bytes,withTemplate=true)=>{
  const b=XLSX.read(bytes,{cellStyles:true});assert.deepEqual(b.SheetNames,['中文订单','英文订单']);
  for(const name of b.SheetNames){const s=b.Sheets[name];assert.equal(s.B13.v,'测试客户甲');assert.equal(s.Y13.v,'TABLE-NEW');if(withTemplate){assert.equal(s.G18.v,'header picture');for(const a of ['G19','H19']){assert(!s[a]?.f,'Header WPS image formula becomes an ordinary picture');assert.notEqual(s[a]?.v,'#NAME?');}}
   assert.equal(Array.from({length:count},(_,i)=>s['B'+(21+i)]?.v).filter(Boolean).length,count);assert.equal(qty(s),total);assert.equal(s['W'+(21+count)].v,total);assert.equal(s.AL21.v,'TABLE-OLD');
  }
  const cn=b.Sheets['中文订单'],en=b.Sheets['英文订单'];assert.equal(cn.AK21.v,'待客服确认');assert.match(en.AK21.v,/pending|confirmation/i);
  for(const c of ['G','I','K','M','O','Q','S','AA'])assert.equal(cn['!cols'][XLSX.utils.decode_col(c)].hidden,true,'Chinese sheet hides '+c);
  for(const c of ['H','J','L','N','P','R','T','AB','AC','AD'])assert.equal(en['!cols'][XLSX.utils.decode_col(c)].hidden,true,'English sheet hides '+c);
  for(const s of [cn,en])for(const c of ['AH','AI','AJ','AN','AO'])assert.equal(s['!cols'][XLSX.utils.decode_col(c)].hidden,true,'Technical roundtrip cells stay hidden');
  const zip=unzipSync(new Uint8Array(bytes)),worksheetKeys=Object.keys(zip).filter(k=>/^xl\/worksheets\/[^/]+\.xml$/.test(k));assert.equal(worksheetKeys.length,2);assert.equal(worksheetKeys.reduce((n,k)=>n+(strFromU8(zip[k]).match(/tabSelected="1"/g)||[]).length,0),1,'Export opens one selected worksheet, avoiding grouped editing');assert(!strFromU8(zip['xl/worksheets/factory-english.xml']).includes('tabSelected="1"'));assert(!Object.keys(zip).includes('xl/sharedStrings.xml'));assert(!Object.values(zip).some(v=>strFromU8(v).includes('PRIVATE-OLD-QUANTITY')||strFromU8(v).includes('OLD-PRIVATE-ORDER')));
  if(withTemplate){const relPath=p=>p.slice(0,p.lastIndexOf('/')+1)+'_rels/'+p.slice(p.lastIndexOf('/')+1)+'.rels',resolve=(p,target)=>{const segments=[];for(const v of (target.startsWith('/')?target.slice(1):p.slice(0,p.lastIndexOf('/')+1)+target).split('/')){if(v==='..')segments.pop();else if(v&&v!=='.')segments.push(v);}return segments.join('/');};
   const target=(p,id)=>{assert(zip[relPath(p)],'Relationship file exists for '+p);const r=(strFromU8(zip[relPath(p)]).match(/<Relationship\b[^>]*\/>/g)||[]).find(r=>r.includes(`Id="${id}"`));assert(r,'Relationship exists: '+id);const k=resolve(p,r.match(/Target="([^"]+)"/)[1]);assert(zip[k],'Relationship target exists: '+k);return k;};
   for(const p of worksheetKeys){const xml=strFromU8(zip[p]);assert(!xml.includes('DISPIMG'),'No WPS image formulas remain on the exported header');const drawing=target(p,xml.match(/<drawing\b[^>]*r:id="([^"]+)"/)[1]),d=strFromU8(zip[drawing]);assert(d.includes('SYNTHETIC_STANDARD'),'Existing template drawing is preserved');assert.equal((d.match(/<xdr:pic>/g)||[]).length,2,'Visible-language WPS header picture plus the original drawing are retained');for(const blip of d.match(/<a:blip\b[^>]*r:embed="([^"]+)"[^>]*\/>/g)||[])assert.match(target(drawing,blip.match(/r:embed="([^"]+)"/)[1]),/\.png$/);}
  }
  return b;
 };
 const input=make();assert.equal((await call('factory-order-table-preview',form(input),clerk)).status,403);
 let job=await ok('factory-order-table-preview',form(input));assert.equal(job.rows.length,count);assert.equal(job.rows.reduce((n,r)=>n+r.quantity,0),total);assert(!(await state()).orders.some(o=>o.orderNo==='TABLE-NEW'));
 await ok('factory-order-table-commit',{id:job.id});let orders=(await state()).orders.filter(o=>o.orderNo==='TABLE-NEW');assert.equal(orders.length,count);assert.equal(orders.reduce((n,o)=>n+o.quantity,0),total);assert(orders.every(o=>o.stage==='待下达'&&o.promiseConfirmed===false));const order=orders.find(o=>o.drawing==='TABLE-DN');
 let factories=(await items()).filter(x=>orders.some(o=>o.id===x.lineId));assert.equal(factories.length,count);assert(factories.every(x=>x.status==='待客服确认'&&x.materialImageConfirmed===false));
 assert((await ok('factory-order-table-commit',{id:job.id})).repeated);assert.equal((await items()).filter(x=>orders.some(o=>o.id===x.lineId)).length,count);
 await ok('factory-order-save',{lineId:order.id,sourceEnglish:'Front + pad arm + end piece (female): Black\nTemple: Blue',chineseProcess:'前框+鼻臂+庄头母件：PROC FRONT\n镜腿：PROC TEMPLE',materialSpec:'L9000',platingSpec:'前框+鼻臂+庄头母件：PLATE FRONT',lensSpec:'白片',materialImageConfirmed:false,action:'draft'});const componentBook=XLSX.read(await exported(orders));assert.equal(componentBook.Sheets['中文订单'].H21.v,'PLATE FRONT');assert.equal(componentBook.Sheets['中文订单'].N21.v,'PROC TEMPLE');
 verifySplit(await exported(orders),false);await ok('factory-order-template',form(input));let bytes=await exported(orders);verifySplit(bytes);
 job=await ok('factory-order-table-preview',form(bytes));assert.equal(job.rows.length,count);assert.equal(job.rows.reduce((n,r)=>n+r.quantity,0),total);await ok('factory-order-table-commit',{id:job.id});assert.equal((await state()).orders.filter(o=>o.orderNo==='TABLE-NEW').length,count);assert.equal((await latestFor(order.id)).status,'待客服确认');
 assert.equal((await call('factory-order-table-preview',form(bytes))).status,409);assert.equal((await call('factory-order-table-export?lineId='+order.id,undefined,clerk)).status,403);
 pass('032R2旧模板兼容，整单拆为中文/英文两个子表；16条合并回传不重复明细或数量');

 // Each language sheet contributes its own editable process cells to one draft.
 bytes=await exported(orders);let changed=XLSX.read(bytes);changed.Sheets['中文订单'].H21={t:'s',v:'中框测试色'};changed.Sheets['英文订单'].G21={t:'s',v:'Blue TEST'};
 job=await ok('factory-order-table-preview',form(write(changed)));const edited=job.rows.find(r=>r.drawing===order.drawing);assert.match(edited.sourceEnglish,/Blue TEST/);assert.match(edited.chineseProcess,/中框测试色/);await ok('factory-order-table-commit',{id:job.id});let latest=await latestFor(order.id);assert.match(latest.sourceEnglish,/Blue TEST/);assert.match(latest.chineseProcess,/中框测试色/);assert.match(latest.platingSpec,/中框测试色/);assert.equal(latest.status,'待客服确认');
 pass('两个语言子表分别编辑工艺后合并成同一待确认草稿');

 // Either exported sheet is usable on its own, still carrying the other language.
 for(const name of ['中文订单','英文订单']){const single=XLSX.read(await exported(orders));single.SheetNames=[name];single.Sheets={[name]:single.Sheets[name]};job=await ok('factory-order-table-preview',form(write(single)));assert.equal(job.rows.length,count);const first=job.rows.find(r=>r.drawing===order.drawing);assert.match(first.sourceEnglish,/Blue TEST/);assert.match(first.chineseProcess,/中框测试色/);await ok('factory-order-table-commit',{id:job.id});}
 pass('中文或英文子表单独回传仍可导入并保留另一语言');

 changed=XLSX.read(await exported(orders));for(const name of changed.SheetNames)for(let r=21;r<21+count;r++)delete changed.Sheets[name]['AH'+r];job=await ok('factory-order-table-preview',form(write(changed)));assert.equal(job.rows.length,count);assert.equal(job.rows.reduce((n,r)=>n+r.quantity,0),total);await ok('factory-order-table-commit',{id:job.id});assert.equal((await state()).orders.filter(o=>o.orderNo==='TABLE-NEW').length,count);
 pass('没有隐藏明细ID的双子表按业务身份合并，不新增重复订单');

 // Disagreement between copies of identity/source fields is rejected before any write.
 bytes=await exported(orders);changed=XLSX.read(bytes);changed.Sheets['英文订单'].W21={t:'n',v:999};const before=(await items()).length;assert.equal((await call('factory-order-table-preview',form(write(changed)))).status,400);assert.equal((await items()).length,before);
 changed=XLSX.read(bytes);changed.Sheets['英文订单'].S21={t:'s',v:'L9001'};assert.equal((await call('factory-order-table-preview',form(write(changed)))).status,400);assert.equal((await items()).length,before);
 changed=XLSX.read(bytes);changed.Sheets['英文订单'].AJ21={t:'n',v:999};assert.equal((await call('factory-order-table-preview',form(write(changed)))).status,400);
 changed=XLSX.read(bytes);changed.Sheets['英文订单'].G21={t:'s',v:'computed',f:'"computed"'};assert.equal((await call('factory-order-table-preview',form(write(changed)))).status,400);
 pass('两子表源单数量、板料或版本不一致及英文子表公式均阻止导入，失败不写单');

 job=await ok('factory-order-table-preview',form(bytes));await ok('factory-order-save',{lineId:order.id,sourceEnglish:'fresh',chineseProcess:'fresh',materialSpec:'',platingSpec:'',lensSpec:'白片',materialImageConfirmed:false,action:'draft'});assert.equal((await call('factory-order-table-commit',{id:job.id})).status,409);
 const other=(await state()).orders.find(o=>o.orderNo!==order.orderNo);assert.equal((await call('factory-order-table-export?lineId='+order.id+'&lineId='+other.id)).status,400);
 // Spreadsheet status text cannot approve or release either language sheet.
 changed=XLSX.read(await exported(orders));for(const name of changed.SheetNames)changed.Sheets[name].AK21={t:'s',v:'已下发工厂'};job=await ok('factory-order-table-preview',form(write(changed)));await ok('factory-order-table-commit',{id:job.id});assert.equal((await latestFor(order.id)).status,'待客服确认');assert.equal((await latestFor(order.id)).materialImageConfirmed,false);
 pass('双子表保留预览/提交版本及权限拦截，状态伪造不能通过Excel下发订单');
}
