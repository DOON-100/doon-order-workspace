using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace DoonPanelPreview {
 public sealed class LensNameRule {public string Keyword{get;set;}public string Name{get;set;}public string Source{get;set;}}
 public sealed class ComposedName {public string Value="";public List<string> Issues=new List<string>();}
 public static class NameComposer {
  public static ComposedName Compose(string frame,string lens,IEnumerable<ProductName> frames,IEnumerable<LensNameRule> lensRules){
   var result=new ComposedName();var baseNames=frames.Where(x=>PriceParser.Key(x.Code)==PriceParser.Key(frame)).Select(x=>x.Name).Distinct().ToList();
   if(baseNames.Count!=1)result.Issues.Add("镜架材质名称未配置或不唯一");
   string value=PriceParser.Key(lens);var matched=lensRules.Where(x=>value.Contains(PriceParser.Key(x.Keyword))&&PriceParser.Key(x.Keyword)!="").ToList();
   if(value=="")result.Issues.Add("缺少镜片描述");
   else if(matched.Any(x=>new[]{"非","不要","不是","不含"}.Any(prefix=>value.Contains(prefix+PriceParser.Key(x.Keyword)))))result.Issues.Add("镜片描述含否定，须核对");
   else if(Regex.IsMatch(value,@"[/|、]|或者|或")&&Regex.Split(value,@"[/|、]|或者|或").Any(part=>lensRules.Where(x=>PriceParser.Key(x.Keyword)!=""&&part.Contains(PriceParser.Key(x.Keyword))).Select(x=>x.Name).Distinct().Count()!=1))result.Issues.Add("镜片描述含未识别的备选，须核对");
   else if(matched.Select(x=>x.Name).Distinct().Count()!=1)result.Issues.Add(matched.Count==0?"镜片关键词尚未配置":"镜片命中不同名称，须核对");
   if(result.Issues.Count==0)result.Value=baseNames[0]+"（"+matched[0].Name+"）";
   return result;
  }
 }
 public sealed partial class PriceStore {
  void LensSchema(){Run("CREATE TABLE IF NOT EXISTS lens_name_rules(id INTEGER PRIMARY KEY,keyword TEXT NOT NULL,name TEXT NOT NULL,source TEXT NOT NULL,source_hash TEXT NOT NULL,imported_at TEXT NOT NULL,UNIQUE(keyword,source_hash))");}
  public List<LensNameRule> LensRules(){return Run("SELECT p.keyword,p.name,p.source FROM lens_name_rules p WHERE p.id=(SELECT MAX(n.id) FROM lens_name_rules n WHERE n.keyword=p.keyword) ORDER BY p.id").Select(x=>new LensNameRule{Keyword=x[0],Name=x[1],Source=x[2]}).ToList();}
  public int ImportLensRules(string path){
   byte[] bytes=File.ReadAllBytes(path);string hash=PriceParser.Hash(bytes);var rows=PriceParser.Json.Deserialize<List<LensNameRule>>(System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));
   if(rows==null||rows.Count==0||rows.Count>1000)throw new InvalidDataException("镜片规则数量无效。");
   foreach(var row in rows){row.Keyword=PriceParser.Key(row.Keyword);if(row.Keyword==""||string.IsNullOrWhiteSpace(row.Name)||string.IsNullOrWhiteSpace(row.Source))throw new InvalidDataException("镜片关键词、名称及来源必须完整。");}
   if(rows.Select(r=>r.Keyword).Distinct().Count()!=rows.Count)throw new InvalidDataException("镜片关键词重复。");
   string folder=Path.Combine(DirectoryPath,"rules-source");Directory.CreateDirectory(folder);string archive=Path.Combine(folder,hash+".json");
   if(!File.Exists(archive)){using(var stream=new FileStream(archive,FileMode.CreateNew,FileAccess.Write)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}}
   if(PriceParser.Hash(File.ReadAllBytes(archive))!=hash)throw new IOException("镜片规则归档校验失败。");
   int added=0;Run("BEGIN IMMEDIATE");try{foreach(var row in rows){if(Run("SELECT id FROM lens_name_rules WHERE keyword=? AND source_hash=?",row.Keyword,hash).Count>0)continue;Run("INSERT INTO lens_name_rules(keyword,name,source,source_hash,imported_at) VALUES(?,?,?,?,?)",row.Keyword,row.Name,row.Source,hash,DateTime.UtcNow.ToString("o"));added++;}Run("COMMIT");return added;}catch{Run("ROLLBACK");throw;}
  }
 }
}
