@echo off
REM =========================================
REM iPod Classic Tool v3 - Chocolatey Setup
REM =========================================

setlocal enabledelayedexpansion
echo.
echo === iPod Classic Tool v3 - Setup via Chocolatey ===
echo.

REM Check if Chocolatey is installed
echo [INIT] Checking for Chocolatey...
if exist "C:\ProgramData\chocolatey\bin\choco.exe" (
    echo [OK] Chocolatey is already installed
) else (
    echo [!] Chocolatey not found. Installing...
    echo.
    
    REM Install Chocolatey
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"
    
    if errorlevel 1 (
        echo [ERROR] Failed to install Chocolatey
        pause
        exit /b 1
    )
    
    echo [OK] Chocolatey installed
)

echo.

REM Check and install Node.js
echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if errorlevel 1 (
    echo [!] Node.js not found. Installing via Chocolatey...
    echo.
    C:\ProgramData\chocolatey\bin\choco.exe install nodejs -y
    
    if errorlevel 1 (
        echo [ERROR] Failed to install Node.js
        pause
        exit /b 1
    )
    
    REM Refresh PATH
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "PATH=%%B"
    set "PATH=!PATH!;C:\Program Files\nodejs"
    
    echo [OK] Node.js installed
    node --version
) else (
    echo [OK] Node.js already installed
    node --version
)

echo.

REM Check and install Python
echo [2/3] Checking Python installation...
where python >nul 2>&1
if errorlevel 1 (
    echo [!] Python not found. Installing via Chocolatey...
    echo.
    C:\ProgramData\chocolatey\bin\choco.exe install python -y
    
    if errorlevel 1 (
        echo [WARNING] Failed to install Python - some features may not work
    ) else (
        REM Refresh PATH
        for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "PATH=%%B"
        
        echo [OK] Python installed
        python --version
    )
) else (
    echo [OK] Python already installed
    python --version
)

echo.

REM Install project dependencies
echo [3/3] Installing project dependencies...
echo.

echo [*] Installing Python packages...
python -m pip install -r requirements.txt --upgrade >nul 2>&1
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
echo ✅ Node.js installed
node --version
echo.
echo ✅ npm installed
npm --version
echo.
echo ✅ Python installed
python --version
echo.
echo ✅ All dependencies ready!
echo.
echo Next steps:
echo    npm start
echo.
pause
