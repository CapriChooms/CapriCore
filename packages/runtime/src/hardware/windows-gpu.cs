// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Capri.Setup;

internal static class CapriGpuMonitor {
    [StructLayout(LayoutKind.Sequential)]
    struct FormattedItem { public IntPtr Name; public uint Status; public double Value; }
    public sealed class Counter { public string name; public double value; }
    public sealed class Reading {
        public GpuHardware[] adapters;
        public Counter[] memory, engines;
    }
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr items);
    static readonly Regex EngineName = new Regex(@"^pid_[0-9]+_luid_0x[0-9a-f]{8}_0x[0-9a-f]{8}_phys_[0-9]+_eng_[0-9]+_engtype_[a-z0-9_]+$", RegexOptions.IgnoreCase);

    static Counter[] MemoryValues(IntPtr counter) {
        var samples = GpuPerformanceCounters.ReadDedicatedUsage(counter);
        return samples == null ? null : Array.ConvertAll(samples, sample =>
            new Counter { name = sample.Instance, value = sample.DedicatedUsageBytes });
    }

    static Counter[] EngineValues(IntPtr counter) {
        if (counter == IntPtr.Zero) return null;
        uint size = 0, count;
        uint status = PdhGetFormattedCounterArrayW(counter, 0x200, ref size, out count, IntPtr.Zero);
        if (status == 0 && count == 0) return new Counter[0];
        if (status != 0x800007D2 || size == 0 || size > 4 * 1024 * 1024) return null;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try {
            status = PdhGetFormattedCounterArrayW(counter, 0x200, ref size, out count, buffer);
            if (status != 0) return null;
            int stride = Marshal.SizeOf(typeof(FormattedItem));
            if (count > 8192 || count > size / stride) return null;
            var result = new List<Counter>();
            for (int i = 0; i < count; i++) {
                var item = (FormattedItem)Marshal.PtrToStructure(IntPtr.Add(buffer, i * stride), typeof(FormattedItem));
                string name = Marshal.PtrToStringUni(item.Name);
                if (item.Status > 1 || Double.IsNaN(item.Value) || Double.IsInfinity(item.Value) || item.Value < 0 ||
                    name == null || name.Length > 256 || !EngineName.IsMatch(name)) continue;
                result.Add(new Counter { name = name, value = item.Value });
            }
            return result.ToArray();
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static int Main() {
        IntPtr query = IntPtr.Zero, memory = IntPtr.Zero, engines = IntPtr.Zero;
        try {
            var json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
            if (GpuPerformanceCounters.PdhOpenQueryW(null, IntPtr.Zero, out query) == 0) {
                GpuPerformanceCounters.PdhAddEnglishCounterW(query, GpuPerformanceCounters.DedicatedUsagePath, IntPtr.Zero, out memory);
                GpuPerformanceCounters.PdhAddEnglishCounterW(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out engines);
            }
            GpuHardware[] adapters = null; DateTime refresh = DateTime.MinValue;
            bool first = true; string request;
            while ((request = Console.ReadLine()) != null) {
                if (request != "sample") return 2;
                if (DateTime.UtcNow >= refresh) {
                    adapters = GpuInventory.ReadAdaptersOnly();
                    refresh = DateTime.UtcNow.AddSeconds(30);
                }
                bool collected = query != IntPtr.Zero && GpuPerformanceCounters.PdhCollectQueryData(query) == 0;
                Console.WriteLine(json.Serialize(new Reading {
                    adapters = adapters,
                    memory = collected ? MemoryValues(memory) : null,
                    engines = collected && !first ? EngineValues(engines) : null
                }));
                first = false;
            }
            return 0;
        } catch { return 1; }
        finally { if (query != IntPtr.Zero) GpuPerformanceCounters.PdhCloseQuery(query); }
    }
}
