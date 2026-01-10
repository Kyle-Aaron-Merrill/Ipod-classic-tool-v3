@echo off
setlocal enabledelayedexpansion

echo Starting test...
echo.

set "SETUP_TEMP=%TEMP%\ipod_setup_temp"
echo SETUP_TEMP is: !SETUP_TEMP!
echo.

echo Checking if path contains special chars...
if exist "!SETUP_TEMP!" (
    echo Path exists or has special chars
) else (
    echo Path does not exist
)

echo.
echo Done.
pause
