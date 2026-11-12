using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DoonPanelPreview {
 // Windows 10/11 system SQLite. Parameters are always bound, never interpolated.
 public sealed partial class PriceStore : IDisposable {
  IntPtr db; public readonly string DirectoryPath;
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)] static extern int sqlite3_open16(string name,out IntPtr db);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)] static extern int sqlite3_prepare16_v2(IntPtr db,string sql,int bytes,out IntPtr stmt,IntPtr tail);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl,CharSet=CharSet.Unicode)] static extern int sqlite3_bind_text16(IntPtr stmt,int index,string value,int bytes,IntPtr destructor);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr stmt);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr stmt);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text16(IntPtr stmt,int column);
  [DefaultDllImportSearchPaths(DllImportSearchPath.System32),DllImport("winsqlite3.dll",CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_column_count(IntPtr stmt);
  public PriceStore(string directory){DirectoryPath=Path.GetFullPath(directory);Directory.CreateDirectory(DirectoryPath);int rc=sqlite3_open16(Path.Combine(DirectoryPath,"prices.sqlite3"),out db);if(rc!=0){Dispose();throw new IOException("无法打开本地价格库，错误码 "+rc);}try{Run("PRAGMA busy_timeout=5000");Run("PRAGMA foreign_keys=ON");Run("CREATE TABLE IF NOT EXISTS sources(hash TEXT PRIMARY KEY,filename TEXT NOT NULL,imported_at TEXT NOT NULL,parser TEXT NOT NULL)");Run("CREATE TABLE IF NOT EXISTS price_records(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL REFERENCES sources(hash),customer TEXT NOT NULL,drawing TEXT NOT NULL,color TEXT NOT NULL,sheet TEXT NOT NULL,row_number INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(source_hash,sheet,row_number))");Run("CREATE INDEX IF NOT EXISTS price_lookup ON price_records(customer,drawing,color)");NamesSchema();MaterialsSchema();}catch{Dispose();throw;}}
  List<string[]> Run(string sql,params string[] values){IntPtr st;int rc=sqlite3_prepare16_v2(db,sql,-1,out st,IntPtr.Zero);if(rc!=0)throw new IOException("价格库语句失败，错误码 "+rc);try{for(int i=0;i<values.Length;i++){rc=sqlite3_bind_text16(st,i+1,values[i]??"",-1,new IntPtr(-1));if(rc!=0)throw new IOException("价格库参数失败，错误码 "+rc);}var rows=new List<string[]>();while((rc=sqlite3_step(st))==100){var row=new string[sqlite3_column_count(st)];for(int c=0;c<row.Length;c++)row[c]=Marshal.PtrToStringUni(sqlite3_column_text16(st,c))??"";rows.Add(row);}if(rc!=101)throw new IOException("价格库读写失败，错误码 "+rc);return rows;}finally{sqlite3_finalize(st);}}
  public List<PriceRow> All(){return Run("SELECT payload FROM price_records ORDER BY customer,source_hash,sheet,row_number").Select(x=>PriceParser.Json.Deserialize<PriceRow>(x[0])).ToList();}
  public int Import(ParsedFile file){
   if(file.Rows.Count==0)throw new InvalidDataException("没有识别到可保存的价格明细，请先核对文件格式。");
   if(PriceParser.Hash(file.Bytes)!=file.Hash)throw new InvalidDataException("来源校验失败。");
   string originals=Path.Combine(DirectoryPath,"originals");Directory.CreateDirectory(originals);string archive=Path.Combine(originals,file.Hash+".xlsx");
   if(!File.Exists(archive)){using(var f=new FileStream(archive,FileMode.CreateNew,FileAccess.Write,FileShare.None)){f.Write(file.Bytes,0,file.Bytes.Length);f.Flush(true);}}
   if(PriceParser.Hash(File.ReadAllBytes(archive))!=file.Hash)throw new IOException("归档原件哈希不一致，已停止写入。");
   Run("BEGIN IMMEDIATE");try{if(Run("SELECT hash FROM sources WHERE hash=?",file.Hash).Count>0){Run("COMMIT");return 0;}
    Run("INSERT INTO sources VALUES(?,?,?,?)",file.Hash,file.Name,DateTime.UtcNow.ToString("o"),PriceParser.Version);
    foreach(var p in file.Rows)Run("INSERT INTO price_records VALUES(?,?,?,?,?,?,?,?)",p.Id,file.Hash,p.Customer,p.Drawing,p.Color,p.Sheet,p.Row.ToString(System.Globalization.CultureInfo.InvariantCulture),PriceParser.Json.Serialize(p));Run("COMMIT");return file.Rows.Count;
   }catch{Run("ROLLBACK");throw;}
  }
  public void CopyOriginal(PriceRow row,string destination){if(!System.Text.RegularExpressions.Regex.IsMatch(row.Hash??"","^[a-f0-9]{64}$"))throw new InvalidDataException("原件标识无效。");string source=Path.Combine(DirectoryPath,"originals",row.Hash+".xlsx");byte[] bytes=File.ReadAllBytes(source);if(PriceParser.Hash(bytes)!=row.Hash)throw new IOException("原件校验失败。");using(var f=new FileStream(destination,FileMode.CreateNew,FileAccess.Write)){f.Write(bytes,0,bytes.Length);}}
  public string Integrity(){return Run("PRAGMA integrity_check")[0][0];}
  public void Dispose(){if(db!=IntPtr.Zero){sqlite3_close(db);db=IntPtr.Zero;}}
 }
}
