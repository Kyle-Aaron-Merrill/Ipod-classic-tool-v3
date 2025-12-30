import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, '..');
const YT_DLP_DIR = path.join(APP_DIR, '.yt-dlp-bin');
const YT_DLP_PATH = path.join(YT_DLP_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

/**
 * Get the path to yt-dlp executable (download if needed)
 */
export async function getYtDlpPath() {
    // Check if local copy exists
    if (fs.existsSync(YT_DLP_PATH)) {
        return YT_DLP_PATH;
    }

    // Try system PATH
    try {
        execSync(`${process.platform === 'win32' ? 'where' : 'which'} yt-dlp`, { stdio: 'pipe' });
        return 'yt-dlp'; // Found in system PATH
    } catch (e) {
        // Not in system PATH, need to download
    }

    console.log('📥 Downloading yt-dlp...');
    await downloadYtDlp();
    return YT_DLP_PATH;
}

/**
 * Download yt-dlp from GitHub releases
 */
async function downloadYtDlp() {
    try {
        if (!fs.existsSync(YT_DLP_DIR)) {
            fs.mkdirSync(YT_DLP_DIR, { recursive: true });
        }

        const downloadUrl = getDownloadUrl();
        console.log(`Fetching: ${downloadUrl}`);

        const response = await fetch(downloadUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Write file
        const buffer = await response.buffer();
        fs.writeFileSync(YT_DLP_PATH, buffer);

        // Make executable (Unix-like systems)
        if (process.platform !== 'win32') {
            fs.chmodSync(YT_DLP_PATH, 0o755);
        }

        console.log(`✅ yt-dlp downloaded to ${YT_DLP_PATH}`);
        return YT_DLP_PATH;
    } catch (error) {
        console.error(`❌ Failed to download yt-dlp: ${error.message}`);
        console.error('Manual installation required:');
        console.error('  Windows: choco install yt-dlp');
        console.error('  macOS: brew install yt-dlp');
        console.error('  Linux: sudo apt install yt-dlp');
        throw error;
    }
}

/**
 * Get the correct download URL for current platform
 */
function getDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch;
    
    // Latest release page
    const releaseUrl = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
    
    // Platform-specific filenames
    let filename;
    if (platform === 'win32') {
        filename = 'yt-dlp.exe';
    } else if (platform === 'darwin') {
        filename = arch === 'arm64' ? 'yt-dlp_macos_legacy' : 'yt-dlp_macos';
    } else if (platform === 'linux') {
        filename = 'yt-dlp_linux';
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`;
}

/**
 * Check if yt-dlp is available (sync version for postinstall)
 */
export function isYtDlpAvailable() {
    // Check local copy
    if (fs.existsSync(YT_DLP_PATH)) {
        return true;
    }

    // Check system PATH
    try {
        execSync(`${process.platform === 'win32' ? 'where' : 'which'} yt-dlp`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}
