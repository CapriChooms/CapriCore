# SPDX-License-Identifier: GPL-3.0-only
# Catalog helpers shared by the Windows installer, updater and uninstaller.
function Get-CapriInstallerCulture([string]$Culture,$Languages) {
    $base=($Culture -split '-')[0].ToLowerInvariant()
    $aliases=@{fil='tl';nb='no';nn='no';iw='he'}
    if($aliases.ContainsKey($base)){$base=$aliases[$base]}
    if(@($Languages|Where-Object{$_.id -eq $base}).Count){return $base}
    return 'en'
}
function Get-CapriCatalogLanguages($Translations) {
    return @($Translations.PSObject.Properties.Name | ForEach-Object {@{id=$_}})
}
function Get-CapriInstalledLanguage([string]$Root,$Translations) {
    $languages=Get-CapriCatalogLanguages $Translations
    $fallback=Get-CapriInstallerCulture ([Globalization.CultureInfo]::CurrentUICulture.Name) $languages
    try {
        $path=Join-Path $Root 'data/desktop/languages.json'
        Assert-CapriNoLinks $path
        if(Test-Path -LiteralPath $path -PathType Leaf){
            $configured=(Read-CapriJson $path).settings.interface
            if($configured -in $Translations.PSObject.Properties.Name){return $configured}
        }
    } catch {} # An unavailable preference leaves the Windows language in effect.
    return $fallback
}
function Get-CapriInstallerText($Translations,[string]$Language,[string]$Key) {
    foreach($id in @($Language,'en')){
        $locale=$Translations.PSObject.Properties[$id]
        if(-not $locale){continue}
        $value=$locale.Value
        foreach($part in ($Key -split '\.')){
            if(-not $value){break}
            $property=$value.PSObject.Properties[$part]
            $value=if($property){$property.Value}else{$null}
        }
        if($value -is [string] -and $value.Length){return $value}
    }
    return $Key
}
function Test-CapriSetupNetworkError([string]$Message,[string]$Code='',[Exception]$Exception=$null) {
    # Transport types remain recognizable even when Windows localizes their messages.
    for($depth=0;$Exception -and $depth -lt 12;$depth++){
        if($Exception -is [Net.WebException] -and [string]$Exception.Status -in @(
            'NameResolutionFailure','ConnectFailure','ReceiveFailure','SendFailure','Timeout',
            'ConnectionClosed','TrustFailure','SecureChannelFailure','KeepAliveFailure','ProxyNameResolutionFailure'
        )){return $true}
        if($Exception -is [Net.Sockets.SocketException] -and [string]$Exception.SocketErrorCode -in @(
            'HostNotFound','TryAgain','TimedOut','NetworkDown','NetworkUnreachable','HostUnreachable',
            'ConnectionAborted','ConnectionReset','ConnectionRefused'
        )){return $true}
        $Exception=$Exception.InnerException
    }
    if($Code -match '^(?:CAPRI_DISK_SPACE|EACCES|EPERM|ENOSPC|ABORT_ERR|AbortError)$'){return $false}
    $details=$Code+"`n"+$Message
    if($details -match '(?i)\bHTTP(?:\s+(?:error|status(?:\s+code)?))?\s*[:=(]?\s*(?:401|403|404)\b'){return $false}
    return $details -match '(?ix)
        \b(?:INSTALLER_NETWORK_ERROR|NPM_NETWORK_UNAVAILABLE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|
        ESOCKETTIMEDOUT|ERR_SOCKET_TIMEOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|
        ERR_STREAM_PREMATURE_CLOSE|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)|
        ConnectTimeout|ReadTimeout|ConnectError|ConnectionError|SSLError|ENETDOWN)\b
        |(?:TLS|SSL|HTTPS)[^\r\n]{0,70}(?:handshake|certificate|EOF|connection[ ]failed)
        |(?:handshake)[^\r\n]{0,40}(?:failed|EOF|error)
        |(?:fetch[ ]failed|failed[ ]to[ ]fetch|network[ ](?:error|unavailable|is[ ]unreachable))
        |(?:connection|socket|download|request|read|connect)[^\r\n]{0,55}(?:timed[ ]out|timeout|reset[ ]by[ ]peer|interrupted)
        |(?:dial[ ]tcp|connectex:|could[ ]not[ ]resolve[ ](?:host|proxy)|failed[ ]to[ ]connect)
        |(?:download[ ](?:stopped[ ]responding|ended[ ]early)|no[ ]such[ ]host|temporary[ ]failure[ ]in[ ]name[ ]resolution)
        |(?:remote[ ]name[ ]could[ ]not[ ]be[ ]resolved|underlying[ ]connection[ ]was[ ]closed)
        |(?:HTTP(?:[ ]+(?:error|status(?:[ ]+code)?))?[ ]*[:=(]?[ ]*(?:408|429|500|502|503|504)\b)
        |(?:не[ ]удалось[ ]разрешить[ ]удал[её]нное[ ]имя|соединение[^\r\n]{0,40}(?:разорвано|закрыто))
    '
}
function Get-CapriSetupError($Translations,[string]$Language,[string]$Message,[string]$Code='') {
    if($Code -eq 'CAPRI_DISK_SPACE'){return (Get-CapriInstallerText $Translations $Language 'diskSpaceError')+"`r`n"+$Message}
    if($Message -match 'INSTALLER_ALREADY_ACTIVE'){return (Get-CapriInstallerText $Translations $Language 'activeInstallation')}
    if($Message -match 'INSTALLER_UI_ALREADY_OPEN|INSTALLER_UI_SUPERSEDED'){return (Get-CapriInstallerText $Translations $Language 'windowAlreadyOpen')}
    $voice=@{
        VOICE_PACK_FOLDER_MISSING='voiceFolderMissing'
        VOICE_PACK_PROFILE_MISSING='voiceProfileMissing'
        VOICE_PACK_PROFILE_INVALID='voiceProfileInvalid'
        VOICE_PACK_FILES_MISSING='voiceFilesMissing'
    }
    foreach($candidate in @($Code,$Message)){
        if($voice.ContainsKey($candidate)){return (Get-CapriInstallerText $Translations $Language $voice[$candidate])}
        foreach($property in $Translations.en.PSObject.Properties){
            if($property.Value -is [string] -and $candidate -ceq $property.Value){return (Get-CapriInstallerText $Translations $Language $property.Name)}
        }
    }
    $summary=Get-CapriInstallerText $Translations $Language 'componentFailed'
    if(Test-CapriSetupNetworkError $Message $Code){
        $summary+="`r`n`r`n"+(Get-CapriInstallerText $Translations $Language 'networkHelp')
    }
    return $summary+"`r`n`r`n"+(Get-CapriInstallerText $Translations $Language 'technicalDetails')+":`r`n"+$Message
}
