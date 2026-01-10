@echo off
setlocal enabledelayedexpansion

echo Starting PowerShell test...
echo.

set "NODE_ZIP_URL=https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"
set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
set "NODE_ZIP_FILE=!SETUP_TEMP!\node-v20.zip"

echo NODE_ZIP_FILE is: !NODE_ZIP_FILE!
echo.

echo Running PowerShell command...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%NODE_ZIP_URL%', '%NODE_ZIP_FILE%')" 2>nul

echo PowerShell command completed with errorlevel: !ERRORLEVEL!
echo.

if not exist "!NODE_ZIP_FILE!" (
    echo Download verification failed - file not found
) else (
    echo Download verification succeeded - file found
    dir "!NODE_ZIP_FILE!"
)

pause
