# SPDX-License-Identifier: GPL-3.0-only
# Read only owned metadata. Never start Ollama, load a model, or query the network.
function Get-CapriSetupModels([string]$Target,$CatalogProfiles) {
    $script:installedModelNames=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $inventory=Join-Path $Target 'data/model-inventory.json'
    try {
        if(Test-Path -LiteralPath $inventory -PathType Leaf){
            Assert-CapriNoLinks $inventory
            foreach($model in @((Read-CapriJson $inventory).models)){
                if($model.name -match '^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$'){$null=$script:installedModelNames.Add($model.name)}
            }
        }
    }catch{} # A damaged inventory must not prevent selecting a repair/download.
    $profiles=@($CatalogProfiles)
    foreach($profile in $CatalogProfiles){
        $alias=if($profile.model -like 'qwen3.5:*'){'capri-'+$profile.model}else{$profile.model}
        foreach($name in @($profile.model,$alias)){
            $parts=$name.Split(':');$tag=if($parts.Count -gt 1){$parts[1]}else{'latest'}
            $file=Join-Path $Target ('data/models/manifests/registry.ollama.ai/library/'+$parts[0]+'/'+$tag)
            try{Assert-CapriNoLinks $file;if(Test-Path -LiteralPath $file -PathType Leaf){$null=$script:installedModelNames.Add($name)}}catch{}
        }
    }
    $packages=Join-Path $Target 'data/huggingface/packages'
    try {
        Assert-CapriNoLinks $packages
        if(Test-Path -LiteralPath $packages -PathType Container){
            foreach($entry in @(Get-ChildItem -LiteralPath $packages -Directory | Where-Object{$_.Name -cmatch '^hf-[a-f0-9]{24}$'} | Select-Object -First 100)){
                try {
                    $file=Join-Path $entry.FullName 'receipt.json';Assert-CapriNoLinks $file
                    $receipt=Read-CapriJson $file;$profile=$receipt.profile
                    $complete=$receipt.task -ceq 'llm' -and @($receipt.files).Count -gt 0 -and @($receipt.files).Count -le 129
                    foreach($artifact in @($receipt.files)){
                        if($artifact.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $artifact.bytes -lt 12){$complete=$false;break}
                        $blob=Join-Path $Target ('data/huggingface/blobs/'+$artifact.sha256);Assert-CapriNoLinks $blob
                        if(-not(Test-Path -LiteralPath $blob -PathType Leaf) -or (Get-Item -LiteralPath $blob).Length -ne $artifact.bytes){$complete=$false;break}
                    }
                    if($complete -and $receipt.id -ceq $entry.Name -and $profile.id -ceq $entry.Name -and $profile.source -ceq 'huggingface' -and
                       $profile.model -ceq ('capri-'+$entry.Name+':latest') -and $profile.alias -ceq $profile.model){
                        $profiles+=@($profile)
                        $null=$script:installedModelNames.Add($profile.model)
                    }
                }catch{} # The worker revalidates receipts and artifacts before applying a choice.
            }
        }
    }catch{}
    return $profiles
}
function Get-CapriSetupProfileForConfig($Config,$Profiles) {
    foreach($key in @('model','upstreamModel')){
        $value=$Config.PSObject.Properties[$key]
        if(-not $value){continue}
        foreach($profile in $Profiles){
            $alias=if($profile.PSObject.Properties['alias']){$profile.alias}elseif($profile.model -like 'qwen3.5:*'){'capri-'+$profile.model}else{$profile.model}
            if($value.Value -ceq $alias -or $value.Value -ceq $profile.model){return $profile.id}
        }
    }
    if($Config.PSObject.Properties['resourceProfile'] -and $Config.resourceProfile -in @($Profiles.id)){return $Config.resourceProfile}
}
