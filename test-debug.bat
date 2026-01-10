@echo off
REM =========================================
REM iPod Classic Tool v3 - Portable Setup
REM =========================================

setlocal enabledelayedexpansion
echo.
echo === iPod Classic Tool v3 - Portable Dependency Setup ===
echo.

REM Create temp directory for downloads
echo [DEBUG] Creating temp directory...
set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
echo [DEBUG] SETUP_TEMP set to: !SETUP_TEMP!

if exist "!SETUP_TEMP!" rmdir /s /q "!SETUP_TEMP!"
echo [DEBUG] Old temp dir removed
mkdir "!SETUP_TEMP!"
echo [DEBUG] New temp dir created

REM ========== CHECK AND INSTALL NODE.JS ==========
echo [1/3] Checking Node.js installation...
echo [DEBUG] About to check if C:\nodejs\node.exe exists
if exist "C:\nodejs\node.exe" (
    echo [OK] Node.js already installed
    "C:\nodejs\node.exe" --version
) else (
    echo [DEBUG] Entering else block
    echo [^!] Node.js not found. Installing portable version...
    echo.
    
    set "NODE_ZIP_URL=https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip"
    echo [DEBUG] NODE_ZIP_URL set to: !NODE_ZIP_URL!
    
    set "NODE_ZIP_FILE=!SETUP_TEMP!\node-v20.zip"
    echo [DEBUG] NODE_ZIP_FILE set to: !NODE_ZIP_FILE!
    
    echo [*] Downloading Node.js v20.11.0 (portable)...
    echo [DEBUG] About to run PowerShell command
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%NODE_ZIP_URL%', '%NODE_ZIP_FILE%')" 2>nul
    echo [DEBUG] PowerShell command returned errorlevel: !ERRORLEVEL!
)

echo.
echo Done.
pause
