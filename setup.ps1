
# iPod Classic Tool v3 - Setup Script
# PowerShell version for better reliability

Write-Host ""
Write-Host "=== iPod Classic Tool v3 - Automated Dependency Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[1/3] Checking Node.js installation..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Write-Host "[OK] Node.js already installed" -ForegroundColor Green
    & node --version
} else {
    Write-Host "[!] Node.js not found. Installing..." -ForegroundColor Yellow
    Write-Host "[*] Downloading Node.js v20.11.0..." -ForegroundColor Cyan
    
    $nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi"
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        (New-Object System.Net.WebClient).DownloadFile($nodeUrl, $nodeInstaller)
        Write-Host "[OK] Downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to download Node.js: $_" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "[*] Installing Node.js..." -ForegroundColor Cyan
    Start-Process "C:\Windows\System32\msiexec.exe" -ArgumentList "/i `"$nodeInstaller`" /norestart ALLUSERS=1 ADD_TO_PATH=1 ADDLOCAL=all" -Wait
    
    # Wait for installation
    Start-Sleep -Seconds 5
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Write-Host "[OK] Node.js installed successfully" -ForegroundColor Green
        & node --version
    } else {
        Write-Host "[ERROR] Node.js installation verification failed" -ForegroundColor Red
        Write-Host "[*] Trying to find node manually..." -ForegroundColor Yellow
        if (Test-Path "C:\Program Files\nodejs\node.exe") {
            Write-Host "[OK] Found at: C:\Program Files\nodejs\node.exe" -ForegroundColor Green
            & "C:\Program Files\nodejs\node.exe" --version
        } else {
            Write-Host "[ERROR] Could not find node.exe" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host ""

# Check Python
Write-Host "[2/3] Checking Python installation..." -ForegroundColor Yellow
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    Write-Host "[OK] Python already installed" -ForegroundColor Green
    & python --version
} else {
    Write-Host "[!] Python not found. Installing..." -ForegroundColor Yellow
    Write-Host "[*] Downloading Python 3.12.1..." -ForegroundColor Cyan
    
    $pythonUrl = "https://www.python.org/ftp/python/3.12.1/python-3.12.1-amd64.exe"
    $pythonInstaller = "$env:TEMP\python-installer.exe"
    
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        (New-Object System.Net.WebClient).DownloadFile($pythonUrl, $pythonInstaller)
        Write-Host "[OK] Downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Failed to download Python: $_" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "[*] Installing Python..." -ForegroundColor Cyan
    Write-Host "[*] Installation wizard will open. Please check 'Add Python to PATH' during installation." -ForegroundColor Yellow
    Start-Process $pythonInstaller -ArgumentList "/quiet","InstallAllUsers=1","PrependPath=1","Include_pip=1","Include_tcltk=0" -Wait
    
    # Wait for installation
    Start-Sleep -Seconds 5
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        Write-Host "[OK] Python installed successfully" -ForegroundColor Green
        & python --version
    } else {
        Write-Host "[ERROR] Python installation verification failed" -ForegroundColor Red
        Write-Host "[*] Trying to find python manually..." -ForegroundColor Yellow
        if (Test-Path "C:\Python312\python.exe") {
            Write-Host "[OK] Found at: C:\Python312\python.exe" -ForegroundColor Green
            & "C:\Python312\python.exe" --version
        } else {
            Write-Host "[ERROR] Could not find python.exe" -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host ""

# Install project dependencies
Write-Host "[3/3] Installing project dependencies..." -ForegroundColor Yellow
Write-Host "[*] Installing Python packages..." -ForegroundColor Cyan

try {
    & python -m pip install -r requirements.txt --upgrade | Out-Null
    Write-Host "[OK] Python packages installed" -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Some Python packages may not have installed" -ForegroundColor Yellow
}

Write-Host "[*] Installing Node.js packages (this may take several minutes)..." -ForegroundColor Cyan
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "=== SETUP COMPLETE ===" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Node.js installed" -ForegroundColor Green
& node --version
Write-Host ""
Write-Host "✅ npm installed" -ForegroundColor Green
& npm --version
Write-Host ""
Write-Host "✅ Python installed" -ForegroundColor Green
& python --version
Write-Host ""
Write-Host "✅ All dependencies ready!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "   npm start" -ForegroundColor Cyan
Write-Host ""
