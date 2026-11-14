# SPDX-License-Identifier: GPL-3.0-only
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$OutputEncoding=[Console]::OutputEncoding
function Test-CapriProfileRam([double]$RamGiB,[double]$RequiredGiB) {
    $reservation=[Math]::Max(0.5,[Math]::Min(2.0,($RequiredGiB/16.0)))
    return -not([double]::IsNaN($RamGiB) -or [double]::IsInfinity($RamGiB) -or [double]::IsNaN($RequiredGiB) -or [double]::IsInfinity($RequiredGiB)) -and $RequiredGiB -gt 0 -and $RamGiB -ge ($RequiredGiB-$reservation)
}
function Get-CapriHash([string]$Path) {
    $stream=[IO.File]::OpenRead($Path);
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
    finally{$algorithm.Dispose();
        $stream.Dispose()}
}
function Read-CapriJson([string]$Path) { if((Get-Item -LiteralPath $Path -Force).Length -gt 2MB){throw 'Installer metadata is too large.'};
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) }
function Write-CapriJson([string]$Path, $Value) {
    $parent = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    # Windows PowerShell 5.1 coerces $null to an empty string for this overload.
    # File.Replace then rejects the backup path on the second installation.
    $backup = $temporary + '.bak'
    try {
        $bytes=(New-Object Text.UTF8Encoding($false)).GetBytes(($Value | ConvertTo-Json -Depth 25))
        $output=New-Object IO.FileStream($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
        try{$output.Write($bytes,0,$bytes.Length);$output.Flush($true)}finally{$output.Dispose()}
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary,$Path,$backup) } else { [IO.File]::Move($temporary,$Path) }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
        if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
    }
}
function Assert-CapriNoLinks([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    $parents = New-Object 'Collections.Generic.Stack[string]'
    while ($cursor) {
        $parents.Push($cursor)
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break };
        $cursor = $parent
    }
    foreach($entry in $parents){
        try{$attributes=[IO.File]::GetAttributes($entry)}
        catch [IO.FileNotFoundException]{return}
        catch [IO.DirectoryNotFoundException]{return}
        if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Installation paths cannot contain filesystem links.'}
    }
}
function Resolve-CapriInstallFolder([string]$Directory,[string]$Source,[string]$Version) {
    if([string]::IsNullOrWhiteSpace($Directory) -or -not [IO.Path]::IsPathRooted($Directory) -or $Directory.StartsWith('\\') -or $Directory -match '[\x00-\x1f"<>|?*]'){throw 'Choose an absolute local installation folder.'}
    $selected=[IO.Path]::GetFullPath($Directory)
    Assert-CapriNoLinks $selected
    if(Test-Path -LiteralPath $selected -PathType Leaf){throw 'Choose a folder, not a file.'}
    # Browse selects a parent. Reuse an explicitly selected Capri folder or
    # managed installation instead of accidentally nesting Capri inside it.
    $leaf=[IO.Path]::GetFileName($selected.TrimEnd('\'))
    $target=if($leaf -ieq 'Capri' -or (Test-Path -LiteralPath (Join-Path $selected '.capri-install.json'))){$selected}else{Join-Path $selected 'Capri'}
    return (Assert-CapriTarget $target $Source $Version)
}
function Assert-CapriTarget([string]$Target,[string]$Source,[string]$Version) {
    if (-not [IO.Path]::IsPathRooted($Target) -or $Target.StartsWith('\\') -or $Target -match '[\x00-\x1f"<>|?*]') { throw 'Choose an absolute local installation folder.' }
    $destination = [IO.Path]::GetFullPath($Target).TrimEnd('\')
    $origin = [IO.Path]::GetFullPath($Source).TrimEnd('\')
    if ($destination -eq [IO.Path]::GetPathRoot($destination).TrimEnd('\') -or $destination -eq $env:USERPROFILE -or $destination -eq $env:SystemRoot -or $destination -eq $env:ProgramFiles -or $origin -eq $destination -or $origin.StartsWith($destination + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'This folder cannot be used as an installation target.' }
    if ($destination.StartsWith($origin+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $destination.StartsWith($origin+'\.runtime\',[StringComparison]::OrdinalIgnoreCase) -and -not $destination.StartsWith($origin+'\release\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a folder outside the source tree.' }
    Assert-CapriNoLinks $destination
    if ((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) {
        $identityPath=Join-Path $destination '.capri-install.json'
        if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) { throw 'The folder contains unrelated files. Choose an empty folder.' }
        $identity=Read-CapriJson $identityPath
        if($identity.productId -ne 'capri.desktop' -or $identity.schemaVersion -ne 1 -or $identity.root -ne $destination -or $identity.version -notmatch '^\d+\.\d+\.\d+$' -or $Version -notmatch '^\d+\.\d+\.\d+$' -or $identity.installId -notmatch '^[a-f0-9-]{36}$') { throw 'Installation identity/version does not match this folder.' }
        if([version]$Version -lt [version]$identity.version){throw 'A newer Capri version is installed. Downgrades require a separate folder.'}
    }
    return $destination
}
function Assert-CapriArchiveSingleLink([string]$File) {
    if(-not [IO.File]::Exists($File)){return}
    if(-not ('CapriInstallerFileLinks' -as [type])){
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CapriInstallerFileLinks {
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation {
        public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh,
            WriteLow, WriteHigh, VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    public static uint Count(string path) {
        using (var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
            FileInformation information;
            if (!GetFileInformationByHandle(file.SafeFileHandle, out information))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return information.Links;
        }
    }
}
'@
    }
    if([CapriInstallerFileLinks]::Count($File) -ne 1){throw 'Archive destination contains a hard-linked file.'}
}
function Expand-CapriArchive([string]$Archive,[string]$Destination,[long]$MaximumBytes=20GB) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Assert-CapriNoLinks $Destination
    $root=[IO.Path]::GetFullPath($Destination).TrimEnd('\')
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        [long]$unpacked=0
        foreach($entry in $zip.Entries) {
            $name=$entry.FullName.Replace('/','\')
            if($name -match '(^|\\)\.\.?(\\|$)|[:\x00-\x1f]' -or [IO.Path]::IsPathRooted($name) -or ((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960)) { throw 'Unsafe archive entry.' }
            $target=[IO.Path]::GetFullPath((Join-Path $root $name))
            if(-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($target.TrimEnd('\'))) { throw 'Archive path escapes or duplicates an entry.' }
            $unpacked += $entry.Length
            if($unpacked -gt $MaximumBytes) { throw 'Archive exceeds its expansion budget.' }
            Assert-CapriNoLinks $target
            Assert-CapriArchiveSingleLink $target
        }
        foreach($entry in $zip.Entries) {
            $target=Join-Path $root $entry.FullName.Replace('/','\')
            if($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { [IO.Directory]::CreateDirectory($target) | Out-Null;
                continue }
            [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
            Assert-CapriNoLinks $target
            Assert-CapriArchiveSingleLink $target
            # A running Node frontend may still be locked while npm needs repair.
            # Do not rewrite byte-identical entries from the verified archive.
            if([IO.File]::Exists($target) -and (Get-Item -LiteralPath $target -Force).Length -eq $entry.Length){
                $expectedStream=$null;$actualStream=$null;$algorithm=$null
                try{
                    $algorithm=[Security.Cryptography.SHA256]::Create()
                    $expectedStream=$entry.Open();$actualStream=[IO.File]::OpenRead($target)
                    $expected=[BitConverter]::ToString($algorithm.ComputeHash($expectedStream))
                    $actual=[BitConverter]::ToString($algorithm.ComputeHash($actualStream))
                    if($expected -eq $actual){continue}
                }finally{if($expectedStream){$expectedStream.Dispose()};if($actualStream){$actualStream.Dispose()};if($algorithm){$algorithm.Dispose()}}
            }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
        }
    } finally { $zip.Dispose() }
}
function Quote-CapriArgument([string]$Value) {
    return '"' + [regex]::Replace([regex]::Replace($Value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1') + '"'
}
function Test-CapriNodeRuntime([string]$Node) {
    # Loading npm's actual ci command resolves its transitive dependencies without
    # running npm, installing packages, or making network requests.
    $npmCommand=Join-Path (Split-Path -Parent $Node) 'node_modules/npm/lib/commands/ci.js'
    if(-not(Test-Path -LiteralPath $npmCommand -PathType Leaf)){return $false}
    Assert-CapriNoLinks $npmCommand
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$Node
    $start.Arguments='-e '+(Quote-CapriArgument 'try{require(process.argv[1]);}catch{process.exitCode=1;}')+' '+(Quote-CapriArgument $npmCommand)
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $probe=New-Object Diagnostics.Process;$probe.StartInfo=$start
    try{
        $null=$probe.Start();$probe.BeginOutputReadLine();$probe.BeginErrorReadLine()
        if(-not $probe.WaitForExit(10000)){$probe.Kill();return $false}
        return $probe.ExitCode -eq 0
    }catch{return $false}finally{$probe.Dispose()}
}
function Assert-CapriVoicePack([string]$Folder) {
    if ([string]::IsNullOrWhiteSpace($Folder) -or -not [IO.Path]::IsPathRooted($Folder) -or -not (Test-Path -LiteralPath $Folder -PathType Container)) {
        throw 'VOICE_PACK_FOLDER_MISSING'
    }
    Assert-CapriNoLinks $Folder
    $profileFile=Join-Path $Folder 'voice-profile.json'
    Assert-CapriNoLinks $profileFile
    if (-not (Test-Path -LiteralPath $profileFile -PathType Leaf)) { throw 'VOICE_PACK_PROFILE_MISSING' }
    try { $profile=Read-CapriJson $profileFile } catch { throw 'VOICE_PACK_PROFILE_INVALID' }
    if ($profile.PSObject.Properties.Name -notcontains 'schemaVersion' -or
        $profile.PSObject.Properties.Name -notcontains 'engine' -or
        $profile.PSObject.Properties.Name -notcontains 'language' -or
        $profile.PSObject.Properties.Name -notcontains 'references' -or
        $profile.schemaVersion -ne 1 -or $profile.engine -ne 'chatterbox-turbo' -or $profile.language -ne 'en') {
        throw 'VOICE_PACK_PROFILE_INVALID'
    }
    $required=@('adapter.safetensors','adapter.json')
    foreach($reference in $profile.references.PSObject.Properties.Value) {
        if($reference.PSObject.Properties.Name -notcontains 'file' -or $reference.file -notmatch '^references/[a-z0-9_-]+\.wav$') { throw 'VOICE_PACK_PROFILE_INVALID' }
        $required+=$reference.file
    }
    foreach($name in $required) {
        $file=Join-Path $Folder $name
        Assert-CapriNoLinks $file
        if(-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'VOICE_PACK_FILES_MISSING' }
    }
    return [IO.Path]::GetFullPath($Folder)
}
function Get-CapriNodeBootstrapSources($Spec) {
    if($Spec.version -cnotmatch '^\d+\.\d+\.\d+$' -or $Spec.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $Spec.bytes -le 0){throw 'Invalid Node bootstrap manifest.'}
    $version='v'+$Spec.version
    $file='node-'+$version+'-win-x64.zip'
    if($Spec.url -cne ('https://nodejs.org/dist/'+$version+'/'+$file)){throw 'Invalid Node bootstrap manifest.'}
    $sources=@([string]$Spec.url)
    if($Spec.PSObject.Properties['mirrors']){
        $mirrors=@($Spec.mirrors)
        if($mirrors.Count -ne 1 -or $mirrors[0] -cne ('https://cdn.npmmirror.com/binaries/node/'+$version+'/'+$file)){throw 'Invalid Node bootstrap mirror.'}
        $sources+=$mirrors
    }
    return $sources
}
function Invoke-CapriDownloadRetry {
    param([Parameter(Mandatory=$true)][ScriptBlock]$Operation,[ScriptBlock]$Cancelled={ $false },[ScriptBlock]$Notify={},[int]$Attempts=3,[int]$DelayMilliseconds=1000)
    for($attempt=1;$attempt -le $Attempts;$attempt++) {
        if(& $Cancelled){throw 'Installation cancelled.'}
        try { return (& $Operation $attempt) }
        catch {
            if(& $Cancelled){throw 'Installation cancelled.'}
            $exception=$_.Exception
            $transient=$false
            while($exception){
                if($exception -is [IO.IOException] -or $exception -is [TimeoutException] -or $exception.GetType().FullName -in @('System.Net.Http.HttpRequestException','System.Net.Sockets.SocketException','System.Threading.Tasks.TaskCanceledException')){$transient=$true}
                $exception=$exception.InnerException
            }
            if(-not $transient -or $attempt -ge $Attempts){throw}
            & $Notify ($attempt+1) $Attempts
            for($elapsed=0;$elapsed -lt $DelayMilliseconds;$elapsed+=100){
                if(& $Cancelled){throw 'Installation cancelled.'}
                [Threading.Thread]::Sleep([Math]::Min(100,$DelayMilliseconds-$elapsed))
            }
        }
    }
}
function Wait-CapriDownloadTask {
    param([Parameter(Mandatory=$true)][Threading.Tasks.Task]$Task,[ScriptBlock]$Cancelled={ $false },[int]$TimeoutMilliseconds=60000)
    if($TimeoutMilliseconds -le 0){throw 'A positive download timeout is required.'}
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while($true){
        if(& $Cancelled){throw 'Installation cancelled.'}
        $remaining=$TimeoutMilliseconds-$watch.ElapsedMilliseconds
        if($remaining -le 0){throw (New-Object TimeoutException('The download stopped responding. Retry the installation.'))}
        # Wait wakes as soon as bytes arrive. Sleeping for 100 ms on every
        # incomplete read imposes a throughput ceiling on small network reads.
        try {$completed=$Task.Wait([int][Math]::Min(100,$remaining))}
        catch {throw $_.Exception.GetBaseException()}
        if($completed){return}
    }
}
