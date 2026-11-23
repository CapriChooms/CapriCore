// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Capri.Setup {
    // Rebrand our private copy only. Electron's installed original and its
    // license/notices stay intact; no native DLL or model executable is patched.
    public static class DesktopBranding {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
        [DllImport("kernel32.dll", SetLastError=true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr resource);
        [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
        delegate bool NameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr context);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
        static extern bool EnumResourceNames(IntPtr module, IntPtr type, NameCallback callback, IntPtr context);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

        static byte[] ReadVersion(string file) {
            IntPtr module=LoadLibraryEx(file,IntPtr.Zero,2);
            if(module==IntPtr.Zero)throw new Win32Exception();
            try {
                IntPtr resource=FindResource(module,new IntPtr(1),new IntPtr(16));
                if(resource==IntPtr.Zero)throw new Win32Exception();
                byte[] bytes=new byte[checked((int)SizeofResource(module,resource))];
                Marshal.Copy(LockResource(LoadResource(module,resource)),bytes,0,bytes.Length);
                return bytes;
            } finally { FreeLibrary(module); }
        }
        static int[] IconGroups(string file) {
            IntPtr module=LoadLibraryEx(file,IntPtr.Zero,2);
            if(module==IntPtr.Zero)throw new Win32Exception();
            var names=new List<int>();
            try {
                EnumResourceNames(module,new IntPtr(14),(m,t,n,c)=>{
                    long id=n.ToInt64();
                    if(id>0 && id<=65535)names.Add((int)id);
                    return true;
                },IntPtr.Zero);
            } finally { FreeLibrary(module); }
            return names.Count>0?names.ToArray():new int[]{1};
        }
        static void Put(IntPtr update,int type,int id,byte[] bytes) {
            foreach(ushort language in new ushort[]{0,1033})
                if(!UpdateResource(update,new IntPtr(type),new IntPtr(id),language,bytes,(uint)bytes.Length))
                    throw new Win32Exception();
        }
        public static void Apply(string executable,string metadata,string icon) {
            byte[] version=ReadVersion(metadata);
            int[] groups=IconGroups(executable);
            byte[] ico=File.ReadAllBytes(icon);
            if(ico.Length<6 || BitConverter.ToUInt16(ico,2)!=1)throw new InvalidDataException("Invalid Capri icon");
            int count=BitConverter.ToUInt16(ico,4);
            if(count<1 || count>256 || ico.Length<6+count*16)throw new InvalidDataException("Invalid icon directory");
            IntPtr update=BeginUpdateResource(executable,false);
            if(update==IntPtr.Zero)throw new Win32Exception();
            bool committed=false;
            try {
                Put(update,16,1,version);
                using(var stream=new MemoryStream())using(var writer=new BinaryWriter(stream)) {
                    writer.Write((ushort)0);writer.Write((ushort)1);writer.Write((ushort)count);
                    for(int i=0;i<count;i++) {
                        int entry=6+i*16;
                        int length=checked((int)BitConverter.ToUInt32(ico,entry+8));
                        int offset=checked((int)BitConverter.ToUInt32(ico,entry+12));
                        if(length<1 || offset<0 || offset>ico.Length-length)throw new InvalidDataException("Invalid icon image");
                        byte[] image=new byte[length];Buffer.BlockCopy(ico,offset,image,0,length);
                        int id=60000+i;Put(update,3,id,image);
                        writer.Write(ico,entry,12);writer.Write((ushort)id);
                    }
                    foreach(int group in groups)Put(update,14,group,stream.ToArray());
                }
                if(!EndUpdateResource(update,false))throw new Win32Exception();
                committed=true;
            } finally { if(!committed)EndUpdateResource(update,true); }
        }
    }
}
