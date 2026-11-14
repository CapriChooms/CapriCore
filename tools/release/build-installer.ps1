param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$Version,
    [string]$VoicePack,
    [string]$SignTool,
    [string]$SigningThumbprint,
    [uri]$TimestampUrl
)
# SPDX-License-Identifier: GPL-3.0-only
$ErrorActionPreference='Stop'
$sign = [bool]($SignTool -or $SigningThumbprint -or $TimestampUrl)
if ($sign) {
    if (-not $SignTool -or -not (Test-Path -LiteralPath $SignTool -PathType Leaf) -or
        $SigningThumbprint -notmatch '^[a-f0-9]{40}$' -or -not $TimestampUrl -or
        -not $TimestampUrl.IsAbsoluteUri -or $TimestampUrl.Scheme -notin @('http', 'https') -or
        $TimestampUrl.UserInfo) {
        throw 'A Windows SDK SignTool path, code-signing certificate thumbprint and RFC 3161 timestamp URL are required.'
    }
    $certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $SigningThumbprint) -ErrorAction SilentlyContinue
    if (-not $certificate -or -not $certificate.HasPrivateKey -or
        $certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) {
        throw 'The current user certificate store has no valid signing certificate with that thumbprint and a private key.'
    }
}
. (Join-Path $PSScriptRoot '../../packages/installer/windows/common.ps1')
$capriBuildRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid package version.'}
$releaseRoot=(Join-Path $capriBuildRoot 'release')+'\'
foreach($folder in @($Source,$Destination)){if(-not [IO.Path]::GetFullPath($folder).StartsWith($releaseRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Installer build inputs and outputs must stay in release.'}}
[IO.Directory]::CreateDirectory($Destination)|Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload=Join-Path $Destination 'source.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($Source,$payload,[IO.Compression.CompressionLevel]::Optimal,$false)
$checksum=(Get-CapriHash $payload)
$voiceChecksum=''
$voiceResource=@()
if($VoicePack){
    $VoicePack=[IO.Path]::GetFullPath($VoicePack)
    if(-not $VoicePack.StartsWith($releaseRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Voice build input must stay in release.'}
    Assert-CapriNoLinks $VoicePack
    $null=Assert-CapriVoicePack $VoicePack
    $voicePayload=Join-Path $Destination 'voice.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($VoicePack,$voicePayload,[IO.Compression.CompressionLevel]::Optimal,$false)
    $voiceChecksum=Get-CapriHash $voicePayload
    $voiceResource=@('/resource:'+$voicePayload+',CapriVoicePayload')
}
$generated=Join-Path $Destination 'PayloadInfo.cs'
$assemblyVersion=$Version+'.0'
[IO.File]::WriteAllText($generated,('[assembly:System.Reflection.AssemblyTitle("Capri Setup")]'+[Environment]::NewLine+'[assembly:System.Reflection.AssemblyVersion("'+$assemblyVersion+'")]'+[Environment]::NewLine+'internal static class CapriPayloadInfo { internal const string Sha256="'+$checksum+'"; internal const string VoiceSha256="'+$voiceChecksum+'"; }'))
$icon=Join-Path $Destination 'setup.ico'
# Preserve every size from the reviewed application icon, including small taskbar
# and Explorer variants, instead of rasterizing the old fallback avatar.
Copy-Item -LiteralPath (Join-Path $Source 'assets/default/app.ico') -Destination $icon -Force
$csc=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(-not(Test-Path -LiteralPath $csc)){throw 'The Windows .NET Framework compiler is unavailable.'}
$exe=Join-Path $Destination ('CapriSetup-'+$Version+'.exe')
$buildExe = $exe
if ($sign) {
    $staging = Join-Path $Destination '.signing'
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    $buildExe = Join-Path $staging ([IO.Path]::GetFileName($exe))
}
& $csc /nologo /target:winexe /platform:x64 /optimize+ ('/out:'+$buildExe) ('/win32icon:'+$icon) ('/win32manifest:'+(Join-Path $capriBuildRoot 'packages/installer/windows/launcher.manifest')) ('/resource:'+$payload+',CapriPayload') ('/resource:'+(Join-Path $Source 'config/installer-text.json')+',CapriSetupTranslations') @voiceResource /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $capriBuildRoot 'packages/installer/windows/launcher.cs') (Join-Path $capriBuildRoot 'packages/installer/windows/setup-localization.cs') $generated
if($LASTEXITCODE -ne 0){throw 'Installer launcher compilation failed.'}
if ($sign) {
    & $SignTool sign /s My /sha1 $SigningThumbprint /fd SHA256 /tr $TimestampUrl.AbsoluteUri /td SHA256 $buildExe
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing or timestamping failed.' }
    & $SignTool verify /pa /all /tw $buildExe
    if ($LASTEXITCODE -ne 0) { throw 'SignTool could not verify the timestamped Authenticode signature.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $buildExe
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or
        $signature.SignerCertificate.Thumbprint -ine $SigningThumbprint) {
        throw 'The installer signature is invalid, lacks a timestamp or uses a different certificate.'
    }
    Move-Item -LiteralPath $buildExe -Destination $exe -ErrorAction Stop
}
Write-Output $exe
