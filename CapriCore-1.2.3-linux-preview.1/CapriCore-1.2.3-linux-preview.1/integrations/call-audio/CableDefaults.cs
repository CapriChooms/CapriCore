// SPDX-License-Identifier: GPL-3.0-only
// Preserve the owner's endpoints when Windows selects a newly installed audio driver.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Capri.CallAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDevice {
    [PreserveSig] int Activate(ref Guid id, uint context, IntPtr parameters, out IntPtr value);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
  }
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class Policy { }
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicy {
    [PreserveSig] int GetMixFormat(IntPtr id, out IntPtr format);
    [PreserveSig] int GetDeviceFormat(IntPtr id, int defaults, out IntPtr format);
    [PreserveSig] int ResetDeviceFormat(IntPtr id);
    [PreserveSig] int SetDeviceFormat(IntPtr id, IntPtr endpoint, IntPtr mix);
    [PreserveSig] int GetProcessingPeriod(IntPtr id, int defaults, IntPtr period, IntPtr minimum);
    [PreserveSig] int SetProcessingPeriod(IntPtr id, IntPtr period);
    [PreserveSig] int GetShareMode(IntPtr id, IntPtr mode);
    [PreserveSig] int SetShareMode(IntPtr id, IntPtr mode);
    [PreserveSig] int GetPropertyValue(IntPtr id, IntPtr key, IntPtr value);
    [PreserveSig] int SetPropertyValue(IntPtr id, IntPtr key, IntPtr value);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility(IntPtr id, int visible);
  }
  public sealed class Endpoint {
    public int Flow;
    public int Role;
    public string Id;
  }
  public static class Defaults {
    public static Endpoint[] Capture() {
      var result = new List<Endpoint>();
      var devices = (IDevices)new Enumerator();
      try {
        for (int flow = 0; flow < 2; flow++) for (int role = 0; role < 3; role++) {
          IDevice device;
          if (devices.GetDefaultAudioEndpoint(flow, role, out device) != 0) continue;
          try {
            string id;
            if (device.GetId(out id) == 0) result.Add(new Endpoint { Flow = flow, Role = role, Id = id });
          } finally { Marshal.ReleaseComObject(device); }
        }
      } finally { Marshal.ReleaseComObject(devices); }
      return result.ToArray();
    }
    public static bool Restore(Endpoint[] saved) {
      bool restored = true;
      var devices = (IDevices)new Enumerator();
      var policy = (IPolicy)new Policy();
      try {
        foreach (var endpoint in saved) {
          IDevice current;
          string id = null;
          if (devices.GetDefaultAudioEndpoint(endpoint.Flow, endpoint.Role, out current) == 0) {
            try { current.GetId(out id); } finally { Marshal.ReleaseComObject(current); }
          }
          if (id != endpoint.Id && policy.SetDefaultEndpoint(endpoint.Id, endpoint.Role) != 0) restored = false;
        }
      } finally { Marshal.ReleaseComObject(policy); Marshal.ReleaseComObject(devices); }
      return restored;
    }
  }
}
