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
npm --version >nul 2>&1
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
    
    REM Install Node.js silently
    echo Installing Node.js...
    msiexec /i "%NODE_INSTALLER%" /quiet /norestart ADDLOCAL=all
    if errorlevel 1 (
        echo ERROR: Failed to install Node.js
        pause
        exit /b 1
    )
    
    REM Refresh PATH
    set PATH=%PATH%;C:\Program Files\nodejs
    
    REM Verify installation
    timeout /t 3 /nobreak >nul
    npm --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Node.js installation did not complete correctly
        echo Please restart your computer and run setup again
        pause
        exit /b 1
    )
    
    REM Cleanup
    rmdir /s /q "%TEMP_DIR%"
)
echo [✓] Node.js is available
npm --version

echo.
echo [2/4] Checking Python installation...
python --version >nul 2>&1
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
    
    REM Install Python with PATH added
    echo Installing Python 3.12...
    "%PYTHON_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_tcltk=0
    if errorlevel 1 (
        echo ERROR: Failed to install Python
        pause
        exit /b 1
    )
    
    REM Refresh PATH
    set PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts
    
    REM Verify installation
    timeout /t 3 /nobreak >nul
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python installation did not complete correctly
        echo Please restart your computer and run setup again
        pause
        exit /b 1
    )
    
    REM Cleanup
    rmdir /s /q "%TEMP_DIR%"
)
echo [✓] Python is available
python --version

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
echo Next step:
echo    npm start
echo.
echo 2. (Optional) Install FFmpeg for better audio quality:
echo    choco install ffmpeg
echo    OR download from: https://ffmpeg.org/download.html
echo.
echo 3. Run the application:
echo    npm start
echo.
pause
