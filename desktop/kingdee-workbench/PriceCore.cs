using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace DoonPanelPreview {
 public sealed class SourceCell {
  public string Address="", Value="", Formula="", Format="", Type="";
 }
 public sealed class SourceSheet {
  public string Name=""; public bool Hidden;
  public Dictionary<string,SourceCell> Cells=new Dictionary<string,SourceCell>();
  public Dictionary<string,string> Merges=new Dictionary<string,string>();
  public int LastRow;
  public SourceCell Get(int row,int col) {string a=XlsxSource.Address(row,col),anchor;SourceCell c;if(Merges.TryGetValue(a,out anchor))a=anchor;return Cells.TryGetValue(a,out c)?c:new SourceCell{Address=a};}
 }
 public static class XlsxSource {
  static byte[] ReadOnce(string file){using(var input=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))using(var output=new MemoryStream()){if(input.Length>32*1024*1024)throw new InvalidDataException("文件超过 32 MiB 限制。");var buffer=new byte[65536];int n;while((n=input.Read(buffer,0,buffer.Length))>0){if(output.Length+n>32*1024*1024)throw new InvalidDataException("文件超过读取限制。");output.Write(buffer,0,n);}return output.ToArray();}}
  public static byte[] ReadFile(string file){var first=ReadOnce(file);var second=ReadOnce(file);if(PriceParser.Hash(first)!=PriceParser.Hash(second))throw new IOException("文件正在变化，请完成保存后重试。");return first;}
  static readonly XNamespace S="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  static string Attr(XElement e,string name){return (string)e.Attribute(name)??"";}
  public static string Address(int row,int col){string s="";while(col>0){col--;s=(char)('A'+col%26)+s;col/=26;}return s+row;}
  public static int Col(string a){int n=0;foreach(char c in a.ToUpperInvariant()){if(c<'A'||c>'Z')break;n=n*26+c-'A'+1;}return n;}
  static int Row(string a){return int.Parse(Regex.Match(a,@"\d+$").Value,CultureInfo.InvariantCulture);}
  static XDocument Xml(ZipArchive z,string p){var e=z.GetEntry(p);if(e==null)throw new InvalidDataException("工作簿缺少必要结构："+p);using(var stream=e.Open())using(var reader=XmlReader.Create(stream,new XmlReaderSettings {DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=64000000})){return XDocument.Load(reader);}}
  public static List<SourceSheet> Read(byte[] bytes) {
   if(bytes.Length>32*1024*1024)throw new InvalidDataException("文件超过 32 MiB 限制。");
   using(var mem=new MemoryStream(bytes))using(var zip=new ZipArchive(mem,ZipArchiveMode.Read)){
    if(zip.Entries.Count>10000||zip.Entries.Sum(x=>x.Length)>128*1024*1024)throw new InvalidDataException("工作簿解压内容超过限制。");
    var shared=zip.GetEntry("xl/sharedStrings.xml")==null?new List<string>():Xml(zip,"xl/sharedStrings.xml").Root.Elements(S+"si").Select(x=>string.Concat(x.Descendants(S+"t").Select(t=>t.Value))).ToList();
    var styles=new List<string>();if(zip.GetEntry("xl/styles.xml")!=null){var st=Xml(zip,"xl/styles.xml");var formats=st.Descendants(S+"numFmt").ToDictionary(x=>Attr(x,"numFmtId"),x=>Attr(x,"formatCode"));var xf=st.Root.Element(S+"cellXfs");if(xf!=null)foreach(var x in xf.Elements()){string fmt;styles.Add(formats.TryGetValue(Attr(x,"numFmtId"),out fmt)?fmt:"");}}
    var rels=Xml(zip,"xl/_rels/workbook.xml.rels").Root.Elements().Where(x=>Attr(x,"TargetMode")!="External").ToDictionary(x=>Attr(x,"Id"),x=>Attr(x,"Target"));
    var result=new List<SourceSheet>();foreach(var meta in Xml(zip,"xl/workbook.xml").Descendants(S+"sheet")){
     string rel=(string)meta.Attribute(XName.Get("id","http://schemas.openxmlformats.org/officeDocument/2006/relationships"));string target;if(!rels.TryGetValue(rel,out target))throw new InvalidDataException("工作表链接不可用。");
     var uri=new Uri(new Uri("https://local.invalid/xl/workbook.xml"),target);if(uri.Host!="local.invalid"||!uri.AbsolutePath.StartsWith("/xl/worksheets/",StringComparison.Ordinal))throw new InvalidDataException("工作表路径无效。");
     var xml=Xml(zip,Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')));var sheet=new SourceSheet{Name=Attr(meta,"name"),Hidden=Attr(meta,"state")=="hidden"||Attr(meta,"state")=="veryHidden"};
     foreach(var cell in xml.Descendants(S+"sheetData").Descendants(S+"c")){
      string a=Attr(cell,"r");if(!Regex.IsMatch(a,@"^[A-Z]{1,3}[1-9][0-9]*$"))continue;int row=Row(a);if(row>50000||Col(a)>1000)throw new InvalidDataException("工作表行列超过支持范围。");
      string type=Attr(cell,"t"),v=(string)cell.Element(S+"v")??"",formula=cell.Element(S+"f")==null?"":((string)cell.Element(S+"f")==""?"[共享公式，原件保留]":(string)cell.Element(S+"f"));int index;
      if(type=="s"){if(!int.TryParse(v,out index)||index<0||index>=shared.Count)throw new InvalidDataException("共享文本索引无效。");v=shared[index];}else if(type=="inlineStr")v=string.Concat(cell.Descendants(S+"t").Select(t=>t.Value));
      string fmt=int.TryParse(Attr(cell,"s"),out index)&&index>=0&&index<styles.Count?styles[index]:"";sheet.Cells[a]=new SourceCell{Address=a,Value=v,Formula=formula,Format=fmt,Type=type};sheet.LastRow=Math.Max(row,sheet.LastRow);
     }
     foreach(var merge in xml.Descendants(S+"mergeCell")){var ends=Attr(merge,"ref").Split(':');if(ends.Length!=2)continue;int r1=Row(ends[0]),r2=Row(ends[1]),c1=Col(ends[0]),c2=Col(ends[1]);if(r2>50000||c2>1000||(long)(r2-r1+1)*(c2-c1+1)>100000)throw new InvalidDataException("合并范围超过限制。");for(int r=r1;r<=r2;r++)for(int c=c1;c<=c2;c++)sheet.Merges[Address(r,c)]=ends[0];}
     result.Add(sheet);
    }return result;
   }
  }
 }
 public sealed class PriceRow {
  public string Lens{get;set;} public string RawPrice{get;set;} public string Id{get;set;} public string Customer{get;set;} public string Drawing{get;set;} public string Model{get;set;} public string Sku{get;set;} public string Color{get;set;} public string Kind{get;set;} public string Unit{get;set;} public string Currency{get;set;} public string BasePrice{get;set;} public string Plating{get;set;} public string Moq{get;set;} public string UnitPrice{get;set;} public string Quantity{get;set;} public string Pi{get;set;} public string Po{get;set;} public string Sheet{get;set;} public int Row{get;set;} public string File{get;set;} public string Hash{get;set;} public string Status{get;set;} public string Notes{get;set;} public string Evidence{get;set;} public string PriceCell{get;set;} public string RawDrawing{get;set;} public string RawModel{get;set;} public string Formula{get;set;}
 }
 public sealed class ParsedFile {public List<PriceRow> Rows=new List<PriceRow>();public List<string> Skipped=new List<string>(); public string Hash="";public byte[] Bytes;public string Name="";}
 public static class PriceParser {
  public const string Version="invoice-prices-v1";
  public static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
  public static string Hash(byte[] data){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
  public static string Key(string s){return Regex.Replace((s??"").Normalize(NormalizationForm.FormKC),@"[\s\u200B\uFEFF]+","").ToUpperInvariant();}
  public static string DrawingKey(string s){var first=(s??"").Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()??"";return Regex.Replace(Key(first),@"-(?:AC\+TI|TI\+AC|AC|TI|SS|SUN)$","");}
  public static decimal? Number(string s){decimal n;return decimal.TryParse(s,NumberStyles.AllowLeadingSign|NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out n)?(decimal?)n:null;}
  public static string Num(decimal? d){return d.HasValue?d.Value.ToString("0.############################",CultureInfo.InvariantCulture):"";}
  static string Head(string s){return Key(s).Replace(":","");}
  static int Find(Dictionary<int,string> h,Func<string,bool> test){var cols=h.Where(x=>test(x.Value)).Select(x=>x.Key).ToList();if(cols.Count>1)throw new InvalidDataException("表头存在多个同类字段，须先明确字段映射。");return cols.FirstOrDefault();}
  static string HeaderValue(SourceSheet s,int before,string pattern){foreach(var pair in s.Cells){var c=pair.Value;int row=int.Parse(Regex.Match(c.Address,@"\d+$").Value);if(row>=before||!Regex.IsMatch(Head(c.Value),pattern,RegexOptions.IgnoreCase))continue;int col=XlsxSource.Col(c.Address);for(int cc=col+1;cc<=Math.Min(col+18,120);cc++){var next=s.Get(row,cc);if(next.Address==c.Address||next.Value.Trim()=="")continue;return next.Value.Trim();}}return "";}
  public static ParsedFile Parse(string file){return Parse(XlsxSource.ReadFile(file),Path.GetFileName(file));}
  public static ParsedFile Parse(byte[] bytes,string filename){
   var parsed=new ParsedFile{Bytes=bytes,Name=filename,Hash=Hash(bytes)};
   foreach(var sheet in XlsxSource.Read(bytes)){
    Dictionary<int,string> headers=null;int header=0;
    for(int r=1;r<=Math.Min(sheet.LastRow,60);r++){var hh=new Dictionary<int,string>();for(int c=1;c<=120;c++){string t=Head(sheet.Get(r,c).Value);if(t!="")hh[c]=t;}if(hh.Values.Any(t=>t.StartsWith("DRAWING")||t.Contains("图纸编号"))&&hh.Values.Any(t=>t=="MODEL"||t.StartsWith("MODEL款号")||t=="款号")){header=r;headers=hh;break;}}
    if(headers==null){parsed.Skipped.Add(sheet.Name+"：非订单明细表");continue;}
    int drawing=Find(headers,t=>t.StartsWith("DRAWING")||t.Contains("图纸编号")),model=Find(headers,t=>t=="MODEL"||t.StartsWith("MODEL款号")||t=="款号"),color=Find(headers,t=>t=="COLOURWAY"||t=="COLORWAY"||t=="COLOURNAME"||t=="COLORNAME"||t=="色号"||t=="COLORNO."),sku=Find(headers,t=>t=="SKU"),price=Find(headers,t=>t=="FRAMEPRICE"||t=="UNITPRICE"||t=="单价"),plating=Find(headers,t=>t.StartsWith("EXTRAPLATINGCOST")),moq=Find(headers,t=>t.StartsWith("PRICEFORNOTREACHMOQ")),qty=Find(headers,t=>t.StartsWith("ORDERQTY")||t=="QUANTITY"||t=="数量"),sampleQty=Find(headers,t=>t.StartsWith("SAMPLEQTY")||t=="样办数量"),unit=Find(headers,t=>t=="UNIT"||t=="单位"),remark=Find(headers,t=>t.StartsWith("REMARK")||t=="备注"),total=Find(headers,t=>t=="ITEMNET"||t=="TOTAL");
    int lens=Find(headers,t=>t=="LENS"||t=="LENSDESCRIPTION"||t=="LENSCOLOR"||t=="LENSCOLOUR"||t=="镜片"||t=="镜片描述"||t=="镜片颜色");
    if(color==0){parsed.Skipped.Add(sheet.Name+"：缺少明确色号列");continue;}
    string pi=HeaderValue(sheet,header,@"^PI/ORDERCONFIRMATIONNO\.?$|^PI(NO|NUMBER)\.?$|^INVOICENO\.?$|^单据编号$|^生产单号$|^内部订单号$"),po=HeaderValue(sheet,header,@"^CUSTOMERPONO\.?$|^客户订单号$"),explicitCustomer=HeaderValue(sheet,header,@"^CUSTOMER(CODE|NO\.?|NUMBER)$|^客户(编码|编号|代码)$");
    var customers=new HashSet<string>();foreach(string text in new[]{pi,po})foreach(Match m in Regex.Matches(Key(text),@"(?<![A-Z0-9])\d{4}-(C\d+)(?=-)"))customers.Add(m.Groups[1].Value);if(Regex.IsMatch(Key(explicitCustomer),@"^C\d+$"))customers.Add(Key(explicitCustomer));string customer=customers.Count==1?customers.First():"";
    string scope=Key(sheet.Name+" "+pi+" "+po);string kind=Regex.IsMatch(scope,@"SAMPLE|样办|(?:^|-)YB(?:-|\d)")?"样办":"正式";
    if(kind=="样办"&&sampleQty>0)qty=sampleQty;
    for(int r=header+1;r<=sheet.LastRow;r++){
     string first=Key(sheet.Get(r,1).Value);if(Regex.IsMatch(first,@"^(TOTALQUANTITY|TOTALAMOUNT|TOTAL:|合计|总计|DEPOSIT|BALANCE|REMARKS:?)"))break;
     var dc=sheet.Get(r,drawing);var mc=sheet.Get(r,model);var cc=sheet.Get(r,color);
     if(cc.Value.Trim()==""||Regex.IsMatch(Head(cc.Value),@"^(COLOURWAY|COLORWAY|COLOURNAME|色号)$"))continue;
     if(dc.Value.Trim()==""&&mc.Value.Trim()=="")continue;
     var pc=price>0?sheet.Get(r,price):new SourceCell();var qc=qty>0?sheet.Get(r,qty):new SourceCell();var ec=plating>0?sheet.Get(r,plating):new SourceCell();var ac=moq>0?sheet.Get(r,moq):new SourceCell();var tc=total>0?sheet.Get(r,total):new SourceCell();
     var issues=new List<string>();if(sheet.Cells.Values.Any(c=>c.Formula!=""&&int.Parse(Regex.Match(c.Address,@"\d+$").Value)<header))issues.Add("识别字段含公式待核对");if(customer=="")issues.Add(customers.Count>1?"客户编号冲突":"缺客户编号依据");if(sheet.Hidden)issues.Add("隐藏工作表");
     decimal? bp=Number(pc.Value),ex=Number(ec.Value),mq=Number(ac.Value);if(pc.Type=="e"||!bp.HasValue)issues.Add("缺有效单价");if(bp<0)issues.Add("负单价");if(bp==0)issues.Add("零价需确认");if(pc.Formula!=""||ec.Formula!=""||ac.Formula!="")issues.Add("单价含公式，仅保留缓存待核对");
     if(ec.Value!=""&&!ex.HasValue)issues.Add("电镀加价非数值");if(ac.Value!=""&&!mq.HasValue)issues.Add("起订量加价非数值");if(ex<0||mq<0)issues.Add("负附加费");
     string fmt=pc.Format.ToUpperInvariant();string currency=Regex.IsMatch(fmt,@"US\$|USD")?"USD":Regex.IsMatch(fmt,@"CNY|RMB|￥|¥")?"CNY":Regex.IsMatch(fmt,@"EUR|€")?"EUR":"";if(currency=="")issues.Add("币种待核对");
     string d=DrawingKey(dc.Value),mkey=Key(mc.Value),ckey=Key(cc.Value);if(d=="")issues.Add("缺图纸号");if(mkey=="")issues.Add("缺客款号");if(dc.Formula!=""||mc.Formula!=""||cc.Formula!=""||qc.Formula!=""||(unit>0&&sheet.Get(r,unit).Formula!="")||(sku>0&&sheet.Get(r,sku).Formula!="")||(lens>0&&sheet.Get(r,lens).Formula!=""))issues.Add("识别字段含公式待核对");
     decimal? effective=bp.HasValue?bp+(ex??0)+(mq??0):null;
     string u=unit>0?Key(sheet.Get(r,unit).Value):"";if(u=="")issues.Add("缺单位");
     if(mq>0)issues.Add("含起订量附加费，按单核对");
     if(ex>0||mq>0){string form=Key(tc.Formula).Replace("$","");var referenced=Regex.Matches(form,@"[A-Z]+[1-9][0-9]*").Cast<Match>().Select(x=>x.Value).ToList();if((ex>0&&!referenced.Contains(ec.Address))||(mq>0&&!referenced.Contains(ac.Address)))issues.Add("附加费与原金额公式不一致");}
     string notes=remark>0?sheet.Get(r,remark).Value:"";
     parsed.Rows.Add(new PriceRow{Lens=lens>0?sheet.Get(r,lens).Value:"",RawPrice=pc.Value,Id=Hash(Encoding.UTF8.GetBytes(parsed.Hash+"\n"+sheet.Name+"\n"+r)),Customer=customer,Drawing=d,Model=mkey,Sku=sku>0?Key(sheet.Get(r,sku).Value):"",Color=ckey,Kind=kind,Unit=u,Currency=currency,BasePrice=Num(bp),Plating=Num(ex),Moq=Num(mq),UnitPrice=Num(effective),Quantity=qc.Value,Pi=pi,Po=po,Sheet=sheet.Name,Row=r,File=filename,Hash=parsed.Hash,Status=issues.Count==0?"可匹配":string.Join("；",issues.Distinct()),Notes=notes,Evidence="图纸 "+dc.Address+"；款号 "+mc.Address+"；色号 "+cc.Address+"；单价 "+pc.Address+"；加价 "+ec.Address+"；MOQ "+ac.Address,PriceCell=pc.Address,RawDrawing=dc.Value,RawModel=mc.Value,Formula=pc.Formula!=""?pc.Formula:tc.Formula});
    }
   }return parsed;
  }
 }
 public sealed class MatchResult {public string Status="",Price="",Amount="",Currency="",Reason="";public List<PriceRow> Candidates=new List<PriceRow>();}
 public static class PriceMatcher {
  public static MatchResult Match(PriceRow order,IEnumerable<PriceRow> prices){
   if((order.Status??"").Contains("识别字段含公式")||(order.Status??"").Contains("单价含公式")||(order.Status??"").Contains("隐藏工作表"))return new MatchResult{Status="待确认",Reason="订单含公式识别字段或隐藏来源，不能使用缓存自动定价"};
   var result=new MatchResult();if(!string.IsNullOrEmpty(order.RawPrice)&&!PriceParser.Number(order.RawPrice).HasValue){result.Status="待确认";result.Reason="原单单价不是有效数字，保留原值核对";return result;}if(order.Customer==""){result.Status="待确认";result.Reason="订单客户编号缺失或冲突";return result;}
   if(order.Drawing==""||order.Color==""||order.Unit==""){result.Status="待确认";result.Reason="缺图纸、色号或单位，不能仅按客户匹配";return result;}
   var pool=prices.Where(p=>p.Customer==order.Customer&&p.Drawing==order.Drawing&&p.Color==order.Color&&p.Kind==order.Kind&&p.Unit==order.Unit).ToList();
   if(order.Model!=""){var compatible=pool.Where(p=>p.Model==order.Model).ToList();if(pool.Count>0&&compatible.Count==0){result.Status="待确认";result.Reason="图纸色号命中，但客款号不一致";result.Candidates=pool;return result;}pool=compatible;}
   if(order.Sku!="")pool=pool.Where(p=>p.Sku==""||p.Sku==order.Sku).ToList();
   var exact=pool.Where(p=>(order.Pi!=""&&PriceParser.Key(p.Pi)==PriceParser.Key(order.Pi))||(order.Po!=""&&PriceParser.Key(p.Po)==PriceParser.Key(order.Po))).ToList();if(exact.Count>0)pool=exact;
   result.Candidates=pool;if(pool.Count==0){result.Status="未匹配";result.Reason="无同客户、图纸、色号、单位和订单类型的价格";return result;}
   if(pool.Any(p=>p.Status!="可匹配")){result.Status="待确认";result.Reason="候选含零价、公式缓存、附加费或缺项";return result;}
   var distinct=pool.Select(p=>p.Currency+"|"+p.UnitPrice).Distinct().ToList();if(distinct.Count!=1){result.Status="价格冲突";result.Reason="同一条件有不同单价或币种，不自动选择";return result;}
   var chosen=pool[0];if(order.Currency!=""&&order.Currency!=chosen.Currency){result.Status="待确认";result.Reason="订单与报价币种不同，须明确换算规则";return result;}
   decimal? qty=PriceParser.Number(order.Quantity),pvalue=PriceParser.Number(chosen.UnitPrice);if(!qty.HasValue||qty<=0||!pvalue.HasValue){result.Status="待确认";result.Reason="订单数量无效或单价缺失";return result;}
   if(order.BasePrice!=""&&PriceParser.Number(order.UnitPrice)!=pvalue){result.Status="原单价格不同";result.Reason="保留原单价格，不覆盖为历史报价";return result;}
   result.Status=order.BasePrice!=""?"原价一致":"已匹配";result.Price=chosen.UnitPrice;result.Currency=chosen.Currency;
   try{result.Amount=PriceParser.Num(checked(qty.Value*pvalue.Value));}catch(OverflowException){result.Status="待确认";result.Price="";result.Reason="金额超出支持范围";return result;}
   result.Reason=exact.Count>0?"同单精确匹配；金额为原币种数量×单价，未作度昂折算":"历史候选价格一致；金额为原币种数量×单价，未作度昂折算";return result;
  }
 }
}
