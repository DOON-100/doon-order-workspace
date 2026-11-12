using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public sealed class MaterialRow {
  public string Id{get;set;}public string Code{get;set;}public string Hash{get;set;}public string File{get;set;}public string Sheet{get;set;}public int Row{get;set;}
  public Dictionary<string,string> Values{get;set;}public Dictionary<string,string> Formulas{get;set;}public Dictionary<string,string> Types{get;set;}public Dictionary<string,string> Formats{get;set;}
 }
 public sealed class MaterialFile {public string Hash,Name;public byte[] Bytes;public List<MaterialRow> Rows=new List<MaterialRow>();public List<string> Skipped=new List<string>();}
 public static class MaterialParser {
  public static MaterialFile Parse(string path){return Parse(XlsxSource.ReadFile(path),Path.GetFileName(path));}
  public static MaterialFile Parse(byte[] bytes,string filename){var output=new MaterialFile{Hash=PriceParser.Hash(bytes),Name=filename,Bytes=bytes};foreach(var s in XlsxSource.Read(bytes)){
   int header=0;var columns=new Dictionary<int,string>();for(int row=1;row<=Math.Min(30,s.LastRow);row++){var candidate=new Dictionary<int,string>();for(int c=1;c<=120;c++){var cell=s.Get(row,c);if(cell.Address!=XlsxSource.Address(row,c)||string.IsNullOrWhiteSpace(cell.Value))continue;candidate[c]=cell.Value.Trim();}if(candidate.Values.Contains("物料编码")&&candidate.Values.Contains("物料名称")){header=row;columns=candidate;break;}}
   if(header==0){output.Skipped.Add(s.Name+"：未找到物料编码 / 物料名称表头");continue;}if(columns.Values.Distinct().Count()!=columns.Count)throw new InvalidDataException("物料表头重名，须先明确字段映射。");var wanted=new[]{"物料编码","物料名称","规格型号","基本单位","物料分类"};if(wanted.Any(n=>!columns.Values.Contains(n)))throw new InvalidDataException("物料清单缺少所需的五个字段。");columns=columns.Where(x=>wanted.Contains(x.Value)).ToDictionary(x=>x.Key,x=>x.Value);int code=columns.Single(x=>x.Value=="物料编码").Key;
   for(int row=header+1;row<=s.LastRow;row++){var values=new Dictionary<string,string>();var formulas=new Dictionary<string,string>();var types=new Dictionary<string,string>();var formats=new Dictionary<string,string>();foreach(var col in columns){var cell=s.Get(row,col.Key);values[col.Value]=cell.Value;types[col.Value]=cell.Type;formats[col.Value]=cell.Format;if(cell.Formula!="")formulas[col.Value]=cell.Formula;}if(values.Values.All(string.IsNullOrWhiteSpace))continue;
    // No deduplication by normalized code: raw IDs and duplicate source rows are evidence.
    output.Rows.Add(new MaterialRow{Id=PriceParser.Hash(Encoding.UTF8.GetBytes(output.Hash+"\n"+s.Name+"\n"+row)),Code=PriceParser.Key(s.Get(row,code).Value),Hash=output.Hash,File=filename,Sheet=s.Name,Row=row,Values=values,Formulas=formulas,Types=types,Formats=formats});
   }
  }if(output.Rows.Count==0)throw new InvalidDataException("未识别到物料明细。");return output;}
 }
 public sealed partial class PriceStore {
  void MaterialsSchema(){Run("CREATE TABLE IF NOT EXISTS material_sources(hash TEXT PRIMARY KEY,filename TEXT NOT NULL,imported_at TEXT NOT NULL)");Run("CREATE TABLE IF NOT EXISTS material_records(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL REFERENCES material_sources(hash),code TEXT NOT NULL,sheet TEXT NOT NULL,row_number INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(source_hash,sheet,row_number))");Run("CREATE INDEX IF NOT EXISTS material_code ON material_records(code)");}
  public int MaterialCount(){return int.Parse(Run("SELECT COUNT(*) FROM material_records")[0][0]);}
  public List<MaterialRow> Materials(){return Run("SELECT payload FROM material_records ORDER BY source_hash,sheet,row_number").Select(x=>PriceParser.Json.Deserialize<MaterialRow>(x[0])).ToList();}
  public int ImportMaterials(MaterialFile file){if(PriceParser.Hash(file.Bytes)!=file.Hash)throw new InvalidDataException("物料原件校验失败。");string folder=Path.Combine(DirectoryPath,"originals");Directory.CreateDirectory(folder);string archive=Path.Combine(folder,file.Hash+".xlsx");if(!File.Exists(archive)){using(var stream=new FileStream(archive,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(file.Bytes,0,file.Bytes.Length);stream.Flush(true);}}if(PriceParser.Hash(File.ReadAllBytes(archive))!=file.Hash)throw new IOException("归档原件校验失败。");Run("BEGIN IMMEDIATE");try{if(Run("SELECT hash FROM material_sources WHERE hash=?",file.Hash).Count>0){Run("COMMIT");return 0;}Run("INSERT INTO material_sources VALUES(?,?,?)",file.Hash,file.Name,DateTime.UtcNow.ToString("o"));foreach(var r in file.Rows)Run("INSERT INTO material_records VALUES(?,?,?,?,?,?)",r.Id,file.Hash,r.Code,r.Sheet,r.Row.ToString(System.Globalization.CultureInfo.InvariantCulture),PriceParser.Json.Serialize(r));Run("COMMIT");return file.Rows.Count;}catch{Run("ROLLBACK");throw;}}
 }
 public sealed partial class Workbench {
  void Materials(){Heading("金蝶成品与物料库",store.MaterialCount()+" 条已归档来源明细 · 仅保存五个业务字段，完整原件归档 · 更新清单追加来源，不覆盖历史");content.Children.Add(Btn("导入金蝶物料 Excel",()=>{string file=Pick("选择金蝶物料清单");if(file==null)return;var parsed=MaterialParser.Parse(file);int added=store.ImportMaterials(parsed);Materials();Detail("物料导入结果","新增 "+added+" 条；来源行 "+parsed.Rows.Count+" 条。\n原件已完整归档。\n"+string.Join("\n",parsed.Skipped),null);}));content.Children.Add(Label("本页保留金蝶原名称；商品名称对应表单独管理。编码检索值去除空格，原编码不改写。\n原表未提供的启用／禁用状态保持未知；导入不代表物料已启用。"));var rows=store.Materials();var indexed=rows.ToDictionary(x=>x.Id);Table(rows.Select(MaterialMap).ToList(),record=>{var r=indexed[record["__materialId"]];Detail("物料详情 · "+r.Values["物料编码"],string.Join("\n\n",record.Where(x=>!x.Key.StartsWith("__")).Select(x=>x.Key+"："+x.Value))+"\n\n原始物料编码："+r.Values["物料编码"]+"\n来源文件："+r.File+"\n工作表："+r.Sheet+"\n行号："+r.Row+"\n来源哈希："+r.Hash+"\n无空格检索编码："+r.Code+"\n来源公式："+string.Join("；",r.Formulas.Select(x=>x.Key+"="+x.Value))+"\n\n字段类型（原 OOXML）\n"+string.Join("；",r.Types.Where(x=>x.Value!="").Select(x=>x.Key+"="+x.Value)),()=>{var d=new Microsoft.Win32.SaveFileDialog{Title="保存原物料清单副本",FileName=Path.GetFileNameWithoutExtension(r.File)+"-副本.xlsx",Filter="Excel (*.xlsx)|*.xlsx"};if(d.ShowDialog()==true)store.CopyOriginal(new PriceRow{Hash=r.Hash},d.FileName);});});}
  static Dictionary<string,string> MaterialMap(MaterialRow r){var map=new Dictionary<string,string>(r.Values);map["物料编码"]=r.Code;map["__materialId"]=r.Id;return map;}
 }
}
