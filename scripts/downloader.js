import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { getPythonCommand } from '../utils/platform-utils.js';
import { getYtDlpPath } from '../utils/yt-dlp-manager.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get directory paths for resolving ffmpeg
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const manifestPath = process.argv[2];

// === GET FFMPEG PATH ===
function getFfmpegPath() {
    try {
        const ffmpegBinary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        let ffmpegPath;
        
        // Try multiple locations in order
        const searchPaths = [];
        
        // 1. Packaged app locations
        if (process.resourcesPath) {
            searchPaths.push(
                path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', ffmpegBinary),
                path.join(process.resourcesPath, 'node_modules', 'ffmpeg-static', ffmpegBinary)
            );
        }
        
        // 2. Development locations
        searchPaths.push(
            path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', ffmpegBinary),
            path.join(process.cwd(), 'node_modules', 'ffmpeg-static', ffmpegBinary)
        );
        
        // Search all paths
        for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
                console.log(`[Downloader] ✅ Found ffmpeg at: ${searchPath}`);
                return searchPath;
            }
        }
        
        console.warn(`[Downloader] ⚠️  WARNING: ffmpeg-static not found in any of these locations:`);
        searchPaths.forEach(p => console.warn(`[Downloader]    - ${p}`));
        console.warn(`[Downloader] yt-dlp will fail to convert audio to MP3`);
        return null;
    } catch (err) {
        console.warn(`[Downloader] WARNING: Could not locate ffmpeg: ${err.message}`);
        return null;
    }
}

const FFMPEG_PATH = getFfmpegPath();

// === INITIAL VALIDATION ===
if (!manifestPath) {
    const errorMsg = 'No manifest path provided to downloader';
    console.error(`[Downloader] ERROR: ${errorMsg}`);
    process.exit(1);
}

console.log(`[Downloader] Received manifest path: ${manifestPath}`);
console.log(`[Downloader] Checking if file exists...`);

// Check if manifest file exists before trying to read it
if (!fs.existsSync(manifestPath)) {
    const errorMsg = `Manifest file not found at: ${manifestPath}`;
    console.error(`[Downloader] ERROR: ${errorMsg}`);
    console.error(`[Downloader] File exists check: false`);
    
    // Try to provide helpful info
    const dir = path.dirname(manifestPath);
    console.error(`[Downloader] Checking parent directory: ${dir}`);
    if (fs.existsSync(dir)) {
        console.error(`[Downloader] Parent directory exists`);
        console.error(`[Downloader] Files in directory:`, fs.readdirSync(dir));
    } else {
        console.error(`[Downloader] Parent directory does not exist`);
    }
    
    process.exit(1);
}

console.log(`[Downloader] ✅ Manifest file exists`);

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
    const errorMsg = `Failed to parse manifest file: ${err.message}`;
    console.error(`[Downloader] ERROR: ${errorMsg}`);
    process.exit(1);
}

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
    // Get download URL from Query if available, fallback to other fields
    const globalDownloadUrl = manifest.Query?.channelUrl || manifest.download_url || manifest.Captured_URL;
    
    if (!globalDownloadUrl) {
        throw new Error(`[Downloader] ERROR: No download URL found in manifest. Query: ${JSON.stringify(manifest.Query)}`);
    }
    
    // Ensure Tracks array exists; if not, create a placeholder
    if (!manifest.Tracks || !Array.isArray(manifest.Tracks) || manifest.Tracks.length === 0) {
        console.warn(`[Downloader] ⚠️  WARNING: No Tracks array or empty Tracks found in manifest.`);
        console.warn(`[Downloader] Manifest keys: ${Object.keys(manifest).join(', ')}`);
        console.warn(`[Downloader] Creating placeholder for full album download.`);
        manifest.Tracks = [
            {
                number: 1,
                title: "Full Album",
                status: "pending",
                duration: "N/A"
            }
        ];
    }
    
    const tracksToProcess = manifest.Tracks.filter(t => t.status === "pending" || t.status === "failed");

    console.log(`[Downloader] Processing ${tracksToProcess.length} tracks from: ${globalDownloadUrl}`);

    for (const track of tracksToProcess) {
        let outputPath = 'unknown'; // Initialize to avoid undefined reference in catch block
        
        try {
            const index = manifest.Tracks.findIndex(t => t.title === track.title);
            const safeTitle = track.title.replace(/[\\/:"*?<>|]/g, " ");
            const trackNum = String(track.number || index + 1).padStart(2, '0');
            outputPath = path.join(DOWNLOAD_DIR, `${trackNum} - ${safeTitle} - ${manifest.session_id}.mp3`);
            
            // Normalize path to use correct separators for the OS
            outputPath = path.normalize(outputPath);
            
            // Build Argument Array (Better for spawn)
            const args = [
                '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
                '--cookies', COOKIES_PATH,
                '--sleep-requests', '1', '--sleep-interval', '2',
                '-o', outputPath, globalDownloadUrl
            ];
            
            // Add ffmpeg location if available
            if (FFMPEG_PATH) {
                args.unshift('--ffmpeg-location', FFMPEG_PATH);
            }

            // Only use --playlist-items if we have specific track numbers (not a full album placeholder)
            if (globalDownloadUrl.includes('list=') && track.title !== "Full Album") {
                console.log(`[Downloader] Downloading specific track #${track.number} from playlist`);
                args.push('--playlist-items', String(track.number || index + 1));
            } else if (globalDownloadUrl.includes('list=') && track.title === "Full Album") {
                console.log(`[Downloader] Downloading entire playlist (no track filter)`);
                // Don't add --playlist-items; download the whole playlist
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
processAlbum()
    .then(() => {
        console.log(`[Downloader] ✅ All tracks processed successfully`);
        process.exit(0);
    })
    .catch(err => {
        console.error(`[Downloader] FATAL ERROR: ${err.message}`);
        console.error(err.stack);
        if (process.send) {
            process.send({ type: 'ERROR', message: err.message });
        }
        process.exit(1);
    });