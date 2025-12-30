#!/bin/bash
# =========================================
# iPod Classic Tool v3 - macOS/Linux Setup
# =========================================

set -e  # Exit on any error

echo ""
echo "=== iPod Classic Tool v3 - Setup ==="
echo ""

echo "[1/4] Checking Python 3 installation..."
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 not found!"
    echo ""
    echo "Please install Python 3:"
    echo "  macOS: brew install python3"
    echo "  Linux: sudo apt install python3 python3-pip"
    exit 1
fi
python3 --version
echo "[✓] Python 3 found"

echo ""
echo "[2/4] Installing Python packages..."
echo "This may take a few minutes..."
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
echo "[✓] Python packages installed"

echo ""
echo "[3/4] Installing Node.js dependencies..."
npm install
echo "[✓] Node packages installed"

echo ""
echo "[4/4] Installing system tools (optional)..."
if command -v brew &> /dev/null; then
    echo "Found Homebrew. Installing ffmpeg and yt-dlp..."
    brew install ffmpeg yt-dlp 2>/dev/null || echo "⚠️  Some packages may already be installed"
else
    echo "⚠️  Homebrew not found (macOS only). Install manually:"
    echo "  brew install ffmpeg yt-dlp"
fi

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Verify yt-dlp is installed:"
echo "   yt-dlp --version"
echo ""
echo "2. Run the application:"
echo "   npm start"
echo ""
