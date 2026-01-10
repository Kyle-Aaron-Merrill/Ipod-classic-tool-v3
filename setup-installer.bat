@echo off
REM =========================================
REM iPod Classic Tool v3 - Bootstrap Setup
REM =========================================

echo.
echo === iPod Classic Tool v3 - Dependency Setup ===
echo.
echo Checking for Node.js installation...

where /q npm
if errorlevel 1 (
    echo.
    echo Node.js is not installed. Please install it manually:
    echo Download from: https://nodejs.org/download/release/v20.11.0/
    echo Select: node-v20.11.0-x64.msi (Windows Installer)
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo ✓ Node.js found
node --version
npm --version

echo.
echo Checking for Python installation...

where /q python
if errorlevel 1 (
    echo.
    echo Python is not installed. Please install it manually:
    echo Download from: https://www.python.org/downloads/release/python-3121/
    echo Select: python-3.12.1-amd64.exe (Windows installer)
    echo.
    echo During installation, make sure to check "Add Python to PATH"
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo ✓ Python found
python --version

echo.
echo All dependencies found! Proceeding with npm install...
echo.

npm install

if errorlevel 1 (
    echo.
    echo ERROR: npm install failed!
    pause
    exit /b 1
)

echo.
echo === Setup Complete! ===
echo.
echo You can now run: npm start
echo.
pause
