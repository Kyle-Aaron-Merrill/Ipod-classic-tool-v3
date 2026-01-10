@echo off
REM =========================================
REM iPod Classic Tool v3 - Windows Setup
REM =========================================

setlocal enabledelayedexpansion
echo.
echo === iPod Classic Tool v3 - Automated Setup ===
echo This script will download and install all required dependencies.
echo.

REM Check for Node.js/npm and install if missing
echo [1/4] Checking Node.js installation...
where npm >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Node.js not found. Downloading and installing...
    echo.
    
    REM Create temp directory
    set "TEMP_DIR=%temp%\node_installer"
    if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
    mkdir "%TEMP_DIR%"
    
    REM Download Node.js LTS installer (20.x)
    set "NODE_INSTALLER=%TEMP_DIR%\node-installer.msi"
    echo Downloading Node.js 20 LTS installer...
    powershell -NoProfile -Command "try { (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi', '%NODE_INSTALLER%'); Write-Host '[✓] Download complete' } catch { Write-Host 'ERROR: Failed to download Node.js'; exit 1 }"
    if errorlevel 1 (
        echo ERROR: Failed to download Node.js
        echo Please install manually from: https://nodejs.org/
        pause
        exit /b 1
    )
    
    REM Install Node.js with PATH enabled (ALLUSERS=1 for system-wide, ADD_TO_PATH=1)
    echo Installing Node.js...
    msiexec /i "%NODE_INSTALLER%" /quiet /norestart ALLUSERS=1 ADD_TO_PATH=1 ADDLOCAL=all
    if errorlevel 1 (
        echo ERROR: Failed to install Node.js
        pause
        exit /b 1
    )
    
    REM Wait for installer to complete
    timeout /t 5 /nobreak >nul
    
    REM Reload PATH from registry to get Node.js
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYSTEM_PATH=%%B"
    if defined SYSTEM_PATH (
        set "PATH=%SYSTEM_PATH%;%USERPROFILE%\AppData\Local\Microsoft\WindowsApps"
    ) else (
        set "PATH=%PATH%;C:\Program Files\nodejs"
    )
    
    REM Verify installation by checking node command
    timeout /t 2 /nobreak >nul
    node --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Node.js was installed but 'node' command is not accessible
        echo Please restart your computer and run setup again
        exit /b 1
    )
    
    REM Cleanup
    rmdir /s /q "%TEMP_DIR%"
    echo.
    echo ========== SUCCESS =========
    echo ✓ Node.js installed and added to PATH
    node --version
    echo ✓ npm available
    npm --version
    echo =============================
    echo.
) else (
    echo [✓] Node.js already installed
    node --version
    echo [✓] npm available
    npm --version
)

echo.
echo [2/4] Checking Python installation...
where python >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Python not found. Downloading and installing...
    echo.
    
    set "TEMP_DIR=%temp%\python_installer"
    if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
    mkdir "%TEMP_DIR%"
    
    set "PYTHON_INSTALLER=%TEMP_DIR%\python-installer.exe"
    echo Downloading Python 3.12 installer...
    powershell -NoProfile -Command "try { (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.12.1/python-3.12.1-amd64.exe', '%PYTHON_INSTALLER%'); Write-Host '[✓] Download complete' } catch { Write-Host 'ERROR: Failed to download Python'; exit 1 }"
    if errorlevel 1 (
        echo ERROR: Failed to download Python
        echo Please install manually from: https://www.python.org/
        pause
        exit /b 1
    )
    
    REM Install Python with PATH enabled
    echo Installing Python 3.12...
    "%PYTHON_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_tcltk=0
    if errorlevel 1 (
        echo ERROR: Failed to install Python
        pause
        exit /b 1
    )
    
    REM Wait for installer to complete
    timeout /t 5 /nobreak >nul
    
    REM Reload PATH from registry to get Python
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYSTEM_PATH=%%B"
    if defined SYSTEM_PATH (
        set "PATH=%SYSTEM_PATH%;%USERPROFILE%\AppData\Local\Microsoft\WindowsApps"
    ) else (
        set "PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts"
    )
    
    REM Verify installation
    timeout /t 2 /nobreak >nul
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python was installed but 'python' command is not accessible
        echo Please restart your computer and run setup again
        exit /b 1
    )
    
    REM Cleanup
    rmdir /s /q "%TEMP_DIR%"
    echo.
    echo ========== SUCCESS =========
    echo ✓ Python installed and added to PATH
    python --version
    echo =============================
    echo.
) else (
    echo [✓] Python already installed
    python --version
)

echo.
echo [3/4] Installing Python packages...
echo This may take a few minutes...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install Python packages
    pause
    exit /b 1
)
echo [✓] Python packages installed

echo.
echo [4/4] Installing Node.js dependencies ^(includes Chromium^)...
echo This may take several minutes...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install Node packages
    pause
    exit /b 1
)
echo [✓] Node packages and Chromium installed

echo.
echo === Setup Complete! ===
echo.
echo ✅ Node.js installed
echo ✅ Python installed
echo ✅ Chromium installed automatically
echo ✅ All dependencies ready
echo.
echo === VERIFYING INSTALLATION ===
echo Checking that all tools are accessible...
echo.

REM Final verification
echo === FINAL VERIFICATION ===
echo.
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Node.js is not in PATH!
    echo.
    echo SOLUTION: 
    echo 1. Close all terminal windows
    echo 2. Restart your computer
    echo 3. Run setup.bat again
    echo 4. If the problem persists, manually install Node.js from https://nodejs.org/
    echo.
    exit /b 1
)
echo ✅ Node.js is in PATH:
node --version

npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: npm is not in PATH!
    echo.
    echo SOLUTION: Restart your computer and run setup.bat again
    echo.
    exit /b 1
)
echo ✅ npm is in PATH:
npm --version

python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Python is not in PATH!
    echo.
    echo SOLUTION:
    echo 1. Close all terminal windows
    echo 2. Restart your computer
    echo 3. Run setup.bat again
    echo.
    exit /b 1
)
echo ✅ Python is in PATH:
python --version

echo.
echo === ALL VERIFICATIONS PASSED ===
echo.
echo Next step:
echo    npm start
echo.
echo Optional - Install FFmpeg for better audio quality:
echo    choco install ffmpeg
echo    OR download from: https://ffmpeg.org/download.html
echo.
