using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using System.Collections.Generic;

namespace DoonPanelPreview {
 public static class CodingTests {
  static int count;static void Check(bool ok,string name){count++;if(!ok)throw new Exception("Coding test failed: "+name);}
  static readonly XNamespace N="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  static XElement Cell(string address,string value){return new XElement(N+"c",new XAttribute("r",address),new XAttribute("t","inlineStr"),new XElement(N+"is",new XElement(N+"t",value)));}
  internal static byte[] Fixture(bool revision=false,bool invalid=false){using(var output=new MemoryStream()){using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){
   Action<string,string> add=(path,xml)=>{using(var writer=new StreamWriter(zip.CreateEntry(path).Open(),new UTF8Encoding(false)))writer.Write(xml);};
   add("xl/workbook.xml","<workbook xmlns='"+N+"' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'><sheets><sheet name='合成成品编码规则' sheetId='1' r:id='rId1'/><sheet name='合成半成品编码规则' sheetId='2' r:id='rId2'/></sheets></workbook>");
   add("xl/_rels/workbook.xml.rels","<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Target='worksheets/sheet1.xml'/><Relationship Id='rId2' Target='worksheets/sheet2.xml'/></Relationships>");
   add("xl/worksheets/sheet2.xml",new XElement(N+"worksheet",new XElement(N+"sheetData",new XElement(N+"row",new XAttribute("r",1),Cell("A1","合成半成品，不作成品规则")))).ToString());var data=new XElement(N+"sheetData");var headers=new[]{"成品类别名称","规则","成品类别代码","客户代码","图纸号","客款号","板料编码","电镀颜色","色号","编码示例","备注"};
   data.Add(new XElement(N+"row",new XAttribute("r",2),headers.Select((v,i)=>Cell(XlsxSource.Address(2,i+2),v))));
   string board="客户代码+图纸号+客款号+板料编码+色号",plating="客户代码+图纸号+客款号+电镀颜色+色号";
   data.Add(new XElement(N+"row",new XAttribute("r",3),Cell("B3",revision?"合成修订":"合成类别"),Cell("C3","X+"+(invalid?"未知规则":board)),Cell("D3","X"),Cell("E3","C999"),Cell("G3","Model 01"),Cell("H3","B01"),Cell("J3","C01"),Cell("K3","X-C999-Model 01-B01-C01")));
   data.Add(new XElement(N+"row",new XAttribute("r",4),Cell("B4","合成电镀"),Cell("C4","Z+"+plating),Cell("D4","Z"),Cell("K4","Z/SUN-C999-DN9002-Metal 01-测试色-C2-2")));
   data.Add(new XElement(N+"row",new XAttribute("r",5),Cell("B5","合成复合"),Cell("C5","GJ-X+Y+"+board),Cell("D5","GJ-X+Y")));
   data.Add(new XElement(N+"row",new XAttribute("r",9),Cell("C9","成品不同类别分开做销售订单")));
   add("xl/worksheets/sheet1.xml",new XElement(N+"worksheet",data,new XElement(N+"mergeCells",new XElement(N+"mergeCell",new XAttribute("ref","C9:L9")))).ToString());
  }return output.ToArray();}}
  public static int Run(){count=0;var file=CodingParser.Parse(Fixture(),"synthetic-rules.xlsx");Check(file.Rules.Count==3,"rules and merged footer");Check(file.Rules[0].MiddleField=="板料编码"&&file.Rules[1].MiddleField=="电镀颜色","branch semantics");Check(file.Rules[0].Reference.Contains("〈图纸号待填写〉"),"missing drawing explicit placeholder");Check(file.Rules[1].Reference=="Z-C999-DN9002-Metal01-测试色-C2-2","example prefix and whitespace corrected");Check(file.Rules[1].Example.StartsWith("Z/SUN-"),"original example retained");
   var frames=new[]{new ProductName{Code="X",Name="合成镜架",Source="合成依据"},new ProductName{Code="Z",Name="合成金属镜架",Source="合成依据"}};
   var lenses=new[]{new LensNameRule{Keyword="测试片",Name="合成镜片",Source="合成依据"}};
   var input=new CodingInput{Category="X",Customer=" C999 ",Drawing="DN 9001",Model="Model 01",Middle="B 01",Color="C2-2",FrameMaterial="X",Lens="强化测试片"};
   var result=CodingEngine.Generate(input,file.Rules,frames,lenses);Check(result.Code=="X-C999-DN9001-Model01-B01-C2-2","six segments no spaces preserves inner hyphen");Check(result.Name=="合成镜架（合成镜片）","keyword compound name");Check(CodingEngine.Matches(" x - c999 - dn9001 - model01 - b01 - c2-2 ",result),"validation explicit inputs");input.Drawing="";Check(!CodingEngine.Generate(input,file.Rules,frames,lenses).Valid,"drawing required");input.Drawing="〈图纸号待填写〉";Check(!CodingEngine.Generate(input,file.Rules,frames,lenses).Valid,"placeholder blocked");input.Drawing="DN9001";input.Category="X/SUN";Check(!CodingEngine.Generate(input,file.Rules,frames,lenses).Valid,"unconfigured alias blocked");input.Category="GJ-X+Y";Check(CodingEngine.Generate(input,file.Rules,frames,lenses).Code.StartsWith("GJ-X+Y-"),"compound prefix preserved");
   Check(NameComposer.Compose("X","测试片",frames,lenses).Value==result.Name,"literal keyword");Check(NameComposer.Compose("X","强化测试片",frames,lenses).Value==result.Name,"substring keyword");Check(NameComposer.Compose("Z","测试片",frames,lenses).Value=="合成金属镜架（合成镜片）","frame-specific naming");Check(NameComposer.Compose("UNKNOWN","测试片",frames,lenses).Value=="","unknown frame");Check(NameComposer.Compose("X","太阳测试",frames,lenses).Value=="","unknown lens");Check(NameComposer.Compose("X","",frames,lenses).Value=="","blank lens");Check(NameComposer.Compose("X","非测试片",frames,lenses).Value=="","negated keyword");Check(NameComposer.Compose("X","测试片/其他片",frames,lenses).Value=="","alternatives not guessed");Check(NameComposer.Compose("X","强化测试片",frames,lenses.Concat(new[]{new LensNameRule{Keyword="强化",Name="不同镜片",Source="合成依据"}})).Value=="","conflicting keywords");
   var sun=new[]{new LensNameRule{Keyword="太阳测试",Name="合成太阳镜片",Source="合成依据"},new LensNameRule{Keyword="SYNTHSUN",Name="合成太阳镜片",Source="合成依据"}};Check(NameComposer.Compose("X","强化太阳测试",frames,sun).Value=="合成镜架（合成太阳镜片）","sun substring");Check(NameComposer.Compose("X","sYnThSuN tint",frames,sun).Value=="合成镜架（合成太阳镜片）","sun case insensitive");Check(NameComposer.Compose("X","太阳测试 SYNTHSUN",frames,sun).Value=="合成镜架（合成太阳镜片）","aliases same result");Check(NameComposer.Compose("X","测试片 SYNTHSUN",frames,lenses.Concat(sun)).Value=="","white sun conflict");Check(NameComposer.Compose("X","太阳测试/SYNTHSUN",frames,sun).Value=="合成镜架（合成太阳镜片）","aliases separated by slash");bool rejected=false;try{CodingParser.Parse(Fixture(false,true),"invalid.xlsx");}catch(InvalidDataException){rejected=true;}Check(rejected,"unsupported rule atomic failure");
   string root=Path.Combine(Path.GetTempPath(),"doon-coding-test-"+Guid.NewGuid().ToString("N"));try{using(var db=new PriceStore(root)){
    var price=PriceParser.Parse(SelfTests.Workbook(),"synthetic-prices.xlsx");db.Import(price);string before=PriceParser.Json.Serialize(db.All());
    Check(db.ImportCoding(file)==3&&db.ImportCoding(file)==0,"rule idempotency");Check(db.CodingRules().Count==3,"rule storage");var revised=CodingParser.Parse(Fixture(true),"synthetic-rules.xlsx");Check(db.ImportCoding(revised)==3&&db.CodingRules().All(r=>r.Hash==revised.Hash),"latest version");Check(db.ImportCoding(file)==0&&db.CodingRules()[0].Hash==revised.Hash,"old reimport does not revert active version");Check(File.Exists(Path.Combine(root,"originals",file.Hash+".xlsx")),"old original retained");
    string json=Path.Combine(root,"lenses.json");File.WriteAllText(json,PriceParser.Json.Serialize(lenses));Check(db.ImportLensRules(json)==1&&db.ImportLensRules(json)==0,"lens rule idempotency");Check(db.LensRules()[0].Keyword=="测试片","lens persistence");Check(PriceParser.Json.Serialize(db.All())==before,"existing prices preserved");Check(db.Integrity()=="ok","integrity");
   }}finally{string full=Path.GetFullPath(root);if(full.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(full).StartsWith("doon-coding-test-"))Directory.Delete(full,true);}
   return count;
  }
 }
}
