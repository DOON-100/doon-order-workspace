using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public static class OrderExporter {
  public static List<object[]> SalesRows(OrderDraft d,IEnumerable<ResolvedLine> lines){return lines.Select(l=>new object[]{l.BillNo,d.Settings.BillDate,PriceParser.Key(l.Input.Customer),d.Settings.Salesperson,"人民币",1m,d.Settings.BusinessType,l.Code,l.Unit,l.Qty,l.Price,PriceParser.Number(d.Settings.Tax).Value,l.Input.Gift,d.Settings.DeliveryDate,l.Input.Po}).ToList();}
  public static List<object[]> MaterialRows(OrderDraft d,IEnumerable<ResolvedLine> lines){return lines.Where(l=>l.IsNew).GroupBy(l=>PriceParser.Key(l.Code)).Select(g=>g.First()).Select(l=>new object[]{l.Code,l.Name,l.ProductClass,l.Unit,PriceParser.Number(d.Settings.Tax).Value,d.Settings.Warehouse,"是","是","是","是"}).ToList();}
  public static byte[] Build(OrderDraft draft,OrderContext context,byte[] salesTemplate,byte[] materialTemplate){
   var preview=OrderFlow.Preview(draft,context);if(!preview.Ready)throw new InvalidOperationException("存在未解决项目，不能导出。");if(draft.ReviewHash!=preview.Fingerprint||string.IsNullOrWhiteSpace(draft.ReviewedBy)||string.IsNullOrWhiteSpace(draft.ReviewedAt))throw new InvalidOperationException("本次内容或资料库已变化，请重新预览并确认。");
   var files=new Dictionary<string,byte[]>();int index=0;
   foreach(var group in preview.Lines.GroupBy(l=>l.BillNo)){index++;files.Add("销售订单-"+index.ToString("000")+".xlsx",KingdeeTemplate.Fill(salesTemplate,context.SalesTemplate,SalesRows(draft,group)));}
   var materials=MaterialRows(draft,preview.Lines);if(materials.Count>0)files.Add("商品新建-先导入.xlsx",KingdeeTemplate.Fill(materialTemplate,context.MaterialTemplate,materials));
   files.Add("核对记录.json",Encoding.UTF8.GetBytes(PriceParser.Json.Serialize(new{version="doon-export-v1",draft=draft,preview=preview})));
   files.Add("导入说明.txt",Encoding.UTF8.GetBytes("度昂金蝶导入包\r\n"+(materials.Count>0?"1. 先导入商品新建表，确认金蝶创建成功后再导入销售订单。\r\n":"")+"销售订单按单据与成品类别分别生成，文件序号与核对记录一致。\r\n导入前核对客户、业务员、单位、日期、赠品和金额。\r\n人民币订单的汇率字段为 1；美元折算已经计入人民币单价。\r\n商品表可为子件、可自制、可销售、可采购均为是，已在程序核对页显示。\r\n重复导入需在金蝶先核对单号，不代表本程序自动防重。\r\n此包未直接写入金蝶，实际导入结果需在金蝶核验。"));
   files.Add("文件校验.json",Encoding.UTF8.GetBytes(PriceParser.Json.Serialize(files.ToDictionary(p=>p.Key,p=>PriceParser.Hash(p.Value)))));
   using(var ms=new MemoryStream()){using(var zip=new ZipArchive(ms,ZipArchiveMode.Create,true))foreach(var pair in files)using(var stream=zip.CreateEntry(pair.Key,CompressionLevel.Optimal).Open())stream.Write(pair.Value,0,pair.Value.Length);byte[] bytes=ms.ToArray();
    using(var input=new MemoryStream(bytes))using(var zip=new ZipArchive(input,ZipArchiveMode.Read)){if(zip.Entries.Count!=files.Count)throw new IOException("导入包文件数量不符。");foreach(var entry in zip.Entries)using(var stream=entry.Open())using(var read=new MemoryStream()){stream.CopyTo(read);if(PriceParser.Hash(read.ToArray())!=PriceParser.Hash(files[entry.FullName]))throw new IOException("导入包校验失败。");}}return bytes;
   }
  }
  public static string Save(PriceStore store,OrderDraft draft,string path){
   if(!System.Text.RegularExpressions.Regex.IsMatch(draft.SourceHash??"","^[a-f0-9]{64}$")||PriceParser.Hash(File.ReadAllBytes(Path.Combine(store.DirectoryPath,"originals",draft.SourceHash+".xlsx")))!=draft.SourceHash)throw new IOException("订单原件归档校验失败。");
   var context=store.OrderContext();if(context.SalesTemplate==null)throw new InvalidOperationException("缺少销售订单模板。");byte[] bytes=Build(draft,context,store.TemplateBytes(context.SalesTemplate),context.MaterialTemplate==null?null:store.TemplateBytes(context.MaterialTemplate));string hash=PriceParser.Hash(bytes);
   using(var f=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None)){f.Write(bytes,0,bytes.Length);f.Flush(true);}if(PriceParser.Hash(File.ReadAllBytes(path))!=hash)throw new IOException("导出文件回读校验失败。");
   try{store.RecordExport(draft,path,hash);}catch(Exception ex){throw new IOException("文件已生成且校验通过，但本地导出记录保存失败。请先检查目标文件，避免重复操作。"+ex.Message);}return hash;
  }
 }
}
