param([switch]$DependenciesOnly,[switch]$PlanOnly,[ValidateSet('auto','legacy','blackwell','amd')][string]$VoiceRuntime='auto')
$ErrorActionPreference = 'Stop'
$capriRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $capriRoot
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$capriRuntime = Get-CapriPythonRuntime -ProjectRoot $capriRoot
$capriUv = $capriRuntime.Uv
$capriPython = $capriRuntime.Python
# Extra user indexes must not shadow the pinned public package sources.
foreach($capriIndexVariable in @('UV_INDEX','UV_EXTRA_INDEX_URL','UV_INDEX_URL','UV_DEFAULT_INDEX','UV_FIND_LINKS','UV_NO_INDEX','UV_INDEX_STRATEGY','UV_TORCH_BACKEND','UV_OVERRIDE','UV_CONSTRAINT','UV_BUILD_CONSTRAINT')){
    [Environment]::SetEnvironmentVariable($capriIndexVariable,$null,'Process')
}
$capriSelectionJson = & $capriPython tools/setup/select-voice-runtime.py --profile $VoiceRuntime
if($LASTEXITCODE -ne 0){throw 'Could not select a compatible voice runtime.'}
$capriVoiceRuntime=$capriSelectionJson|ConvertFrom-Json
if($capriVoiceRuntime.profile -eq 'amd'){
    $env:ROCM_SDK_TARGET_FAMILY='custom'
    if([Environment]::OSVersion.Version.Build -lt 22000){throw 'Experimental AMD voice requires Windows 11 and AMD Adrenalin 26.2.2 or newer.'}
    $capriRuntime=Get-CapriPythonRuntime -ProjectRoot $capriRoot -Version '3.12.12'
    $capriPython=$capriRuntime.Python
    Write-Host 'Experimental AMD ROCm voice: supported Radeon GPUs only, inference only. Install AMD Adrenalin 26.2.2 or newer. Hardware qualification is still in progress.'
}
$capriVenvPython = Ensure-CapriVirtualEnvironment -ProjectRoot $capriRoot -Name 'voice-training-venv' -Runtime $capriRuntime
Write-Host ('Voice runtime: '+$capriVoiceRuntime.profile+' / PyTorch '+$capriVoiceRuntime.torch+' / '+$capriVoiceRuntime.backend)
$capriRequirements=$capriVoiceRuntime.requirements
$capriOverrides=$capriVoiceRuntime.overrides
$capriPrepared=$false
$capriGeneratedLocks=@()
try {
if(-not $PlanOnly -and $env:OS -eq 'Windows_NT' -and $capriVoiceRuntime.profile -in @('legacy','blackwell')){
    $capriLockId=[Guid]::NewGuid().ToString('N')
    $capriStageRequirements=Join-Path $capriRoot ('.runtime/voice-training-venv/chatterbox-requirements-'+$capriLockId+'.txt')
    $capriGeneratedLocks+= $capriStageRequirements
    $capriWheelArgs=@($capriVoiceRuntime.profile,$capriStageRequirements)
    if($capriOverrides){
        $capriStageOverrides=Join-Path $capriRoot ('.runtime/voice-training-venv/chatterbox-overrides-'+$capriLockId+'.txt')
        $capriGeneratedLocks+= $capriStageOverrides
        $capriWheelArgs+=@('--overrides',$capriStageOverrides)
    }
    & $capriVenvPython -m integrations.voice_runtime.chatterbox_wheels @capriWheelArgs
    if($LASTEXITCODE -ne 0){throw 'The pinned CUDA voice packages could not be downloaded.'}
    $capriPrepared=Test-Path -LiteralPath $capriStageRequirements -PathType Leaf
    if($capriPrepared){
        $capriRequirements=$capriStageRequirements
        if($capriOverrides){$capriOverrides=$capriStageOverrides}
    }
}
$capriVoiceSync=@('pip','sync','--python',$capriVenvPython,$capriRequirements,'--torch-backend',$capriVoiceRuntime.backend,'--default-index','https://pypi.org/simple','--index-strategy','first-index')
if($capriVoiceRuntime.PSObject.Properties.Name -contains 'overrides'){
    # pip sync consumes a complete lock without dependency overrides. Use the
    # resolver's exact install for this reviewed upstream version-pin exception.
    $capriVoiceSync=@('pip','install','--exact','--python',$capriVenvPython,'--requirements',$capriRequirements,'--overrides',$capriOverrides,'--torch-backend',$capriVoiceRuntime.backend,'--default-index','https://pypi.org/simple','--index-strategy','first-index')
}
if($capriVoiceRuntime.profile -eq 'amd'){
    $capriVoiceSync=@('pip','install','--exact','--python',$capriVenvPython,'--requirements',$capriVoiceRuntime.requirements,'--overrides',$capriVoiceRuntime.overrides,'--default-index','https://pypi.org/simple','--index-strategy','first-index')
}
if($PlanOnly){$capriVoiceSync+='--dry-run'}
$capriTransportArgs=@('--uv',$capriUv,'--windows-git-trust')
if($capriVoiceRuntime.profile -ne 'amd' -and -not $capriPrepared){$capriTransportArgs+=@('--pytorch-profile',$capriVoiceRuntime.profile)}
& $capriPython tools/setup/uv-retry.py @capriTransportArgs -- @capriVoiceSync
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies could not be installed' }
} finally {
    foreach($capriLockFile in $capriGeneratedLocks){
        if(Test-Path -LiteralPath $capriLockFile -PathType Leaf){Remove-Item -LiteralPath $capriLockFile}
    }
}
if($PlanOnly){return}

function Invoke-CapriVoiceComputeProbe {
    $lines=@(& $capriVenvPython -m integrations.voice_training doctor --runtime-only)
    $code=$LASTEXITCODE
    $lines | Write-Host
    $report=$null
    if($code -eq 0 -and $lines.Count){$report=$lines[-1] | ConvertFrom-Json}
    return @{code=$code;ready=[bool]($report.cuda -and $report.cudaCompute.kernelReady);error=$report.cudaCompute.error}
}

if(-not $DependenciesOnly -or $capriVoiceRuntime.profile -eq 'amd'){
    $probe=Invoke-CapriVoiceComputeProbe
    $adapterCount=[Math]::Min(8,[int]$capriVoiceRuntime.amdAdapterCount)
    $hipMask=[Environment]::GetEnvironmentVariable('HIP_VISIBLE_DEVICES','Process')
    $cudaMask=[Environment]::GetEnvironmentVariable('CUDA_VISIBLE_DEVICES','Process')
    if(-not $probe.ready -and $capriVoiceRuntime.profile -eq 'amd' -and $adapterCount -gt 1 -and
       $null -eq $hipMask -and $null -eq $cudaMask -and $probe.code -in @(0,-1073741819,3221225477)){
        try {
            # ROCm ordinals need not match Windows display order. Test each candidate in
            # a clean process and only retain the one that actually executes GPU kernels.
            for($adapter=0;$adapter -lt $adapterCount;$adapter++){
                Write-Host ('Retrying AMD voice compute with only HIP adapter '+$adapter+'.')
                $env:HIP_VISIBLE_DEVICES=[string]$adapter
                $candidate=Invoke-CapriVoiceComputeProbe
                if($candidate.ready){
                    $probe=$candidate
                    $capriVoiceRuntime | Add-Member -NotePropertyName hipVisibleDevice -NotePropertyValue $adapter
                    break
                }
            }
        } finally {
            [Environment]::SetEnvironmentVariable('HIP_VISIBLE_DEVICES',$hipMask,'Process')
        }
    }
    if($probe.code -ne 0){
        throw ('The voice runtime could not be inspected ('+$capriVoiceRuntime.backend+', exit '+$probe.code+'). Check the output above, or choose text-only replies to finish Setup.')
    }
    if(-not $probe.ready){
        throw ('The selected voice runtime is not ready. '+$probe.error+' Check the GPU driver and choose a compatible voice.')
    }
}
if(-not $DependenciesOnly){
    & $capriVenvPython -m integrations.voice_training init
    if($LASTEXITCODE -ne 0){throw 'Voice folders could not be created'}
    # The download command verifies every pinned file before writing the model receipt.
    & $capriVenvPython -m integrations.voice_training download
    if($LASTEXITCODE -ne 0){throw 'The pinned voice model could not be downloaded'}
}
[IO.File]::WriteAllText((Join-Path $capriRoot '.runtime/voice-runtime.json'),($capriVoiceRuntime|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
