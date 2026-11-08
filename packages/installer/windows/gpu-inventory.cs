// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Capri.Setup {
    public sealed class GpuHardware {
        public string name { get; set; }
        public string vendor { get; set; }
        public double vramMiB { get; set; }
        public string memoryKind { get; set; }
        public string luid { get; set; }
        public double? freeVramMiB { get; set; }
    }

    // Native facts are kept separate from presentation and can be exercised
    // without a particular vendor's hardware, driver, or model-name heuristics.
    public sealed class GpuAdapterFacts {
        public string Name;
        public uint VendorId;
        public ulong DedicatedVideoBytes;
        public ulong DedicatedSystemBytes;
        public ulong SharedSystemBytes;
        public uint Flags;
        public uint LuidHigh;
        public uint LuidLow;
        public bool? Uma;
        public uint NodeCount;
    }
    public sealed class GpuMemoryCounter {
        public string Instance;
        public ulong DedicatedUsageBytes;
    }

    public static class GpuInventory {
        const int NotFound = unchecked((int)0x887A0002);
        const double MiB = 1048576.0;
        static readonly object InventoryGate = new object();
        static readonly object CounterGate = new object();
        static Task<GpuHardware[]> activeInventory;
        static Task<GpuMemoryCounter[]> activeCounters;
        static readonly Regex CounterInstance = new Regex(
            @"^luid_0x([0-9a-f]{8})_0x([0-9a-f]{8})_phys_([0-9]+)$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        [StructLayout(LayoutKind.Sequential)]
        struct Luid { public uint Low; public uint High; }
        // SIZE_T must remain pointer-sized: uint truncates 8/16 GiB cards.
        // https://learn.microsoft.com/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc1
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct AdapterDesc {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
            public uint VendorId, DeviceId, SubSysId, Revision;
            public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
            public Luid AdapterLuid;
            public uint Flags;
        }
        // D3D12_FEATURE_ARCHITECTURE1 (16), including each physical node.
        // https://learn.microsoft.com/windows/win32/api/d3d12/ns-d3d12-d3d12_feature_data_architecture1
        [StructLayout(LayoutKind.Sequential)]
        struct Architecture { public uint NodeIndex; public int TileBased, Uma, CacheCoherent, IsolatedMmu; }
        [DllImport("dxgi.dll", ExactSpelling = true)]
        static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
        [DllImport("d3d12.dll", ExactSpelling = true)]
        static extern int D3D12CreateDevice(IntPtr adapter, uint featureLevel, ref Guid iid, out IntPtr device);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int EnumAdapter(IntPtr factory, uint index, out IntPtr adapter);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int DescribeAdapter(IntPtr adapter, out AdapterDesc description);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate uint GetNodeCount(IntPtr device);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int CheckArchitecture(IntPtr device, uint feature, ref Architecture data, uint bytes);

        static Delegate Method(IntPtr instance, int index, Type type) {
            return Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance), index * IntPtr.Size), type);
        }
        static string Vendor(uint id) {
            return id == 0x1002 ? "amd" : id == 0x10de ? "nvidia" : id == 0x8086 ? "intel" : "other";
        }
        static string LuidText(uint high, uint low) {
            return "0x" + high.ToString("X8", CultureInfo.InvariantCulture) + "_0x" +
                low.ToString("X8", CultureInfo.InvariantCulture);
        }

        static bool? UnifiedMemory(IntPtr adapter, out uint nodes) {
            nodes = 0;
            IntPtr device = IntPtr.Zero;
            try {
                var iid = new Guid("189819f1-1db6-4b57-be54-1821339b85f7");
                if (D3D12CreateDevice(adapter, 0xb000, ref iid, out device) < 0 || device == IntPtr.Zero)
                    return null;
                nodes = ((GetNodeCount)Method(device, 7, typeof(GetNodeCount)))(device);
                if (nodes == 0 || nodes > 32) return null;
                var check = (CheckArchitecture)Method(device, 13, typeof(CheckArchitecture));
                bool? unified = null;
                for (uint index = 0; index < nodes; index++) {
                    var data = new Architecture { NodeIndex = index };
                    if (check(device, 16, ref data, (uint)Marshal.SizeOf(typeof(Architecture))) < 0)
                        return null;
                    bool nodeUnified = data.Uma != 0;
                    if (unified.HasValue && unified.Value != nodeUnified) return null;
                    unified = nodeUnified;
                }
                return unified;
            } catch (DllNotFoundException) { return null; }
              catch (EntryPointNotFoundException) { return null; }
              catch (COMException) { return null; }
            finally { if (device != IntPtr.Zero) Marshal.Release(device); }
        }

        static GpuAdapterFacts[] NativeAdapters() {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("GPU inventory requires x64.");
            IntPtr factory = IntPtr.Zero;
            try {
                var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
                Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
                if (factory == IntPtr.Zero) throw new InvalidOperationException("DXGI inventory unavailable.");
                // IDXGIFactory1::EnumAdapters1, after IUnknown/IDXGIObject/IDXGIFactory.
                var enumerate = (EnumAdapter)Method(factory, 12, typeof(EnumAdapter));
                var facts = new List<GpuAdapterFacts>();
                for (uint index = 0; index < 64; index++) {
                    IntPtr adapter = IntPtr.Zero;
                    try {
                        int result = enumerate(factory, index, out adapter);
                        if (result == NotFound) return facts.ToArray();
                        Marshal.ThrowExceptionForHR(result);
                        if (adapter == IntPtr.Zero) throw new InvalidOperationException("DXGI adapter unavailable.");
                        var describe = (DescribeAdapter)Method(adapter, 10, typeof(DescribeAdapter));
                        AdapterDesc description;
                        Marshal.ThrowExceptionForHR(describe(adapter, out description));
                        if ((description.Flags & 3) != 0 || String.IsNullOrWhiteSpace(description.Description)) continue;
                        uint nodes;
                        bool? uma = UnifiedMemory(adapter, out nodes);
                        facts.Add(new GpuAdapterFacts {
                            Name = description.Description,
                            VendorId = description.VendorId,
                            DedicatedVideoBytes = description.DedicatedVideoMemory.ToUInt64(),
                            DedicatedSystemBytes = description.DedicatedSystemMemory.ToUInt64(),
                            SharedSystemBytes = description.SharedSystemMemory.ToUInt64(),
                            Flags = description.Flags,
                            LuidHigh = description.AdapterLuid.High,
                            LuidLow = description.AdapterLuid.Low,
                            Uma = uma,
                            NodeCount = nodes
                        });
                    } finally { if (adapter != IntPtr.Zero) Marshal.Release(adapter); }
                }
                throw new InvalidOperationException("DXGI adapter inventory exceeds its safety limit.");
            } finally { if (factory != IntPtr.Zero) Marshal.Release(factory); }
        }

        static GpuMemoryCounter[] DedicatedCounters() {
            try {
                // Adapter-wide WDDM values, never GPU Process Memory or DXGI's
                // process residency budget (QueryVideoMemoryInfo is NOT free VRAM).
                // https://learn.microsoft.com/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo
                var category = new PerformanceCounterCategory("GPU Adapter Memory");
                var values = category.ReadCategory();
                if (!values.Contains("Dedicated Usage")) return new GpuMemoryCounter[0];
                var usage = values["Dedicated Usage"];
                var result = new List<GpuMemoryCounter>();
                foreach (string instance in usage.Keys) {
                    var sample = usage[instance];
                    if (!CounterInstance.IsMatch(instance) || sample.RawValue < 0 ||
                        sample.Sample.CounterType != PerformanceCounterType.NumberOfItems64) continue;
                    result.Add(new GpuMemoryCounter {
                        Instance = instance, DedicatedUsageBytes = (ulong)sample.RawValue
                    });
                }
                return result.ToArray();
            } catch { return new GpuMemoryCounter[0]; }
        }

        public static GpuHardware[] FromFacts(GpuAdapterFacts[] facts, GpuMemoryCounter[] counters) {
            var result = new List<GpuHardware>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var adapter in facts ?? new GpuAdapterFacts[0]) {
                if (adapter == null || (adapter.Flags & 3) != 0) continue;
                string name = Regex.Replace(adapter.Name ?? "", @"[\x00-\x1f\x7f]", " ").Trim();
                if (name.Length == 0) continue;
                if (name.Length > 128) name = name.Substring(0, 128);
                string luid = LuidText(adapter.LuidHigh, adapter.LuidLow);
                if (!seen.Add(luid)) continue;
                string kind = adapter.Uma.HasValue ? (adapter.Uma.Value ? "shared" : "dedicated") : "unknown";
                double? free = null;
                // A single physical-node counter must match both halves of the
                // adapter LUID exactly. Ambiguous/missing/invalid samples stay null.
                if (kind == "dedicated" && adapter.NodeCount == 1 && adapter.DedicatedVideoBytes > 0) {
                    GpuMemoryCounter matched = null;
                    int count = 0;
                    foreach (var counter in counters ?? new GpuMemoryCounter[0]) {
                        if (counter == null) continue;
                        var match = CounterInstance.Match(counter.Instance ?? "");
                        if (!match.Success || !String.Equals(
                            "0x" + match.Groups[1].Value + "_0x" + match.Groups[2].Value,
                            luid, StringComparison.OrdinalIgnoreCase)) continue;
                        count++;
                        if (match.Groups[3].Value == "0") matched = counter;
                    }
                    if (count == 1 && matched != null && matched.DedicatedUsageBytes <= adapter.DedicatedVideoBytes)
                        free = (adapter.DedicatedVideoBytes - matched.DedicatedUsageBytes) / MiB;
                }
                result.Add(new GpuHardware {
                    name = name, vendor = Vendor(adapter.VendorId),
                    // DedicatedSystemBytes and SharedSystemBytes are deliberately
                    // excluded, including the large shared pool on UMA/iGPUs.
                    vramMiB = adapter.DedicatedVideoBytes / MiB,
                    memoryKind = kind, luid = luid, freeVramMiB = free
                });
            }
            return result.ToArray();
        }

        static GpuMemoryCounter[] ReadCounters() {
            Task<GpuMemoryCounter[]> counters;
            lock (CounterGate) {
                if (activeCounters == null || activeCounters.IsCompleted)
                    activeCounters = Task<GpuMemoryCounter[]>.Factory.StartNew(
                        DedicatedCounters, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
                counters = activeCounters;
            }
            // A slow provider can outlive this wait, but subsequent refreshes
            // reuse that same query instead of accumulating blocked threads.
            try { return counters.Wait(400) ? counters.Result : null; }
            catch { return null; }
        }
        // Persistent runtime collectors already own English PDH counters. Avoid
        // loading PerformanceCounterCategory a second time just for DXGI facts.
        public static GpuHardware[] ReadAdaptersOnly() {
            return FromFacts(NativeAdapters(), null);
        }

        static GpuHardware[] Collect() {
            return FromFacts(NativeAdapters(), ReadCounters());
        }
        public static GpuHardware[] Read(int timeoutMilliseconds) {
            if (timeoutMilliseconds < 250 || timeoutMilliseconds > 3500)
                throw new ArgumentOutOfRangeException("timeoutMilliseconds");
            Task<GpuHardware[]> task;
            lock (InventoryGate) {
                if (activeInventory == null || activeInventory.IsCompleted)
                    activeInventory = Task<GpuHardware[]>.Factory.StartNew(
                        Collect, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
                task = activeInventory;
            }
            // Completed work is replaced, never reused as stale telemetry. A
            // timed-out driver call remains single-flight until it really ends.
            if (!task.Wait(timeoutMilliseconds)) throw new TimeoutException("GPU inventory timed out.");
            return task.Result;
        }
    }
}
