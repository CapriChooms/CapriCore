# SPDX-License-Identifier: GPL-3.0-only
param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$output=Join-Path $Root '.runtime/coding-vscode/capri-project-bridge.vsix'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
$stream=[IO.File]::Open($output,[IO.FileMode]::Create)
$zip=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
    foreach($name in @('package.json','extension.cjs')) {
        $entry=$zip.CreateEntry('extension/'+$name);$writer=New-Object IO.StreamWriter($entry.Open(),(New-Object Text.UTF8Encoding($false)))
        try{$writer.Write([IO.File]::ReadAllText((Join-Path $Root ('integrations/coding-vscode/'+$name))))}finally{$writer.Dispose()}
    }
    $metadata=@{
        '[Content_Types].xml'='<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
        'extension.vsixmanifest'='<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="capri-project-bridge" Version="0.1.0" Publisher="capricore"/><DisplayName>Capri Project Bridge</DisplayName><Description xml:space="preserve">Local project documents and diagnostics for Capri.</Description><Tags>capri</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
    }
    foreach($name in $metadata.Keys){$entry=$zip.CreateEntry($name);$writer=New-Object IO.StreamWriter($entry.Open(),(New-Object Text.UTF8Encoding($false)));try{$writer.Write($metadata[$name])}finally{$writer.Dispose()}}
} finally {$zip.Dispose();$stream.Dispose()}
Write-Output $output
