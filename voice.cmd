@echo off
setlocal
set "CAPRI_HOME=%~dp0"
if not exist "%CAPRI_HOME%package.json" set "CAPRI_HOME=%~dp0..\"
pushd "%CAPRI_HOME%"
set "UV_CACHE_DIR=%CD%\.runtime\uv-cache"
set "TMP=%CD%\.runtime\tmp"
set "TEMP=%TMP%"
if not exist ".runtime\voice-training-venv\Scripts\python.exe" (
  echo Run setup-voice-training.cmd first.
  popd
  exit /b 1
)
".runtime\voice-training-venv\Scripts\python.exe" -m integrations.voice_training %*
set "capriVoiceExit=%errorlevel%"
popd
exit /b %capriVoiceExit%
