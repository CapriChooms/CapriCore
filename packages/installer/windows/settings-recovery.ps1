# SPDX-License-Identifier: GPL-3.0-only
# Only desktop preferences whose readers supply defaults when the file is absent.
# Never enumerate the profile: it also contains conversations, keys and databases.
function Reset-CapriDesktopPreferences([string]$Target,[string]$Source,[string]$Version) {
    $root=Assert-CapriTarget $Target $Source $Version
    $identity=Join-Path $root '.capri-install.json'
    Assert-CapriNoLinks $identity
    if(-not [IO.File]::Exists($identity)){throw 'Choose an existing Capri installation.'}
    $cache=Join-Path $root '.runtime/installer'
    $lockFile=Join-Path $cache 'install.lock.json'
    Assert-CapriNoLinks $lockFile
    [IO.Directory]::CreateDirectory($cache)|Out-Null
    # Same lock name and PID format as the updater. Windows releases it even if Setup exits.
    $lock=[IO.FileStream]::new($lockFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::DeleteOnClose)
    try {
        $record=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;id=[Guid]::NewGuid().ToString()}|ConvertTo-Json -Compress))
        $lock.Write($record,0,$record.Length);$lock.Flush($true)
        foreach($service in @('desktop','capri')){
            $marker=Join-Path $root ('data/run/'+$service+'.json')
            Assert-CapriNoLinks $marker
            if([IO.File]::Exists($marker)){
                $owner=(Read-CapriJson $marker).pid
                if([int]$owner -gt 0 -and (Get-Process -Id $owner -ErrorAction SilentlyContinue)){throw 'Quit Capri and unload its models before resetting preferences.'}
            }
        }
        $preferences=@('avatar','avatar-layout','companion','dimming','window','window-graphics','presence',
            'skills','initiative','music-listening','chess','screen-observation','voice-effects','voice-volume','microphone','audio-routing')
        $desktop=Join-Path $root 'data/desktop'
        $backup=Join-Path $cache ('settings-backups/'+[Guid]::NewGuid().ToString('N'))
        Assert-CapriNoLinks $backup
        $files=@(foreach($name in $preferences){
            $file=Join-Path $desktop ($name+'.json')
            Assert-CapriNoLinks $file
            if([IO.Directory]::Exists($file)){throw ('Expected a settings file: '+$name)}
            if([IO.File]::Exists($file)){Assert-CapriArchiveSingleLink $file;$name+'.json'}
        })
        if(-not $files.Count){return}
        [IO.Directory]::CreateDirectory($backup)|Out-Null
        $moved=[Collections.Generic.Stack[string]]::new()
        try{
            foreach($name in $files){
                [IO.File]::Move((Join-Path $desktop $name),(Join-Path $backup $name))
                $moved.Push($name)
            }
        }catch{
            while($moved.Count){$name=$moved.Pop();[IO.File]::Move((Join-Path $backup $name),(Join-Path $desktop $name))}
            throw
        }
        return $backup
    }finally{$lock.Dispose()}
}
