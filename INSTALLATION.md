# Installation Guide - iPod Classic Tool v3

## Two Installation Methods

### Option 1: Packaged Application (Recommended for Users)

If you have a packaged app (`.exe`, `.dmg`, `.AppImage`):

1. **Download and Install**
   - Run the installer
   - Click "Next" through the setup
   - Launch when done

**That's it!** The app is completely ready to use.

- ✅ All dependencies included
- ✅ yt-dlp auto-downloads on first YouTube download
- ✅ No manual setup needed

---

### Option 2: From Source (For Developers)

## System Requirements

- **Node.js 16+** (https://nodejs.org/)

That's it! yt-dlp will auto-download if needed on first YouTube download.

## Quick Start

### 1. Install Node.js
Download and install from https://nodejs.org/

### 2. Extract Project
```bash
cd ipod-classic-tool-v3
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Application
```bash
npm start
```

Done! The Electron UI will launch.

---

## Optional: YouTube Downloading

yt-dlp is automatically downloaded on first YouTube download. However, you can also manually install it:

**Windows** (optional):
```powershell
choco install yt-dlp
```

**macOS** (optional):
```bash
brew install yt-dlp
```

**Linux** (optional):
```bash
sudo apt install yt-dlp
```

The app works perfectly without pre-installing yt-dlp - it will fetch it automatically!

---

## Verify Installation

```bash
# Check Node/npm
node --version
npm --version

# Test app starts (Ctrl+C to exit)
npm start
```

---

## Troubleshooting

**"npm command not found"**
- Node.js wasn't installed or added to PATH
- Restart terminal after installing Node.js

**App won't start**
- Run: `rm -rf node_modules package-lock.json && npm install`
- Then: `npm start`

**YouTube downloads not working**
- Install yt-dlp (see above)

---

## Platform Notes

### Windows
- Works on Windows 10+
- No additional software needed beyond Node.js

### macOS
- Works on macOS 10.13+
- May need: `xcode-select --install`

### Linux
- Works on Ubuntu, Debian, Fedora
- May need: `sudo apt install build-essential`

---

## Included Features

The app bundles everything needed:
- ✅ Electron (UI)
- ✅ Puppeteer (page automation)
- ✅ node-id3 (MP3 metadata)
- ✅ sharp (image processing)
- ✅ OpenAI API support (GPT metadata)
- ✅ Metadata fetchers for: YouTube Music, Spotify, Apple Music, Amazon Music, Tidal

---

## Support

For issues, check:
- Your Node.js version: `node --version`
- Dependencies installed: `npm list`
- App console output for error messages
