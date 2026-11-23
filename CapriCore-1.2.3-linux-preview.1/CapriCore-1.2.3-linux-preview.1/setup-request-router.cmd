@echo off
setlocal
set "CAPRI_HOME=%~dp0"
if not exist "%CAPRI_HOME%package.json" set "CAPRI_HOME=%~dp0..\"
cd /d "%CAPRI_HOME%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CAPRI_HOME%scripts\setup-request-router.ps1"
if errorlevel 1 exit /b 1
