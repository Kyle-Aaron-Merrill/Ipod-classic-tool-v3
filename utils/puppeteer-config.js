import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Get the path to Chrome executable
 * Checks bundled location first (production), then user cache (development)
 * @returns {string|undefined} Path to Chrome executable
 */
export function getChromePath() {
    try {
        // Check if running in packaged app
        const isPackaged = process.env.NODE_ENV === 'production' || 
                          (process.resourcesPath && !process.resourcesPath.includes('node_modules'));
        
        if (isPackaged && process.resourcesPath) {
            // Production: Check extraFiles location
            const appDir = path.dirname(process.resourcesPath);
            const chromeDir = path.join(appDir, 'resources', 'chrome', 'win64-143.0.7499.42', 'chrome-win64');
            const chromePath = path.join(chromeDir, 'chrome.exe');
            
            if (fs.existsSync(chromePath)) {
                console.log('[Chromium] Using bundled Chrome:', chromePath);
                return chromePath;
            }
        }
        
        // Development: Use build directory if exists, otherwise user cache
        const buildPath = path.join(process.cwd(), 'build', 'chrome', 'win64-143.0.7499.42', 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(buildPath)) {
            console.log('[Chromium] Using build Chrome:', buildPath);
            return buildPath;
        }
        
        const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
        const devPath = path.join(
            userHome, 
            '.cache', 
            'puppeteer', 
            'chrome', 
            'win64-143.0.7499.42', 
            'chrome-win64', 
            'chrome.exe'
        );
        
        if (fs.existsSync(devPath)) {
            console.log('[Chromium] Using development Chrome:', devPath);
            return devPath;
        }
        
        console.log('[Chromium] Chrome not found in expected locations');
        return undefined;
        
    } catch (error) {
        console.error('[Chromium] Error finding Chrome:', error);
        return undefined;
    }
}

/**
 * Get default Puppeteer launch options with bundled Chrome
 * @returns {Object} Puppeteer launch options
 */
export function getPuppeteerLaunchOptions() {
    const chromePath = getChromePath();
    
    const options = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };
    
    if (chromePath) {
        options.executablePath = chromePath;
    }
    
    return options;
}
