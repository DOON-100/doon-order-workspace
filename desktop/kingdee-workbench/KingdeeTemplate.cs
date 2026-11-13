using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public sealed class TemplateInfo {
  public string Kind="",Hash="",File="",SheetPath="",Sheet="sheet1（名称勿改）";
  public Dictionary<string,List<string>> Choices=new Dictionary<string,List<string>>();
  public Dictionary<string,string> RangeRepairs=new Dictionary<string,string>();
  public bool Allowed(string key,string value){List<string> list;return !string.IsNullOrWhiteSpace(value)&&Choices.TryGetValue(key,out list)&&list.Contains(value);}
  public List<string> Options(string key){List<string> list;return Choices.TryGetValue(key,out list)?list:new List<string>();}
 }
 public static class KingdeeTemplate {
  public static readonly string[] SalesKeys={"billno","billdate","customerid.number","empid.name","currencyid.name","exchangerate","transtype","materialid.number","unit.name","qty","price","cess","is_free","deliverydate","custbillno"};
  public static readonly string[] MaterialKeys={"number","name","parent.number","baseunitid.name","taxrate","stockid.name","issubpart","isselfrestraint","issale","ispurchase"};
  internal static readonly XNamespace N="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  internal static XDocument Xml(ZipArchive zip,string path){var entry=zip.GetEntry(path);if(entry==null)throw new InvalidDataException("模板缺少 "+path);using(var stream=entry.Open())using(var reader=XmlReader.Create(stream,new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=64000000}))return XDocument.Load(reader,LoadOptions.PreserveWhitespace);}
  public static TemplateInfo Inspect(byte[] bytes,string kind,string filename){
   var sheets=XlsxSource.Read(bytes);var sheet=sheets.SingleOrDefault(s=>s.Name=="sheet1（名称勿改）");if(sheet==null)throw new InvalidDataException("模板工作表名称不符。");var keys=kind=="sales"?SalesKeys:kind=="material"?MaterialKeys:null;if(keys==null)throw new InvalidDataException("未知模板类型。");
   for(int c=1;c<=keys.Length;c++){string text=sheet.Get(3,c).Value;string key=text.Contains("#")?text.Substring(text.LastIndexOf('#')+1).Trim():"";if(key!=keys[c-1])throw new InvalidDataException("模板第 "+c+" 列不符，应为 "+keys[c-1]);}
   var info=new TemplateInfo{Kind=kind,File=filename,Hash=PriceParser.Hash(bytes)};
   using(var input=new MemoryStream(bytes))using(var zip=new ZipArchive(input,ZipArchiveMode.Read)){
    if(zip.Entries.Any(e=>e.FullName.StartsWith("xl/externalLinks/")||e.FullName.EndsWith("vbaProject.bin")))throw new InvalidDataException("模板含宏或外链，不用于本地导出。");
    var wb=Xml(zip,"xl/workbook.xml");var meta=wb.Descendants(N+"sheet").Single(x=>(string)x.Attribute("name")==info.Sheet);string rid=(string)meta.Attribute(XName.Get("id","http://schemas.openxmlformats.org/officeDocument/2006/relationships"));
    var rel=Xml(zip,"xl/_rels/workbook.xml.rels").Root.Elements().Single(x=>(string)x.Attribute("Id")==rid);var uri=new Uri(new Uri("https://local.invalid/xl/workbook.xml"),(string)rel.Attribute("Target"));info.SheetPath=uri.AbsolutePath.TrimStart('/');
    if(uri.Host!="local.invalid"||!info.SheetPath.StartsWith("xl/worksheets/"))throw new InvalidDataException("模板工作表路径异常。");
    var names=wb.Descendants(N+"definedName").ToDictionary(x=>(string)x.Attribute("name"),x=>x.Value);
    var xml=Xml(zip,info.SheetPath);foreach(var validation in xml.Descendants(N+"dataValidation")){
     string formula=((string)validation.Element(N+"formula1")??"").TrimStart('=');var options=new List<string>();
     if(formula.StartsWith("\"")&&formula.EndsWith("\""))options=formula.Trim('"').Split(',').ToList();
     else if(names.ContainsKey(formula)){var m=Regex.Match(names[formula],@"^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$");if(!m.Success)throw new InvalidDataException("模板字典范围不支持："+formula);var dict=sheets.SingleOrDefault(s=>s.Name==m.Groups[1].Value);if(dict==null)throw new InvalidDataException("模板字典工作表缺失。");int begin=int.Parse(m.Groups[3].Value),end=int.Parse(m.Groups[5].Value),col=XlsxSource.Col(m.Groups[2].Value);if(end<begin||end-begin>10000||m.Groups[2].Value!=m.Groups[4].Value)throw new InvalidDataException("模板字典范围过大或不是单列。");for(int r=begin;r<=end;r++){string v=dict.Get(r,col).Value;if(v!="")options.Add(v);}
      // Some Kingdee templates point at A while storing the sole dictionary in the field's column.
      // Repair only this provable case: empty named range, one populated column, complete row coverage.
      if(options.Count==0){int expected=XlsxSource.Col(((string)validation.Attribute("sqref")??"").Split(' ')[0]);var populated=dict.Cells.Values.Where(c=>c.Value!="").ToList();var columns=populated.Select(c=>XlsxSource.Col(c.Address)).Distinct().ToList();
       if(dict.Hidden&&columns.Count==1&&columns[0]==expected&&Enumerable.Range(begin,end-begin+1).All(r=>dict.Get(r,expected).Value!="")&&populated.Count==end-begin+1){for(int r=begin;r<=end;r++)options.Add(dict.Get(r,expected).Value);string letter=Regex.Match(XlsxSource.Address(1,expected),"^[A-Z]+").Value;info.RangeRepairs[formula]="'"+dict.Name.Replace("'","''")+"'!$"+letter+"$"+begin+":$"+letter+"$"+end;}
      }
     }
     foreach(string range in ((string)validation.Attribute("sqref")??"").Split(' ')){int col=XlsxSource.Col(range);if(col>0&&col<=keys.Length&&options.Count>0)info.Choices[keys[col-1]]=options.Distinct().ToList();}
    }
   }
   foreach(var key in kind=="sales"?new[]{"customerid.number","empid.name","currencyid.name","unit.name"}:new[]{"parent.number","baseunitid.name","stockid.name"})if(info.Options(key).Count==0)throw new InvalidDataException("模板缺少可读取的字典："+key);
   return info;
  }
  static byte[] XmlBytes(XDocument xml){using(var stream=new MemoryStream()){using(var writer=XmlWriter.Create(stream,new XmlWriterSettings{Encoding=new UTF8Encoding(false),Indent=false,CloseOutput=false}))xml.Save(writer);return stream.ToArray();}}
  public static byte[] Fill(byte[] template,TemplateInfo info,List<object[]> values){
   if(PriceParser.Hash(template)!=info.Hash)throw new InvalidDataException("模板内容已变化，须重新核对。");int width=info.Kind=="sales"?15:10;if(values.Count==0||values.Count>9998||values.Any(r=>r.Length!=width))throw new InvalidDataException("导出行数或字段数量不符。");
   using(var source=new MemoryStream(template))using(var zip=new ZipArchive(source,ZipArchiveMode.Read))using(var output=new MemoryStream()){
    var xml=Xml(zip,info.SheetPath);var data=xml.Root.Element(N+"sheetData");if(data==null)throw new InvalidDataException("模板缺少行数据。");
    var oldRows=data.Elements(N+"row").Where(r=>(int?)r.Attribute("r")>=4).ToList();var first=oldRows.FirstOrDefault(r=>(int?)r.Attribute("r")==4);var styles=new Dictionary<int,string>();if(first!=null)foreach(var c in first.Elements(N+"c"))styles[XlsxSource.Col((string)c.Attribute("r"))]=(string)c.Attribute("s")??"0";
    foreach(var row in oldRows)row.Remove();var merges=xml.Root.Element(N+"mergeCells");if(merges!=null){foreach(var merge in merges.Elements().ToList())if(Regex.Matches((string)merge.Attribute("ref"),@"\d+").Cast<Match>().Any(m=>int.Parse(m.Value)>=4))merge.Remove();if(!merges.HasElements)merges.Remove();else merges.SetAttributeValue("count",merges.Elements().Count());}
    var styleXml=Xml(zip,"xl/styles.xml");var numFmts=styleXml.Root.Element(N+"numFmts");if(numFmts==null){numFmts=new XElement(N+"numFmts");styleXml.Root.AddFirst(numFmts);}int nextFmt=Math.Max(164,numFmts.Elements().Select(e=>(int?)e.Attribute("numFmtId")??0).DefaultIfEmpty(0).Max()+1);
    numFmts.Add(new XElement(N+"numFmt",new XAttribute("numFmtId",nextFmt),new XAttribute("formatCode","#,##0.########")));numFmts.SetAttributeValue("count",numFmts.Elements().Count());var xfs=styleXml.Root.Element(N+"cellXfs");int numericStyle=xfs.Elements().Count();string qtyStyle;int baseStyle=styles.TryGetValue(10,out qtyStyle)?int.Parse(qtyStyle):0;var xf=new XElement(xfs.Elements().ElementAt(baseStyle));xf.SetAttributeValue("numFmtId",nextFmt);xf.SetAttributeValue("applyNumberFormat",1);xfs.Add(xf);xfs.SetAttributeValue("count",xfs.Elements().Count());
    for(int i=0;i<values.Count;i++){var row=new XElement(N+"row",new XAttribute("r",i+4));if(first!=null)foreach(var a in first.Attributes().Where(a=>a.Name.LocalName!="r"&&a.Name.LocalName!="spans"))row.SetAttributeValue(a.Name,a.Value);
     for(int c=1;c<=width;c++){object value=values[i][c-1];string style;var cell=new XElement(N+"c",new XAttribute("r",XlsxSource.Address(i+4,c)),new XAttribute("s",styles.TryGetValue(c,out style)?style:"0"));
      if(value is decimal||value is int){if(info.Kind=="sales"&&c==10)cell.SetAttributeValue("s",numericStyle);cell.SetAttributeValue("t","n");cell.Add(new XElement(N+"v",Convert.ToString(value,System.Globalization.CultureInfo.InvariantCulture)));}
      else {cell.SetAttributeValue("t","inlineStr");cell.Add(new XElement(N+"is",new XElement(N+"t",new XAttribute(XNamespace.Xml+"space","preserve"),value==null?"":value.ToString())));}
      row.Add(cell);
     }data.Add(row);
    }
    var dimension=xml.Root.Element(N+"dimension");if(dimension!=null)dimension.SetAttributeValue("ref","A1:"+XlsxSource.Address(values.Count+3,width));
    // Repeat all required headers per line. No data merges: each row remains an importable record.
    var workbook=Xml(zip,"xl/workbook.xml");foreach(var name in workbook.Descendants(N+"definedName")){string replacement;if(info.RangeRepairs.TryGetValue((string)name.Attribute("name"),out replacement))name.Value=replacement;}
    using(var target=new ZipArchive(output,ZipArchiveMode.Create,true)){foreach(var entry in zip.Entries){var copy=target.CreateEntry(entry.FullName,CompressionLevel.Optimal);using(var stream=copy.Open()){if(entry.FullName==info.SheetPath){var bytes=XmlBytes(xml);stream.Write(bytes,0,bytes.Length);}else if(entry.FullName=="xl/styles.xml"){var bytes=XmlBytes(styleXml);stream.Write(bytes,0,bytes.Length);}else if(entry.FullName=="xl/workbook.xml"&&info.RangeRepairs.Count>0){var bytes=XmlBytes(workbook);stream.Write(bytes,0,bytes.Length);}else using(var original=entry.Open())original.CopyTo(stream);}}}
    var result=output.ToArray();Verify(result,info,values);return result;
   }
  }
  public static void Verify(byte[] bytes,TemplateInfo info,List<object[]> values){var sheet=XlsxSource.Read(bytes).Single(s=>s.Name==info.Sheet);for(int r=0;r<values.Count;r++)for(int c=0;c<values[r].Length;c++){var cell=sheet.Get(r+4,c+1);string expected=Convert.ToString(values[r][c],System.Globalization.CultureInfo.InvariantCulture)??"";if(values[r][c] is decimal||values[r][c] is int){if(PriceParser.Number(cell.Value)!=PriceParser.Number(expected)||cell.Type=="s"||cell.Type=="inlineStr")throw new InvalidDataException("导出数值回读不一致。");}else if(cell.Value!=expected)throw new InvalidDataException("导出文本回读不一致。");if(cell.Formula!="")throw new InvalidDataException("导出明细不能含公式。");}if(sheet.LastRow>values.Count+3)throw new InvalidDataException("导出残留了模板样例行。");}
 }
}
