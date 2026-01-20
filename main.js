import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron';
import path, { normalize, resolve } from 'path';
import fs from 'fs'; 
import os from 'os';
import crypto from 'crypto';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { get } from 'http';
import { url } from 'inspector';
import { rejects } from 'assert';
import { getPythonCommand, escapePath } from './utils/platform-utils.js';
import { getChromePath } from './utils/puppeteer-config.js';
import { embedMetadataFromManifest } from './scripts/embed_from_manifest.js';
import { fetchMetadataWithGPT } from './scripts/fetch_gpt_meta.js';
import { getTrackUrl } from './scripts/get_track_url.js';
import { setupDependencyHandlers } from './utils/dependency-setup-handler.js';

// --- CRITICAL: Global Error Handlers to Prevent Process Crashes ---
// Catch unhandled promise rejections (prevents terminal reset on crash)
process.on('unhandledRejection', (reason, promise) => {
    console.error(`[CRITICAL] Unhandled Promise Rejection:`, reason);
    console.error(`[CRITICAL] Promise:`, reason);
});

// Catch uncaught exceptions (prevents terminal reset on crash)
process.on('uncaughtException', (error) => {
    console.error(`[CRITICAL] Uncaught Exception:`, error);
    console.error(`[CRITICAL] Stack:`, error.stack);
});

// --- Global Variables ---
let setupWindow = null;
let mainWindow = null;

// ES Modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Paths ---
const PROJECT_ROOT = __dirname;
const UI_HTML_PATH = path.join(PROJECT_ROOT, 'ui', 'index.html');
const PRELOAD_JS_PATH = path.join(PROJECT_ROOT, 'preload.js');
const UI_SETUP_PATH = path.join(PROJECT_ROOT, 'ui', 'setup.html');
const DEPENDENCY_SETUP_PATH = path.join(PROJECT_ROOT, 'ui', 'dependency-setup.html');
const ICON_PATH = path.join(PROJECT_ROOT, 'build', 'logo.png');

const APP_DATA_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(APP_DATA_DIR, 'config.json');
const COOKIES_PATH = path.join(APP_DATA_DIR, 'cookies.txt');
const MUSIC_PATH = app.getPath('music');
const LOG_PATH = path.join(APP_DATA_DIR, 'app.log');
const DOWNLOADER_PATH = path.join(PROJECT_ROOT, 'scripts', 'downloader.js');

// --- Setup Logging ---
function writeLog(message) {
    try {
        // Ensure directory exists
        if (!fs.existsSync(APP_DATA_DIR)) {
            fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        }
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(LOG_PATH, logMessage);
    } catch (err) {
        // Silently fail if logging fails
        console.error(`Failed to write log: ${err.message}`);
    }
}

// Redirect console.log and console.error to file (but not before app ready)
let loggingEnabled = false;
const originalLog = console.log;
const originalError = console.error;

// Flag to prevent recursive logging
let isLogging = false;

console.log = (...args) => {
    const message = args.join(' ');
    originalLog(...args);
    
    // Write to terminal stdout (for packaged apps)
    if (process.stdout && process.stdout.writable) {
        process.stdout.write(message + '\n');
    }
    
    if (loggingEnabled && !isLogging) {
        isLogging = true;
        try {
            writeLog(`[LOG] ${message}`);
        } catch (err) {
            originalError(`Failed to write log: ${err.message}`);
        } finally {
            isLogging = false;
        }
    }
};
console.error = (...args) => {
    const message = args.join(' ');
    originalError(...args);
    
    // Write to terminal stderr (for packaged apps)
    if (process.stderr && process.stderr.writable) {
        process.stderr.write(message + '\n');
    }
    
    if (loggingEnabled && !isLogging) {
        isLogging = true;
        try {
            writeLog(`[ERROR] ${message}`);
        } catch (err) {
            // Silently fail to prevent double-error recursion
        } finally {
            isLogging = false;
        }
    }
};
const CONVERTER_PATH = path.join(PROJECT_ROOT, 'scripts', 'link-convert.js');
const DLP_PATH = path.join(PROJECT_ROOT, 'scripts', 'get_yt_dlp_link.js');

// Check if dependencies are available
function checkDependencies() {
    const deps = {
        node: false,
        npm: false,
        python: false
    };
    
    try {
        execSync('where node', { stdio: 'pipe' });
        deps.node = true;
    } catch (e) {
        // Node not found
    }
    
    try {
        execSync('where npm', { stdio: 'pipe' });
        deps.npm = true;
    } catch (e) {
        // npm not found
    }
    
    try {
        execSync('where python', { stdio: 'pipe' });
        deps.python = true;
    } catch (e) {
        // Python not found
    }
    
    return deps;
}

function areDependenciesMissing() {
    // Check for force setup flag (for testing)
    if (process.env.IPOD_FORCE_SETUP === 'true') {
        console.log("[MAIN] IPOD_FORCE_SETUP is set - showing setup window");
        return true;
    }
    
    // Check if setup was completed recently (bypass checks if so)
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            if (config.setupCompleted === true) {
                const setupTime = new Date(config.setupCompletedAt).getTime();
                const now = Date.now();
                const timeSinceSetup = now - setupTime;
                
                // If setup was completed less than 2 hours ago, assume dependencies are installed
                // (they might not show up in PATH until reboot, but they're installed)
                if (timeSinceSetup < 2 * 60 * 60 * 1000) {
                    console.log("[MAIN] Setup was recently completed - skipping dependency check");
                    return false;
                }
            }
        }
    } catch (configErr) {
        console.warn("[MAIN] Error checking setup completion flag:", configErr.message);
    }
    
    try {
        execSync('where node', { stdio: 'pipe' });
    } catch (e) {
        return true; // Node missing
    }
    
    try {
        execSync('where npm', { stdio: 'pipe' });
    } catch (e) {
        return true; // npm missing
    }
    
    try {
        execSync('where python', { stdio: 'pipe' });
    } catch (e) {
        return true; // Python missing
    }
    
    return false; // All dependencies found
}

if (!fs.existsSync(MUSIC_PATH)) {
    fs.mkdirSync(MUSIC_PATH, { recursive: true });
    console.log(`[MAIN] Created Music directory at: ${MUSIC_PATH}`);
}
/*
GLOBAL VARIABLES
*/
// --- Config ---
let appConfig = null;

// --- Links ---
let videoLinkArray = [];
let finalizedLinks = [];

/*
FUNCTIONS
*/
function deleteManifest(manifestPath) {
    if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        console.log(`[Main] 🗑️ Manifest deleted: ${manifestPath}`);
    }
}

function launchCookieExporter() {
    return new Promise((resolve, reject) => {
        try {
            const exporterPath = path.join(PROJECT_ROOT, 'scripts', 'cookie_exporter.cjs');
            console.log(`[MAIN] ▶️ Launching cookie exporter from: ${exporterPath}`);
            console.log(`[MAIN] Cookie path: ${COOKIES_PATH}`);
            
            // Use fork instead of exec to avoid path issues in packaged apps
            // Fork directly with Node instead of trying to call 'npx electron'
            const child = utilityProcess.fork(exporterPath, ['youtube', COOKIES_PATH], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdoutData = '';
            let stderrData = '';
            
            child.stdout?.on('data', (data) => {
                const msg = data.toString().trim();
                stdoutData += msg;
                console.log(`[COOKIE-EXPORTER] ${msg}`);
            });
            
            child.stderr?.on('data', (data) => {
                const msg = data.toString().trim();
                stderrData += msg;
                console.error(`[COOKIE-EXPORTER-ERR] ${msg}`);
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`[MAIN] ✅ Cookies refreshed successfully (exit code 0)`);
                    resolve();
                } else {
                    console.error(`[MAIN] ❌ Cookie exporter exited with code ${code}`);
                    if (stderrData) {
                        console.error(`[MAIN] ❌ Error details:\n${stderrData}`);
                    } else {
                        console.error(`[MAIN] Last output: ${stdoutData || 'no output'}`);
                    }
                    console.error(`[MAIN] ⚠️  This is usually a Puppeteer/Chromium issue. Continuing anyway...`);
                    resolve(); // Don't reject - allow pipeline to continue
                }
            });
            
            child.on('error', (err) => {
                console.error(`[MAIN] ❌ Cookie Export Error: ${err.message}`);
                console.error(`[MAIN] Stack: ${err.stack}`);
                reject(err);
            });
            
            // 30 second timeout
            const timeout = setTimeout(() => {
                console.error(`[MAIN] ❌ Cookie exporter timeout after 30s`);
                try {
                    child.kill();
                } catch (e) {
                    // ignore
                }
                reject(new Error('Cookie exporter timeout'));
            }, 30000);
            
            child.on('exit', () => {
                clearTimeout(timeout);
            });
            
        } catch (err) {
            console.error(`[MAIN] ❌ Error launching cookie exporter: ${err.message}`);
            console.error(`[MAIN] Stack: ${err.stack}`);
            reject(err);
        }
    });
}

/**
 * Executes the downloader and embedder sequentially.
 * Returns a Promise so the main loop can 'await' the entire process.
 * @param {string} manifestPath - Path to the manifest file
 * @param {Function} uiLog - Function to log messages to the UI
 */
function download(manifestPath, uiLog) {
    return new Promise((resolve, reject) => {
        console.log(`[Main] ⬇️ Starting Downloader for manifest: ${manifestPath}`);
        
        console.log(`[Downloader] Spawning utility process: ${DOWNLOADER_PATH}`);
        const downloader = utilityProcess.fork(DOWNLOADER_PATH, [manifestPath], {
            stdio: 'pipe'
        });
        
        let errorOutput = '';

        // Listen for stdout 
        downloader.stdout?.on('data', (data) => {
            console.log(`[Downloader-stdout]`, data.toString());
        });

        // Listen for stderr
        downloader.stderr?.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`[Downloader-stderr]`, data.toString());
        });

        // Handle exit
        downloader.on('exit', async (code) => {
            if (code === 0) {
                console.log("[Main] Downloader finished. Starting Metadata Embedding...");
                
                try {
                    await embedMetadataFromManifest(manifestPath);
                    console.log("✅ [Main] All tracks downloaded and embedded successfully!");
                    resolve();
                } catch (err) {
                    console.error(`[Main] Embedding failed: ${err.message}`);
                    reject(new Error("Embedding stage failed."));
                }
            } else {
                console.error(`[Main] Downloader exited with code ${code}.`);
                reject(new Error(`Downloader failed with code ${code}`));
            }
        });

        downloader.on('error', (err) => {
            console.error("[Main] Downloader process error:", err);
            reject(err);
        });
    });
}

async function updateManifest(manifestPath, yt_dlp_link) {
    let masterMetadata = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Safety check: if Tracks is missing or empty, this is likely a Puppeteer failure
    if (!masterMetadata.Tracks || masterMetadata.Tracks.length === 0) {
        console.error(`[Main] ❌ CRITICAL: No tracks found in manifest. This typically means:`);
        console.error(`[Main]    - Puppeteer failed to scrape YouTube Music metadata`);
        console.error(`[Main]    - Chromium/Chrome is not installed or accessible`);
        console.error(`[Main]    - Antivirus is blocking the browser automation`);
        console.error(`[Main]    `);
        console.error(`[Main] 📋 SOLUTION: Run this command to install Chromium:`);
        console.error(`[Main]    npx puppeteer browsers install chrome`);
        console.error(`[Main] `);
        throw new Error("Cannot proceed: No tracks available. Puppeteer/Chromium issue. See PUPPETEER_FIX.md for help.");
    }

    const jobManifest = {
        ...masterMetadata,
        download_url: yt_dlp_link || "", 
        music_download_path: MUSIC_PATH,
        Tracks: masterMetadata.Tracks.map((track) => ({
            ...track,
            status: "pending"
        }))
    };

    fs.writeFileSync(manifestPath, JSON.stringify(jobManifest, null, 2));
    console.log(`[Main] Manifest created: ${manifestPath}`);
}

async function normalizeMeta(manifestPath){
    let masterData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        if (!masterData.Tracks && masterData.tracklist) {
            console.log("[Main] Normalizing tracklist schema to standard Tracks format...");
            masterData.Tracks = masterData.tracklist.map(t => ({
                title: t.title,
                number: t.number || t.track_number,
                duration: t.duration,
                url: t.url
            }));
            
            // Save normalized data back to disk
            fs.writeFileSync(manifestPath, JSON.stringify(masterData, null, 2));
        }
}

async function extractGptMeta(manifestPath) {
    try {
        // Try to get API key from config (nested structure), environment, or skip
        let apiKey = process.env.OPENAI_API_KEY;
        
        if (!apiKey && appConfig) {
            // Check for nested structure: openai_credentials.api_key
            if (appConfig.openai_credentials && appConfig.openai_credentials.api_key) {
                apiKey = appConfig.openai_credentials.api_key;
            }
            // Also check for flat structure: apiKey
            else if (appConfig.apiKey) {
                apiKey = appConfig.apiKey;
            }
        }
        
        if (!apiKey) {
            console.log('[GPT] OpenAI API key not configured in settings. Skipping GPT metadata extraction.');
            return;
        }
        
        console.log('[GPT] Using configured OpenAI API key for metadata extraction.');
        await fetchMetadataWithGPT(manifestPath, apiKey);
    } catch (err) {
        console.warn('[GPT] Error during metadata extraction:', err.message);
        // Continue even on GPT error to prevent blocking the flow
    }
}

async function extractYoutubeDlpLinkFromQuery(artistUrl, media, album, track){
    return new Promise((resolve, reject) => {
        try {
            console.log(`[DLP] Spawning utility process: ${DLP_PATH}`);
            console.log(`[DLP] Args:`, [artistUrl, media, album, track]);
            
            const child = utilityProcess.fork(DLP_PATH, [artistUrl, media, album, track], {
                stdio: 'pipe'
            });
            let output = '';
            let errorOutput = '';

            child.stdout?.on('data', (data) => {
                output += data.toString();
            });

            child.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('exit', (code) => {
                if (code === 0 && output) {
                    try {
                        const finalYoutubeLink = output.trim();
                        if (finalYoutubeLink && finalYoutubeLink.startsWith('https')) {
                            console.log(`[Main] SUCCESS! Received Link: ${finalYoutubeLink}`);
                            if (mainWindow) {
                                mainWindow.webContents.send('download-progress', {
                                    status: 'Link Found',
                                    url: finalYoutubeLink
                                });
                            }
                            resolve(finalYoutubeLink);
                        } else {
                            console.error(`[Link-Convert] ⚠️ No link found for this item. Skipping.`);
                            resolve(null);
                        }
                    } catch (parseError) {
                        reject(parseError);
                    }
                } else {
                    if (errorOutput) console.log(`[Fetcher Logs]:\n${errorOutput}`);
                    console.error(`[Link-Convert] ⚠️ No link found for this item. Skipping.`);
                    resolve(null);
                }
            });

            child.on('error', (err) => {
                console.error(`[Main] Fork error: ${err.message}`);
                reject(err);
            });
        } catch (err) {
            console.error(`[Main] Error spawning DLP fetcher: ${err.message}`);
            reject(err);
        }
    });
}

async function extractQueryFromLinkConversion(manifestPath, url) {
    return new Promise((resolve, reject) => {
        let processFinished = false;
        let timeoutHandle = null;

        try {
            // utilityProcess handles asar paths automatically
            let converterPath = CONVERTER_PATH;
            console.log(`[LinkConverter] 🔍 Resolving script path...`);
            if (app.isPackaged) {
                // Electron will handle app.asar.unpacked automatically
                converterPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'link-convert.js');
                console.log(`[LinkConverter] ✅ Packaged app, using: ${converterPath}`);
            } else {
                console.log(`[LinkConverter] ℹ️ Running from source, using: ${converterPath}`);
            }

            // Force Puppeteer to use the bundled Chrome if we can find it
            const bundledChrome = getChromePath('main-spawn');
            if (bundledChrome) {
                console.log(`[LinkConverter] ✅ Bundled Chrome resolved for child: ${bundledChrome}`);
            } else {
                console.warn(`[LinkConverter] ⚠️ Bundled Chrome not resolved at spawn time; child will auto-detect`);
            }
            
            console.log(`[LinkConverter] ▶️ Starting link converter for: ${url}`);
            console.log(`[LinkConverter] Manifest: ${manifestPath}`);
            
            const child = utilityProcess.fork(converterPath, [url, manifestPath], {
                stdio: ['ignore', 'pipe', 'pipe'],  // stdin: ignore, stdout: pipe, stderr: pipe
                env: {
                    ...process.env,
                    // Strongly hint Puppeteer to use the bundled Chrome
                    PUPPETEER_EXECUTABLE_PATH: bundledChrome || process.env.PUPPETEER_EXECUTABLE_PATH,
                    // Ensure consistent cache dir if it ever tries to fetch
                    PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || path.join(app.getPath('home'), '.cache', 'puppeteer')
                }
            });
            let output = '';
            let errorOutput = '';

            console.log(`[LinkConverter] 🔧 utilityProcess spawned, pid: ${child.pid || 'pending'}`);

            // Add 60 second timeout for the converter process
            timeoutHandle = setTimeout(() => {
                if (!processFinished) {
                    processFinished = true;
                    console.error(`[LinkConverter] ❌ Timeout after 60s - killing process`);
                    try {
                        child.kill();
                    } catch (e) {
                        console.error(`[LinkConverter] ❌ Error killing process:`, e.message);
                    }
                    reject(new Error("Link converter timed out - likely Puppeteer crash on Windows"));
                }
            }, 60000);

            // Capture spawn event (confirms process started)
            child.on('spawn', () => {
                console.log(`[LinkConverter] ✅ Process spawned successfully, pid: ${child.pid}`);
            });

            // Capture any errors from utilityProcess itself (not the script)
            child.on('error', (err) => {
                if (processFinished) return;
                processFinished = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                console.error(`[LinkConverter] ❌ utilityProcess error (failed to spawn or IPC issue):`, err.message);
                console.error(`[LinkConverter] ❌ Error stack:`, err.stack);
                reject(new Error(`utilityProcess error: ${err.message}`));
            });

            child.stdout?.on('data', (data) => {
                const msg = data.toString();
                if (msg.trim()) {
                    // All stdout goes into output buffer
                    output += msg;
                    // Log for debugging
                    const preview = msg.trim().substring(0, 100);
                    if (msg.trim().startsWith('{') || msg.trim().startsWith('[')) {
                        console.log(`[LinkConverter-stdout] [JSON] ${preview}...`);
                    } else {
                        console.log(`[LinkConverter-stdout] ${preview}...`);
                    }
                }
            });

            child.stderr?.on('data', (data) => {
                const msg = data.toString();
                if (msg.trim()) {
                    errorOutput += msg;
                    console.error(`[LinkConverter-stderr] ${msg.trim()}`);
                }
            });

            child.on('exit', (code) => {
                if (processFinished) return; // Already timed out or errored
                processFinished = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);

                console.log(`[LinkConverter] Process exited with code: ${code}`);
                console.log(`[LinkConverter] Output length: ${output.length} bytes`);
                if (errorOutput) {
                    console.log(`[LinkConverter] STDERR (diagnostic only):\n${errorOutput.substring(0, 500)}...`);
                }

                try {
                    // Success if exit code is 0. Child process writes diagnostics to stderr, JSON to stdout
                    if (code === 0) {
                        console.log(`[LinkConverter] ✅ Process completed successfully (exit code 0)`);
                        
                        // Try to parse JSON output if present
                        if (output && output.trim()) {
                            console.log(`[LinkConverter] ✅ Parsing JSON output...`);
                            
                            // Try to extract JSON from output (handle mixed stdout)
                            let jsonString = output.trim();
                            
                            // If output contains non-JSON text, try to find the JSON line
                            if (!jsonString.startsWith('[') && !jsonString.startsWith('{')) {
                                // Split by lines and find the last line that looks like JSON
                                const lines = output.split('\n');
                                for (let i = lines.length - 1; i >= 0; i--) {
                                    const line = lines[i].trim();
                                    if (line.startsWith('[') || line.startsWith('{')) {
                                        jsonString = line;
                                        console.log(`[LinkConverter] Found JSON at line ${i + 1}`);
                                        break;
                                    }
                                }
                            }
                            
                            const rawResults = JSON.parse(jsonString);
                            
                            // Convert array format to query object format
                            const queryObj = {};
                            for (const item of rawResults) {
                                if (item.Captured_URL) queryObj.capturedUrl = item.Captured_URL;
                                if (item.Service) queryObj.service = item.Service;
                                if (item.Media) queryObj.media = item.Media;
                                if (item.Artist) queryObj.artistUrl = item.Artist;
                                if (item.Album) queryObj.album = item.Album;
                                if (item.Track) queryObj.track = item.Track;
                                if (item.ChannelUrl) queryObj.channelUrl = item.ChannelUrl;
                            }
                            
                            console.log(`[LinkConverter] ✅ Successfully extracted: ${JSON.stringify(queryObj)}`);
                            resolve(queryObj);
                        } else {
                            console.log(`[LinkConverter] ℹ️  No stdout JSON (expected if using manifest-based workflow)`);
                            console.log(`[LinkConverter] ✅ Treating exit code 0 as success`);
                            // Return empty/null result; caller should check manifest
                            resolve(null);
                        }
                    } else {
                        console.error(`[LinkConverter] ❌ Exit code ${code}`);
                        if (!errorOutput) {
                            console.error(`[LinkConverter] ❌ No error details captured. This may be a Puppeteer/Chromium issue.`);
                            console.error(`[LinkConverter] ❌ Suggestions:`);
                            console.error(`[LinkConverter]    1. Ensure Chromium dependencies are installed`);
                            console.error(`[LinkConverter]    2. Try disabling hardware acceleration`);
                            console.error(`[LinkConverter]    3. Check antivirus isn't blocking Puppeteer`);
                            console.error(`[LinkConverter]    4. Restart the application`);
                        }
                        reject(new Error(`Link converter failed: exit code ${code}`));
                    }
                } catch (parseError) {
                    console.error(`[LinkConverter] ❌ JSON parse error: ${parseError.message}`);
                    reject(parseError);
                }
            });

            child.on('error', (err) => {
                if (processFinished) return;
                processFinished = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                console.error(`[LinkConverter] ❌ Fork error: ${err.message}`);
                reject(err);
            });
        } catch (err) {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error(`[LinkConverter] ❌ Error spawning converter: ${err.message}`);
            console.error(`[LinkConverter] Stack: ${err.stack}`);
            reject(err);
        }
    });
}

async function processLinks() {
    if (videoLinkArray.length === 0) {
        console.log("[Main] All downloads complete.");
        return;
    }

    // Concurrency: compute based on user config and system resources
    // Priority: user config (appConfig.concurrency OR appConfig.maxConcurrency OR appConfig.downloadConcurrency)
    // Fallback: based on CPU cores and available memory
    const DEFAULT_CONCURRENCY = 4;
    let CONCURRENCY = DEFAULT_CONCURRENCY;
    try {
        const cpuCount = (os.cpus() && os.cpus().length) || 2;
        const totalMemGB = os.totalmem ? (os.totalmem() / (1024 ** 3)) : 4; // GB

        // Recommended concurrency: prefer ~75% of CPU cores, clamped to available RAM and at least 1
        let recommended = Math.max(1, Math.ceil(cpuCount * 0.75));
        // ensure we don't exceed RAM-based limit (approx 1GB per worker)
        const ramLimit = Math.max(1, Math.floor(totalMemGB));
        recommended = Math.max(1, Math.min(recommended, Math.min(cpuCount, ramLimit)));

        // honor possible user-config keys
        const userCfg = appConfig || {};
        const userVal = (Number.isInteger(userCfg.concurrency) && userCfg.concurrency > 0) ? userCfg.concurrency
            : (Number.isInteger(userCfg.maxConcurrency) && userCfg.maxConcurrency > 0) ? userCfg.maxConcurrency
            : (Number.isInteger(userCfg.downloadConcurrency) && userCfg.downloadConcurrency > 0) ? userCfg.downloadConcurrency
            : null;

        if (userVal) {
            // clamp to reasonable bounds
            CONCURRENCY = Math.max(1, Math.min(userVal, Math.max(1, cpuCount)));
        } else {
            // choose the recommended concurrency by default (kept within system limits)
            CONCURRENCY = recommended;
        }
    } catch (e) {
        CONCURRENCY = DEFAULT_CONCURRENCY;
    }
    console.log(`[Main] Using concurrency=${CONCURRENCY} (cpus=${os.cpus()?.length || 'unknown'})`);
    let index = 0;
    const totalItems = videoLinkArray.length;

    const uiLog = (msg) => {
        console.error(msg);
        if (mainWindow) mainWindow.webContents.send('log-update', msg);
    };

    async function processSingle(linkObj) {
        const jobId = crypto.randomUUID().substring(0, 8);
        console.log(`\n[Pipeline-${jobId}] ▶️ Starting new pipeline...`);
        console.log(`[Pipeline-${jobId}] Input URL: ${linkObj.url}`);
        
        uiLog(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
        uiLog(`┃ 🚀 STARTING PIPELINE`);
        uiLog(`┃ URL: ${linkObj.url}`);
        uiLog(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

        try {
            console.log(`[Pipeline-${jobId}] [Step 1/7] Getting metadata and creating manifest...`);
            const manifestPath = await getMetaAndCreateManifest(linkObj);
            console.log(`[Pipeline-${jobId}] [Step 1/7] ✅ Manifest created: ${manifestPath}`);
            uiLog(`[1/7] 📁 Manifest: ${manifestPath}`);

            let query;
            try {
                console.log(`[Pipeline-${jobId}] [Step 2/7] Extracting query from link conversion...`);
                query = await extractQueryFromLinkConversion(manifestPath, linkObj.url);
                console.log(`[Pipeline-${jobId}] [Step 2/7] ✅ Query extracted:`, query);
            } catch (err) {
                console.error(`[Pipeline-${jobId}] [Step 2/7] ❌ Link converter error: ${err.message}`);
                uiLog(`[!] ⚠️  Link converter failed: ${err.message}`);
                uiLog(`[!] ⚠️  This often happens on Windows with Puppeteer issues. Skipping.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            if (!query) {
                console.log(`[Pipeline-${jobId}] [Step 2/7] ℹ️  Query is null, checking if manifest was populated...`);
                // Child process may have written metadata to manifest instead of returning JSON
                try {
                    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                    console.log(`[Pipeline-${jobId}] [Step 2/7] Manifest data keys:`, Object.keys(manifestData));
                    
                    // Check if we have album metadata in manifest (stored at root level)
                    if (manifestData.Album_Title && manifestData.Primary_Artist) {
                        console.log(`[Pipeline-${jobId}] [Step 2/7] ✅ Found metadata in manifest, reconstructing query...`);
                        
                        // Use resolved_url if available (from browse link resolution), otherwise use original URL
                        const urlToUse = manifestData.resolved_url || linkObj.url;
                        console.log(`[Pipeline-${jobId}] [Step 2/7] Using URL for query: ${urlToUse}${manifestData.resolved_url ? ' (resolved)' : ''}`);
                        
                        // For YouTube Music URLs, use them as the channelUrl (direct link to content)
                        const isYouTubeMusicUrl = urlToUse.includes('music.youtube.com') || urlToUse.includes('youtube.com');
                        
                        query = {
                            service: 'youtube music',
                            media: 'album',
                            artistUrl: manifestData.Primary_Artist || 'Various Artists',
                            album: manifestData.Album_Title,
                            track: 'Full Album',
                            capturedUrl: urlToUse,
                            channelUrl: isYouTubeMusicUrl ? urlToUse : null
                        };
                        console.log(`[Pipeline-${jobId}] [Step 2/7] ✅ Reconstructed query:`, query);
                    } else {
                        console.error(`[Pipeline-${jobId}] [Step 2/7] ❌ No Album_Title or Primary_Artist in manifest`);
                        console.error(`[Pipeline-${jobId}] [Step 2/7] Manifest has:`, manifestData);
                        uiLog(`[!] ⚠️  SKIPPING: Could not extract metadata from URL.`);
                        if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                        return;
                    }
                } catch (manifestErr) {
                    console.error(`[Pipeline-${jobId}] [Step 2/7] ❌ Failed to read manifest: ${manifestErr.message}`);
                    uiLog(`[!] ⚠️  SKIPPING: Could not extract metadata from URL.`);
                    if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                    return;
                }
            }

            // For soundtracks and compilations, we might not have an artistUrl but we should still proceed
            // Use album name as fallback for searching
            const searchIdentifier = query.artistUrl || query.album || 'Unknown';
            
            if (!searchIdentifier || searchIdentifier === 'Unknown') {
                console.error(`[Pipeline-${jobId}] [Step 2/7] ❌ Query missing both artist and album information`);
                console.error(`[Pipeline-${jobId}] Query object:`, query);
                uiLog(`[!] ⚠️  SKIPPING: Could not extract metadata from URL.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            uiLog(`[2/7] 🏷️  Metadata: ${query.artistUrl || '(Compilation/Soundtrack)'} - ${query.album} - ${query.track}`);

            // Check if channelUrl is already a direct YouTube URL (not a search URL)
            let yt_dlp_link = null;
            if (query.channelUrl && 
                (query.channelUrl.includes('youtube.com') || query.channelUrl.includes('music.youtube.com')) && 
                (query.channelUrl.includes('/watch?v=') || query.channelUrl.includes('/playlist?list='))) {
                // It's already a direct YouTube link, use it directly
                console.log(`[Pipeline-${jobId}] [Step 3/7] Direct YouTube URL detected, skipping channel search`);
                console.log(`[Pipeline-${jobId}] [Step 3/7] Using URL: ${query.channelUrl}`);
                yt_dlp_link = query.channelUrl;
            } else {
                // Need to search for the artist channel and find the release
                // For soundtracks/compilations, use album name if no artist available
                const searchQuery = query.artistUrl || query.album || '';
                console.log(`[Pipeline-${jobId}] [Step 3/7] Extracting YouTube DLP link from query...`);
                yt_dlp_link = await extractYoutubeDlpLinkFromQuery(query.channelUrl || searchQuery, query.media, query.album, query.track);
                console.log(`[Pipeline-${jobId}] [Step 3/7] ✅ Got yt_dlp_link: ${yt_dlp_link}`);
            }
            
            if (!yt_dlp_link) {
                console.error(`[Pipeline-${jobId}] [Step 3/7] ❌ No YouTube link found`);
                uiLog(`[!] ⚠️  SKIPPING: No matching YouTube release found.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            uiLog(`[3/7] 🔗 YouTube Link: ${yt_dlp_link}`);
            
            console.log(`[Pipeline-${jobId}] [Step 4/7] Extracting GPT metadata...`);
            await extractGptMeta(manifestPath);
            console.log(`[Pipeline-${jobId}] [Step 4/7] ✅ GPT enrichment complete`);
            uiLog(`[4/7] 🤖 GPT Enrichment: Complete`);
            
            console.log(`[Pipeline-${jobId}] [Step 5/7] Normalizing metadata...`);
            await normalizeMeta(manifestPath);
            console.log(`[Pipeline-${jobId}] [Step 5/7] ✅ Normalization complete`);
            uiLog(`[5/7] 🛠️  Normalization: Complete`);
            
            console.log(`[Pipeline-${jobId}] [Step 6/7] Updating manifest...`);
            await updateManifest(manifestPath, yt_dlp_link);
            console.log(`[Pipeline-${jobId}] [Step 6/7] ✅ Manifest updated`);
            uiLog(`[6/7] 💾 Final Manifest: Saved`);

            console.log(`[Pipeline-${jobId}] [Step 7/7] Starting downloader...`);
            uiLog(`[→] ⬇️  Handoff: Starting Downloader...`);
            await download(manifestPath, uiLog);

            console.log(`[Pipeline-${jobId}] ✅ SUCCESS: Pipeline completed for "${query.album || query.track}"`);
            uiLog(`\n✅ SUCCESS: "${query.album || query.track }" has finished.`);
            deleteManifest(manifestPath);
        } catch (err) {
            console.error(`[Pipeline-${jobId}] ❌ Pipeline error: ${err.message}`);
            console.error(`[Pipeline-${jobId}] Stack: ${err.stack}`);
            uiLog(`\n❌ ERROR: ${err.message}`);
        } finally {
            uiLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        }
    }

    // Simple concurrency runner
    const runners = new Array(CONCURRENCY).fill(null).map(async () => {
        while (true) {
            let item;
            try {
                // take next item atomically
                if (index < totalItems) item = videoLinkArray[index++];
                else break;
                // update batch progress
                if (mainWindow) mainWindow.webContents.send('progress-update', { type: 'batch', current: index, total: totalItems });
                await processSingle(item);
            } catch (runnerErr) {
                // Catch ANY error in runner to prevent process crash
                console.error(`[Main] Runner error (caught to prevent crash): ${runnerErr.message}`);
                uiLog(`[!] ⚠️  Critical error in processing: ${runnerErr.message}`);
            }
        }
    });

    try {
        await Promise.all(runners);
    } catch (allErr) {
        // Final safety net - catch errors from Promise.all itself
        console.error(`[Main] Critical error in Promise.all: ${allErr.message}`);
        uiLog(`[!] ⚠️  Critical error during batch processing: ${allErr.message}`);
    }
    
    console.log(`[Main] All ${totalItems} items processed.`);

    // Clear in-memory queue and notify renderer to clear UI state
    try {
        videoLinkArray = [];
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('app:reset-done', { success: true, auto: true });
            mainWindow.webContents.send('log-update', `[MAIN] All items processed — UI cleared.`);
        }
    } catch (e) {
        console.warn('[Main] Failed to auto-clear UI after processing:', e.message);
    }
}

async function getMetaAndCreateManifest(linkObj){
    // Return a Promise so callers can await the manifest being fully written
    return new Promise((resolve, reject) => {
        try {
            // Create a highly-unique session id to avoid filename collisions
            const sessionID = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
            const manifestPath = path.join(APP_DATA_DIR, `manifest_${sessionID}.json`);

            // Initial state of the manifest
            const initialManifest = {
                session_id: sessionID,
                source_url: linkObj.url,
                music_download_path: MUSIC_PATH,
                status: "queued",
                metadata: {}
            };

            fs.writeFileSync(manifestPath, JSON.stringify(initialManifest, null, 2));
            console.log(`[Main] Manifest created for job ${sessionID}`);

            // small delay to ensure file system stability on some platforms
            setTimeout(() => {
                console.log(`[Main] Step 1 Complete: Manifest ${sessionID} is ready for Step 2.`);
                resolve(manifestPath);
            }, 50);
        } catch (err) {
            reject(err);
        }
    });
}


function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '116.68.185.155';
}

function computeConcurrencyInfo() {
    const DEFAULT_CONCURRENCY = 4;
    let cpuCount = 2;
    let totalMemGB = 4;
    try {
        cpuCount = (os.cpus() && os.cpus().length) || 2;
        totalMemGB = os.totalmem ? (os.totalmem() / (1024 ** 3)) : 4;
    } catch (e) {}

    // recommended: ~75% of CPU cores, limited by RAM (approx 1GB per worker)
    let recommended = Math.max(1, Math.ceil(cpuCount * 0.75));
    const ramLimit = Math.max(1, Math.floor(totalMemGB));
    recommended = Math.max(1, Math.min(recommended, Math.min(cpuCount, ramLimit)));

    const userCfg = appConfig || {};
    const userVal = (Number.isInteger(userCfg.concurrency) && userCfg.concurrency > 0) ? userCfg.concurrency
        : (Number.isInteger(userCfg.maxConcurrency) && userCfg.maxConcurrency > 0) ? userCfg.maxConcurrency
        : (Number.isInteger(userCfg.downloadConcurrency) && userCfg.downloadConcurrency > 0) ? userCfg.downloadConcurrency
        : null;

    const min = 1;
    const max = Math.max(1, cpuCount);

    // Ensure recommended (normal) falls within min..max
    recommended = Math.max(min, Math.min(max, recommended));

    return {
        cpuCount,
        totalMemGB: Math.round(totalMemGB),
        recommended,
        default: DEFAULT_CONCURRENCY,
        userVal,
        min,
        max
    };
}

function loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            appConfig = JSON.parse(data);
            console.log('[MAIN] Configuration successfully loaded.'); 
            return appConfig;
        } catch (error) {
            console.error('[MAIN ERROR] Failed to load or parse config.json:', error);
            return null;
        }
    }
    return null;
}

function waitForMetadata(filePath, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (fs.existsSync(filePath)) {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error("Timeout waiting for music_metadata_extracted.json"));
            }
        }, 500);
    });
}

function cleanMetadataString(str) {
    if (!str || typeof str !== 'string') return "";
    return str
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\\/]/g, " ")       // First, replace slashes with spaces
        .replace(/[:"*?<>|]/g, "")    // Then remove other illegal filename characters
        .replace(/\s+/g, " ")         // Collapse multiple spaces into one
        .trim();
}

/*
IPC HANDLERS
*/
ipcMain.handle('refresh-cookies', async () => {
    try {
        await launchCookieExporter();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.on('download:start', async (event) => {
    processLinks();
});

ipcMain.on('save-config', (event, config) => {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        appConfig = config;
        event.sender.send('save-config-reply', { success: true });
        if (setupWindow) {
            setupWindow.close();
            setupWindow = null;
        }
        // If main window exists, reload it to apply new config instead of reopening
        if (mainWindow && mainWindow.webContents) {
            try {
                mainWindow.webContents.reload();
            } catch (e) {
                console.error('[MAIN] Failed to reload mainWindow:', e.message);
                createWindow();
            }
        } else {
            createWindow();
        }
    } catch (error) {
        console.error('[MAIN ERROR] Failed to save config.json:', error);
        event.sender.send('save-config-reply', { success: false, message: error.message });
    }
});

ipcMain.handle('get-local-ip', () => getLocalIpAddress());

// Return current saved config (if any)
ipcMain.handle('get-config', () => {
    return appConfig || {};
});

// Return concurrency/system info for the UI
ipcMain.handle('get-concurrency-info', () => {
    return computeConcurrencyInfo();
});

ipcMain.on('link-input:send', (event, linkUrl) => {
    const linkIndex = videoLinkArray.length + 1;
    const linkObject = { linkIndex, url: linkUrl };
    videoLinkArray.push(linkObject);

    console.log(`[IPC] Received new link: ${linkUrl}`);
    event.sender.send('log-update', linkUrl);
    event.sender.send('link-input:confirm', `Link added successfully: ${linkUrl}`);
});

// Reset app: clear queued links, delete manifest files, clear session storage, reload window
ipcMain.on('app:reset', async (event) => {
    try {
        // Clear in-memory queue
        videoLinkArray = [];

        // Delete manifest_*.json files in app data dir
        try {
            const files = fs.readdirSync(APP_DATA_DIR);
            for (const f of files) {
                if (f.startsWith('manifest_') && f.endsWith('.json')) {
                    const p = path.join(APP_DATA_DIR, f);
                    try { fs.unlinkSync(p); console.log(`[Main] Deleted manifest: ${p}`); } catch (e) { console.warn(`[Main] Failed deleting ${p}: ${e.message}`); }
                }
            }
        } catch (e) {
            console.warn('[Main] Could not enumerate app data dir for manifests:', e.message);
        }

        // Clear renderer session storage and reload
        if (mainWindow && mainWindow.webContents) {
            try {
                await mainWindow.webContents.session.clearStorageData();
                mainWindow.webContents.send('log-update', '[MAIN] App reset: cleared queue and cache. Reloading window...');
                mainWindow.reload();
            } catch (e) {
                console.error('[Main] Failed to clear session or reload:', e.message);        }
        }

        event.sender.send('app:reset-done', { success: true });
    } catch (err) {
        console.error('[Main] app:reset failed:', err.message);
        event.sender.send('app:reset-done', { success: false, error: err.message });
    }
});

ipcMain.on('delete-video-url', (event, urlToRemove) => {
    // Remove links matching the provided URL string
    try {
        videoLinkArray = videoLinkArray.filter(link => (link && link.url) ? link.url !== urlToRemove : true);
        console.log("Deleted:", urlToRemove);
    } catch (e) {
        console.warn('[Main] delete-video-url handler error:', e.message);
    }
});

// Clear the entire in-memory queue and delete any manifest files (no reload)
ipcMain.on('clear-queue', (event) => {
    try {
        videoLinkArray = [];

        // Delete manifest_*.json files in app data dir
        try {
            const files = fs.readdirSync(APP_DATA_DIR);
            for (const f of files) {
                if (f.startsWith('manifest_') && f.endsWith('.json')) {
                    const p = path.join(APP_DATA_DIR, f);
                    try { fs.unlinkSync(p); console.log(`[Main] Deleted manifest: ${p}`); } catch (e) { console.warn(`[Main] Failed deleting ${p}: ${e.message}`); }
                }
            }
        } catch (e) {
            console.warn('[Main] Could not enumerate app data dir for manifests during clear-queue:', e.message);
        }

        // Notify renderer
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('log-update', '[MAIN] Queue cleared and manifests removed.');
            event.sender.send('clear-queue-done', { success: true });
        } else {
            event.sender.send('clear-queue-done', { success: true });
        }
    } catch (err) {
        console.error('[Main] clear-queue failed:', err.message);
        event.sender.send('clear-queue-done', { success: false, error: err.message });
    }
});

/*
WINDOWS
*/
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 800,
        resizable: true,
        frame: true,
        icon: ICON_PATH,
        webPreferences: {
            preload: PRELOAD_JS_PATH,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile(UI_HTML_PATH); 
    mainWindow.on('closed', () => { mainWindow = null; });
    //mainWindow.webContents.openDevTools();
}

function createSetupWindow() {
    setupWindow = new BrowserWindow({
        width: 600,
        height: 550,
        resizable: true,
        frame: true,
        icon: ICON_PATH,
        webPreferences: { preload: PRELOAD_JS_PATH, contextIsolation: true, nodeIntegration: false }
    });
    setupWindow.loadFile(UI_SETUP_PATH);
    setupWindow.on('closed', () => {
        setupWindow = null;
        if (!fs.existsSync(CONFIG_PATH)) app.quit();
    });
}

function createDependencyWindow() {
    console.log("[MAIN] Creating dependency window...");
    let depWindow = new BrowserWindow({
        width: 800,
        height: 900,
        resizable: true,
        frame: true,
        icon: ICON_PATH,
        webPreferences: { preload: PRELOAD_JS_PATH, contextIsolation: true, nodeIntegration: false }
    });
    console.log("[MAIN] Window object created");
    
    depWindow.loadFile(DEPENDENCY_SETUP_PATH);
    console.log("[MAIN] Dependency setup HTML loaded");
    
    // Setup dependency handlers
    setupDependencyHandlers(depWindow);
    console.log("[MAIN] Dependency handlers set up");
    
    depWindow.on('closed', () => {
        console.log("[MAIN] Dependency window closed");
        depWindow = null;
        // Launch the main app window after dependency setup completes
        console.log("[MAIN] Launching main app window...");
        createWindow();
    });
    
    depWindow.webContents.on('did-finish-load', () => {
        console.log("[MAIN] Dependency window content loaded successfully");
    });
    
    depWindow.webContents.on('crashed', () => {
        console.error("[MAIN] Dependency window crashed!");
    });
    
    return depWindow;
}

/*
APP LIFECYCLE
*/
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && fs.existsSync(CONFIG_PATH)) createWindow();
    else if (BrowserWindow.getAllWindows().length === 0 && !fs.existsSync(CONFIG_PATH)) createSetupWindow();
});

app.on('ready', () => {
    try {
        loggingEnabled = true; // Enable file logging now
        console.log("=== iPod Classic Tool Started ===");
        
        // Check if dependencies are missing on first startup
        let depsMissing = false;
        try {
            depsMissing = areDependenciesMissing();
        } catch (depsErr) {
            console.warn("[MAIN] Error checking dependencies, assuming missing:", depsErr.message);
            depsMissing = true;
        }
        
        if (depsMissing) {
            console.log("[MAIN] Dependencies missing! Opening dependency setup window...");
            try {
                createDependencyWindow();
            } catch (depWinErr) {
                console.error("[MAIN] Error creating dependency window:", depWinErr.message);
                // Fallback - create a basic window
                if (!mainWindow) createWindow();
            }
            return; // Don't proceed with app initialization until dependencies are installed
        }
        
        if (fs.existsSync(CONFIG_PATH)) { 
            try {
                loadConfig(); 
            } catch (cfgErr) {
                console.error(`[Main] Error loading config: ${cfgErr.message}`);
            }
            createWindow(); 
        } else {
            createSetupWindow();
        }
        
        if (!fs.existsSync(COOKIES_PATH)) {
            try {
                launchCookieExporter();
            } catch (cookieErr) {
                console.warn(`[Main] Error launching cookie exporter: ${cookieErr.message}`);
                // Continue anyway - cookies will be handled later
            }
        }
    } catch (readyErr) {
        console.error(`[Main] Critical error during app ready: ${readyErr.message}`);
        // Try to show at least a basic window
        try {
            if (!mainWindow) createWindow();
        } catch (windowErr) {
            console.error(`[Main] Failed to create window: ${windowErr.message}`);
        }
    }
});

// IPC handler to open dependency setup window
ipcMain.on('open-dependency-setup', (event) => {
    createDependencyWindow();
});

// IPC handler for when dependencies are successfully installed
ipcMain.on('dependencies-installed', () => {
    console.log("[MAIN] Dependencies installed successfully. Initializing app...");
    
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                loadConfig();
            } catch (cfgErr) {
                console.error(`[Main] Error loading config: ${cfgErr.message}`);
            }
            createWindow();
        } else {
            createSetupWindow();
        }
        
        if (!fs.existsSync(COOKIES_PATH)) {
            try {
                launchCookieExporter();
            } catch (cookieErr) {
                console.warn(`[Main] Error launching cookie exporter: ${cookieErr.message}`);
            }
        }
    } catch (err) {
        console.error(`[Main] Error initializing app after dependency setup: ${err.message}`);
    }
});
