import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Get the path to Chrome executable
 * Checks bundled location first (production), then user cache (development)
 * @param {string} [context] Optional label for logging context
 * @returns {string|undefined} Path to Chrome executable
 */
export function getChromePath(context = 'default') {
    try {
        console.error(`[Chromium] Starting Chrome path detection (context=${context})...`);
        console.error('[Chromium] process.resourcesPath:', process.resourcesPath || 'undefined');
        console.error('[Chromium] process.argv[0]:', process.argv[0] || 'undefined');
        console.error('[Chromium] process.cwd():', process.cwd());
        console.error('[Chromium] PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR || 'not set');
        console.error('[Chromium] PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || 'not set');
        
        // Helper: scan a base folder for any win64-*\chrome-win64\chrome.exe
        const findChromeInBase = (base) => {
            console.error(`[Chromium] Searching in: ${base}`);
            if (!base || !fs.existsSync(base)) {
                console.error(`[Chromium] Path does not exist: ${base}`);
                return undefined;
            }
            const entries = fs.readdirSync(base).filter((d) => d.startsWith('win64-'));
            console.error(`[Chromium] Found ${entries.length} win64-* folders:`, entries);
            // Prefer latest lexicographically (version strings sort reasonably)
            entries.sort().reverse();
            for (const entry of entries) {
                const candidate = path.join(base, entry, 'chrome-win64', 'chrome.exe');
                console.error(`[Chromium] Checking candidate: ${candidate}`);
                if (fs.existsSync(candidate)) {
                    const stats = fs.statSync(candidate);
                    console.error(`[Chromium] ✓ Found Chrome at: ${candidate} (size=${stats.size} bytes)`);
                    return candidate;
                }
            }
            console.error(`[Chromium] No Chrome found in: ${base}`);
            return undefined;
        };

        // 0) Environment override
        const envExec = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
        if (envExec) {
            console.error(`[Chromium] Found env override: ${envExec}`);
            if (fs.existsSync(envExec)) {
                console.error('[Chromium] Using env executable path');
                return envExec;
            }
            console.error('[Chromium] Env executable path does not exist on disk');
        }

        // 1) Packaged: check inside process.resourcesPath first
        if (process.resourcesPath) {
            // electron packs extra resources under resources/...
            const resChromeBaseA = path.join(process.resourcesPath, 'chrome');
            const resChromeA = findChromeInBase(resChromeBaseA);
            if (resChromeA) {
                console.error('[Chromium] Using bundled Chrome from resourcesPath:', resChromeA);
                return resChromeA;
            }
            // Some builds put resources under the app directory/resources
            const appDir = path.dirname(process.resourcesPath);
            const resChromeBaseB = path.join(appDir, 'resources', 'chrome');
            const resChromeB = findChromeInBase(resChromeBaseB);
            if (resChromeB) {
                console.error('[Chromium] Using bundled Chrome from app dir:', resChromeB);
                return resChromeB;
            }
        }

        // 1b) For utility processes, try the app executable path
        if (process.argv && process.argv.length > 0) {
            const exePath = process.argv[0];
            if (exePath && exePath.includes('iPod Classic Tool')) {
                const appRoot = path.dirname(exePath);
                const utilChromeBase = path.join(appRoot, 'resources', 'chrome');
                const utilChrome = findChromeInBase(utilChromeBase);
                if (utilChrome) {
                    console.error('[Chromium] Using bundled Chrome from utility process:', utilChrome);
                    return utilChrome;
                }
            }
        }

        // 2) Dev build folder
        const buildChromeBase = path.join(process.cwd(), 'build', 'chrome');
        const buildChrome = findChromeInBase(buildChromeBase);
        if (buildChrome) {
            console.error('[Chromium] Using build Chrome:', buildChrome);
            return buildChrome;
        }

        // 3) User cache (installed via @puppeteer/browsers or npx puppeteer)
        const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
        const cacheChromeBase = path.join(userHome, '.cache', 'puppeteer', 'chrome');
        const cacheChrome = findChromeInBase(cacheChromeBase);
        if (cacheChrome) {
            console.error('[Chromium] Using development Chrome:', cacheChrome);
            return cacheChrome;
        }

        console.error('[Chromium] Chrome not found in expected locations');
        return undefined;
    } catch (error) {
        console.error('[Chromium] Error finding Chrome:', error);
        return undefined;
    }
}

/**
 * Get default Puppeteer launch options with bundled Chrome
 * @param {string} [context] Optional label for logging context
 * @returns {Object} Puppeteer launch options
 */
export function getPuppeteerLaunchOptions(context = 'default') {
    const chromePath = getChromePath(context);
    
    // Check environment variable for headless mode (default true)
    const headlessMode = process.env.PUPPETEER_HEADLESS !== 'false';
    
    const options = {
        headless: headlessMode,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            // --- FIXES FOR THE "NOISE" ERRORS ---
            '--disable-background-networking',     // Stops the "Phone Home" to Google
            '--disable-component-update',           // Stops the browser from trying to update itself
            '--disable-extensions',                 // Blocks any hidden browser extensions
            '--disable-features=IsolateOrigins,site-per-process', // Saves memory
            '--disable-notifications'             // Stops "Allow notifications" popups
        ],
        dumpio: true
    };
    
    if (chromePath) {
        if (fs.existsSync(chromePath)) {
            options.executablePath = chromePath;
        } else {
            console.error(`[Chromium] WARNING: Resolved path does not exist: ${chromePath}`);
        }
    }
    
    // Log current mode
    if (!headlessMode) {
        console.error('[Chromium] ⚠️  DEBUG MODE: Running with headless=false (visible browser window)');
    }
    
    console.error('[Chromium] getPuppeteerLaunchOptions:', {
        context,
        headless: options.headless,
        executablePath: options.executablePath || 'auto',
        executableExists: !!options.executablePath && fs.existsSync(options.executablePath),
        cwd: process.cwd(),
        resourcesPath: process.resourcesPath || 'undefined',
        args: options.args
    });
    
    return options;
}
