# How to Test the Fixes

## The Problem
The log shows you're running the **packaged/installed version** from:
```
C:\Users\teddg\AppData\Local\Programs\iPod Classic Tool
```

This is the OLD version without the fixes. You need to run the UPDATED source code.

## Option 1: Run from Source (Recommended for Testing)

1. **Open PowerShell in the project directory**
   ```powershell
   cd "C:\Users\Gamer\Desktop\ipod-classic-tool-v3"
   ```

2. **Install dependencies (if not done already)**
   ```powershell
   npm install
   ```

3. **Run the app from source**
   ```powershell
   npm start
   ```

This will launch Electron with the FIXED code.

## Option 2: Rebuild the Packaged App

1. **Build the new installer**
   ```powershell
   cd "C:\Users\Gamer\Desktop\ipod-classic-tool-v3"
   npm run build:win
   ```

2. **Find the new installer in `dist/` folder**
   - Look for `iPod Classic Tool Setup 3.0.0.exe`

3. **Uninstall the old version**
   - Go to Control Panel → Programs → Uninstall
   - Remove "iPod Classic Tool"

4. **Install the new version**
   - Run the new installer from `dist/`

## Option 3: Copy to Your Dad's PC

Once you've tested on your PC:

1. **Copy the ENTIRE project folder** to his PC
   ```
   ipod-classic-tool-v3/
   ```

2. **On his PC, run from source:**
   ```powershell
   cd path\to\ipod-classic-tool-v3
   npm install
   npm start
   ```

Or build the installer and give him the .exe file.

## What the Fixed Version Will Show

Instead of this:
```
❌ ERROR: Cannot read properties of null (reading 'artistUrl')
```

You'll see this:
```
[!] ⚠️  Link converter failed: Link converter failed: exit code 1
[!] ⚠️  This often happens on Windows with Puppeteer issues. Skipping.
```

And the app will continue instead of showing a confusing error!

## Additional Issue Found: Cookie Exporter

The log also shows an issue with the cookie exporter:
```
Error: Invalid package .\npx electron
```

This is being caught by the global handler now (won't crash), but needs a separate fix for the cookie exporter path in packaged apps.
