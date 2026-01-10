@echo off
REM =========================================
REM iPod Classic Tool v3 - Dependencies Setup
REM =========================================

echo.
echo === iPod Classic Tool v3 - Dependency Installation ===
echo.

REM Check Node.js
echo [1/3] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js is installed
node --version

echo.

REM Check Python
echo [2/3] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] Python not found - some features may not work
) else (
    echo [OK] Python is installed
    python --version
)

echo.

REM Install project dependencies
echo [3/3] Installing project dependencies...
echo.

echo [*] Installing Python packages...
python -m pip install -r requirements.txt --upgrade 2>nul
if errorlevel 1 (
    echo [WARNING] Some Python packages may not have installed
) else (
    echo [OK] Python packages installed
)

echo.
echo [*] Installing Node.js packages (this may take several minutes)...
call npm install

if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)

echo.
echo ==========================================
echo === SETUP COMPLETE ===
echo ==========================================
echo.
echo ✅ All dependencies ready!
echo.
echo Next steps:
echo    npm start
echo.
pause
