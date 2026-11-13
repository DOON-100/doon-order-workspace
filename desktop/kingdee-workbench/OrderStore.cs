using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public sealed partial class PriceStore {
  void ExportSchema(){
   Run("CREATE TABLE IF NOT EXISTS export_templates(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,hash TEXT NOT NULL,filename TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(kind,hash))");
   Run("CREATE TABLE IF NOT EXISTS order_draft_versions(id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,PRIMARY KEY(id,version))");
   Run("CREATE TABLE IF NOT EXISTS order_exports(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,review_hash TEXT NOT NULL,file_hash TEXT NOT NULL,filename TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL)");
  }
  public static string Actor {get{return System.Security.Principal.WindowsIdentity.GetCurrent().Name;}}
  public void ArchiveOrder(ParsedFile file){ArchiveBytes("originals",file.Hash,file.Bytes);}
  void ArchiveBytes(string folder,string hash,byte[] bytes){
   if(PriceParser.Hash(bytes)!=hash)throw new InvalidDataException("归档内容校验不符。");
   string dir=Path.Combine(DirectoryPath,folder);Directory.CreateDirectory(dir);string path=Path.Combine(dir,hash+".xlsx");
   if(!File.Exists(path))using(var f=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None)){f.Write(bytes,0,bytes.Length);f.Flush(true);}
   if(PriceParser.Hash(File.ReadAllBytes(path))!=hash)throw new InvalidDataException("已存原件校验失败。");
  }
  public TemplateInfo InstallTemplate(string path,string kind){var bytes=XlsxSource.ReadFile(path);var info=KingdeeTemplate.Inspect(bytes,kind,Path.GetFileName(path));ArchiveBytes("templates",info.Hash,bytes);Run("INSERT OR IGNORE INTO export_templates(kind,hash,filename,created_at) VALUES(?,?,?,?)",kind,info.Hash,info.File,DateTime.UtcNow.ToString("o"));return info;}
  public TemplateInfo CurrentTemplate(string kind){var rows=Run("SELECT hash,filename FROM export_templates WHERE kind=? ORDER BY seq DESC LIMIT 1",kind);if(rows.Count==0)return null;var bytes=File.ReadAllBytes(Path.Combine(DirectoryPath,"templates",rows[0][0]+".xlsx"));if(PriceParser.Hash(bytes)!=rows[0][0])throw new IOException("本地模板校验失败。");return KingdeeTemplate.Inspect(bytes,kind,rows[0][1]);}
  public byte[] TemplateBytes(TemplateInfo info){var bytes=File.ReadAllBytes(Path.Combine(DirectoryPath,"templates",info.Hash+".xlsx"));if(PriceParser.Hash(bytes)!=info.Hash)throw new IOException("模板已改变。");return bytes;}
  public OrderContext OrderContext(){var ctx=new OrderContext{Prices=All(),Materials=Materials(),Rules=CodingRules(),Names=Names(),Lenses=LensRules(),SalesTemplate=CurrentTemplate("sales"),MaterialTemplate=CurrentTemplate("material")};
   // Hash each row independently; the material catalogue can exceed the JSON document limit.
   var fingerprints=ctx.Prices.Cast<object>().Concat(ctx.Materials).Concat(ctx.Rules).Concat(ctx.Names).Concat(ctx.Lenses).Select(o=>PriceParser.Hash(Encoding.UTF8.GetBytes(PriceParser.Json.Serialize(o))));
   ctx.Fingerprint=PriceParser.Hash(Encoding.UTF8.GetBytes("order-export-v1\n"+string.Join("\n",fingerprints)+"\n"+(ctx.SalesTemplate==null?"":ctx.SalesTemplate.Hash)+"\n"+(ctx.MaterialTemplate==null?"":ctx.MaterialTemplate.Hash)));ctx.MaterialCodes=ctx.Materials.Select(m=>new KeyValuePair<string,MaterialRow>(PriceParser.Key(m.Code),m)).ToList();return ctx;
  }
  public void SaveDraft(OrderDraft draft){Run("BEGIN IMMEDIATE");try{int current=int.Parse(Run("SELECT COALESCE(MAX(version),0) FROM order_draft_versions WHERE id=?",draft.Id)[0][0]);if(current!=draft.Version)throw new InvalidOperationException("此草稿已被另一个窗口更新，请重新打开后核对。");int next=current+1;var copy=PriceParser.Json.Deserialize<OrderDraft>(PriceParser.Json.Serialize(draft));copy.Version=next;Run("INSERT INTO order_draft_versions VALUES(?,?,?,?,?)",draft.Id,next.ToString(),PriceParser.Json.Serialize(copy),DateTime.UtcNow.ToString("o"),Actor);Run("COMMIT");draft.Version=next;}catch{Run("ROLLBACK");throw;}}
  public List<OrderDraft> Drafts(){return Run("SELECT v.payload FROM order_draft_versions v WHERE v.version=(SELECT MAX(x.version) FROM order_draft_versions x WHERE x.id=v.id) ORDER BY v.created_at DESC").Select(r=>PriceParser.Json.Deserialize<OrderDraft>(r[0])).ToList();}
  public void RecordExport(OrderDraft draft,string path,string hash){Run("INSERT INTO order_exports VALUES(?,?,?,?,?,?,?)",Guid.NewGuid().ToString("N"),draft.Id,draft.ReviewHash,hash,Path.GetFullPath(path),DateTime.UtcNow.ToString("o"),Actor);}
  public List<Dictionary<string,string>> ExportHistory(){return Run("SELECT draft_id,review_hash,file_hash,filename,created_at,actor FROM order_exports ORDER BY created_at DESC").Select(r=>new Dictionary<string,string>{{"文件",r[3]},{"时间",r[4]},{"操作者",r[5]},{"文件哈希",r[2]},{"核对指纹",r[1]},{"草稿",r[0]}}).ToList();}
 }
}
