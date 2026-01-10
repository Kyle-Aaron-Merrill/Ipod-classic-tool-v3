@echo off
setlocal enabledelayedexpansion
echo.
echo === Test ===
echo.

set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
if exist "!SETUP_TEMP!" rmdir /s /q "!SETUP_TEMP!"
mkdir "!SETUP_TEMP!"

echo [1/3] Checking Node.js installation...
if exist "C:\nodejs\node.exe" (
    echo [OK] Node.js already installed
) else (
    echo [^!] Node.js not found. Installing portable version...
)

echo.
pause
