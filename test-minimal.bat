@echo off
REM =========================================
REM iPod Classic Tool v3 - Portable Setup
REM =========================================

setlocal enabledelayedexpansion
echo.
echo === iPod Classic Tool v3 - Portable Dependency Setup ===
echo.

REM Create temp directory for downloads
set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
if exist "!SETUP_TEMP!" rmdir /s /q "!SETUP_TEMP!"
mkdir "!SETUP_TEMP!"

REM ========== CHECK AND INSTALL NODE.JS ==========
echo [1/3] Checking Node.js installation...
if exist "C:\nodejs\node.exe" (
    echo [OK] Node.js already installed
    "C:\nodejs\node.exe" --version
) else (
    echo [^!] Node.js not found. Installing portable version...
    echo.
)

echo Done
pause
