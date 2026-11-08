// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
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
        try {
            if (args.Length != 0 && !quiet) throw new ArgumentException("Invalid uninstall arguments.");
            string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            CapriSetupLocale.SelectInstalled(root);
            string script = ResolveScript(root, Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "Capri", "Uninstall"), CapriUninstallInfo.Recovery);
            if (script == null) {
                if (!quiet) ShowError(CapriSetupLocale.Text("repairNeeded", "Capri's uninstall files are missing. Run Capri Setup to repair this installation."));
                return 1;
            }
            string powershell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            var start = new ProcessStartInfo(powershell,
                "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + script +
                "\" -InstallRoot \"" + root + "\" -LauncherPid " + Process.GetCurrentProcess().Id +
                (quiet ? " -Quiet" : ""));
            start.WorkingDirectory = Environment.SystemDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            using (Process process = Process.Start(start)) {
                if (process == null) {
                    if (!quiet) ShowError(CapriSetupLocale.Text("openFailed", "Could not open the uninstall window."));
                    return 1;
                }
            }
            return 0;
        } catch (Exception error) {
            if (!quiet) ShowError(CapriSetupLocale.Text("openFailed", "Could not open the uninstall window.") +
                "\r\n\r\n" + CapriSetupLocale.Text("technicalDetails") + ":\r\n" + error.Message);
            return 1;
        }
    }
    private static readonly string[] BundleFiles = new string[] {
        "uninstall.ps1", "uninstall-window.cs", "common.ps1", "shell-link.cs", "localization.ps1",
        "uninstaller-text.json", "installer-config.json", "source-files.json", "registration.json", "app.ico"
    };
    private const int JsonLimit = 2 * 1024 * 1024;
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
                !Guid.TryParseExact(id, "D", out parsed) || id != id.ToLowerInvariant()) return null;
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
        // Reflection keeps old registration-test stubs containing only Recovery compatible.
        FieldInfo field = typeof(CapriUninstallInfo).GetField("BundleHashes", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
        if (field == null) return null;
        string json = field.GetValue(null) as string;
        if (String.IsNullOrEmpty(json) || json.Length > 64 * 1024) throw new InvalidDataException();
        return new JavaScriptSerializer { MaxJsonLength = 64 * 1024 }.Deserialize<Dictionary<string, string>>(json);
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
    private static bool SafeFile(string file) {
        try {
            string current = Path.GetFullPath(file);
            if ((File.GetAttributes(current) & FileAttributes.Directory) != 0) return false;
            while (current != null) {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false;
                current = Path.GetDirectoryName(current);
            }
            using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                FileInformation information;
                return GetFileInformationByHandle(stream.SafeFileHandle, out information) && information.NumberOfLinks == 1;
            }
        } catch { return false; }
    }
    private static void ShowError(string message) {
        MessageBox.Show(message, CapriSetupLocale.Text("title", "Uninstall Capri"),
            MessageBoxButtons.OK, MessageBoxIcon.Error, MessageBoxDefaultButton.Button1,
            CapriSetupLocale.RightToLeft ? MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign : 0);
    }
}
