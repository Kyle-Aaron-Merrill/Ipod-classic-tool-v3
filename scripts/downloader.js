import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { getPythonCommand } from '../utils/platform-utils.js';
import { getYtDlpPath } from '../utils/yt-dlp-manager.js';

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const DOWNLOAD_DIR = manifest.music_download_path;
const COOKIES_PATH = path.join(path.dirname(manifestPath), 'cookies.txt');

// === VALIDATION ON STARTUP ===
function validateEnvironment() {
    const errors = [];
    
    // Check if DOWNLOAD_DIR exists and is writable
    if (!DOWNLOAD_DIR) {
        errors.push('DOWNLOAD_DIR not set in manifest');
    } else if (!fs.existsSync(DOWNLOAD_DIR)) {
        console.warn(`[Downloader] DOWNLOAD_DIR does not exist: ${DOWNLOAD_DIR}. Creating...`);
        try {
            fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
            console.log(`[Downloader] Created DOWNLOAD_DIR: ${DOWNLOAD_DIR}`);
        } catch (err) {
            errors.push(`Failed to create DOWNLOAD_DIR: ${err.message}`);
        }
    }
    
    // Check if COOKIES_PATH exists
    if (!fs.existsSync(COOKIES_PATH)) {
        console.warn(`[Downloader] WARNING: Cookies file not found at ${COOKIES_PATH}`);
        console.warn(`[Downloader] Protected content may fail to download. Cookie refresh will be triggered if needed.`);
    } else {
        console.log(`[Downloader] ✅ Cookies file found: ${COOKIES_PATH}`);
    }
    
    if (errors.length > 0) {
        const errorMsg = errors.join('; ');
        console.error(`[Downloader] VALIDATION FAILED: ${errorMsg}`);
        if (process.send) {
            process.send({ type: 'ERROR', message: `Environment validation failed: ${errorMsg}` });
        }
        throw new Error(errorMsg);
    }
    console.log('[Downloader] ✅ Environment validation passed');
}

// Run validation before processing
validateEnvironment();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function updateYtdlp() {
    try {
        const pythonCmd = getPythonCommand();
        execSync(`${pythonCmd} -m pip install -U yt-dlp`, { stdio: 'ignore' });
    } catch (e) {
        try { execSync('yt-dlp -U', { stdio: 'ignore' }); } catch (err) {}
    }
}

async function downloadWithRetry(args, track, onProgress) {
    let attempts = 0;
    const maxAttempts = 2;
    let currentArgs = [...args];
    
    // Get yt-dlp path (downloads if needed)
    let ytDlpPath;
    try {
        ytDlpPath = await getYtDlpPath();
        console.log(`[Downloader] Using yt-dlp from: ${ytDlpPath}`);
    } catch (err) {
        console.error(`[Downloader] FATAL: Could not locate yt-dlp: ${err.message}`);
        if (process.send) {
            process.send({ type: 'ERROR', message: `yt-dlp error: ${err.message}` });
        }
        throw new Error(`Failed to get yt-dlp path: ${err.message}`);
    }

    while (attempts < maxAttempts) {
        try {
            await new Promise((resolve, reject) => {
                // Ensure --no-progress is removed so we can scrape the %
                const finalArgs = currentArgs.filter(a => a !== '--no-progress');
                const child = spawn(ytDlpPath, finalArgs);
                let errorOutput = '';

                child.stdout.on('data', (data) => {
                    const match = data.toString().match(/(\d+\.\d+)%/);
                    if (match && onProgress) onProgress(parseFloat(match[1]));
                });

                child.stderr.on('data', (data) => { errorOutput += data.toString(); });

                child.on('close', (code) => {
                    if (code === 0) resolve();
                    else {
                        const err = new Error(errorOutput || `Exit code ${code}`);
                        err.stderr = errorOutput;
                        reject(err);
                    }
                });
            });
            return true;
        } catch (e) {
            const errorMsg = e.stderr || e.message || "";
            const isForbidden = errorMsg.includes("403") || errorMsg.includes("Forbidden");
            
            if (isForbidden && attempts < maxAttempts - 1) {
                attempts++;
                // --- COOKIE REFRESH LOGIC ---
                if (process.send) {
                    process.send({ type: 'REFRESH_COOKIES_REQUEST' });
                    // Wait for Main to tell us cookies are ready
                    await new Promise(r => process.once('message', m => m.type === 'REFRESH_COOKIES_DONE' && r()));
                }
                
                updateYtdlp();
                if (!currentArgs.includes('youtube:player_client=android,web')) {
                    currentArgs.push('--extractor-args', 'youtube:player_client=android,web');
                }
                continue;
            }
            throw e;
        }
    }
}

async function processAlbum() {
    const globalDownloadUrl = manifest.download_url;
    const tracksToProcess = manifest.Tracks.filter(t => t.status === "pending" || t.status === "failed");

    console.log(`[Downloader] Processing ${tracksToProcess.length} tracks from: ${globalDownloadUrl}`);

    for (const track of tracksToProcess) {
        try {
            const index = manifest.Tracks.findIndex(t => t.title === track.title);
            const safeTitle = track.title.replace(/[\\/:"*?<>|]/g, " ");
            const trackNum = String(track.number || index + 1).padStart(2, '0');
            const outputPath = path.join(DOWNLOAD_DIR, `${trackNum} - ${safeTitle} - ${manifest.session_id}.mp3`);
            
            // Build Argument Array (Better for spawn)
            const args = [
                '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
                '--cookies', COOKIES_PATH,
                '--sleep-requests', '1', '--sleep-interval', '2',
                '-o', outputPath, globalDownloadUrl
            ];

            if (globalDownloadUrl.includes('list=')) {
                args.push('--playlist-items', String(track.number || index + 1));
            }

            await downloadWithRetry(args, track, (percent) => {
                if (process.send) process.send({ type: 'PROGRESS', value: percent });
            });

            track.status = "completed";
            track.local_file_path = outputPath; 
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch (e) {
            const errorDetails = e.stderr || e.message || String(e);
            console.error(`[Downloader] ❌ FAILED to download track: "${track.title}"`);
            console.error(`[Downloader] Error: ${errorDetails}`);
            console.error(`[Downloader] Output path was: ${outputPath}`);
            
            track.status = "failed";
            track.error_message = errorDetails; // Store error for UI display
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            
            // Send error update to main process
            if (process.send) {
                process.send({ 
                    type: 'TRACK_ERROR', 
                    track: track.title,
                    message: errorDetails 
                });
            }
        }
    }
}

// Execute with error handling
processAlbum().catch(err => {
    console.error(`[Downloader] FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    if (process.send) {
        process.send({ type: 'ERROR', message: err.message });
    }
    process.exit(1);
});