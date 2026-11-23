// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Capri.Setup
{
    // Bind explicitly to IShellLinkW. WScript.Shell's TargetPath setter rejects
    // characters outside the Windows ANSI code page, even in a Unicode string.
    // Method order is the native IUnknown vtable order, not alphabetical order.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr item);
        void SetIDList(IntPtr item);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    public sealed class ShortcutInfo
    {
        public string TargetPath { get; internal set; }
        public string WorkingDirectory { get; internal set; }
        public string IconPath { get; internal set; }
        public int IconIndex { get; internal set; }
        public string Description { get; internal set; }
        public int ShowCommand { get; internal set; }
    }

    public static class Shortcuts
    {
        private static object NewLink()
        {
            return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046"), true));
        }

        public static void Save(string file, string target, string workingDirectory, string description)
        {
            object instance = NewLink();
            try
            {
                IShellLinkW link = (IShellLinkW)instance;
                link.SetPath(target);
                link.SetWorkingDirectory(workingDirectory);
                link.SetDescription(description);
                link.SetIconLocation(target, 0);
                link.SetShowCmd(1);
                ((IPersistFile)instance).Save(file, true);
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }

        // Read stored values without Resolve: uninstall must not search for or
        // launch a replacement target when the owned executable has been removed.
        public static ShortcutInfo Read(string file)
        {
            object instance = NewLink();
            try
            {
                ((IPersistFile)instance).Load(file, 0);
                IShellLinkW link = (IShellLinkW)instance;
                StringBuilder target = new StringBuilder(32768);
                StringBuilder workingDirectory = new StringBuilder(32768);
                StringBuilder icon = new StringBuilder(32768);
                StringBuilder description = new StringBuilder(32768);
                int iconIndex, showCommand;
                link.GetPath(target, target.Capacity, IntPtr.Zero, 4); // SLGP_RAWPATH
                link.GetWorkingDirectory(workingDirectory, workingDirectory.Capacity);
                link.GetIconLocation(icon, icon.Capacity, out iconIndex);
                link.GetDescription(description, description.Capacity);
                link.GetShowCmd(out showCommand);
                return new ShortcutInfo {
                    TargetPath = target.ToString(), WorkingDirectory = workingDirectory.ToString(),
                    IconPath = icon.ToString(), IconIndex = iconIndex,
                    Description = description.ToString(), ShowCommand = showCommand
                };
            }
            finally { Marshal.FinalReleaseComObject(instance); }
        }
    }
}
