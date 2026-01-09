#!/bin/bash
# =========================================
# iPod Classic Tool v3 - macOS/Linux Setup
# =========================================

set -e  # Exit on any error

echo ""
echo "=== iPod Classic Tool v3 - Automated Setup ==="
echo "This script will download and install all required dependencies."
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    echo "ERROR: Unsupported operating system"
    exit 1
fi

# Check and install Node.js if needed
echo "[1/4] Checking Node.js installation..."
if ! command -v npm &> /dev/null; then
    echo "⚠️  Node.js not found. Installing..."
    echo ""
    
    if [ "$OS" = "linux" ]; then
        # Linux - use NodeSource repository for Ubuntu/Debian
        echo "Downloading Node.js setup script..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || {
            echo "ERROR: Failed to set up Node.js repository"
            exit 1
        }
        
        echo "Installing Node.js..."
        sudo apt-get install -y nodejs || {
            echo "ERROR: Failed to install Node.js"
            exit 1
        }
    else
        # macOS - use Homebrew
        if ! command -v brew &> /dev/null; then
            echo "Homebrew not found. Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
                echo "ERROR: Failed to install Homebrew"
                exit 1
            }
        fi
        
        echo "Installing Node.js via Homebrew..."
        brew install node || {
            echo "ERROR: Failed to install Node.js"
            exit 1
        }
    fi
fi

echo "[✓] Node.js installed"
npm --version

echo ""
echo "[2/4] Checking Python 3 installation..."
if ! command -v python3 &> /dev/null; then
    echo "⚠️  Python 3 not found. Installing..."
    echo ""
    
    if [ "$OS" = "linux" ]; then
        echo "Installing Python 3..."
        sudo apt-get update
        sudo apt-get install -y python3 python3-pip || {
            echo "ERROR: Failed to install Python 3"
            exit 1
        }
    else
        # macOS - use Homebrew
        if ! command -v brew &> /dev/null; then
            echo "Homebrew not found. Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
                echo "ERROR: Failed to install Homebrew"
                exit 1
            }
        fi
        
        echo "Installing Python 3 via Homebrew..."
        brew install python3 || {
            echo "ERROR: Failed to install Python 3"
            exit 1
        }
    fi
fi

echo "[✓] Python 3 installed"
python3 --version

echo ""
echo "[3/4] Installing Python packages..."
echo "This may take a few minutes..."
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt || {
    echo "ERROR: Failed to install Python packages"
    exit 1
}
echo "[✓] Python packages installed"

echo ""
echo "[4/4] Installing Node.js dependencies (includes Chromium)..."
echo "This may take several minutes..."
npm install || {
    echo "ERROR: Failed to install Node packages"
    exit 1
}
echo "[✓] Node packages and Chromium installed"

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "✅ Node.js installed"
echo "✅ Python 3 installed"
echo "✅ Chromium installed automatically"
echo "✅ All dependencies ready"
echo ""
echo "Next step:"
echo "   npm start"
echo ""
echo "   yt-dlp --version"
echo ""
echo "2. Run the application:"
echo "   npm start"
echo ""
