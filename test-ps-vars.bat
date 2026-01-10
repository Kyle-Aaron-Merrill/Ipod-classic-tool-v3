@echo off
setlocal enabledelayedexpansion

set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
mkdir "!SETUP_TEMP!" 2>nul

set "NODE_ZIP_FILE=!SETUP_TEMP!\node-v20.zip"
set "NODE_ZIP_URL=https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"

echo TEST 1: Simple PowerShell command
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Write-Host 'Hello'" 2>nul
echo Completed: !ERRORLEVEL!
echo.

echo TEST 2: PowerShell with one variable
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Write-Host '%NODE_ZIP_URL%'" 2>nul
echo Completed: !ERRORLEVEL!
echo.

echo TEST 3: PowerShell with two variables
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Write-Host '%NODE_ZIP_URL%'; Write-Host '%NODE_ZIP_FILE%'" 2>nul
echo Completed: !ERRORLEVEL!
echo.

echo TEST 4: PowerShell with the actual download command
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%NODE_ZIP_URL%', '%NODE_ZIP_FILE%')" 2>nul
echo Completed: !ERRORLEVEL!
echo.

pause
