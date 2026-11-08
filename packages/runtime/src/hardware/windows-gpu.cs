// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Capri.Setup;

internal static class CapriGpuMonitor {
    [StructLayout(LayoutKind.Sequential)]
    struct RawItem {
        public IntPtr Name;
        public uint Status, TimeLow, TimeHigh;
        public long Value, SecondValue;
        public uint Count;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct FormattedItem { public IntPtr Name; public uint Status; public double Value; }
    public sealed class Counter { public string name; public double value; }
    public sealed class Reading {
        public GpuHardware[] adapters;
        public Counter[] memory, engines;
    }
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhOpenQueryW(string source, IntPtr data, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr data, out IntPtr counter);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhGetRawCounterArrayW(IntPtr counter, ref uint size, out uint count, IntPtr items);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr items);
    static readonly Regex MemoryName = new Regex(@"^luid_0x[0-9a-f]{8}_0x[0-9a-f]{8}_phys_[0-9]+$", RegexOptions.IgnoreCase);
    static readonly Regex EngineName = new Regex(@"^pid_[0-9]+_luid_0x[0-9a-f]{8}_0x[0-9a-f]{8}_phys_[0-9]+_eng_[0-9]+_engtype_[a-z0-9_]+$", RegexOptions.IgnoreCase);
    static Counter[] Values(IntPtr counter, bool formatted) {
        if (counter == IntPtr.Zero) return null;
        uint size = 0, count;
        uint status = formatted
            ? PdhGetFormattedCounterArrayW(counter, 0x200, ref size, out count, IntPtr.Zero)
            : PdhGetRawCounterArrayW(counter, ref size, out count, IntPtr.Zero);
        if (status == 0 && count == 0) return new Counter[0];
        if (status != 0x800007D2 || size == 0 || size > 4 * 1024 * 1024) return null;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try {
            status = formatted
                ? PdhGetFormattedCounterArrayW(counter, 0x200, ref size, out count, buffer)
                : PdhGetRawCounterArrayW(counter, ref size, out count, buffer);
            if (status != 0) return null;
            int stride = Marshal.SizeOf(formatted ? typeof(FormattedItem) : typeof(RawItem));
            if (count > 8192 || count > size / stride) return null;
            var result = new List<Counter>();
            for (int i = 0; i < count; i++) {
                IntPtr address = IntPtr.Add(buffer, i * stride);
                string name; double value; uint validity;
                if (formatted) {
                    var item = (FormattedItem)Marshal.PtrToStructure(address, typeof(FormattedItem));
                    name = Marshal.PtrToStringUni(item.Name); value = item.Value; validity = item.Status;
                } else {
                    var item = (RawItem)Marshal.PtrToStructure(address, typeof(RawItem));
                    name = Marshal.PtrToStringUni(item.Name); value = item.Value; validity = item.Status;
                }
                if (validity > 1 || Double.IsNaN(value) || Double.IsInfinity(value) || value < 0 ||
                    name == null || name.Length > 256 || !(formatted ? EngineName : MemoryName).IsMatch(name)) continue;
                result.Add(new Counter { name = name, value = value });
            }
            return result.ToArray();
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static int Main() {
        IntPtr query = IntPtr.Zero, memory = IntPtr.Zero, engines = IntPtr.Zero;
        try {
            var json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
            if (PdhOpenQueryW(null, IntPtr.Zero, out query) == 0) {
                PdhAddEnglishCounterW(query, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out memory);
                PdhAddEnglishCounterW(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out engines);
            }
            GpuHardware[] adapters = null; DateTime refresh = DateTime.MinValue;
            bool first = true; string request;
            while ((request = Console.ReadLine()) != null) {
                if (request != "sample") return 2;
                if (DateTime.UtcNow >= refresh) {
                    adapters = GpuInventory.ReadAdaptersOnly();
                    refresh = DateTime.UtcNow.AddSeconds(30);
                }
                bool collected = query != IntPtr.Zero && PdhCollectQueryData(query) == 0;
                Console.WriteLine(json.Serialize(new Reading {
                    adapters = adapters,
                    memory = collected ? Values(memory, false) : null,
                    engines = collected && !first ? Values(engines, true) : null
                }));
                first = false;
            }
            return 0;
        } catch { return 1; }
        finally { if (query != IntPtr.Zero) PdhCloseQuery(query); }
    }
}
