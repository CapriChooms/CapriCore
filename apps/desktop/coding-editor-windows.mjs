// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { win32 as path } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const discoveryScript = String.raw`
  $ErrorActionPreference = 'Stop'
  $env:PSModulePath = Join-Path $PSHOME 'Modules'
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $known = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($file in (ConvertFrom-Json -InputObject $env:CAPRI_EDITOR_NAMES)) {
    [void]$known.Add($file)
  }
  $executables = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $installLocations = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $products = '^(?:JetBrains(?:\s|$)|IntelliJ IDEA|PyCharm|WebStorm|PhpStorm|Rider|CLion|GoLand|RubyMine|DataGrip|DataSpell|RustRover|Android Studio|(?:Microsoft )?Visual Studio(?:\s|$)|VS Code|Cursor(?:\s|$)|Windsurf(?:\s|$)|VSCodium|Sublime Text|Notepad\+\+|Neovim|Neovide|(?:GNU )?Emacs)'
  $drives = @{}

  function LocalPath($value) {
    if ($value -isnot [string]) { return }
    $full = [Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
    if ($full.Length -gt 1024 -or $full -notmatch '^[a-z]:[\\/]' -or $full -match '[<>|?*"\x00-\x1f]' -or $full.Substring(2).Contains(':')) { return }
    $full = [IO.Path]::GetFullPath($full)
    $drive = [IO.Path]::GetPathRoot($full)
    if (!$drives.ContainsKey($drive)) {
      $drives[$drive] = ([IO.DriveInfo]::new($drive).DriveType -ne [IO.DriveType]::Network)
    }
    if ($drives[$drive]) { return $full }
  }

  function AddExecutable($value) {
    if ($executables.Count -ge 160) { return }
    $full = LocalPath $value
    if ($full -and $known.Contains([IO.Path]::GetFileName($full))) {
      [void]$executables.Add($full)
    }
  }

  function ReadRegistry($hive, $view) {
    try {
      $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        foreach ($file in $known) {
          try {
            $entry = $root.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\App Paths\$file")
            if (!$entry) { continue }
            try { AddExecutable ($entry.GetValue('')) }
            finally { $entry.Dispose() }
          } catch {}
        }
        $installed = $root.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
        if (!$installed) { return }
        try {
          foreach ($id in ($installed.GetSubKeyNames() | Select-Object -First 2048)) {
            if ($timer.ElapsedMilliseconds -gt 2500 -or $installLocations.Count -ge 128) { break }
            try {
              $entry = $installed.OpenSubKey($id)
              if (!$entry) { continue }
              try {
                AddExecutable (([string]$entry.GetValue('DisplayIcon')) -replace ',\s*-?\d+\s*$','')
                if ($entry.GetValue('DisplayName') -notmatch $products) { continue }
                $location = LocalPath ($entry.GetValue('InstallLocation'))
                if ($location -and $location.Length -gt 3) { [void]$installLocations.Add($location) }
              } finally { $entry.Dispose() }
            } catch {}
          }
        } finally { $installed.Dispose() }
      } finally { $root.Dispose() }
    } catch {}
  }

  foreach ($hive in @('CurrentUser', 'LocalMachine')) {
    foreach ($view in @('Registry64', 'Registry32')) {
      ReadRegistry $hive $view
    }
  }

  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  foreach ($file in $known) {
    if ($timer.ElapsedMilliseconds -gt 3200 -or $executables.Count -ge 160) { break }
    $name = [IO.Path]::GetFileNameWithoutExtension($file)
    foreach ($process in [Diagnostics.Process]::GetProcessesByName($name)) {
      try {
        if ($process.SessionId -eq $session) { AddExecutable $process.MainModule.FileName }
      } catch {} finally { $process.Dispose() }
    }
  }

  try {
    $shell = New-Object -ComObject WScript.Shell
    $pending = [Collections.Generic.Queue[object]]::new()
    foreach ($folder in @('StartMenu', 'CommonStartMenu')) {
      $start = LocalPath ([Environment]::GetFolderPath($folder))
      if ($start) { $pending.Enqueue(@{ path = $start; depth = 0 }) }
    }
    $directories = 0
    $shortcuts = 0
    while ($pending.Count -and $directories -lt 128 -and $shortcuts -lt 768 -and $timer.ElapsedMilliseconds -lt 4200) {
      $folder = $pending.Dequeue()
      $directories++
      try {
        if ([IO.File]::GetAttributes($folder.path) -band [IO.FileAttributes]::ReparsePoint) { continue }
        foreach ($link in [IO.Directory]::EnumerateFiles($folder.path, '*.lnk')) {
          if (++$shortcuts -gt 768 -or $timer.ElapsedMilliseconds -ge 4200) { break }
          try {
            if ([IO.File]::GetAttributes($link) -band [IO.FileAttributes]::ReparsePoint) { continue }
            $shortcut = $shell.CreateShortcut($link)
            try { AddExecutable $shortcut.TargetPath }
            finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) }
          } catch {}
        }
        if ($folder.depth -ge 5) { continue }
        foreach ($directory in [IO.Directory]::EnumerateDirectories($folder.path)) {
          if ($pending.Count + $directories -ge 128) { break }
          $pending.Enqueue(@{ path = $directory; depth = $folder.depth + 1 })
        }
      } catch {}
    }
  } catch {}

  $result = @{
    executables = [string[]]$executables
    installLocations = [string[]]$installLocations
  }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;
const command = Buffer.from(discoveryScript, 'utf16le').toString('base64');

function localDrivePath(value) {
  return (
    typeof value === 'string' &&
    value.length <= 1024 &&
    /^[a-z]:[\\/]/i.test(value) &&
    !/[<>|?*"\x00-\x1f:]/.test(value.slice(2))
  );
}

function distinctPaths(values) {
  const paths = new Map();
  for (const value of values) {
    if (!localDrivePath(value)) continue;
    const full = path.normalize(value);
    const key = full.toLowerCase();
    if (!paths.has(key)) paths.set(key, full);
  }
  return [...paths.values()];
}

async function windowsRegistrations(names, env) {
  const windows = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  if (!localDrivePath(windows)) return null;
  try {
    const { stdout } = await run(
      path.join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command],
      {
        env: { ...env, CAPRI_EDITOR_NAMES: JSON.stringify(names) },
        windowsHide: true,
        timeout: 6500,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
      },
    );
    return JSON.parse(stdout.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

async function visualStudioPaths(env) {
  const program = env['ProgramFiles(x86)'] || env.ProgramFiles;
  if (!localDrivePath(program)) return [];
  const locator = path.join(program, 'Microsoft Visual Studio/Installer/vswhere.exe');
  try {
    if (!(await lstat(locator)).isFile()) return [];
    const { stdout } = await run(
      locator,
      ['-legacy', '-prerelease', '-utf8', '-find', 'Common7\\IDE\\devenv.exe'],
      { env, windowsHide: true, timeout: 1800, maxBuffer: 65536, encoding: 'utf8' },
    );
    return stdout
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim());
  } catch {
    return [];
  }
}

/** Read Windows' local installation metadata without opening editors or shortcuts. */
export async function readWindowsEditorMetadata(executableNames, env = process.env) {
  if (process.platform !== 'win32') return { executables: [], installLocations: [] };
  const names = new Set(
    [...executableNames]
      .slice(0, 100)
      .filter((file) => typeof file === 'string' && /^[\w .+-]{1,72}\.exe$/i.test(file))
      .map((file) => file.toLowerCase()),
  );
  if (!names.size) return { executables: [], installLocations: [] };
  const [registration, studio] = await Promise.all([
    windowsRegistrations([...names], env),
    names.has('devenv.exe') ? visualStudioPaths(env) : [],
  ]);
  return {
    executables: distinctPaths([
      ...(Array.isArray(registration?.executables) ? registration.executables : []),
      ...studio,
    ]).filter((file) => names.has(path.basename(file).toLowerCase())),
    installLocations: distinctPaths(
      Array.isArray(registration?.installLocations) ? registration.installLocations : [],
    ),
  };
}
