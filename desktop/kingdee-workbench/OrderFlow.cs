using System;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public sealed class OrderSettings {
  public string BillDate=DateTime.Today.ToString("yyyy-MM-dd"),DeliveryDate=DateTime.Today.AddDays(105).ToString("yyyy-MM-dd"),Salesperson="",BusinessType="赊销",Rate="7",Factor="0.89",Tax="13",PcsUnit="副",Warehouse="成品仓";
 }
 public sealed class OrderLine {
  public string Id="",BillNo="",Po="",Customer="",Drawing="",Model="",Color="",Category="",Frame="",Lens="",Board="",Plating="",Quantity="",Unit="",ChosenCode="",ManualPrice="",ManualCurrency="",Note="",Gift="否",ProductClass="";
  public bool UseManualPrice;public PriceRow Source;
 }
 public sealed class OrderDraft {
  public string Id=Guid.NewGuid().ToString("N"),File="",SourceHash="",ReviewHash="",ReviewedBy="",ReviewedAt="";
  public int Version;public OrderSettings Settings=new OrderSettings();public List<OrderLine> Lines=new List<OrderLine>();
 }
 public sealed class ResolvedLine {
  public OrderLine Input;public string Code="",Name="",OriginalName="",Category="",Frame="",Middle="",Unit="",Currency="",SourcePrice="",PriceEvidence="",MaterialEvidence="",BillNo="",ProductClass="";
  public bool IsNew;public decimal Qty,Price,Amount;public List<string> Errors=new List<string>();public List<MaterialRow> Candidates=new List<MaterialRow>();public List<PriceRow> PriceCandidates=new List<PriceRow>();
 }
 public sealed class OrderContext {
  public List<PriceRow> Prices;public List<MaterialRow> Materials;public List<CodingRule> Rules;public List<ProductName> Names;public List<LensNameRule> Lenses;
  public string Fingerprint="";public TemplateInfo SalesTemplate,MaterialTemplate;
  public List<KeyValuePair<string,MaterialRow>> MaterialCodes;
 }
 public sealed class OrderPreview {
  public List<ResolvedLine> Lines=new List<ResolvedLine>();public List<string> Errors=new List<string>();public string Fingerprint="",ContextHash="";
  public bool Ready {get{return Lines.Count>0&&Errors.Count==0&&Lines.All(x=>x.Errors.Count==0);}}
 }
 public static class OrderFlow {
  static string K(string s){return PriceParser.Key(s);}static bool Same(string a,string b){return K(a)==K(b);}
  public static string BoardCode(string description){
   var parts=Regex.Matches((description??"").ToUpperInvariant(),@"[A-Z0-9]+(?:-[A-Z0-9]+)*").Cast<Match>().Select(m=>m.Value).Where(v=>v.Count(char.IsDigit)>=3).Distinct().ToList();return parts.Count==1?parts[0]:"";
  }
  public static string SourceDrawing(PriceRow source,IEnumerable<CodingRule> rules){string raw=K((source.RawDrawing??"").Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()??"");string category=rules.Select(r=>K(r.Category)).OrderByDescending(c=>c.Length).FirstOrDefault(c=>raw.EndsWith("-"+c,StringComparison.Ordinal));return category==null?source.Drawing:raw.Substring(0,raw.Length-category.Length-1);}
  public static OrderDraft Create(ParsedFile source,IEnumerable<string> selectedSheets,IEnumerable<CodingRule> rules){
   var chosen=new HashSet<string>(selectedSheets);var d=new OrderDraft{File=source.Name,SourceHash=source.Hash};var categories=rules.Select(x=>x.Category).OrderByDescending(x=>x.Length).ToList();
   foreach(var p in source.Rows.Where(x=>chosen.Contains(x.Sheet))){string category=categories.FirstOrDefault(c=>Same(c,p.Category))??"";
    if(category=="")category=categories.FirstOrDefault(c=>K((p.RawDrawing??"").Split('\n')[0]).EndsWith("-"+c,StringComparison.Ordinal))??"";
    d.Lines.Add(new OrderLine{Id=p.Id,Source=p,BillNo=p.Pi,Po=p.Po,Customer=p.Customer,Drawing=SourceDrawing(p,rules),Model=p.Model,Color=p.Color,Category=category,Frame=category,Lens=p.Lens??"",Board=p.BoardIsCode?CodingEngine.Clean(p.Board):BoardCode(p.Board),Plating=p.PlatingColor??"",Quantity=p.Quantity,Unit="",ChosenCode=p.MaterialCode??""});
   }
   if(d.Lines.Count==0)throw new InvalidDataException("没有选择有效的订单明细。");return d;
  }
  public static List<MaterialRow> CandidateMaterials(OrderLine row,OrderContext ctx,bool requireMiddle){
   if(string.IsNullOrWhiteSpace(row.Customer)||string.IsNullOrWhiteSpace(row.Drawing)||string.IsNullOrWhiteSpace(row.Model)||string.IsNullOrWhiteSpace(row.Color))return new List<MaterialRow>();
   var anchors=ctx.Rules.Where(r=>row.Category==""||Same(r.Category,row.Category)).Select(r=>new{Prefix=K(r.Category+"-"+row.Customer+"-"+row.Drawing+"-"+row.Model+"-"),Suffix=K("-"+row.Color),Middle=K(r.MiddleField=="板料编码"?row.Board:row.Plating)}).ToList();
   var indexed=ctx.MaterialCodes??ctx.Materials.Select(m=>new KeyValuePair<string,MaterialRow>(K(m.Code),m));
   return indexed.Where(pair=>anchors.Any(a=>pair.Key.StartsWith(a.Prefix,StringComparison.Ordinal)&&pair.Key.EndsWith(a.Suffix,StringComparison.Ordinal)&&pair.Key.Length>a.Prefix.Length+a.Suffix.Length&&(!requireMiddle||a.Middle==""||pair.Key.Substring(a.Prefix.Length,pair.Key.Length-a.Prefix.Length-a.Suffix.Length)==a.Middle))).Select(pair=>pair.Value).ToList();
  }
  static string CategoryOf(string code,IEnumerable<CodingRule> rules){return rules.Select(r=>r.Category).OrderByDescending(s=>s.Length).FirstOrDefault(c=>K(code).StartsWith(K(c)+"-",StringComparison.Ordinal))??"";}
  static bool TrustOriginal(PriceRow p){return PriceParser.Number(p.UnitPrice)>0&&(p.Currency=="USD"||p.Currency=="CNY")&&!new[]{"公式","附加费","零价","非数值","负"}.Any(t=>(p.Status??"").Contains(t));}
  public static OrderPreview Preview(OrderDraft draft,OrderContext ctx){
   var preview=new OrderPreview{ContextHash=ctx.Fingerprint};DateTime billDate,delivery;
   if(!DateTime.TryParseExact(draft.Settings.BillDate,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out billDate))preview.Errors.Add("单据日期必须为 yyyy-MM-dd");
   if(!DateTime.TryParseExact(draft.Settings.DeliveryDate,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out delivery))preview.Errors.Add("交货日期必须为 yyyy-MM-dd");
   else if(billDate!=DateTime.MinValue&&delivery<billDate)preview.Errors.Add("交货日期早于单据日期");
   decimal? rate=PriceParser.Number(draft.Settings.Rate),factor=PriceParser.Number(draft.Settings.Factor),tax=PriceParser.Number(draft.Settings.Tax);
   if(!rate.HasValue||rate<=0||rate>1000)preview.Errors.Add("汇率必须大于 0 且不超过 1000");if(!factor.HasValue||factor<=0||factor>10)preview.Errors.Add("折算系数必须大于 0 且不超过 10");if(!tax.HasValue||tax<0||tax>100)preview.Errors.Add("税率应在 0–100 之间");
   if(draft.Settings.BusinessType!="现销"&&draft.Settings.BusinessType!="赊销")preview.Errors.Add("本流程仅支持现销或赊销");
   if(string.IsNullOrWhiteSpace(draft.Settings.Salesperson))preview.Errors.Add("请填写业务员");
   if(ctx.SalesTemplate==null)preview.Errors.Add("缺少销售订单导入模板");
   else {if(!ctx.SalesTemplate.Allowed("empid.name",draft.Settings.Salesperson))preview.Errors.Add("业务员不在当前模板字典内，请选择或更新模板");if(!ctx.SalesTemplate.Allowed("currencyid.name","人民币"))preview.Errors.Add("模板不支持人民币");}
   if(draft.Lines.Count>9998)preview.Errors.Add("本批次超过模板 9998 行限制，请拆分订单");
   if(draft.Lines.GroupBy(l=>l.Id).Any(g=>g.Count()>1))preview.Errors.Add("同一来源行被重复选择");
   foreach(var duplicate in draft.Lines.GroupBy(l=>K(l.BillNo)).Where(g=>g.Select(l=>l.Source.Sheet).Distinct().Count()>1))preview.Errors.Add("同一单据号来自多个工作表，请选择明确版本："+duplicate.Key);
   foreach(var row in draft.Lines){var resolved=new ResolvedLine{Input=row,Category=K(row.Category),Frame=K(row.Frame),ProductClass=row.ProductClass};preview.Lines.Add(resolved);
    foreach(var kv in new[]{new[]{"单据号",row.BillNo},new[]{"客户订单号",row.Po},new[]{"客户编码",row.Customer},new[]{"图纸号",row.Drawing},new[]{"客款号",row.Model},new[]{"色号",row.Color}})if(string.IsNullOrWhiteSpace(kv[1]))resolved.Errors.Add("缺少"+kv[0]);
    if(ctx.SalesTemplate!=null&&!ctx.SalesTemplate.Allowed("customerid.number",row.Customer))resolved.Errors.Add("客户编码不在模板字典内，请核对或更新模板");
    if((row.Source.Status??"").Contains("识别字段含公式")&&string.IsNullOrWhiteSpace(row.Note))resolved.Errors.Add("来源识别字段含公式缓存，需填写核对依据");
    var qty=PriceParser.Number(row.Quantity);if(!qty.HasValue||qty<=0)resolved.Errors.Add("数量须为正数");else resolved.Qty=qty.Value;
    var pool=CandidateMaterials(row,ctx,true);resolved.Candidates=pool;
    MaterialRow material=null;
    if(row.ChosenCode!=""){
     var chosen=pool.Where(m=>Same(m.Code,row.ChosenCode)).ToList();
     if(chosen.Count==0)resolved.Errors.Add("指定物料不符合本行客户、图纸、款号、色号和中间段");else material=UniqueMaterial(chosen,resolved);
    }else if(pool.Count>0)material=UniqueMaterial(pool,resolved);
    if(material!=null){resolved.Code=material.Code;resolved.OriginalName=material.Values["物料名称"];resolved.MaterialEvidence=material.File+" / "+material.Sheet+" 第 "+material.Row+" 行";resolved.Category=CategoryOf(material.Code,ctx.Rules);if(resolved.ProductClass=="")resolved.ProductClass=material.Values["物料分类"];}
    var rules=ctx.Rules.Where(r=>Same(r.Category,resolved.Category)).ToList();var rule=rules.Count==1?rules[0]:null;
    if(rule==null)resolved.Errors.Add("成品类别缺失或没有明确规则");
    else {resolved.Middle=rule.MiddleField=="板料编码"?row.Board:row.Plating;
     if(resolved.Middle==""&&material!=null){string prefix=K(rule.Category+"-"+row.Customer+"-"+row.Drawing+"-"+row.Model+"-"),suffix=K("-"+row.Color);resolved.Middle=K(material.Code).Substring(prefix.Length,K(material.Code).Length-prefix.Length-suffix.Length);}
     if(resolved.Frame==""&&ctx.Names.Any(n=>Same(n.Code,resolved.Category)))resolved.Frame=resolved.Category;
     var generated=CodingEngine.Generate(new CodingInput{Category=resolved.Category,Customer=row.Customer,Drawing=row.Drawing,Model=row.Model,Middle=resolved.Middle,Color=row.Color,FrameMaterial=resolved.Frame,Lens=row.Lens},ctx.Rules,ctx.Names,ctx.Lenses);
     resolved.Errors.AddRange(generated.Errors);resolved.Errors.AddRange(generated.NameIssues);resolved.Name=generated.Name;
     if(material==null&&pool.Count==0&&row.ChosenCode==""&&generated.Valid){resolved.Code=generated.Code;resolved.IsNew=true;resolved.MaterialEvidence="根据编码规则生成；金蝶清单无同码物料";
      var exact=ctx.Materials.Where(m=>Same(m.Code,resolved.Code)).ToList();if(exact.Count>0){resolved.Candidates=exact;material=UniqueMaterial(exact,resolved);if(material!=null){resolved.IsNew=false;resolved.OriginalName=material.Values["物料名称"];resolved.MaterialEvidence=material.File+" / "+material.Sheet+" 第 "+material.Row+" 行";}}
     }
    }
    string rawUnit=K(row.Source.Unit);resolved.Unit=row.Unit!=""?row.Unit:material!=null?material.Values["基本单位"]:(rawUnit=="PCS"?draft.Settings.PcsUnit:row.Source.Unit);
    if(material!=null&&!Same(resolved.Unit,material.Values["基本单位"]))resolved.Errors.Add("所选单位与现有物料基本单位不一致");if(string.IsNullOrWhiteSpace(resolved.Unit))resolved.Errors.Add("缺少金蝶单位");
    if(rawUnit!="PCS"&&!Same(rawUnit,resolved.Unit))resolved.Errors.Add("来源单位与金蝶单位不同，本版不自动换算数量");
    if(rawUnit=="PCS"&&!Same(resolved.Unit,draft.Settings.PcsUnit))resolved.Errors.Add("本行单位不符合已核定 PCS 单位映射");
    if(ctx.SalesTemplate!=null&&!ctx.SalesTemplate.Allowed("unit.name",resolved.Unit))resolved.Errors.Add("单位不在销售模板字典内");
    bool identity=Same(row.Customer,row.Source.Customer)&&Same(row.Drawing,SourceDrawing(row.Source,ctx.Rules))&&Same(row.Model,row.Source.Model)&&Same(row.Color,row.Source.Color);
    var lookup=PriceParser.Json.Deserialize<PriceRow>(PriceParser.Json.Serialize(row.Source));lookup.Customer=K(row.Customer);lookup.Drawing=K(row.Drawing);lookup.Model=K(row.Model);lookup.Color=K(row.Color);lookup.Quantity=row.Quantity;lookup.Pi=row.BillNo;lookup.Po=row.Po;
    if(identity)lookup.Drawing=row.Source.Drawing;else {lookup.BasePrice="";lookup.UnitPrice="";lookup.RawPrice="";lookup.Currency="";}
    var match=PriceMatcher.Match(lookup,ctx.Prices);resolved.PriceCandidates=match.Candidates;
    if(row.UseManualPrice){resolved.SourcePrice=row.ManualPrice;resolved.Currency=row.ManualCurrency;resolved.PriceEvidence="人工核对："+row.Note;if(string.IsNullOrWhiteSpace(row.Note))resolved.Errors.Add("人工单价须填写核对依据");}
    else if(match.Status=="已匹配"||match.Status=="原价一致"){resolved.SourcePrice=match.Price;resolved.Currency=match.Currency;resolved.PriceEvidence=match.Reason+"；"+string.Join(" / ",match.Candidates.Select(p=>p.Sheet+":"+p.PriceCell).Distinct());}
    else if(identity&&match.Status=="未匹配"&&match.Candidates.Count==0&&TrustOriginal(row.Source)){resolved.SourcePrice=row.Source.UnitPrice;resolved.Currency=row.Source.Currency;resolved.PriceEvidence="原订单明确单价："+row.Source.Sheet+"!"+row.Source.PriceCell;}
    else resolved.Errors.Add("价格待核对："+match.Status+"；"+match.Reason);
    var price=PriceParser.Number(resolved.SourcePrice);if(!price.HasValue||price<0)resolved.Errors.Add("缺少有效原币单价");else if(price==0&&(row.Gift!="是"||!row.UseManualPrice||row.Note==""))resolved.Errors.Add("零价需明确赠品并填写人工核对依据");
    if(row.Gift!="是"&&row.Gift!="否")resolved.Errors.Add("赠品标记须为是或否");if(row.Gift=="是"&&price>0)resolved.Errors.Add("赠品与非零单价冲突，请核对");
    if(resolved.Currency!="USD"&&resolved.Currency!="CNY")resolved.Errors.Add("仅支持明确的 USD 或 CNY 原币种");
    if(price.HasValue&&rate.HasValue&&factor.HasValue){try{resolved.Price=decimal.Round(checked(price.Value*(resolved.Currency=="USD"?rate.Value*factor.Value:1m)),4,MidpointRounding.AwayFromZero);resolved.Amount=decimal.Round(checked(resolved.Price*resolved.Qty),2,MidpointRounding.AwayFromZero);}catch(OverflowException){resolved.Errors.Add("数量或单价超出计算范围");}}
    if(resolved.IsNew){if(ctx.MaterialTemplate==null)resolved.Errors.Add("待新建物料缺少商品模板");else {if(!ctx.MaterialTemplate.Allowed("baseunitid.name",resolved.Unit))resolved.Errors.Add("单位不在商品模板字典内");if(!ctx.MaterialTemplate.Allowed("stockid.name",draft.Settings.Warehouse))resolved.Errors.Add("仓库不在商品模板字典内");if(resolved.ProductClass==""&&ctx.MaterialTemplate.Allowed("parent.number",resolved.Category))resolved.ProductClass=resolved.Category;if(!ctx.MaterialTemplate.Allowed("parent.number",resolved.ProductClass))resolved.Errors.Add("请选择商品类别编码");}}
   }
   foreach(var line in preview.Lines){bool split=preview.Lines.Where(l=>Same(l.Input.BillNo,line.Input.BillNo)).Select(l=>l.Category).Distinct().Count()>1;line.BillNo=CodingEngine.Clean(line.Input.BillNo)+(split?"-"+line.Category:"");}
   foreach(var group in preview.Lines.GroupBy(l=>K(l.BillNo)))if(group.Select(l=>K(l.Input.Customer)+"|"+K(l.Input.Po)+"|"+l.Category).Distinct().Count()!=1)preview.Errors.Add("导出单据号对应不同客户、PO 或类别："+group.Key);
   foreach(var group in preview.Lines.GroupBy(l=>K(l.Code)).Where(g=>g.Key!=""))if(group.Select(l=>l.Name+"|"+l.Unit+"|"+l.IsNew+"|"+l.ProductClass).Distinct().Count()!=1)preview.Errors.Add("同码的名称、单位或新建属性冲突："+group.Key);
   foreach(var line in preview.Lines){if(line.Qty>1000000000m||decimal.Round(line.Qty,6)!=line.Qty||line.Price>1000000000m)line.Errors.Add("数量或单价超出本版 Excel 精度范围（数量最多 6 位小数，数量/单价不超过 10 亿）");}
   preview.Fingerprint=PriceParser.Hash(Encoding.UTF8.GetBytes(PriceParser.Json.Serialize(new{draft=draft.Id,source=draft.SourceHash,settings=draft.Settings,inputs=draft.Lines,context=ctx.Fingerprint,results=preview.Lines.Select(l=>new{l.Code,l.Name,l.Unit,l.Price,l.Qty,l.BillNo,l.IsNew,l.ProductClass,l.PriceEvidence,l.MaterialEvidence,errors=l.Errors}),errors=preview.Errors})));
   return preview;
  }
  static MaterialRow UniqueMaterial(List<MaterialRow> rows,ResolvedLine line){var signatures=rows.Select(m=>K(m.Code)+"|"+m.Values["物料名称"]+"|"+m.Values["基本单位"]+"|"+m.Values["物料分类"]).Distinct().ToList();if(signatures.Count!=1){line.Errors.Add("物料匹配不唯一，请在详情选择明确编码；同码资料冲突须更新清单");return null;}return rows[0];}
 }
}
