# Fix for Puppeteer/Chromium Issues on Windows

## Problem
The app cannot extract YouTube Music metadata because Puppeteer cannot find Chrome/Chromium.

Error message:
```
Could not find Chrome (ver. 143.0.7499.42). This can occur if either
 1. you did not perform an installation before running the script
    (e.g. `npx puppeteer browsers install chrome`) or
 2. your cache path is incorrectly configured
```

## Solution

Run this command in PowerShell as Administrator to install Chromium:

```powershell
npx puppeteer browsers install chrome
```

### Full Steps:

1. **Open PowerShell as Administrator**
   - Press `Win + X` and select "Windows PowerShell (Admin)"
   - Or search for "PowerShell" and right-click → "Run as Administrator"

2. **Navigate to the app directory** (if running from source):
   ```powershell
   cd "C:\Users\teddg\Desktop\ipod-classic-tool-v3"
   ```
   
   Or if running the installed app, use:
   ```powershell
   cd "C:\Users\teddg\AppData\Local\Programs\iPod Classic Tool\resources\app.asar.unpacked"
   ```

3. **Install Chromium**:
   ```powershell
   npx puppeteer browsers install chrome
   ```
   
   This will download and install Chrome (~200-300 MB). Wait for it to complete.

4. **Restart the app** and try again

## Alternative Fix (if above doesn't work)

If the above fails, try using a system-installed Chrome/Chromium instead:

1. Set environment variable pointing to Chrome:
   ```powershell
   $env:PUPPETEER_EXECUTABLE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
   ```

2. Try the app again

## Verify Installation

After installation, verify Chromium is installed:
```powershell
ls "$env:USERPROFILE\.cache\puppeteer"
```

You should see a `chrome` or `chromium` folder there.

## If Still Having Issues

- Check that antivirus isn't blocking Puppeteer
- Try disabling hardware acceleration in Chrome
- Ensure your Windows installation has proper permissions
