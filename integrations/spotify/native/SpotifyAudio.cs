// Core Audio session gain. No endpoint/master-volume interface is exposed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;

namespace Capri.Spotify {
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator { }
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow,uint mask,out IDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeviceCollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index,out IDevice device);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice {
    [PreserveSig] int Activate(ref Guid id,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object value);
    [PreserveSig] int OpenPropertyStore(uint access,out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);
    [PreserveSig] int GetState(out uint state);
}
[ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISessions {
    [PreserveSig] int GetAudioSessionControl(ref Guid id,uint flags,out ISessionControl control);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid id,uint flags,out ISessionVolume volume);
    [PreserveSig] int GetSessionEnumerator(out ISessionEnumerator sessions);
    [PreserveSig] int RegisterSessionNotification(IntPtr callback);
    [PreserveSig] int UnregisterSessionNotification(IntPtr callback);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)]string id,IntPtr callback);
    [PreserveSig] int UnregisterDuckNotification(IntPtr callback);
}
[ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index,out ISessionControl control);
}
[ComImport,Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISessionControl {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,ref Guid context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping,ref Guid context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr callback);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr callback);
}
[ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,ref Guid context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping,ref Guid context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr callback);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr callback);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)]bool optOut);
}
[ComImport,Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISessionVolume {
    [PreserveSig] int SetMasterVolume(float value,ref Guid context);
    [PreserveSig] int GetMasterVolume(out float value);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
}
static class SpotifyAudio {
    static readonly Guid ChangeContext=new Guid("84DC821F-2C2D-4680-A959-560501769925");
    static void Check(int result) { if(result<0)Marshal.ThrowExceptionForHR(result); }
    static T Sessions<T>(Func<List<ISessionVolume>,T> action) {
        var owned=new List<object>(); var volumes=new List<ISessionVolume>();
        try {
            var devices=(IDevices)new DeviceEnumerator();owned.Add(devices);
            IDeviceCollection collection;Check(devices.EnumAudioEndpoints(0,1,out collection));owned.Add(collection);
            uint count;Check(collection.GetCount(out count));
            for(uint i=0;i<count;i++) {
                IDevice device;Check(collection.Item(i,out device));owned.Add(device);
                Guid id=typeof(ISessions).GUID;object raw;
                if(device.Activate(ref id,23,IntPtr.Zero,out raw)<0)continue;
                owned.Add(raw);ISessionEnumerator sessions;if(((ISessions)raw).GetSessionEnumerator(out sessions)<0)continue;owned.Add(sessions);
                int number;Check(sessions.GetCount(out number));
                for(int j=0;j<number;j++) {
                    ISessionControl control;if(sessions.GetSession(j,out control)<0)continue;owned.Add(control);
                    int state;if(control.GetState(out state)<0 || state==2)continue;
                    uint pid;if(((ISessionControl2)control).GetProcessId(out pid)<0 || pid==0)continue;
                    try { using(var process=Process.GetProcessById((int)pid)) { if(!String.Equals(process.ProcessName,"Spotify",StringComparison.OrdinalIgnoreCase))continue; } }
                    catch(ArgumentException){continue;}
                    volumes.Add((ISessionVolume)control);
                }
            }
            return action(volumes);
        } finally {
            var released=new List<object>();
            foreach(var item in owned.AsEnumerable().Reverse())if(!released.Any(other=>Object.ReferenceEquals(other,item))) {
                released.Add(item);try { if(Marshal.IsComObject(item))Marshal.FinalReleaseComObject(item); }catch(InvalidComObjectException){}
            }
        }
    }
    public static Dictionary<string,object> Read() {
        return Sessions(volumes=>{
            if(volumes.Count==0)return new Dictionary<string,object>();
            var levels=new List<float>();var mutes=new List<bool>();
            foreach(var volume in volumes){float value;bool mute;Check(volume.GetMasterVolume(out value));Check(volume.GetMute(out mute));levels.Add(value);mutes.Add(mute);}
            return new Dictionary<string,object>{{"volumePercent",(int)Math.Round(levels.Max()*100)},{"muted",mutes.All(v=>v)},{"volumeScope","spotify-application"},{"audioSessions",volumes.Count}};
        });
    }
    public static void Set(double? level,bool? muted) {
        Sessions(volumes=>{
            if(volumes.Count==0)throw new SpotifyException("audio_session_unavailable","Play a song in Spotify once so Windows can expose its application volume.");
            foreach(var volume in volumes){var context=ChangeContext;if(level.HasValue)Check(volume.SetMasterVolume((float)level.Value,ref context));if(muted.HasValue)Check(volume.SetMute(muted.Value,ref context));}
            return true;
        });
    }
}
}
