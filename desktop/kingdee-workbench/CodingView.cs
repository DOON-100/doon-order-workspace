using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace DoonPanelPreview {
 public sealed partial class Workbench {
  void CodingView(PriceRow source=null){
   Heading("成品编码规则与生成","类别－客户代码－图纸号－客款号－板料编码或电镀颜色－色号；所有段去除多余空格，保留段内 +、/、-。");
   var actions=new WrapPanel();actions.Children.Add(Btn("查看规则库",CodingLibrary));actions.Children.Add(Btn("导入规则 Excel",()=>{string file=Pick("选择含成品编码规则的工作簿");if(file==null)return;var parsed=CodingParser.Parse(file);int added=store.ImportCoding(parsed);CodingView(source);Detail("规则导入完成","新增 "+added+" 条规则。\n原件完整归档；旧规则版本保留。",null);}));content.Children.Add(actions);
   var rules=store.CodingRules();if(rules.Count==0){content.Children.Add(Label("尚未导入成品编码规则，请先选择规则工作簿。"));return;}
   content.Children.Add(Label("当前来源："+rules[0].File+" / "+rules[0].Sheet+" · "+rules.Count+" 类规则。不同类别须分开做销售订单。"));
   if(source!=null)content.Children.Add(Label("订单来源："+source.File+" / "+source.Sheet+" 第 "+source.Row+" 行。\n原图纸："+source.RawDrawing+"；原款号："+source.RawModel+"。当前价格记录状态："+source.Status));
   var selector=new ComboBox{ItemsSource=rules,DisplayMemberPath="Label",SelectedIndex=-1,MinWidth=300,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,4,0,12)};content.Children.Add(Label("成品类别（请选择，不自动猜测）"));content.Children.Add(selector);
   var fields=new[]{"客户代码","图纸号","客款号","板料编码","色号"};var boxes=new TextBox[5];var labels=new TextBlock[5];
   bool prefill=source!=null&&!(source.Status??"").Contains("识别字段含公式");
   string[] initial=prefill?new[]{source.Customer,source.Drawing,source.Model,"",source.Color}:new[]{"","","","",""};
   var form=new Grid();form.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(155)});form.ColumnDefinitions.Add(new ColumnDefinition());
   for(int i=0;i<fields.Length;i++){form.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});labels[i]=Label(fields[i]);boxes[i]=new TextBox{Text=initial[i],Padding=new Thickness(8),Margin=new Thickness(0,3,0,8)};Grid.SetRow(labels[i],i);Grid.SetRow(boxes[i],i);Grid.SetColumn(boxes[i],1);form.Children.Add(labels[i]);form.Children.Add(boxes[i]);}content.Children.Add(form);
   var frameNames=store.Names();var frame=new ComboBox{ItemsSource=frameNames.Select(x=>x.Code).ToList(),IsEditable=true,MinWidth=300,HorizontalAlignment=HorizontalAlignment.Left,Margin=new Thickness(0,4,0,10)};
   var lens=new TextBox{Text=prefill?(source.Lens??""):"",Padding=new Thickness(8),Margin=new Thickness(0,4,0,10)};
   content.Children.Add(Label("镜架材质（用于商品名称）"));content.Children.Add(frame);content.Children.Add(Label("镜片描述（按关键词匹配）"));content.Children.Add(lens);
   var ruleText=Label("");content.Children.Add(ruleText);var resultText=new TextBox{IsReadOnly=true,TextWrapping=TextWrapping.Wrap,MinHeight=80,Padding=new Thickness(12),Margin=new Thickness(0,12,0,12)};var status=Label("填写全部字段后生成候选编码。缺项不会被省略。商品名称按镜架材质与镜片关键词组合。");
   CodingResult generated=null;List<MaterialRow> materialMatches=new List<MaterialRow>();
   var copy=Btn("复制生成编码",()=>{if(generated!=null&&generated.Valid)Clipboard.SetText(generated.Code);});copy.IsEnabled=false;
   var copyName=Btn("复制商品名称",()=>{if(generated!=null&&generated.Name!="")Clipboard.SetText(generated.Name);});copyName.IsEnabled=false;
   var existing=new TextBox{Padding=new Thickness(8),Margin=new Thickness(0,4,0,10)};
   Action invalidate=()=>{generated=null;materialMatches.Clear();resultText.Text="";status.Text="字段已变化，请重新生成并核对。";copy.IsEnabled=false;copyName.IsEnabled=false;};
   foreach(var box in boxes)box.TextChanged+=(s,e)=>invalidate();
   lens.TextChanged+=(s,e)=>invalidate();frame.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent,new TextChangedEventHandler((s,e)=>invalidate()));frame.SelectionChanged+=(s,e)=>invalidate();
   Action selected=()=>{var rule=selector.SelectedItem as CodingRule;if(rule==null){labels[3].Text="先选类别";ruleText.Text="请选择成品类别，以确定第五段使用板料编码还是电镀颜色。";invalidate();return;}labels[3].Text=rule.MiddleField;frame.Text=frameNames.Any(n=>PriceParser.Key(n.Code)==PriceParser.Key(rule.Category))?rule.Category:"";ruleText.Text=rule.Rule+"\n标准模板："+rule.Template+"\n参考示例："+rule.Reference+"\n"+rule.Notes;invalidate();};
   selector.SelectionChanged+=(s,e)=>{boxes[3].Clear();selected();};selected();
   var commands=new WrapPanel();commands.Children.Add(Btn("生成并查询物料库",()=>{
    var rule=selector.SelectedItem as CodingRule;if(rule==null)throw new InvalidDataException("请先选择成品类别。");var current=store.CodingRules();if(!current.Any(r=>r.Category==rule.Category&&r.Hash==rule.Hash))throw new InvalidDataException("规则版本已变化，请重新打开编码页面。");
    generated=CodingEngine.Generate(new CodingInput{Category=rule.Category,Customer=boxes[0].Text,Drawing=boxes[1].Text,Model=boxes[2].Text,Middle=boxes[3].Text,Color=boxes[4].Text,FrameMaterial=frame.Text,Lens=lens.Text},current,store.Names(),store.LensRules());
    if(!generated.Valid){resultText.Text=string.Join("\n",generated.Errors);status.Text="缺少依据，未生成编码。";copy.IsEnabled=false;return;}
    materialMatches=store.FindMaterialCode(generated.Code);resultText.Text=generated.Code+"\n"+generated.Name;
    status.Text="商品名称："+(generated.Name==""?string.Join("；",generated.NameIssues):generated.Name)+"\n"+(materialMatches.Count==0?"金蝶清单无同码记录：候选新编码，尚未建物料。":"金蝶物料库命中 "+materialMatches.Count+" 条来源；请查看详情，原名称不会被覆盖。")+"\n规则依据："+generated.Source+"\n此处仅生成与校验编码，不写入金蝶。";copy.IsEnabled=true;copyName.IsEnabled=generated.Name!="";
   }));commands.Children.Add(copy);commands.Children.Add(copyName);commands.Children.Add(Btn("查看同码物料",()=>{if(generated==null||!generated.Valid)throw new InvalidDataException("请先生成编码。");Detail("同码物料来源",materialMatches.Count==0?"当前物料库没有同码记录。":string.Join("\n\n",materialMatches.Select(m=>string.Join("\n",m.Values.Select(v=>v.Key+"："+v.Value))+"\n来源："+m.File+" / "+m.Sheet+" 第 "+m.Row+" 行")),null);}));content.Children.Add(commands);content.Children.Add(resultText);content.Children.Add(status);
   content.Children.Add(Label("已有编码校验（按上方已填写的各段核对，不猜测内部连字符含义）"));content.Children.Add(existing);content.Children.Add(Btn("校验已有编码",()=>{if(generated==null||!generated.Valid)throw new InvalidDataException("请先按明确字段生成编码。");Detail("编码校验",CodingEngine.Matches(existing.Text,generated)?"与当前分段生成结果一致（忽略空格和字母大小写）。":"与当前分段生成结果不同，请核对各段；现有码不会被改写。",null);}));
  }
  void CodingLibrary(){var rules=store.CodingRules();Heading("成品编码规则库",rules.Count+" 类规则 · 原文、示例、备注与来源位置可追溯 · 最新导入版本用于生成，历史版本不覆盖");content.Children.Add(Btn("返回编码生成",()=>CodingView()));Table(rules.Select(r=>new Dictionary<string,string>{{"类别",r.Category},{"类别原名",r.Name},{"第五段",r.MiddleField},{"编码规则",r.Rule},{"标准模板",r.Template},{"修正参考",r.Reference},{"原示例",r.Example},{"提示",r.Notes},{"来源",r.File},{"工作表",r.Sheet},{"行号",r.Row.ToString()}}).ToList(),row=>{var rule=rules.Single(r=>r.Category==row["类别"]);Detail("规则详情 · "+rule.Category,string.Join("\n\n",row.Select(x=>x.Key+"："+x.Value))+"\n\n附加要求\n"+rule.Requirements+"\n\n商品名称使用独立名称对应表；原类别名称保留。",()=>{var d=new SaveFileDialog{Title="保存编码规则原件副本",FileName=Path.GetFileNameWithoutExtension(rule.File)+"-副本.xlsx",Filter="Excel (*.xlsx)|*.xlsx"};if(d.ShowDialog()==true)store.CopyOriginal(new PriceRow{Hash=rule.Hash},d.FileName);});});}
 }
}
