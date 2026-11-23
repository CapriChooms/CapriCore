// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.Globalization;
using System.Threading;

namespace Capri.Setup {
    // A renderer can reconnect to the main process. If the main process itself
    // dies, no speech download should continue without a way to cancel it.
    public sealed class SpeechOwner : IDisposable {
        readonly Process owner;
        readonly string stamp;
        readonly int worker;
        readonly Timer timer;
        int stopped;
        public SpeechOwner(int pid, string expectedStamp) {
            worker = Process.GetCurrentProcess().Id;
            if (pid <= 0 || pid == worker) throw new ArgumentException("Invalid speech installer owner.");
            owner = Process.GetProcessById(pid);
            stamp = expectedStamp;
            if (!Alive()) { owner.Dispose(); throw new InvalidOperationException("Capri closed before speech installation started."); }
            timer = new Timer(Check, null, 500, 500);
        }
        bool Alive() {
            try { return !owner.HasExited && owner.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) == stamp; }
            catch { return false; }
        }
        void Check(object state) {
            if (Alive() || Interlocked.Exchange(ref stopped, 1) != 0) return;
            try {
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe");
                start.Arguments = "/PID " + worker.ToString(CultureInfo.InvariantCulture) + " /T /F";
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                using (Process killer = Process.Start(start)) { killer.WaitForExit(5000); }
            } catch { Environment.Exit(1); }
        }
        public void Dispose() { Interlocked.Exchange(ref stopped, 1); timer.Dispose(); owner.Dispose(); }
    }
}
