@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM Check for admin privileges
openfiles >nul 2>&1
if errorlevel 1 (
    echo.
    echo ================================================================================
    echo [!] ADMINISTRATOR PRIVILEGES REQUIRED
    echo ================================================================================
    echo.
    echo This setup needs admin privileges to:
    echo   - Install Node.js, Python, and dependencies
    echo   - Add tools to system PATH for permanent access
    echo   - Configure system settings
    echo.
    echo A permission dialog will appear. Please click "Yes" to continue.
    echo.
    timeout /t 3
    
    REM Try to elevate using PowerShell
    powershell -NoProfile -Command "Start-Process -FilePath '%0' -ArgumentList '%1' -Verb RunAs -Wait" 2>nul
    if errorlevel 1 (
        echo.
        echo [ERROR] Admin privileges were not granted or elevation failed
        echo [INFO] Setup cannot continue without admin access
        echo.
        pause
        exit /b 1
    ) else (
        exit /b 0
    )
)

echo.
echo === iPod Classic Tool v3 - Portable Dependency Setup ===
echo.

REM Get project directory from parameter, or use current directory
if "%~1"=="" (
    set "PROJECT_DIR=%cd%"
) else (
    set "PROJECT_DIR=%~1"
)

echo [DEBUG] PROJECT_DIR set to: !PROJECT_DIR!

REM Create temp directory
set "TEMP_DIR=%TEMP%\ipod_setup_temp"
if exist "!TEMP_DIR!" rmdir /s /q "!TEMP_DIR!"
mkdir "!TEMP_DIR!"
if errorlevel 1 (
    echo [ERROR] Failed to create temp directory: !TEMP_DIR!
    exit /b 1
)

REM Check Node.js
echo [1/3] Checking Node.js...
if not exist "C:\nodejs\node.exe" (
    echo [*] Installing Node.js v20.11.0...
    set "NODE_ZIP=!TEMP_DIR!\node.zip"
    
    echo [DEBUG] Downloading Node.js from https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip' -OutFile '!NODE_ZIP!' -ErrorAction Stop" 
    if errorlevel 1 (
        echo [ERROR] Failed to download Node.js from nodejs.org
        if exist "!NODE_ZIP!" del "!NODE_ZIP!"
        exit /b 1
    )
    
    if not exist "!NODE_ZIP!" (
        echo [ERROR] Node.js zip file was not created
        exit /b 1
    )
    
    echo [DEBUG] Extracting Node.js...
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process; Expand-Archive '!NODE_ZIP!' -DestinationPath 'C:\' -Force -ErrorAction Stop; Rename-Item 'C:\node-v20.11.0-win-x64' 'nodejs' -Force -ErrorAction Stop"
    if errorlevel 1 (
        echo [ERROR] Failed to extract and setup Node.js
        exit /b 1
    )
    
    if not exist "C:\nodejs\node.exe" (
        echo [ERROR] Node.js extraction failed - node.exe not found at C:\nodejs\node.exe
        exit /b 1
    )
)
echo [OK] Node.js is ready
"C:\nodejs\node.exe" --version

echo.
echo [2/3] Checking Python...

REM First, try to disable the Microsoft Store Python alias
echo [DEBUG] Disabling Windows Python app execution alias...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\App Execution Aliases\python.exe" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\App Execution Aliases\python3.exe" /f >nul 2>&1

"C:\Windows\System32\where.exe" python >nul 2>&1
if errorlevel 1 (
    echo [*] Installing Python 3.12.1...
    set "PY_EXE=!TEMP_DIR!\python.exe"
    
    echo [DEBUG] Downloading Python from python.org ^(may take 1-2 minutes^)...
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.1/python-3.12.1-amd64.exe' -OutFile '!PY_EXE!' -ErrorAction Stop"
    if errorlevel 1 (
        echo [ERROR] Failed to download Python installer
        exit /b 1
    )
    
    if not exist "!PY_EXE!" (
        echo [ERROR] Python installer was not created
        exit /b 1
    )
    
    echo [DEBUG] Running Python installer ^(this may take 2-3 minutes^)...
    start /wait "Python Setup" "!PY_EXE!" /quiet InstallAllUsers=1 PrependPath=1
    if errorlevel 1 (
        echo [WARNING] Python installer returned exit code !errorlevel!
    )
    
    echo [DEBUG] Refreshing PATH environment...
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH') do set "SYSTEM_PATH=%%B"
    set "PATH=!SYSTEM_PATH!;%PATH%"
)

"C:\Windows\System32\where.exe" python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not available - installation may have failed
    exit /b 1
)
echo [OK] Python is ready
python --version

echo.
setx PATH "C:\nodejs;C:\Python312;C:\Program Files\Python312;!SYSTEM_PATH!" >nul 2>&1
if errorlevel 1 (
    echo [WARNING] setx failed - likely no admin privileges
    echo [INFO] Attempting to set PATH via registry directly...
    
    REM Try to set in registry if we have admin
    for /f "tokens=2*" %%A in ('C:\Windows\System32\reg.exe query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH') do set "CURRENT_PATH=%%B"
    
    if not "!CURRENT_PATH!"=="" (
        echo [DEBUG] Current PATH from registry: !CURRENT_PATH!
        
        REM Check if C:\nodejs is already in PATH
        echo !CURRENT_PATH! | C:\Windows\System32\findstr.exe /i "nodejs" >nul
        if errorlevel 1 (
            REM Add it
            set "NEW_PATH=C:\nodejs;!CURRENT_PATH!"
            echo [DEBUG] Adding C:\nodejs to PATH...
            C:\Windows\System32\reg.exe add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH /d "!NEW_PATH!" /f >nul 2>&1
            if errorlevel 1 (
                echo [WARNING] Could not modify HKLM registry - not running as admin
                echo [INFO] Setting PATH for current session only
                set "PATH=C:\nodejs;!PATH!"
            ) else (
                echo [OK] PATH updated in registry
            )
        ) else (
            echo [OK] C:\nodejs already in PATH
        )
    ) else (
        echo [DEBUG] Could not read current PATH from registry
        echo [INFO] Setting PATH for current session only
        set "PATH=C:\nodejs;!PATH!"
    )
) else (
    echo [OK] PATH successfully set via setx
)

echo.
echo [3/3] Installing npm dependencies...

REM Check if package.json exists - if not, we're in packaged app, skip npm
if not exist "!PROJECT_DIR!\package.json" (
    echo [INFO] package.json not found - running from packaged app, skipping npm install
    echo [INFO] npm dependencies are already bundled with the application
) else (
    cd /d "!PROJECT_DIR!"
    if errorlevel 1 (
        echo [ERROR] Failed to change to project directory: !PROJECT_DIR!
        exit /b 1
    )

    echo [DEBUG] Current directory: %cd%
    echo [DEBUG] Setting PATH for npm...
    set "PATH=C:\nodejs;!PATH!"

    echo [DEBUG] Running: npm install
    call C:\nodejs\npm.cmd install
    if errorlevel 1 (
        echo [ERROR] npm install failed - see above for details
        exit /b 1
    )

    echo [OK] npm install completed successfully
)

echo.
echo [*] Installing Python dependencies...
python -m pip install pillow openai yt-dlp requests mutagen --quiet
if errorlevel 1 (
    echo [WARNING] Python pip install returned error, but some packages may have installed
)

REM Cleanup
echo [DEBUG] Cleaning up temporary files...
rmdir /s /q "!TEMP_DIR!" 2>nul

echo.
echo ========== ✅ SETUP COMPLETE ==========
echo [OK] All dependencies installed successfully!
echo [OK] You can now launch the iPod Classic Tool application
echo.

