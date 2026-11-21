// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using System.Windows.Forms;

[assembly: AssemblyTitle("Uninstall Capri")]
[assembly: AssemblyProduct("Capri")]

internal static class CapriUninstallLauncher {
    [STAThread]
    private static int Main(string[] args) {
        bool quiet = args.Length == 1 && args[0] == "--quiet";
        bool fromDesktop = args.Length == 1 && args[0] == "--desktop";
        try {
            if (args.Length != 0 && !quiet && !fromDesktop) throw new ArgumentException("Invalid uninstall arguments.");
            string executable = Assembly.GetExecutingAssembly().Location;
            string root = LauncherRoot(executable);
            if (root == null) {
                if (!quiet) ShowError(CapriSetupLocale.Text("repairNeeded", "Run Capri Setup to repair the uninstaller."), "UNINSTALL_REPAIR_REQUIRED");
                return 1;
            }
            using (WindowsIdentity user = WindowsIdentity.GetCurrent()) {
                string ownerSid = EmbeddedValue("OwnerSid") ?? user.User.Value;
                bool otherAccount = ownerSid != user.User.Value;
                if (otherAccount || HasFullToken(user.Token)) {
                    if (!quiet && !fromDesktop && TryOpenFromDesktop(executable, ownerSid)) return 0;
                    if (!quiet) ShowError(otherAccount
                        ? CapriSetupLocale.Text("ownerAccountHelp", "Open the uninstaller from the Windows account that installed Capri.")
                        : CapriSetupLocale.Text("standardPrivilegesHelp", "Use the Windows Apps list or open uninstall.exe from your normal desktop session."),
                        otherAccount ? "UNINSTALL_OWNER_ACCOUNT" : "UNINSTALL_USE_DESKTOP");
                    return 1;
                }
            }
            if (!Directory.Exists(root)) {
                if (!quiet) ShowError(CapriSetupLocale.Text("missingInstallHelp", "The Capri installation folder is unavailable. Reconnect its drive or run Capri Setup to repair it."), "UNINSTALL_LOCATION_UNAVAILABLE");
                return 1;
            }
            if (HasLinkedPath(root)) {
                if (!quiet) ShowError(CapriSetupLocale.Text("linkedPathHelp"), "UNINSTALL_LINKED_PATH");
                return 1;
            }
            string script = ResolveScript(root, Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "Capri", "Uninstall"), CapriUninstallInfo.Recovery);
            if (script == null) {
                if (!quiet) ShowError(CapriSetupLocale.Text("repairNeeded", "Capri's uninstall files are missing. Run Capri Setup to repair this installation."), "UNINSTALL_REPAIR_REQUIRED");
                return 1;
            }
            string powershell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            var start = new ProcessStartInfo(powershell,
                "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + script +
                "\" -InstallRoot \"" + root + "\"" +
                (quiet ? " -Quiet" : " -LauncherPid " + Process.GetCurrentProcess().Id));
            start.WorkingDirectory = Environment.SystemDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            using (Process process = Process.Start(start)) {
                if (process == null) {
                    if (!quiet) ShowError(CapriSetupLocale.Text("openFailed", "Could not open the uninstall window."), "UNINSTALL_LAUNCH_FAILED");
                    return 1;
                }
                if (quiet) {
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
            return 0;
        } catch (Exception error) {
            if (!quiet) ShowError(CapriSetupLocale.Text("openFailed", "Could not open the uninstall window.") +
                "\r\n\r\n" + error.Message, "UNINSTALL_LAUNCH_FAILED");
            return 1;
        }
    }
    private static readonly string[] BundleFiles = new string[] {
        "uninstall.ps1", "uninstall-window.cs", "cyberpunk-theme.cs", "common.ps1", "shell-link.cs", "localization.ps1",
        "uninstaller-text.json", "installer-config.json", "source-files.json", "registration.json", "app.ico"
    };
    private const int JsonLimit = 2 * 1024 * 1024;

    internal static string LauncherRoot(string executable) {
        string root = EmbeddedValue("InstallRoot");
        if (root == null) return Path.GetDirectoryName(executable);
        if (!Same(executable, Path.Combine(root, "uninstall.exe")) &&
            !Same(executable, Path.Combine(CapriUninstallInfo.Recovery, "uninstall.exe"))) return null;
        return root;
    }

    // Use the current desktop's Explorer to return to the installation owner's
    // HKCU and LocalAppData, before starting any PowerShell from the per-user bundle.
    private static bool TryOpenFromDesktop(string executable, string ownerSid) {
        try {
            dynamic windows = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
            object location = null, locationRoot = null;
            int handle;
            dynamic desktop = windows.FindWindowSW(ref location, ref locationRoot, 8, out handle, 1); // SWC_DESKTOP, SWFO_NEEDDISPATCH
            uint explorerPid, desktopPid;
            GetWindowThreadProcessId(GetShellWindow(), out explorerPid);
            GetWindowThreadProcessId(new IntPtr(handle), out desktopPid);
            if (desktop == null || explorerPid == 0 || explorerPid != desktopPid) return false;
            using (SafeFileHandle process = OpenProcess(0x1000, false, explorerPid)) { // PROCESS_QUERY_LIMITED_INFORMATION
                SafeFileHandle token;
                if (process.IsInvalid || !OpenProcessToken(process, 8, out token)) return false; // TOKEN_QUERY
                using (token)
                using (var shellUser = new WindowsIdentity(token.DangerousGetHandle())) {
                    if (shellUser.User.Value != ownerSid || HasFullToken(shellUser.Token)) return false;
                }
            }
            desktop.Document.Application.ShellExecute(executable, "--desktop", Environment.SystemDirectory, "open", 1);
            return true;
        } catch { return false; }
    }

    private static bool HasFullToken(IntPtr token) {
        int type, size;
        if (!GetTokenInformation(token, 18, out type, sizeof(int), out size)) // TokenElevationType
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return type == 2; // TokenElevationTypeFull. A default token has no split token to undo.
    }

    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle OpenProcess(uint access, bool inherit, uint process);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(SafeFileHandle process, uint access, out SafeFileHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, out int value, int length, out int required);

    private static string Full(string value) {
        if (String.IsNullOrEmpty(value) || !Path.IsPathRooted(value) ||
            !Path.GetPathRoot(value).EndsWith("\\", StringComparison.Ordinal)) throw new InvalidDataException();
        string full = Path.GetFullPath(value);
        return full.Length == Path.GetPathRoot(full).Length ? full : full.TrimEnd('\\', '/');
    }
    private static bool Same(string left, string right) {
        return String.Equals(Full(left), Full(right), StringComparison.OrdinalIgnoreCase);
    }
    // Resolve only: this method never launches a process, repairs files, or removes data.
    internal static string ResolveScript(string root, string currentRecoveryParent, string legacyRecovery) {
        try {
            root = Full(root);
            if (Same(root, Path.GetPathRoot(root))) return null;
            Dictionary<string, object> identity = ReadJson(Path.Combine(root, ".capri-install.json"));
            string id = Text(identity, "installId");
            Guid parsed;
            if (Text(identity, "productId") != "capri.desktop" || !Same(Text(identity, "root"), root) ||
                !Guid.TryParseExact(id, "D", out parsed) || id != id.ToLowerInvariant() ||
                (EmbeddedValue("InstallId") ?? id) != id) return null;
            string current = Path.Combine(currentRecoveryParent, id);
            if (RecoveryReady(root, id, current)) return Path.Combine(current, "uninstall.ps1");
            if (!String.IsNullOrEmpty(legacyRecovery) && !Same(current, legacyRecovery) &&
                RecoveryReady(root, id, legacyRecovery)) return Path.Combine(legacyRecovery, "uninstall.ps1");
            string installed = Path.Combine(root, "packages", "installer", "windows");
            Dictionary<string, string> hashes = InstalledHashes(root);
            foreach (string name in BundleFiles) {
                string file = InstalledFile(root, installed, name), expected;
                if (!hashes.TryGetValue(name, out expected) || !VerifiedFile(file, expected)) return null;
            }
            return Path.Combine(installed, "uninstall.ps1");
        } catch { return null; }
    }
    private static bool RecoveryReady(string root, string id, string directory) {
        try {
            directory = Full(directory);
            Dictionary<string, object> registration = ReadJson(Path.Combine(directory, "registration.json"));
            if (Text(registration, "installId") != id || !Same(Text(registration, "recovery"), directory)) return false;
            string recordedRoot = Text(registration, "root");
            if (!String.IsNullOrEmpty(recordedRoot)) {
                if (!Same(recordedRoot, root)) return false;
            } else {
                // Old receipts lack root: bind through the matching installed receipt or registry entry.
                bool bound = false;
                try {
                    Dictionary<string, object> local = ReadJson(Path.Combine(root, ".runtime", "installer", "registration.json"));
                    bound = Text(local, "installId") == id && Same(Text(local, "recovery"), directory);
                } catch { }
                if (!bound) {
                    using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Capri." + id, false))
                        bound = key != null && key.GetValue("InstallLocation") is string &&
                            Same((string)key.GetValue("InstallLocation"), root);
                }
                if (!bound) return false;
            }
            Dictionary<string, string> hashes = EmbeddedHashes() ?? InstalledHashes(root);
            foreach (string name in BundleFiles) {
                string expected;
                if (!hashes.TryGetValue(name, out expected) || !VerifiedFile(Path.Combine(directory, name), expected)) return false;
            }
            return true;
        } catch { return false; }
    }
    private static string InstalledFile(string root, string scripts, string name) {
        if (name == "installer-config.json") return Path.Combine(root, "config", "installer.json");
        if (name == "uninstaller-text.json") return Path.Combine(root, "config", name);
        if (name == "source-files.json" || name == "registration.json") return Path.Combine(root, ".runtime", "installer", name);
        if (name == "app.ico") return Path.Combine(root, "assets", "default", name);
        return Path.Combine(scripts, name);
    }
    private static Dictionary<string, string> InstalledHashes(string root) {
        string receipt = Path.Combine(root, ".runtime", "installer", "source-files.json");
        Dictionary<string, object> source = ReadJson(receipt);
        object entries;
        if (!source.TryGetValue("files", out entries) || !(entries is System.Collections.IList)) throw new InvalidDataException();
        Dictionary<string, string> paths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (object value in (System.Collections.IList)entries) {
            Dictionary<string, object> entry = value as Dictionary<string, object>;
            if (entry == null) throw new InvalidDataException();
            paths.Add(Text(entry, "path").Replace('\\', '/'), Text(entry, "sha256"));
        }
        Dictionary<string, string> hashes = new Dictionary<string, string>(StringComparer.Ordinal);
        string scripts = Path.Combine(root, "packages", "installer", "windows");
        foreach (string name in BundleFiles) {
            string file = InstalledFile(root, scripts, name), expected;
            if (name == "source-files.json" || name == "registration.json") {
                if (!SafeFile(file)) throw new InvalidDataException();
                expected = Hash(file);
            } else {
                string relative = file.Substring(root.Length + 1).Replace('\\', '/');
                if (!paths.TryGetValue(relative, out expected)) throw new InvalidDataException();
            }
            hashes.Add(name, expected);
        }
        return hashes;
    }
    private static Dictionary<string, string> EmbeddedHashes() {
        string json = EmbeddedValue("BundleHashes");
        if (json == null) return null;
        if (String.IsNullOrEmpty(json) || json.Length > 64 * 1024) throw new InvalidDataException();
        return new JavaScriptSerializer { MaxJsonLength = 64 * 1024 }.Deserialize<Dictionary<string, string>>(json);
    }
    private static string EmbeddedValue(string name) {
        // Fixture and legacy launchers can still supply only a recovery directory.
        FieldInfo field = typeof(CapriUninstallInfo).GetField(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
        return field == null ? null : (string)field.GetValue(null);
    }
    private static string Text(Dictionary<string, object> value, string key) {
        object text;
        return value.TryGetValue(key, out text) && text is string ? (string)text : "";
    }
    private static Dictionary<string, object> ReadJson(string file) {
        if (!SafeFile(file) || new FileInfo(file).Length > JsonLimit) throw new InvalidDataException();
        return new JavaScriptSerializer { MaxJsonLength = JsonLimit }.Deserialize<Dictionary<string, object>>(File.ReadAllText(file));
    }
    private static bool VerifiedFile(string file, string expected) {
        if (expected == null || expected.Length != 64 || !SafeFile(file)) return false;
        return String.Equals(Hash(file), expected, StringComparison.Ordinal);
    }
    private static string Hash(string file) {
        using (SHA256 algorithm = SHA256.Create())
        using (FileStream stream = File.OpenRead(file))
            return BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    private static bool HasLinkedPath(string path) {
        var parents = new Stack<string>();
        for (string current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current))
            parents.Push(current);
        foreach (string parent in parents)
            if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) return true;
        return false;
    }
    private static bool SafeFile(string file) {
        try {
            if (HasLinkedPath(file) || (File.GetAttributes(file) & FileAttributes.Directory) != 0) return false;
            using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                FileInformation information;
                return GetFileInformationByHandle(stream.SafeFileHandle, out information) && information.NumberOfLinks == 1;
            }
        } catch { return false; }
    }
    private static void ShowError(string message, string code) {
        var messages = new Dictionary<string, string>();
        foreach (string key in new[] { "title", "failed", "technicalDetails", "progressPreparing", "progressItems", "progressClose", "reportBug" })
            messages[key] = CapriSetupLocale.Text(key);
        try {
            using (var progress = new Capri.Setup.UninstallProgress(messages, CapriSetupLocale.RightToLeft, ""))
                progress.Fail(message, code, "");
            return;
        } catch { }
        MessageBox.Show(message, CapriSetupLocale.Text("title", "Uninstall Capri"),
            MessageBoxButtons.OK, MessageBoxIcon.Error, MessageBoxDefaultButton.Button1,
            CapriSetupLocale.RightToLeft ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0);
    }
}
