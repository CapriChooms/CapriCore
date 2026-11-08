// SPDX-License-Identifier: GPL-3.0-only
// An isolated input target. Never operates on an owner's application or files.
using System;
using System.IO;
using System.Windows.Forms;
using System.Runtime.InteropServices;
class ComputerControlFixture {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  static string log;
  static void Record(string line) { File.AppendAllText(log,line+"\n"); }
  [STAThread] static void Main(string[] args) {
    log=args[0]; var form=new Form{Text="Capri isolated input verification",Width=600,Height=360,TopMost=Array.IndexOf(args,"--normal-layer")<0,KeyPreview=true};
    var field=new TextBox{Left=20,Top=25,Width=410,AccessibleName="Verification text"};
    var button=new Button{Left=20,Top=85,Width=180,Height=45,Text="Verification click",AccessibleName="Verification click"};
    var paste=new TextBox{Left=20,Top=160,Width=180,AccessibleName="Verification paste"};
    var clip=new Button{Left=250,Top=85,Width=180,Height=45,Text="Clip source",AccessibleName="Clip source"};
    var timeline=new Label{Left=250,Top=165,Width=240,Height=80,Text="Timeline drop zone",AccessibleName="Timeline drop zone",AllowDrop=true,BorderStyle=BorderStyle.FixedSingle};
    var doubleTarget=new Label{Left=20,Top=240,Width=180,Height=40,Text="Double click target",AccessibleName="Double click target",BorderStyle=BorderStyle.FixedSingle};
    doubleTarget.DoubleClick+=(s,e)=>Record("double-click");
    doubleTarget.MouseUp+=(s,e)=>{if(e.Button==MouseButtons.Right)Record("right-click");if(e.Button==MouseButtons.Middle)Record("middle-click");};
    var menu=new ContextMenuStrip();menu.Items.Add("Insert verification clip",null,(s,e)=>Record("menu-action"));doubleTarget.ContextMenuStrip=menu;
    form.Controls.Add(field);form.Controls.Add(button);form.Controls.Add(paste);form.Controls.Add(clip);form.Controls.Add(timeline);form.Controls.Add(doubleTarget);
    clip.MouseDown+=(s,e)=>{if(e.Button==MouseButtons.Left){Record("drag-ctrl:"+((Control.ModifierKeys&Keys.Control)!=0));clip.DoDragDrop("Capri test clip",DragDropEffects.Copy);}};
    timeline.DragEnter+=(s,e)=>{if(e.Data.GetDataPresent(DataFormats.Text))e.Effect=DragDropEffects.Copy;};
    timeline.DragDrop+=(s,e)=>{if((string)e.Data.GetData(DataFormats.Text)=="Capri test clip"){timeline.Text="Clip placed";timeline.AccessibleName="Clip placed";Record("drop");}};
    paste.TextChanged+=(s,e)=>Record("paste:"+paste.Text);
    if(Array.IndexOf(args,"--clipboard")>=0){
      var backup=new DataObject();var old=Clipboard.GetDataObject();if(old!=null)foreach(var format in old.GetFormats(false))backup.SetData(format,false,old.GetData(format,false));
      form.FormClosed+=(s,e)=>{for(int attempt=0;attempt<20;attempt++){try{if(backup.GetFormats(false).Length==0)Clipboard.Clear();else Clipboard.SetDataObject(backup,true);Record("clipboard-restored");return;}catch(ExternalException){System.Threading.Thread.Sleep(50);}}Record("clipboard-restore-failed");};
      if(Array.IndexOf(args,"--synthetic-clipboard")>=0)Clipboard.SetText("Capri verification sentinel");
      foreach(Control item in form.Controls)item.MouseMove+=(s,e)=>Record("move:"+Cursor.Position.X+","+Cursor.Position.Y);
    }
    form.KeyDown+=(s,e)=>Record("down:"+e.KeyCode);form.KeyUp+=(s,e)=>Record("up:"+e.KeyCode);
    field.TextChanged+=(s,e)=>Record("text:"+field.Text);
    field.KeyUp+=(s,e)=>{if(e.KeyCode==Keys.A)Record("select:"+field.SelectionLength+":ctrl:"+e.Control);if(e.KeyCode==Keys.C)Record("copy-selection:"+field.SelectionLength+":matches:"+(Clipboard.ContainsText()&&Clipboard.GetText()=="Capri workflow"));};
    button.Click+=(s,e)=>{Record("click");button.Text="Draft saved";button.AccessibleName="Draft saved";};
    form.Shown+=(s,e)=>{SetForegroundWindow(form.Handle);field.Focus();Record("ready");};
    var timer=new Timer{Interval=300000};timer.Tick+=(s,e)=>form.Close();timer.Start();
    Application.Run(form);
  }
}
