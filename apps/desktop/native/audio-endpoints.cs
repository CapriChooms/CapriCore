// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Capri.Audio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class DeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDevices {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint states, out IDeviceCollection collection);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
        [PreserveSig] int OpenPropertyStore(uint access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport, Guid("1BE09788-6894-4089-8586-9A2A6C265AC5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IEndpoint {
        [PreserveSig] int GetDataFlow(out int flow);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey {
        public Guid format;
        public uint id;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropertyValue {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr text;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropertyValue value);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormat {
        public ushort tag;
        public ushort channels;
        public uint sampleRate;
        public uint byteRate;
        public ushort blockAlign;
        public ushort bits;
        public ushort extraSize;
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient {
        [PreserveSig] int Initialize(int sharing, uint flags, long bufferDuration, long period, ref WaveFormat format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int sharing, IntPtr format, IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong clock);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    static class Program {
        const uint Active = 1;
        const int Render = 0, Capture = 1;
        const uint SharedEvent = 0x00040000, Loopback = 0x00020000;
        const uint ConvertPcm = 0x80000000, QualityResampler = 0x08000000;
        const uint Silent = 2;
        const int SampleRate = 16000, SampleBytes = 4, PacketBytes = SampleRate * SampleBytes / 10;

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropertyValue value);

        static void Check(int status) {
            if (status < 0) Marshal.ThrowExceptionForHR(status);
        }

        static void Release(object value) {
            if (value != null) Marshal.ReleaseComObject(value);
        }

        public class DeviceInfo {
            public string id { get; set; }
            public string label { get; set; }
            public string kind { get; set; }
        }

        static DeviceInfo Describe(IDevice device, int flow) {
            string id;
            Check(device.GetId(out id));
            string label = "";
            IPropertyStore store;
            if (device.OpenPropertyStore(0, out store) >= 0) {
                try {
                    var key = new PropertyKey { format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), id = 14 };
                    PropertyValue value;
                    if (store.GetValue(ref key, out value) >= 0) {
                        try {
                            if (value.type == 31) label = Marshal.PtrToStringUni(value.text) ?? "";
                        } finally {
                            PropVariantClear(ref value);
                        }
                    }
                } finally {
                    Release(store);
                }
            }
            return new DeviceInfo { id = id, label = label, kind = flow == Render ? "output" : "input" };
        }

        static List<DeviceInfo> List(IDevices devices) {
            var endpoints = new List<DeviceInfo>();
            for (int flow = Render; flow <= Capture; flow++) {
                IDeviceCollection collection;
                Check(devices.EnumAudioEndpoints(flow, Active, out collection));
                try {
                    uint count;
                    Check(collection.GetCount(out count));
                    for (uint index = 0; index < count; index++) {
                        IDevice device;
                        if (collection.Item(index, out device) < 0) continue;
                        try {
                            endpoints.Add(Describe(device, flow));
                        } catch (COMException) {
                            // An endpoint can disappear during enumeration.
                        } finally {
                            Release(device);
                        }
                    }
                } finally {
                    Release(collection);
                }
            }
            return endpoints;
        }

        static void CopyPackets(Stream output, byte[] data, int length, byte[] packet, ref int used) {
            for (int offset = 0; offset < length;) {
                int copy = Math.Min(length - offset, packet.Length - used);
                Buffer.BlockCopy(data, offset, packet, used, copy);
                offset += copy;
                used += copy;
                if (used == packet.Length) {
                    output.Write(packet, 0, packet.Length);
                    used = 0;
                }
            }
        }

        static void ReadPackets(IDevice device, IAudioClient audio, IAudioCaptureClient capture, EventWaitHandle incoming) {
            uint maximumFrames;
            Check(audio.GetBufferSize(out maximumFrames));
            if (maximumFrames == 0 || maximumFrames > SampleRate * 2) throw new InvalidDataException();
            var data = new byte[checked((int)maximumFrames * SampleBytes)];
            var packet = new byte[PacketBytes];
            int used = 0;
            using (var stop = new ManualResetEvent(false)) {
                // Parent death closes the pipe as well, so capture cannot outlive Capri.
                var stopThread = new Thread(() => {
                    try {
                        Console.OpenStandardInput().ReadByte();
                    } catch (IOException) { }
                    try { stop.Set(); } catch (ObjectDisposedException) { }
                }) { IsBackground = true };
                stopThread.Start();
                var handles = new WaitHandle[] { stop, incoming };
                var clock = Stopwatch.StartNew();
                long activityAt = 0, checkAt = 0;
                using (Stream output = Console.OpenStandardOutput()) {
                    var marker = Encoding.ASCII.GetBytes("CAPRI-AUDIO-1\n");
                    output.Write(marker, 0, marker.Length);
                    while (WaitHandle.WaitAny(handles, 100) != 0) {
                        uint pending;
                        Check(capture.GetNextPacketSize(out pending));
                        while (pending > 0 && !stop.WaitOne(0)) {
                            IntPtr address;
                            uint frames, flags;
                            ulong position, timestamp;
                            Check(capture.GetBuffer(out address, out frames, out flags, out position, out timestamp));
                            if (frames == 0) break;
                            int length = checked((int)frames * SampleBytes);
                            try {
                                if (length > data.Length) throw new InvalidDataException();
                                if ((flags & Silent) != 0) Array.Clear(data, 0, length);
                                else Marshal.Copy(address, data, 0, length);
                            } finally {
                                Check(capture.ReleaseBuffer(frames));
                            }
                            CopyPackets(output, data, length, packet, ref used);
                            activityAt = clock.ElapsedMilliseconds;
                            Check(capture.GetNextPacketSize(out pending));
                        }
                        long now = clock.ElapsedMilliseconds;
                        // An idle playback endpoint sends no WASAPI packet. Advance
                        // the detector's clock with silence so a stopped track goes idle.
                        if (now - activityAt >= 100) {
                            Array.Clear(packet, used, packet.Length - used);
                            output.Write(packet, 0, packet.Length);
                            used = 0;
                            activityAt = now;
                        }
                        if (now >= checkAt) {
                            uint state;
                            Check(device.GetState(out state));
                            if (state != Active) throw new InvalidOperationException();
                            checkAt = now + 1000;
                        }
                    }
                }
            }
        }

        static void StreamEndpoint(IDevices devices, string id) {
            IDevice device;
            Check(devices.GetDevice(id, out device));
            object rawAudio = null, rawCapture = null;
            try {
                int flow;
                Check(((IEndpoint)device).GetDataFlow(out flow));
                if (flow != Render && flow != Capture) throw new InvalidDataException();
                uint state;
                Check(device.GetState(out state));
                if (state != Active) throw new InvalidOperationException();
                Guid clientId = typeof(IAudioClient).GUID;
                Check(device.Activate(ref clientId, 23, IntPtr.Zero, out rawAudio));
                var audio = (IAudioClient)rawAudio;
                var format = new WaveFormat {
                    tag = 3,
                    channels = 1,
                    sampleRate = SampleRate,
                    byteRate = SampleRate * SampleBytes,
                    blockAlign = SampleBytes,
                    bits = SampleBytes * 8
                };
                uint flags = SharedEvent | ConvertPcm | QualityResampler;
                if (flow == Render) flags |= Loopback;
                Check(audio.Initialize(0, flags, 0, 0, ref format, IntPtr.Zero));
                using (var incoming = new AutoResetEvent(false)) {
                    Check(audio.SetEventHandle(incoming.SafeWaitHandle.DangerousGetHandle()));
                    Guid captureId = typeof(IAudioCaptureClient).GUID;
                    Check(audio.GetService(ref captureId, out rawCapture));
                    Check(audio.Start());
                    try {
                        ReadPackets(device, audio, (IAudioCaptureClient)rawCapture, incoming);
                    } finally {
                        audio.Stop();
                    }
                }
            } finally {
                Release(rawCapture);
                Release(rawAudio);
                Release(device);
            }
        }

        [MTAThread]
        static int Main(string[] args) {
            IDevices devices = null;
            try {
                devices = (IDevices)new DeviceEnumerator();
                if (args.Length == 1 && args[0] == "list") {
                    Console.OutputEncoding = new UTF8Encoding(false);
                    Console.WriteLine(new JavaScriptSerializer().Serialize(List(devices)));
                } else if (args.Length == 2 && args[0] == "capture") {
                    StreamEndpoint(devices, args[1]);
                } else {
                    return 2;
                }
                return 0;
            } catch (Exception error) {
                Console.Error.WriteLine("WASAPI 0x{0:X8}", error.HResult);
                return 1;
            } finally {
                Release(devices);
            }
        }
    }
}
