@echo off
REM =========================================
REM iPod Classic Tool v3 - Windows Setup
REM =========================================

echo.
echo === iPod Classic Tool v3 - Setup ===
echo.

echo [1/3] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found on PATH!
    echo Please install Python 3 from https://www.python.org
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)
echo [✓] Python found

echo.
echo [2/3] Installing Python packages...
echo This may take a few minutes...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install Python packages
    pause
    exit /b 1
)
echo [✓] Python packages installed

echo.
echo [3/3] Installing Node.js dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install Node packages
    pause
    exit /b 1
)
echo [✓] Node packages installed

echo.
echo === Setup Complete! ===
echo.
echo Next steps:
echo 1. Make sure yt-dlp is installed:
echo    pip install yt-dlp
echo    OR download from: https://github.com/yt-dlp/yt-dlp
echo.
echo 2. (Optional) Install FFmpeg for better audio quality:
echo    choco install ffmpeg
echo    OR download from: https://ffmpeg.org/download.html
echo.
echo 3. Run the application:
echo    npm start
echo.
pause
