import { spawn } from 'child_process';
import path from 'path';

/**
 * Automatically installs Chromium for Puppeteer if it's missing
 * @returns {Promise<boolean>} true if installation succeeded, false otherwise
 */
export async function ensureChromiumInstalled() {
    return new Promise((resolve) => {
        console.log('[Chromium] Attempting to install Chromium...');
        console.log('[Chromium] This may take 2-5 minutes on first install.');
        
        const installProcess = spawn('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: true
        });

        let output = '';
        let errorOutput = '';

        installProcess.stdout?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
                console.log(`[Chromium] ${msg}`);
                output += msg;
            }
        });

        installProcess.stderr?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
                console.log(`[Chromium-ERR] ${msg}`);
                errorOutput += msg;
            }
        });

        installProcess.on('close', (code) => {
            if (code === 0) {
                console.log('[Chromium] ✅ Chromium installation completed successfully!');
                resolve(true);
            } else {
                console.error(`[Chromium] ❌ Installation failed with code ${code}`);
                console.error(`[Chromium] Error: ${errorOutput}`);
                resolve(false);
            }
        });

        installProcess.on('error', (err) => {
            console.error(`[Chromium] ❌ Failed to start installation: ${err.message}`);
            resolve(false);
        });
    });
}

/**
 * Checks if the error is a "Chrome not found" error from Puppeteer
 * @param {Error} error
 * @returns {boolean}
 */
export function isChromeNotFoundError(error) {
    if (!error) return false;
    const msg = error.message || error.toString();
    return msg.includes('Could not find Chrome') || 
           msg.includes('Could not find Chromium') ||
           msg.includes('chrome not installed');
}
