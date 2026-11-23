@echo off
setlocal
set "CAPRI_HOME=%~dp0"
if not exist "%CAPRI_HOME%package.json" set "CAPRI_HOME=%~dp0..\"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CAPRI_HOME%scripts\run-node.ps1" status %*
exit /b %errorlevel%
