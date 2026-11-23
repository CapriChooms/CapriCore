$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$capriFixtureRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$capriFixtureFolder = Join-Path $capriFixtureRoot '.runtime/asr-command-evaluation'
New-Item -ItemType Directory -Path $capriFixtureFolder -Force | Out-Null
$capriFixtureSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $capriFixtureVoice = $capriFixtureSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1
    if (-not $capriFixtureVoice) { throw 'Install an English Windows speech voice to generate the test fixtures.' }
    $capriFixtureSynth.SelectVoice($capriFixtureVoice.VoiceInfo.Name)
    $capriFixtureFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $capriFixtureTexts = @('Capri, clip that.', 'Hey Capri, clip that.', 'Capri, copy that file.', 'Capri, leave that window open.', 'Capri, do not clip that.', 'Capri, play music on Spotify.', 'Capri, what are we watching?', 'Copy that file.', 'Leave that.', 'Do not clip that.', 'Hey, can you leave that alone?', 'Capri.', 'Hey Capri.', 'Capri, leave that.')
    $capriFixtureRows = @()
    for ($capriFixtureIndex = 0; $capriFixtureIndex -lt $capriFixtureTexts.Count; $capriFixtureIndex++) {
        foreach ($capriFixtureRate in @(0, 2)) {
            $capriFixtureName = "$capriFixtureIndex-$capriFixtureRate.wav"
            $capriFixtureSynth.Rate = $capriFixtureRate
            $capriFixtureSynth.SetOutputToWaveFile((Join-Path $capriFixtureFolder $capriFixtureName), $capriFixtureFormat)
            $capriFixtureSynth.Speak($capriFixtureTexts[$capriFixtureIndex])
            $capriFixtureSynth.SetOutputToNull()
            $capriFixtureRows += @{ file = $capriFixtureName; text = $capriFixtureTexts[$capriFixtureIndex] }
        }
    }
    $capriFixtureRows | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $capriFixtureFolder 'fixtures.json') -Encoding UTF8
    Write-Output 'Generated English ASR fixtures without opening a microphone or playing audio.'
} finally { $capriFixtureSynth.Dispose() }
