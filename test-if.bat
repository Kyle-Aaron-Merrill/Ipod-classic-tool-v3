@echo off
setlocal enabledelayedexpansion

echo Test 1: Basic if-exist
if exist "C:\nodejs\node.exe" (
    echo Found
) else (
    echo Not found  
)
echo Done Test 1
echo.

echo Test 2: if-exist in function-like block
if exist "C:\nodejs\node.exe" (
    echo [OK] Node.js already installed
) else (
    echo [^!] Node.js not found
    echo Installing...
)
echo Done Test 2
echo.

pause
