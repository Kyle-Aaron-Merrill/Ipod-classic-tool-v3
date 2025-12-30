#!/usr/bin/env node
/**
 * Postinstall script - Runs after npm install to verify all dependencies
 * This ensures yt-dlp is available and other system dependencies are in place
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isYtDlpAvailable } from '../utils/yt-dlp-manager.js';

console.log('\n🔧 [Postinstall] Verifying dependencies...\n');

// Check yt-dlp
if (isYtDlpAvailable()) {
    console.log('✅ yt-dlp is available');
} else {
    console.log('ℹ️  yt-dlp not found in PATH');
    console.log('   It will be automatically downloaded on first run');
    console.log('   Or install manually with: choco install yt-dlp (Windows)');
}

// Check ffmpeg (optional)
try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    console.log('✅ FFmpeg is available (optional, for better audio quality)');
} catch (e) {
    console.log('ℹ️  FFmpeg not installed (optional - app will work without it)');
}

console.log('\n✅ Dependencies check complete!\n');
console.log('To start the app, run: npm start\n');
