param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$expected=@('yamnet.onnx','yamnet.data','labels.txt','metadata.json')
$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
    foreach($entry in $zip.Entries){
        if($entry.FullName -eq 'yamnet-onnx-float/'){continue}
        if($entry.FullName -notmatch '^yamnet-onnx-float/(yamnet\.onnx|yamnet\.data|labels\.txt|metadata\.json)$' -or $entry.Length -gt 20MB){throw 'Invalid music detector archive'}
        $name=$Matches[1]
        if(-not $seen.Add($name)){throw 'Duplicate music detector entry'}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $Destination $name))
    }
    if($seen.Count -ne $expected.Count){throw 'Incomplete music detector archive'}
} finally {$zip.Dispose()}
