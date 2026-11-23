// SPDX-License-Identifier: GPL-3.0-only
// Disposable local UI target. It has no Discord library, account or network use.
using System;
using System.IO;
using System.Text;
using System.Security.Cryptography;
using System.Windows.Forms;
using System.Runtime.InteropServices;

class DiscordControlFixture {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle,out uint processId);
  static string log;
  static void Record(string line) { File.AppendAllText(log,line+"\n"); }
  static string Hash(string value) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant(); }
  static GroupBox Group(string title,int left,int top,int width,int height) { return new GroupBox { Text=title,AccessibleName=title,Left=left,Top=top,Width=width,Height=height }; }
  static Button Button(string title,int left,int top,int width) { return new Button { Text=title,AccessibleName=title,Left=left,Top=top,Width=width,Height=34 }; }
  [STAThread] static void Main(string[] args) {
    if(args.Length==2&&args[0]=="--assert-foreground"){
      uint processId;GetWindowThreadProcessId(GetForegroundWindow(),out processId);
      Environment.ExitCode=processId.ToString()==args[1]?0:1;return;
    }
    log=args[0];
    var form=new Form { Text="#general | Test Server - Discord",Width=960,Height=690,TopMost=true,KeyPreview=true,StartPosition=FormStartPosition.CenterScreen };
    var servers=Group("Servers sidebar",15,15,190,95);
    var server=Button("Test Server",15,30,160);servers.Controls.Add(server);
    var channels=Group("Channels",15,125,190,180);
    var textChannel=Button("general (text channel)",15,35,160);
    var voiceChannel=Button("Lounge (voice channel)",15,85,160);
    channels.Controls.Add(textChannel);channels.Controls.Add(voiceChannel);
    var content=Group("Channel content",220,15,700,425);
    var composer=new TextBox { Left=20,Top=365,Width=650,Height=30,AccessibleName="Message #general",MaxLength=4000 };
    content.Controls.Add(composer);
    var voice=Group("Voice panel",220,455,490,145);
    var join=Button("Join Voice",20,35,140);
    var status=new Label { Left=20,Top=28,Width=410,Height=25,Text="Voice Connected",AccessibleName="Voice Connected",Visible=false };
    var connection=new Label { Left=20,Top=56,Width=410,Height=25,Text="Lounge / Test Server",AccessibleName="Lounge / Test Server",Visible=false };
    var disconnect=Button("Disconnect",20,87,140);disconnect.Visible=false;join.Visible=false;
    voice.Controls.Add(join);voice.Controls.Add(status);voice.Controls.Add(connection);voice.Controls.Add(disconnect);
    var user=Group("User area",725,455,195,145);
    var settings=Button("User Settings",15,30,160);user.Controls.Add(settings);
    var large=Button("Large layout",15,85,160);user.Controls.Add(large);
    form.Controls.Add(servers);form.Controls.Add(channels);form.Controls.Add(content);form.Controls.Add(voice);form.Controls.Add(user);
    bool connected=false;int sent=0;
    Action showText=()=>{form.Text="#general | Test Server - Discord";composer.Visible=true;join.Visible=false;composer.Focus();};
    server.Click+=(s,e)=>{Record("server");showText();};
    textChannel.Click+=(s,e)=>{Record("text-channel");showText();};
    voiceChannel.Click+=(s,e)=>{Record("voice-channel");form.Text="Lounge | Test Server - Discord";composer.Visible=false;join.Visible=!connected;};
    join.Click+=(s,e)=>{connected=true;join.Visible=false;status.Visible=true;connection.Visible=true;disconnect.Visible=true;Record("join");};
    disconnect.Click+=(s,e)=>{connected=false;status.Visible=false;connection.Visible=false;disconnect.Visible=false;join.Visible=false;showText();Record("leave");};
    composer.KeyDown+=(s,e)=>{
      if(e.KeyCode!=Keys.Enter||e.Modifiers!=Keys.None)return;
      e.Handled=true;e.SuppressKeyPress=true;
      string message=composer.Text;if(message.Length==0)return;
      var posted=new Label { Left=20,Top=35+(sent%3)*100,Width=650,Height=95,Text=message,AccessibleName=message,BorderStyle=BorderStyle.FixedSingle };
      content.Controls.Add(posted);posted.BringToFront();sent++;composer.Clear();Record("send:"+sent+":"+Hash(message));
    };
    large.Click+=(s,e)=>{
      var noise=Group("Synthetic layout budget",220,15,700,425);
      var nestedParent=noise;
      for(int level=0;level<8;level++){
        var nested=Group(level+new string((char)0x754c,96),2,16,690-level*5,405-level*19);
        nestedParent.Controls.Add(nested);nestedParent=nested;
      }
      for(int i=0;i<185;i++){
        string label="Synthetic "+i+new string((char)0x754c,96);
        nestedParent.Controls.Add(new Label { Text=label,AccessibleName=label,Left=10+(i%10)*60,Top=18+(i/10)*10,Width=58,Height=9 });
      }
      form.Controls.Add(noise);noise.BringToFront();Record("large-layout");
    };
    form.Shown+=(s,e)=>{SetForegroundWindow(form.Handle);composer.Focus();Record("ready");};
    var timer=new Timer { Interval=180000 };timer.Tick+=(s,e)=>form.Close();timer.Start();
    Application.Run(form);
  }
}
