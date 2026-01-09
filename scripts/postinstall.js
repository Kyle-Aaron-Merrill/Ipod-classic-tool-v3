#!/usr/bin/env node
/**
 * Postinstall script - Runs after npm install to verify all dependencies
 * This ensures Chromium and other system dependencies are in place
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isYtDlpAvailable } from '../utils/yt-dlp-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n🔧 [Postinstall] Verifying dependencies...\n');

// Install Chromium for Puppeteer and copy to project directory
console.log('📦 [Chromium] Installing Chromium browser for Puppeteer...');
console.log('   (This may take 2-5 minutes on first install)');

try {
    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    console.log('✅ Chromium installed successfully');
    
    // Copy Chromium to project directory for bundling with the app
    const userHome = process.env.USERPROFILE || process.env.HOME;
    const sourceDir = path.join(userHome, '.cache', 'puppeteer', 'chrome');
    const targetDir = path.join(__dirname, '..', 'build', 'chrome');
    
    if (fs.existsSync(sourceDir)) {
        console.log('📦 [Chromium] Bundling Chromium with app...');
        
        // Remove old build/chrome if exists
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        
        // Copy recursively
        fs.cpSync(sourceDir, targetDir, { recursive: true });
        console.log('✅ Chromium bundled to build/chrome');
    } else {
        console.log('⚠️  Could not find cached Chromium at: ' + sourceDir);
        console.log('   The browser will still work from cache');
    }
} catch (error) {
    console.error('❌ Error installing Chromium:', error.message);
    console.log('');
    console.log('⚠️  IMPORTANT: Chromium installation failed.');
    console.log('   The app will attempt to download Chromium on first run.');
    console.log('   This requires an internet connection and npm/npx to be available.');
    console.log('');
    console.log('If you want to manually fix this, run:');
    console.log('   npx puppeteer browsers install chrome');
    console.log('');
}

// Check yt-dlp
console.log('');
if (isYtDlpAvailable()) {
    console.log('✅ yt-dlp is available');
} else {
    console.log('ℹ️  yt-dlp not found in PATH (optional, for YouTube Music support)');
    console.log('   Windows: choco install yt-dlp');
    console.log('   macOS:   brew install yt-dlp');
    console.log('   Linux:   pip install yt-dlp  or  apt install yt-dlp');
}

// Check ffmpeg (optional)
try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    console.log('✅ FFmpeg is available (optional, for better audio quality)');
} catch (e) {
    console.log('ℹ️  FFmpeg not installed (optional - app will work without it)');
}

console.log('\n✅ Postinstall complete!\n');
console.log('To start the app, run: npm start\n');

