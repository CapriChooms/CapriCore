@echo off
setlocal
set "CAPRI_HOME=%~dp0"
if not exist "%CAPRI_HOME%package.json" set "CAPRI_HOME=%~dp0..\"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%CAPRI_HOME%packages\installer\windows\wizard.ps1" %*
exit /b %errorlevel%
