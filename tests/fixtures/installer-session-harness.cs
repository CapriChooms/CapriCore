// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Text;
using System.Threading;
using Capri.Setup;
internal static class SessionHarness {
    private static int Main(string[] args) {
        string mode=args[0],folder=args[1];Directory.CreateDirectory(folder);
        if(mode=="guard") {
            using(WorkerGuard guard=new WorkerGuard(folder,1500))while(!File.Exists(Path.Combine(folder,"stop")))Thread.Sleep(50);
        }else if(mode=="ui") {
            using(UiLease lease=new UiLease(folder,0)) {
                File.WriteAllText(Path.Combine(folder,"ui-ready"),lease.Id);
                while(!File.Exists(Path.Combine(folder,"stop"))) {
                    if(!File.Exists(Path.Combine(folder,"hang")))lease.Heartbeat(!File.Exists(Path.Combine(folder,"hidden")));
                    if(File.Exists(Path.Combine(folder,"resume-request"))){lease.Control("resume");File.Delete(Path.Combine(folder,"resume-request"));}
                    Thread.Sleep(100);
                }
            }
        }else if(mode=="cursor") {
            string file=Path.Combine(folder,"events.jsonl");byte[] text=Encoding.UTF8.GetBytes("{\"type\":\"log\",\"message\":\"\u041f\u0440\u0438\u0432\u0435\u0442\"}\n");
            EventCursor cursor=new EventCursor(file);
            for(int index=0;index<text.Length;index++) {
                using(FileStream output=new FileStream(file,FileMode.Append))output.WriteByte(text[index]);
                string[] lines=cursor.Read();
                if(index<text.Length-1&&lines.Length!=0)return 2;
                if(index==text.Length-1&&(lines.Length!=1||lines[0]+"\n"!=Encoding.UTF8.GetString(text)))return 3;
            }
        }else if(mode=="resume-stale"||mode=="transient-stale") {
            using(UiLease lease=new UiLease(folder,0)) {
                SessionIO.Write(Path.Combine(folder,"ui-heartbeat.json"),new {id=lease.Id,at=DateTime.UtcNow.AddMinutes(-2).ToString("o"),connected=true});
                if(mode=="resume-stale") {
                    SessionIO.Pause(folder,"fixture-stale-heartbeat");
                    lease.Control("resume");
                    using(WorkerGuard guard=new WorkerGuard(folder,3000))Thread.Sleep(1100);
                }else {
                    using(WorkerGuard guard=new WorkerGuard(folder,1500)) {
                        Thread.Sleep(200);lease.Heartbeat();Thread.Sleep(650);
                    }
                }
                if(File.Exists(Path.Combine(folder,"pause")))return 2;
            }
        }else if(mode=="busy-control") {
            using(UiLease lease=new UiLease(folder,0)) {
                using(FileStream gate=SessionIO.Gate(Path.Combine(folder,"ui-control.lock"))) {
                    System.Diagnostics.Stopwatch watch=System.Diagnostics.Stopwatch.StartNew();
                    if(lease.Heartbeat())return 2;
                    if(watch.ElapsedMilliseconds>250)return 3;
                    using(WorkerGuard guard=new WorkerGuard(folder,3000))Thread.Sleep(650);
                    if(File.Exists(Path.Combine(folder,"pause")))return 4;
                }
                if(!lease.Heartbeat())return 5;
            }
        }else if(mode=="cursor-burst") {
            string file=Path.Combine(folder,"events.jsonl");StringBuilder text=new StringBuilder();
            for(int index=0;index<1200;index++)text.Append("{\"type\":\"log\",\"message\":\"").Append(index).Append("-\u041f\u0440\u0438\u0432\u0435\u0442\"}\n");
            File.WriteAllText(file,text.ToString(),new UTF8Encoding(false));
            EventCursor cursor=new EventCursor(file);StringBuilder actual=new StringBuilder();int batches=0;
            while(!cursor.AtEnd) {
                string[] lines=cursor.Read();if(lines.Length>128||lines.Length==0)return 2;
                foreach(string line in lines)actual.Append(line).Append('\n');batches++;
            }
            if(batches<10||actual.ToString()!=text.ToString())return 3;
        }else if(mode=="clock-jump") {
            using(UiLease lease=new UiLease(folder,0)) {
                foreach(int hours in new int[]{-3,3}) {
                    SessionIO.Write(Path.Combine(folder,"ui-heartbeat.json"),new {id=lease.Id,at=DateTime.UtcNow.AddHours(hours).ToString("o"),uptimeMs=unchecked((uint)Environment.TickCount),connected=true});
                    if(!UiLease.Healthy(SessionIO.Read(Path.Combine(folder,"ui-owner.json")),SessionIO.Read(Path.Combine(folder,"ui-heartbeat.json")),15000))return 2;
                }
            }
        }else if(mode=="recover") {
            try {
                using(UiLease lease=new UiLease(folder,0)) {
                    if(!lease.IsOwner()||!File.Exists(Path.Combine(folder,"pause")))return 2;
                    bool blocked=false;try{using(UiLease duplicate=new UiLease(folder,0)){} }catch(IOException){blocked=true;}
                    if(!blocked)return 3;
                }
            }catch(IOException error){Console.Error.WriteLine(error.Message);return 20;}
        }else if(mode=="mismatch") {
            int pid=System.Diagnostics.Process.GetCurrentProcess().Id;
            if(SessionIO.Alive(pid,"incorrect-start-stamp"))return 2;
            using(UiLease lease=new UiLease(folder,0)) {
                bool blocked=false;try{using(UiLease second=new UiLease(folder,0)){} }catch(IOException){blocked=true;}
                if(!blocked)return 3;
                SessionIO.Write(Path.Combine(folder,"ui-heartbeat.json"),new {id=lease.Id,at=DateTime.UtcNow.AddMinutes(-2).ToString("o"),connected=true});
                using(UiLease replacement=new UiLease(folder,0)) {
                    if(lease.Heartbeat())return 4;
                    try{lease.Control("cancel");return 5;}catch(IOException){}
                    if(!replacement.IsOwner())return 6;
                }
            }
        }else return 10;
        return 0;
    }
}
