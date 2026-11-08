# SPDX-License-Identifier: GPL-3.0-only
param(
    [Parameter(Mandatory=$true)][ValidateSet('archive','voice','multilingual','qwen','recognition-en','recognition-multi','recognition-fast-multi')][string]$Component,
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9]+$')][string]$OwnerStamp,
    [Parameter(Mandatory=$true)][string]$ArgumentsBase64
)
$ErrorActionPreference='Stop'
$capriOwnedRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if($ArgumentsBase64.Length -gt 65536){throw 'Speech installer arguments are too large.'}
$capriOwnedDecoded=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsBase64))
if(-not $capriOwnedDecoded.Trim().StartsWith('[')){throw 'Speech installer arguments must be an array.'}
$capriOwnedParsed=$capriOwnedDecoded|ConvertFrom-Json
$capriOwnedArguments=@()
if($null -ne $capriOwnedParsed){$capriOwnedArguments=@($capriOwnedParsed)}
foreach($capriOwnedArgument in $capriOwnedArguments){if($capriOwnedArgument -isnot [string]){throw 'Invalid speech installer argument.'}}
$capriOwnedAllowed=@{
    archive=@('Archive','Destination','MaximumBytes'); voice=@('DependenciesOnly');
    multilingual=@('Language'); qwen=@(); 'recognition-en'=@(); 'recognition-multi'=@(); 'recognition-fast-multi'=@()
}
$capriOwnedParameters=@{}
for($capriOwnedIndex=0;$capriOwnedIndex -lt $capriOwnedArguments.Count;$capriOwnedIndex++){
    $capriOwnedName=$capriOwnedArguments[$capriOwnedIndex]
    if(-not $capriOwnedName.StartsWith('-')){throw 'Invalid speech installer parameter.'}
    $capriOwnedName=$capriOwnedName.Substring(1)
    if($capriOwnedName -notin $capriOwnedAllowed[$Component] -or $capriOwnedParameters.ContainsKey($capriOwnedName)){throw 'Unsupported speech installer parameter.'}
    if($capriOwnedName -eq 'DependenciesOnly'){$capriOwnedParameters[$capriOwnedName]=$true}
    else {
        $capriOwnedIndex++
        if($capriOwnedIndex -ge $capriOwnedArguments.Count){throw 'Missing speech installer parameter value.'}
        $capriOwnedParameters[$capriOwnedName]=$capriOwnedArguments[$capriOwnedIndex]
    }
}
$capriOwnedScripts=@{
    archive='packages/installer/windows/archive.ps1'; voice='tools/setup/setup-voice-training.ps1';
    multilingual='tools/setup/setup-multilingual-voice.ps1'; qwen='tools/setup/setup-qwen-tts.ps1'; 'recognition-en'='tools/setup/setup-streaming-asr.ps1';
    'recognition-multi'='tools/setup/setup-multilingual-asr.ps1'; 'recognition-fast-multi'='tools/setup/setup-fast-multilingual-asr.ps1'
}
Add-Type -Path (Join-Path $capriOwnedRoot 'packages/installer/windows/speech-owner.cs')
$capriOwnedGuard=New-Object Capri.Setup.SpeechOwner($OwnerPid,$OwnerStamp)
try {
    & (Join-Path $capriOwnedRoot $capriOwnedScripts[$Component]) @capriOwnedParameters
    if($LASTEXITCODE){exit $LASTEXITCODE}
} finally { $capriOwnedGuard.Dispose() }
