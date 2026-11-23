// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;
namespace Capri.Setup {
    public sealed class UiDiagnostics : IDisposable {
        private readonly string file;private string reason="normal-exit";
        public string Session {get;set;}
        public UiLease Owner {get;set;}
        public UiDiagnostics(string path) {
            file=path;Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException+=OnThreadError;AppDomain.CurrentDomain.UnhandledException+=OnFatal;
            SessionIO.Log(file,"ui-start","PID "+System.Diagnostics.Process.GetCurrentProcess().Id);
        }
        public void Record(string kind,string message) {
            // A secondary log must never take down the UI or mask the original exception.
            try{SessionIO.Log(file,kind,message);}catch{}
            if(!String.IsNullOrEmpty(Session))try{SessionIO.Log(Path.Combine(Session,"ui-events.jsonl"),kind,message);}catch{}
        }
        public void AttachWorker() {
            try {
                SessionIO.Write(Path.ChangeExtension(file,"worker.json"),new {session=Path.GetFileName(Session)});
            }catch(Exception error){Record("ui-worker-receipt-failed",error.Message);}
        }
        public void ExitReason(string value){reason=value;Record("ui-closing",value);}
        private void Error(string kind,Exception error) {
            reason=kind;try{Record(kind,error.ToString());if(!String.IsNullOrEmpty(Session)&&Owner!=null&&Owner.IsOwner())SessionIO.Pause(Session,kind);}catch{}
        }
        private void OnThreadError(object sender,ThreadExceptionEventArgs args){Error("ui-thread-exception",args.Exception);}
        private void OnFatal(object sender,UnhandledExceptionEventArgs args){Error("ui-unhandled-exception",args.ExceptionObject as Exception??new Exception(Convert.ToString(args.ExceptionObject)));}
        public void Dispose(){Application.ThreadException-=OnThreadError;AppDomain.CurrentDomain.UnhandledException-=OnFatal;try{Record("ui-exit",reason);}catch{}}
    }
}
