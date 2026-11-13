using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public sealed class CodingRule {
  public string Category{get;set;} public string Name{get;set;} public string Rule{get;set;}
  public string MiddleField{get;set;} public string Example{get;set;} public string Notes{get;set;}
  public string Template{get;set;} public string Reference{get;set;}
  public string File{get;set;} public string Hash{get;set;} public string Sheet{get;set;} public int Row{get;set;}
  public string Requirements{get;set;}
  public string Label {get{return Category+" · "+Name;}}
 }
 public sealed class CodingFile {
  public byte[] Bytes; public string Hash,Name; public List<CodingRule> Rules=new List<CodingRule>();
 }
 public sealed class CodingInput {
  public string Category="",Customer="",Drawing="",Model="",Middle="",Color="",FrameMaterial="",Lens="";
 }
 public sealed class CodingResult {
  public string Code="",Name="",RuleHash="",Category="",Source="";
  public List<string> Errors=new List<string>();
  public List<string> NameIssues=new List<string>();
  public bool Valid {get{return Errors.Count==0&&Code!="";}}
 }
 public static class CodingEngine {
  public static string Clean(string value){return Regex.Replace((value??"").Normalize(NormalizationForm.FormKC),@"[\s\u200B\uFEFF]+","");}
  public static CodingResult Generate(CodingInput input,IEnumerable<CodingRule> rules,IEnumerable<ProductName> names,IEnumerable<LensNameRule> lensRules){
   var result=new CodingResult();var candidates=rules.Where(r=>PriceParser.Key(r.Category)==PriceParser.Key(input.Category)).ToList();
   if(candidates.Count!=1){result.Errors.Add(candidates.Count==0?"此类别没有明确的成品编码规则":"同一类别存在多条规则，须先核对版本");return result;}
   var rule=candidates[0];string[] segments={rule.Category,input.Customer,input.Drawing,input.Model,input.Middle,input.Color};
   string[] labels={"成品类别","客户代码","图纸号","客款号",rule.MiddleField,"色号"};
   for(int i=0;i<segments.Length;i++){segments[i]=Clean(segments[i]);if(segments[i]=="")result.Errors.Add("缺少"+labels[i]);if(segments[i].Any(char.IsControl))result.Errors.Add(labels[i]+"含控制字符");if(segments[i].StartsWith("-")||segments[i].EndsWith("-"))result.Errors.Add(labels[i]+"首尾有分隔符，请核对，程序不擅自删除");}
   if(segments.Any(v=>v.Contains("〈")||v.Contains("〉")))result.Errors.Add("占位提示须替换为真实字段值");
   if(rule.MiddleField!="板料编码"&&rule.MiddleField!="电镀颜色")result.Errors.Add("第五段规则未明确");
   if(result.Errors.Count>0)return result;
   result.Code=string.Join("-",segments);result.Category=rule.Category;result.RuleHash=rule.Hash;result.Source=rule.File+" / "+rule.Sheet+" 第 "+rule.Row+" 行";
   var composed=NameComposer.Compose(input.FrameMaterial,input.Lens,names,lensRules);result.Name=composed.Value;result.NameIssues=composed.Issues;return result;
  }
  // A code is validated against explicit segment inputs; inner '-' and '+' are never guessed apart.
  public static bool Matches(string existing,CodingResult result){return result.Valid&&PriceParser.Key(existing)==PriceParser.Key(result.Code);}
 }
 public static class CodingParser {
  public static CodingFile Parse(string path){return Parse(XlsxSource.ReadFile(path),Path.GetFileName(path));}
  public static CodingFile Parse(byte[] bytes,string filename){
   var output=new CodingFile{Bytes=bytes,Name=filename,Hash=PriceParser.Hash(bytes)};
   foreach(var sheet in XlsxSource.Read(bytes).Where(s=>s.Name.Contains("成品编码规则")&&!s.Name.Contains("半成品"))){
    if(sheet.Hidden)throw new InvalidDataException("成品编码规则表隐藏，须先核对来源。");
    int header=0,category=0,name=0,rule=0,example=0,notes=0;
    for(int r=1;r<=Math.Min(sheet.LastRow,30)&&header==0;r++){
     var cells=Enumerable.Range(1,30).Select(c=>new{Col=c,Cell=sheet.Get(r,c)}).Where(x=>x.Cell.Address==XlsxSource.Address(r,x.Col)).ToList();
     var cc=cells.Where(x=>PriceParser.Key(x.Cell.Value).StartsWith("成品类别代码")).ToList();var rr=cells.Where(x=>PriceParser.Key(x.Cell.Value)=="规则").ToList();
     if(cc.Count!=1||rr.Count!=1)continue;
     header=r;category=cc[0].Col;rule=rr[0].Col;
     name=cells.Where(x=>PriceParser.Key(x.Cell.Value)=="成品类别名称").Select(x=>x.Col).SingleOrDefault();
     example=cells.Where(x=>PriceParser.Key(x.Cell.Value)=="编码示例").Select(x=>x.Col).SingleOrDefault();
     notes=cells.Where(x=>PriceParser.Key(x.Cell.Value)=="备注").Select(x=>x.Col).SingleOrDefault();
    }
    if(header==0||name==0)throw new InvalidDataException("未找到完整的成品编码规则表头。");
    string requirements=string.Join("\n",sheet.Cells.Values.Where(c=>c.Value.Contains("分开做销售订单")||c.Value.Contains("与出口报关名称一致")).Select(c=>c.Address+"："+c.Value));
    for(int r=header+1;r<=sheet.LastRow;r++){
     var codeCell=sheet.Get(r,category);string code=PriceParser.Key(codeCell.Value);if(code==""||codeCell.Address!=XlsxSource.Address(r,category))continue;
     var text=sheet.Get(r,rule);string normalized=PriceParser.Key(text.Value);
     if(codeCell.Formula!=""||text.Formula!="")throw new InvalidDataException("规则字段含公式，不能将缓存作为正式规则。");
     if(!Regex.IsMatch(code,@"^[A-Z0-9]+(?:[+/-][A-Z0-9]+)*$"))throw new InvalidDataException("类别代码格式不明确，第 "+r+" 行。");
     bool board=normalized.EndsWith("客户代码+图纸号+客款号+板料编码+色号",StringComparison.Ordinal);
     bool plating=normalized.EndsWith("客户代码+图纸号+客款号+电镀颜色+色号",StringComparison.Ordinal);
     if(board==plating)throw new InvalidDataException("未支持的分段顺序，第 "+r+" 行；不猜测规则。");
     string ex=example>0?sheet.Get(r,example).Value:"",note=notes>0?sheet.Get(r,notes).Value:"",middle=board?"板料编码":"电镀颜色";
     string template=code+"-〈客户代码〉-〈图纸号〉-〈客款号〉-〈"+middle+"〉-〈色号〉",reference=CodingEngine.Clean(ex);
     if(ex!=""&&!PriceParser.Key(ex).StartsWith(code+"-",StringComparison.Ordinal)){
      var boundary=Regex.Match(reference,@"-C\d+-",RegexOptions.IgnoreCase);
      reference=boundary.Success?code+reference.Substring(boundary.Index):template;
      note+="\n参考示例类别已按规则正文修正为 "+code+"；原示例保留在详情中。";
     }
     if(ex!=""&&CleanExampleParts(ex)<6){
      var keys=new[]{"客户代码","图纸号","客款号",middle,"色号"};
      reference=code+"-"+string.Join("-",keys.Select(k=>{string v=ExampleCell(sheet,header,r,k);return v==""?"〈"+k+"待填写〉":CodingEngine.Clean(v);}));
      note+="\n参考示例已补齐六段位置；占位提示须填写真实值，不能直接用于订单。";
     }
     if(reference=="")reference=template;
     output.Rules.Add(new CodingRule{Category=code,Name=sheet.Get(r,name).Value,Rule=text.Value,MiddleField=middle,Example=ex,Template=template,Reference=reference,Notes=note.Trim(),File=filename,Hash=output.Hash,Sheet=sheet.Name,Row=r,Requirements=requirements});
    }
   }
   if(output.Rules.Count==0)throw new InvalidDataException("没有找到成品编码规则。");
   if(output.Rules.Select(r=>r.Category).Distinct().Count()!=output.Rules.Count)throw new InvalidDataException("类别规则重复，导入已中止。");
   return output;
  }
  static int CleanExampleParts(string value){return CodingEngine.Clean(value).Split('-').Length;}
  static string ExampleCell(SourceSheet sheet,int header,int row,string label){var cols=Enumerable.Range(1,30).Where(c=>sheet.Get(header,c).Address==XlsxSource.Address(header,c)&&PriceParser.Key(sheet.Get(header,c).Value).StartsWith(label,StringComparison.Ordinal)).ToList();return cols.Count==1?sheet.Get(row,cols[0]).Value:"";}
 }
 public sealed partial class PriceStore {
  void CodingSchema(){
   Run("CREATE TABLE IF NOT EXISTS coding_rule_sources(hash TEXT PRIMARY KEY,filename TEXT NOT NULL,imported_at TEXT NOT NULL)");
   Run("CREATE TABLE IF NOT EXISTS coding_rules(source_hash TEXT NOT NULL REFERENCES coding_rule_sources(hash),category TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source_hash,category))");
  }
  public List<CodingRule> CodingRules(){return Run("SELECT payload FROM coding_rules WHERE source_hash=(SELECT hash FROM coding_rule_sources ORDER BY rowid DESC LIMIT 1) ORDER BY rowid").Select(x=>PriceParser.Json.Deserialize<CodingRule>(x[0])).ToList();}
  public List<MaterialRow> FindMaterialCode(string code){return Run("SELECT payload FROM material_records WHERE code=? ORDER BY row_number",PriceParser.Key(code)).Select(x=>PriceParser.Json.Deserialize<MaterialRow>(x[0])).ToList();}
  public int ImportCoding(CodingFile file){
   if(file.Rules.Count==0||PriceParser.Hash(file.Bytes)!=file.Hash)throw new InvalidDataException("规则来源校验失败。");
   string folder=Path.Combine(DirectoryPath,"originals");Directory.CreateDirectory(folder);string archive=Path.Combine(folder,file.Hash+".xlsx");
   if(!File.Exists(archive)){using(var stream=new FileStream(archive,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(file.Bytes,0,file.Bytes.Length);stream.Flush(true);}}
   if(PriceParser.Hash(File.ReadAllBytes(archive))!=file.Hash)throw new IOException("规则原件校验失败。");
   Run("BEGIN IMMEDIATE");try{if(Run("SELECT hash FROM coding_rule_sources WHERE hash=?",file.Hash).Count>0){Run("COMMIT");return 0;}
    Run("INSERT INTO coding_rule_sources VALUES(?,?,?)",file.Hash,file.Name,DateTime.UtcNow.ToString("o"));
    foreach(var r in file.Rules)Run("INSERT INTO coding_rules VALUES(?,?,?)",file.Hash,r.Category,PriceParser.Json.Serialize(r));
    Run("COMMIT");return file.Rules.Count;
   }catch{Run("ROLLBACK");throw;}
  }
 }
}
