// Synthetic fixtures only: exercise the real read-only download API and XLSX bytes.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {unzipSync,strFromU8} from 'fflate';

export async function testSalesOrderSourceExports({request,source,payload,post,users,admin,id,snapshot,saved,savedB,savedU,pass}){
 const value=source();value.orderNo='SOURCE-EXPORT-00017';value.customerPO='000042';
 value.lines=Array.from({length:5},(_,index)=>{
  const line=structuredClone(value.lines[0]),row=20+index;
  Object.assign(line,{id:'export-line-'+row,sourceRow:row,drawing:'DRAW-'+row,color:'00'+index,model:' \t ',sku:index===0?'00017':'',deliveryText:'',quantity:[0,12,5,3,1][index],unit:index===2||index===4?'副':'PCS',sampleQuantity:[0,null,2,1,0][index],unitPrice:index===0?'0.00':index===1?'  3.50  ':''});
  const color=(column,entry,label='重复标准颜色')=>({sourceColumn:column,sourceLabel:'Synthetic '+column,sourceCell:column+row,value:entry,status:'adopted',standardZh:label,standardEn:'Synthetic Color',qualifier:'',candidates:[]});
  line.colorFields=[color('J','left-'+index),color('K','right-'+index),color('L',index%2?' \t ':null,'整单全空颜色'),color('M',index===2?'/':'','局部斜杠颜色'),color('N',index===0?'=HYPERLINK("https://invalid.test","synthetic")':index===1?'+1+1':index===2?'@SUM(A1)':index===3?'-7':'_x000A_ & <keep>\r\nnext','文字原文颜色'),color('O',index===4?'0':'','零值颜色'),color('P','\u3000','空格颜色')];
  const raw=(column,label,entry,formula=null,cachedValue=null)=>({column,label,cell:column+row,value:entry,formula,cachedValue});
  line.rawFields=index===0?[raw('Q','Amount','0')]:index===1?[raw('Q','Item Net','=12*3.5','=12*3.5','99.10')]:index===2?[raw('Q','TOTAL','=5*7','=5*7',null)]:index===3?[raw('Q','Amount','8'),raw('R','TOTAL','9')]:[raw('Q','Not amount','100')];
  return line;
 });
 const imported=await post(payload(value)),exportAction=recordId=>'sales-order-sources-export?id='+encodeURIComponent(recordId);
 const emptySource=source();emptySource.orderNo='SOURCE-EXPORT-EMPTY-OPTIONALS';emptySource.lines=emptySource.lines.map(line=>({...line,quantity:0,model:'',sku:'',deliveryText:'',sampleQuantity:null,unitPrice:' \t ',colorFields:line.colorFields.map(field=>({...field,value:null})),rawFields:[]}));
 const emptyImported=await post(payload(emptySource));
 const before=snapshot(),response=await request(exportAction(imported.id));
 assert.equal(response.status,200,await response.clone().text());
 assert.match(response.headers.get('Content-Type')||'',/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
 assert.match(response.headers.get('Content-Disposition')||'',/attachment/);assert.match(response.headers.get('Content-Disposition')||'',/SOURCE-EXPORT-00017/);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Vary')||'',/X-Workspace-Team/i);
 const bytes=new Uint8Array(await response.arrayBuffer()),book=XLSX.read(bytes,{type:'array',cellStyles:true}),sheet=book.Sheets['中英订单明细'];
 assert.deepEqual(book.SheetNames,['中英订单明细','核对说明']);assert(sheet);
 const range=XLSX.utils.decode_range(sheet['!ref']),headers=Array.from({length:range.e.c+1},(_,c)=>sheet[XLSX.utils.encode_cell({r:6,c})]?.v||'');
 const find=text=>{const columns=headers.map((header,c)=>(text==='Quantity'?String(header).split('\n').includes(text):String(header).includes(text))?c:-1).filter(c=>c>=0);assert.equal(columns.length,1,'Expected one column for '+text);return columns[0];};
 const at=(text,index)=>sheet[XLSX.utils.encode_cell({r:7+index,c:find(text)})];
 assert.equal(range.e.r,11,'All five lines are exported, without inserted subtotals.');
 assert(!headers.some(header=>/整单全空颜色|空格颜色|Original Model|Original Delivery/.test(header)),'Whole-order empty columns must be absent, not merely hidden.');
 assert(headers.every(header=>String(header).trim()),'No blank placeholder column survives pruning.');
 assert.equal(headers.filter(header=>String(header).includes('重复标准颜色')).length,2,'Matching display labels do not merge physical source columns.');
 assert.equal(at('来源 J 列',0).v,'left-0');assert.equal(at('来源 K 列',0).v,'right-0');
 assert.equal(at('局部斜杠颜色',2).v,'/');assert(!at('局部斜杠颜色',0)||at('局部斜杠颜色',0).v===undefined);assert.equal(at('零值颜色',4).v,'0');
 assert.equal(at('Source SKU',0).v,'00017');assert.equal(at('Source SKU',0).t,'s');assert.equal(at('Color No.',0).v,'000');assert.equal(at('Customer PO',0).v,'000042');
 assert.equal(at('Quantity',0).v,0);assert.equal(at('Quantity',0).t,'n');assert.equal(at('Quantity',0).w,'0');assert.equal(at('Quantity',1).w,'12');
 assert.equal(at('Sample Quantity',0).v,0);assert.equal(at('Sample Quantity',0).t,'n');assert(!at('Sample Quantity',1)||at('Sample Quantity',1).v===undefined);
 assert.equal(at('Unit Price',0).v,0);assert.equal(at('Unit Price',0).t,'n');assert.equal(at('Unit Price',0).w,'0.00');assert.equal(at('Unit Price',1).v,'  3.50  ');assert.equal(at('Unit Price',1).t,'s');
 assert.deepEqual([0,1,2,3,4].map(index=>at('Source Amount',index)?.v??null),[0,99.1,null,null,null],'Only source amount values or unique formula caches are retained, never recomputed or merged.');assert.equal(at('Source Amount',1).w,'99.10');
 for(let index=0;index<5;index++){const original=value.lines[index].colorFields.find(field=>field.sourceColumn==='N').value;assert.equal(at('文字原文颜色',index).v,original.replace(/\r\n/g,'\n'));assert.equal(at('文字原文颜色',index).t,'s');}
 assert.match(sheet.A4.v,/15 PCS；6 副/);assert.match(sheet.A4.v,/1 PCS；2 副/);assert.match(sheet.A4.v,/1 行未填写/);assert.doesNotMatch(sheet.A4.v,/21 PCS|24 PCS/);
 const review=XLSX.utils.sheet_to_json(book.Sheets['核对说明'],{header:1}).flat().join('\n');
 assert.match(review,/原金额公式无缓存/);assert.match(review,/多个原金额栏/);assert.match(review,/未重新计算/);
 const zip=unzipSync(bytes),xml=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.match(xml,/_x005F_x000A_ &amp; &lt;keep&gt;&#13;\nnext/,'OOXML preserves literal escape-looking text and the original CRLF even when the XLSX reader normalizes line endings.');
 assert.match(xml,/<pane[^>]*xSplit="3"[^>]*ySplit="7"[^>]*state="frozen"/);assert.match(xml,/<autoFilter ref="A7:[A-Z]+12"\/>/);
 assert.doesNotMatch(xml,/<col[^>]*hidden=/);assert.doesNotMatch(xml,/<f[\s>]/);assert.doesNotMatch(xml,/<hyperlinks[\s>]/);assert(!Object.keys(zip).some(name=>/externalLinks|vbaProject/.test(name)));
 for(const name of book.SheetNames)for(const [address,cell] of Object.entries(book.Sheets[name]))if(!address.startsWith('!')){assert.equal(cell.f,undefined,'No formula is executable in '+name+'!'+address);assert.notEqual(cell.t,'e');}
 assert.equal(snapshot(),before,'Export must not append audits or mutate any source/order/status.');
 const emptyResponse=await request(exportAction(emptyImported.id));assert.equal(emptyResponse.status,200);
 const emptyBook=XLSX.read(await emptyResponse.arrayBuffer()),emptySheet=emptyBook.Sheets['中英订单明细'],emptyRange=XLSX.utils.decode_range(emptySheet['!ref']);
 const emptyHeaders=Array.from({length:emptyRange.e.c+1},(_,c)=>emptySheet[XLSX.utils.encode_cell({r:6,c})]?.v||'').join('\n');
 assert.doesNotMatch(emptyHeaders,/Sample Quantity|Unit Price|Source Amount|Source SKU|Original Model|Original Delivery|来源 [A-Z]+ 列/,'All-blank sample, price, amount, SKU and color fields are removed from the actual worksheet.');assert.match(emptyHeaders,/Quantity/,'An all-zero quantity column is retained.');
 pass('销售原单 Excel 真正省略全空列、保留局部空白/零/斜杠/前导零/重复颜色栏目，原金额只取缓存，公式文本不可执行，数量和样办按原单位分开');

 const denied=async(recordId,user,status,team='')=>{const result=await request(exportAction(recordId),{user,team});assert.equal(result.status,status,await result.text());};
 assert.equal((await request(exportAction(saved.id),{user:users.sales,team:id('team_A')})).status,200);
 assert.equal((await request(exportAction(savedU.id),{user:admin,team:'__ungrouped'})).status,200);
 await denied(saved.id,null,401);
 for(const person of ['supplier','inactive','external'])await denied(saved.id,users[person],403);
 for(const person of ['pmc','production','finance','assigned','owner','outside'])await denied(saved.id,users[person],404);
 await denied(savedB.id,users.sales,404);await denied(saved.id,admin,404,id('team_B'));
 await denied(saved.id,users.sales,403,id('team_B'));await denied(saved.id,admin,403,id('missing_team'));await denied('missing_source_id',admin,404);
 assert.equal((await request('sales-order-sources-export',{user:admin})).status,400);
 assert.equal((await request(exportAction(saved.id)+'&id='+encodeURIComponent(savedB.id))).status,400);
 assert.equal((await request(exportAction(' '+saved.id))).status,400);
 const filtered=await request(exportAction(imported.id)+'&search=not-matching-any-line');assert.equal(filtered.status,200);
 assert.equal(XLSX.utils.decode_range(XLSX.read(await filtered.arrayBuffer()).Sheets['中英订单明细']['!ref']).e.r,11,'Search cannot narrow the exported order.');
 assert.equal(snapshot(),before,'Authorized and rejected downloads must all remain read-only.');
 pass('销售原单下载逐次校验在职内部身份、明确客户责任和业务组；越权/跨客户/跨组/未找到拒绝，无业务写入且导出不受表格搜索影响');
}
