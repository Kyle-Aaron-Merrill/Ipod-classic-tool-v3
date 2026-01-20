
# iPod Classic Tool v3 - Setup Script
# PowerShell version for better reliability with retry logic

Write-Host ""
Write-Host "=== iPod Classic Tool v3 - Automated Dependency Setup ===" -ForegroundColor Cyan
Write-Host ""

$setupErrors = @()
$partialSetup = $false

# Helper function to verify command with retry
function Verify-Command {
    param(
        [string]$Command,
        [string]$Name,
        [int]$MaxRetries = 3,
        [int]$WaitSeconds = 2
    )
    
    for ($i = 1; $i -le $MaxRetries; $i++) {
        $cmd = Get-Command $Command -ErrorAction SilentlyContinue
        if ($cmd) {
            return $true
        }
        
        if ($i -lt $MaxRetries) {
            Write-Host "[*] $Name not found yet (attempt $i/$MaxRetries), waiting ${WaitSeconds}s..." -ForegroundColor Yellow
            Start-Sleep -Seconds $WaitSeconds
            
            # Try to refresh PATH again
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        }
    }
    
    return $false
}

# Check Node.js
Write-Host "[1/3] Checking Node.js installation..." -ForegroundColor Yellow
if (Verify-Command "node" "Node.js") {
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
        $setupErrors += "Node.js download failed"
        $partialSetup = $true
    }
    
    if ($partialSetup -eq $false) {
        Write-Host "[*] Installing Node.js..." -ForegroundColor Cyan
        Start-Process "C:\Windows\System32\msiexec.exe" -ArgumentList "/i `"$nodeInstaller`" /norestart ALLUSERS=1 ADD_TO_PATH=1 ADDLOCAL=all" -Wait -ErrorAction SilentlyContinue
        
        # Wait longer for installation and PATH to update
        Write-Host "[*] Waiting for installation to complete and PATH to update..." -ForegroundColor Cyan
        Start-Sleep -Seconds 8
        
        # Refresh environment multiple times
        for ($i = 0; $i -lt 3; $i++) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Start-Sleep -Milliseconds 500
        }
        
        if (Verify-Command "node" "Node.js" 5 3) {
            Write-Host "[OK] Node.js installed successfully" -ForegroundColor Green
            & node --version
        } else {
            Write-Host "[WARNING] Node.js verification failed via PATH, will continue with manual path" -ForegroundColor Yellow
            $partialSetup = $true
            
            # Try to use direct path
            if (Test-Path "C:\Program Files\nodejs\node.exe") {
                Write-Host "[OK] Found Node.js at: C:\Program Files\nodejs\node.exe" -ForegroundColor Green
                & "C:\Program Files\nodejs\node.exe" --version
                $env:PATH = "C:\Program Files\nodejs;$env:PATH"
            }
        }
    }
}


Write-Host ""

# Check Python
Write-Host "[2/3] Checking Python installation..." -ForegroundColor Yellow
if (Verify-Command "python" "Python") {
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
        $setupErrors += "Python download failed"
        $partialSetup = $true
    }
    
    if ($partialSetup -eq $false) {
        Write-Host "[*] Installing Python..." -ForegroundColor Cyan
        Start-Process $pythonInstaller -ArgumentList "/quiet","InstallAllUsers=1","PrependPath=1","Include_pip=1","Include_tcltk=0" -Wait -ErrorAction SilentlyContinue
        
        # Wait longer for installation and PATH to update
        Write-Host "[*] Waiting for installation to complete and PATH to update..." -ForegroundColor Cyan
        Start-Sleep -Seconds 8
        
        # Refresh environment multiple times
        for ($i = 0; $i -lt 3; $i++) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Start-Sleep -Milliseconds 500
        }
        
        if (Verify-Command "python" "Python" 5 3) {
            Write-Host "[OK] Python installed successfully" -ForegroundColor Green
            & python --version
        } else {
            Write-Host "[WARNING] Python verification failed via PATH, will continue with manual path" -ForegroundColor Yellow
            $partialSetup = $true
            
            # Try to use direct path
            if (Test-Path "C:\Python312\python.exe") {
                Write-Host "[OK] Found Python at: C:\Python312\python.exe" -ForegroundColor Green
                & "C:\Python312\python.exe" --version
                $env:PATH = "C:\Python312;$env:PATH"
            }
        }
    }
}

Write-Host ""

# Install project dependencies (continue even if partial)
Write-Host "[3/3] Installing project dependencies..." -ForegroundColor Yellow
$depsInstalled = $false

Write-Host "[*] Installing Python packages..." -ForegroundColor Cyan
try {
    & python -m pip install -r requirements.txt --upgrade 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Python packages installed" -ForegroundColor Green
        $depsInstalled = $true
    } else {
        Write-Host "[WARNING] Python packages had issues (continuing)" -ForegroundColor Yellow
        $setupErrors += "Some Python packages failed to install"
    }
} catch {
    Write-Host "[WARNING] Could not install Python packages (continuing)" -ForegroundColor Yellow
    $setupErrors += "Python package installation failed"
}

Write-Host "[*] Installing Node.js packages (this may take several minutes)..." -ForegroundColor Cyan
$npmInstalled = $false
try {
    & npm install 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] npm packages installed" -ForegroundColor Green
        $npmInstalled = $true
    } else {
        Write-Host "[WARNING] npm install had issues, retrying..." -ForegroundColor Yellow
        & npm install --legacy-peer-deps 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] npm packages installed (legacy mode)" -ForegroundColor Green
            $npmInstalled = $true
        }
    }
} catch {
    Write-Host "[WARNING] npm install error (continuing)" -ForegroundColor Yellow
    $setupErrors += "npm install failed"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "=== SETUP STATUS ===" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Final verification
$nodeOk = Verify-Command "node" "Node.js" 1
$npmOk = Verify-Command "npm" "npm" 1
$pythonOk = Verify-Command "python" "Python" 1

if ($nodeOk) {
    Write-Host "✅ Node.js:" -ForegroundColor Green
    & node --version
} else {
    Write-Host "❌ Node.js: NOT FOUND" -ForegroundColor Red
    $setupErrors += "Node.js not found after setup"
}

Write-Host ""

if ($npmOk) {
    Write-Host "✅ npm:" -ForegroundColor Green
    & npm --version
} else {
    Write-Host "❌ npm: NOT FOUND" -ForegroundColor Red
    $setupErrors += "npm not found after setup"
}

Write-Host ""

if ($pythonOk) {
    Write-Host "✅ Python:" -ForegroundColor Green
    & python --version
} else {
    Write-Host "❌ Python: NOT FOUND" -ForegroundColor Red
    $setupErrors += "Python not found after setup"
}

Write-Host ""

if ($npmInstalled -and $depsInstalled) {
    Write-Host "✅ All project dependencies installed" -ForegroundColor Green
} elseif ($npmInstalled -or $depsInstalled) {
    Write-Host "⚠️  Some project dependencies installed (partial)" -ForegroundColor Yellow
} else {
    Write-Host "❌ Project dependencies not fully installed" -ForegroundColor Yellow
    $setupErrors += "Project dependencies not installed"
}

Write-Host ""

if ($setupErrors.Count -eq 0) {
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "=== ✅ SETUP COMPLETE ===" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "   npm start" -ForegroundColor Cyan
    Write-Host ""
    exit 0
} else {
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host "=== ⚠️  SETUP COMPLETED WITH WARNINGS ===" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Issues encountered:" -ForegroundColor Yellow
    foreach ($error in $setupErrors) {
        Write-Host "  • $error" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "If you continue to have issues:" -ForegroundColor Cyan
    Write-Host "  1. Run this setup again (sometimes takes multiple runs on first install)" -ForegroundColor Cyan
    Write-Host "  2. Or follow manual setup in INSTALLATION.md" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You can still try:" -ForegroundColor Yellow
    Write-Host "   npm start" -ForegroundColor Cyan
    Write-Host ""
    exit 0
}
