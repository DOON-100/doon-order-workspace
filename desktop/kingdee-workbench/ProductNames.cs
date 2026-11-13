using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace DoonPanelPreview {
 public sealed class ProductName {public string Code{get;set;}public string Name{get;set;}public string Source{get;set;}}
 public sealed partial class PriceStore {
  void NamesSchema(){Run("CREATE TABLE IF NOT EXISTS product_names(id INTEGER PRIMARY KEY,code TEXT NOT NULL,name TEXT NOT NULL,source TEXT NOT NULL,source_hash TEXT NOT NULL,imported_at TEXT NOT NULL,UNIQUE(code,source_hash))");}
  public List<ProductName> Names(){return Run("SELECT p.code,p.name,p.source FROM product_names p WHERE p.id=(SELECT MAX(n.id) FROM product_names n WHERE n.code=p.code) ORDER BY p.code").Select(x=>new ProductName{Code=x[0],Name=x[1],Source=x[2]}).ToList();}
  public int ImportNames(string jsonFile){var bytes=File.ReadAllBytes(jsonFile);string sha=PriceParser.Hash(bytes);var rows=PriceParser.Json.Deserialize<List<ProductName>>(System.Text.Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));if(rows==null||rows.Count==0||rows.Count>1000)throw new InvalidDataException("名称对应表为空或过大。");foreach(var r in rows){r.Code=PriceParser.Key(r.Code);if(!Regex.IsMatch(r.Code,@"^[\p{L}0-9+/-]+$")||string.IsNullOrWhiteSpace(r.Name)||string.IsNullOrWhiteSpace(r.Source))throw new InvalidDataException("材质代码、商品名称与来源必须完整。");}if(rows.Select(x=>x.Code).Distinct().Count()!=rows.Count)throw new InvalidDataException("材质代码重复。");NamesSchema();int added=0;Run("BEGIN IMMEDIATE");try{foreach(var r in rows){if(Run("SELECT id FROM product_names WHERE code=? AND source_hash=?",r.Code,sha).Count>0)continue;Run("INSERT INTO product_names(code,name,source,source_hash,imported_at) VALUES(?,?,?,?,?)",r.Code,r.Name,r.Source,sha,DateTime.UtcNow.ToString("o"));added++;}Run("COMMIT");}catch{Run("ROLLBACK");throw;}return added;}
 }
 public sealed partial class Workbench {
  void ProductNames(){Heading("成品名称对应表","商品名称与成品编码规则分别保存。只按明确的材质代码匹配，不根据款号猜材质。");content.Children.Add(Btn("查看镜片关键词规则",()=>{var rules=store.LensRules();Detail("镜片关键词规则",rules.Count==0?"尚未配置。":string.Join("\n\n",rules.Select(r=>"包含关键词："+r.Keyword+"\n镜片名称："+r.Name+"\n来源："+r.Source)),null);}));var names=store.Names();if(names.Count==0){content.Children.Add(Label("尚未导入材质与商品名称对应表。"));return;}Table(names.Select(x=>new Dictionary<string,string>{{"镜架材质",x.Code},{"商品名称",x.Name},{"来源",x.Source}}).ToList(),r=>Detail("商品名称依据",string.Join("\n\n",r.Select(x=>x.Key+"："+x.Value)),null));content.Children.Add(Label("最终商品名称＝镜架名称（镜片名称）。在成品编码页面填写镜架材质和镜片描述后生成，未配置的类型保持待核对。"));}
 }
}
