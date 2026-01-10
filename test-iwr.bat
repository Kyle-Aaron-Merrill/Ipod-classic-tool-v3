@echo off
setlocal enabledelayedexpansion

set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
mkdir "!SETUP_TEMP!" 2>nul

set "NODE_ZIP_FILE=!SETUP_TEMP!\node-v20.zip"
set "NODE_ZIP_URL=https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"

echo Attempting download with Invoke-WebRequest...
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%NODE_ZIP_URL%' -OutFile '%NODE_ZIP_FILE%'" 2>nul
echo Download returned errorlevel: !ERRORLEVEL!

if exist "!NODE_ZIP_FILE!" (
    echo File found!
    dir "!NODE_ZIP_FILE!"
) else (
    echo File not found!
)

pause
