@echo off
REM =========================================
REM Uninstall Node.js, Python, and Chromium
REM =========================================

echo.
echo === Removing Dependencies ===
echo.

REM Uninstall Node.js
echo [1/3] Uninstalling Node.js...
wmic product where name="Node.js" call uninstall /nointeractive
if errorlevel 1 (
    echo Note: Node.js not found via wmic, will try manual removal
)

REM Uninstall Python
echo [2/3] Uninstalling Python...
wmic product where name="Python 3.12.1" call uninstall /nointeractive
if errorlevel 1 (
    echo Note: Python not found via wmic, will try manual removal
)

REM Wait for uninstallers to complete
timeout /t 3 /nobreak >nul

REM Remove directories
echo [3/3] Removing directories...
if exist "C:\Program Files\nodejs" (
    rmdir /s /q "C:\Program Files\nodejs"
    echo Removed C:\Program Files\nodejs
)

if exist "C:\Program Files\Python312" (
    rmdir /s /q "C:\Program Files\Python312"
    echo Removed C:\Program Files\Python312
)

REM Remove Chromium cache
set CACHE_DIR=%USERPROFILE%\.cache\puppeteer
if exist "%CACHE_DIR%" (
    rmdir /s /q "%CACHE_DIR%"
    echo Removed Chromium cache
)

REM Remove build/chrome
if exist "build\chrome" (
    rmdir /s /q "build\chrome"
    echo Removed bundled Chromium
)

echo.
echo === Cleanup Complete ===
echo.
echo Please restart your computer to fully remove from PATH
echo Then run setup.bat to test the installation flow
echo.
pause
