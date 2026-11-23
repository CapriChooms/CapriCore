// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class CapriProcessLoad
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        internal uint Size, Usage;
        internal int Pid;
        internal IntPtr Heap;
        internal uint Module, Threads;
        internal int Parent, Priority;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string Image;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryCounters
    {
        internal uint Size, PageFaults;
        internal UIntPtr PeakWorkingSet, WorkingSet, PeakPagedPool, PagedPool,
            PeakNonPagedPool, NonPagedPool, Commit, PeakCommit, PrivateCommit,
            PrivateWorkingSet, SharedCommit;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RawCounterItem
    {
        internal IntPtr Name;
        internal uint Status, TimeLow, TimeHigh;
        internal long Value, SecondValue;
        internal uint Count;
    }

    [DllImport("kernel32.dll")] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out long start, out long exit, out long kernel, out long user);
    [DllImport("psapi.dll")] private static extern bool GetProcessMemoryInfo(IntPtr process, ref MemoryCounters counters, uint size);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhOpenQueryW(string source, IntPtr data, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhAddEnglishCounterW(IntPtr query, string name, IntPtr data, out IntPtr counter);
    [DllImport("pdh.dll")] private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")] private static extern uint PdhCloseQuery(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhGetRawCounterArrayW(IntPtr counter, ref uint size, out uint count, IntPtr items);

    private sealed class OwnedProcess
    {
        internal int Id;
        internal long Started, CpuTicks;
        internal long? Ram;
    }

    private static OwnedProcess ReadProcess(int pid, string root, StringBuilder image)
    {
        IntPtr process = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) return null;
        try
        {
            long started, exited, kernel, user;
            if (!GetProcessTimes(process, out started, out exited, out kernel, out user)) return null;
            if (root != null)
            {
                image.Clear();
                int capacity = image.Capacity;
                if (!QueryFullProcessImageNameW(process, 0, image, ref capacity) ||
                    !image.ToString().StartsWith(root, StringComparison.OrdinalIgnoreCase)) return null;
            }
            var memory = new MemoryCounters { Size = (uint)Marshal.SizeOf(typeof(MemoryCounters)) };
            long? ram = GetProcessMemoryInfo(process, ref memory, memory.Size)
                ? (long?)memory.PrivateWorkingSet.ToUInt64() : null;
            return new OwnedProcess { Id = pid, Started = started, CpuTicks = kernel + user, Ram = ram };
        }
        finally { CloseHandle(process); }
    }

    private static Dictionary<int, OwnedProcess> ProcessTree(int rootPid, string root)
    {
        var image = new StringBuilder(32768);
        var main = ReadProcess(rootPid, null, image);
        if (main == null) throw new InvalidOperationException();
        var owned = new Dictionary<int, OwnedProcess> { { rootPid, main } };
        var parents = new Dictionary<int, int>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
        if (snapshot == new IntPtr(-1)) throw new InvalidOperationException();
        try
        {
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (!Process32FirstW(snapshot, ref entry)) throw new InvalidOperationException();
            do { parents[entry.Pid] = entry.Parent; } while (Process32NextW(snapshot, ref entry));
        }
        finally { CloseHandle(snapshot); }

        int self = Process.GetCurrentProcess().Id;
        var children = parents.ToLookup(pair => pair.Value, pair => pair.Key);
        var queue = new Queue<OwnedProcess>();
        queue.Enqueue(main);
        while (queue.Count != 0)
        {
            var parent = queue.Dequeue();
            foreach (int pid in children[parent.Id])
            {
                if (pid == self || owned.ContainsKey(pid)) continue;
                var child = ReadProcess(pid, root, image);
                if (child == null || child.Started < parent.Started) continue;
                owned.Add(pid, child);
                queue.Enqueue(child);
            }
        }
        // Include Capri's own launcher/CLI ancestors. Never follow their other children.
        var current = main;
        int parentId;
        while (parents.TryGetValue(current.Id, out parentId) && !owned.ContainsKey(parentId))
        {
            var parent = ReadProcess(parentId, root, image);
            if (parent == null || parent.Started > current.Started) break;
            owned.Add(parentId, parent);
            current = parent;
        }
        return owned;
    }

    private static long? DedicatedGpuBytes(IntPtr counter, Dictionary<int, OwnedProcess> owned)
    {
        uint size = 0, count;
        uint status = PdhGetRawCounterArrayW(counter, ref size, out count, IntPtr.Zero);
        if (status == 0 && count == 0) return 0;
        if (status != 0x800007D2 || size == 0 || size > 4 * 1024 * 1024) return null;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetRawCounterArrayW(counter, ref size, out count, buffer) != 0) return null;
            long total = 0;
            int stride = Marshal.SizeOf(typeof(RawCounterItem));
            if (count > size / stride) return null;
            for (int i = 0; i < count; i++)
            {
                var item = (RawCounterItem)Marshal.PtrToStructure(IntPtr.Add(buffer, i * stride), typeof(RawCounterItem));
                if (item.Status > 1 || item.Value < 0) continue;
                var match = Regex.Match(Marshal.PtrToStringUni(item.Name) ?? "", @"^pid_(\d+)_");
                int pid;
                if (match.Success && int.TryParse(match.Groups[1].Value, out pid) && owned.ContainsKey(pid))
                    total += item.Value;
            }
            return total;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static int Main(string[] args)
    {
        int pid;
        if (args.Length != 2 || !int.TryParse(args[0], out pid) || pid <= 0) return 2;
        IntPtr query = IntPtr.Zero;
        try
        {
            string root = Path.GetFullPath(args[1]).TrimEnd('\\') + "\\";
            var serializer = new JavaScriptSerializer();
            IntPtr counter = IntPtr.Zero;
            if (PdhOpenQueryW(null, IntPtr.Zero, out query) == 0)
                PdhAddEnglishCounterW(query, @"\GPU Process Memory(*)\Dedicated Usage", IntPtr.Zero, out counter);
            string request;
            while ((request = Console.ReadLine()) != null)
            {
                if (request != "sample") return 2;
                var owned = ProcessTree(pid, root);
                var processes = owned.Values.Select(p => new { pid = p.Id, started = p.Started.ToString(), cpuMs = p.CpuTicks / 10000.0 });
                Console.WriteLine(serializer.Serialize(new {
                    processes,
                    ramBytes = owned.Values.All(p => p.Ram.HasValue) ? owned.Values.Sum(p => p.Ram) : null,
                    vramBytes = counter != IntPtr.Zero && PdhCollectQueryData(query) == 0 ? DedicatedGpuBytes(counter, owned) : null
                }));
            }
            return 0;
        }
        catch { return 1; }
        finally { if (query != IntPtr.Zero) PdhCloseQuery(query); }
    }
}
