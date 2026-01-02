import { app, BrowserWindow, ipcMain } from 'electron';
import path, { normalize, resolve } from 'path';
import fs from 'fs'; 
import os from 'os';
import crypto from 'crypto';
import { exec, fork } from 'child_process';
import { fileURLToPath } from 'url';
import { get } from 'http';
import { url } from 'inspector';
import { rejects } from 'assert';
import { getPythonCommand, escapePath } from './utils/platform-utils.js';
import { embedMetadataFromManifest } from './scripts/embed_from_manifest.js';
import { fetchMetadataWithGPT } from './scripts/fetch_gpt_meta.js';
import { getTrackUrl } from './scripts/get_track_url.js';

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
    originalLog(...args);
    if (loggingEnabled && !isLogging) {
        isLogging = true;
        try {
            writeLog(`[LOG] ${args.join(' ')}`);
        } catch (err) {
            originalError(`Failed to write log: ${err.message}`);
        } finally {
            isLogging = false;
        }
    }
};
console.error = (...args) => {
    originalError(...args);
    if (loggingEnabled && !isLogging) {
        isLogging = true;
        try {
            writeLog(`[ERROR] ${args.join(' ')}`);
        } catch (err) {
            // Silently fail to prevent double-error recursion
        } finally {
            isLogging = false;
        }
    }
};
const CONVERTER_PATH = path.join(PROJECT_ROOT, 'scripts', 'link-convert.js');
const DLP_PATH = path.join(PROJECT_ROOT, 'scripts', 'get_yt_dlp_link.js');


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
            console.log(`[MAIN] Launching cookie exporter from: ${exporterPath}`);
            
            // Use fork instead of exec to avoid path issues in packaged apps
            // Fork directly with Node instead of trying to call 'npx electron'
            const child = fork(exporterPath, ['youtube', COOKIES_PATH], {
                stdio: ['ignore', 'pipe', 'pipe', 'ipc']
            });
            
            child.stdout?.on('data', (data) => {
                console.log(`[COOKIE-EXPORTER] ${data.toString().trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                console.error(`[COOKIE-EXPORTER] ${data.toString().trim()}`);
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`[MAIN] Cookies refreshed successfully.`);
                    resolve();
                } else {
                    console.error(`[MAIN] Cookie exporter exited with code ${code}`);
                    reject(new Error(`Cookie exporter failed with code ${code}`));
                }
            });
            
            child.on('error', (err) => {
                console.error(`[MAIN] Cookie Export Error:`, err.message);
                reject(err);
            });
        } catch (err) {
            console.error(`[MAIN] Error launching cookie exporter:`, err.message);
            reject(err);
        }
    });
}

/**
 * Executes the downloader and embedder sequentially.
 * Returns a Promise so the main loop can 'await' the entire process.
 */
function download(manifestPath) {
    return new Promise((resolve, reject) => {
        console.log(`[Main] ⬇️ Starting Downloader for manifest: ${manifestPath}`);
        
        // Use fork WITHOUT 'inherit' to allow IPC (Inter-Process Communication)
        const downloader = fork(DOWNLOADER_PATH, [manifestPath]);

        // 1. Listen for IPC messages from the downloader script
        downloader.on('message', async (msg) => {
            // Forward real-time progress to the Renderer (UI)
            if (msg.type === 'PROGRESS') {
                if (mainWindow) {
                    mainWindow.webContents.send('progress-update', {
                        type: 'file',
                        value: msg.value // This is the % from downloader.js
                    });
                }
            }

            // Handle downloader errors
            if (msg.type === 'ERROR') {
                uiLog(`❌ [Downloader Error] ${msg.message}`);
                console.error(`[Main] Downloader error: ${msg.message}`);
                downloader.kill();
                reject(new Error(msg.message));
            }

            // Handle the 403 Forbidden / Cookie refresh fix
            if (msg.type === 'REFRESH_COOKIES_REQUEST') {
                uiLog("⚠️ [Main] Downloader requested cookie refresh...");
                
                try {
                    // This should trigger your existing cookie export logic
                    await launchCookieExporter(); 
                    
                    // Tell the downloader it's safe to try again
                    downloader.send({ type: 'REFRESH_COOKIES_DONE' });
                    uiLog("✅ [Main] Cookies refreshed. Resuming download...");
                } catch (err) {
                    uiLog(`❌ [Main] Cookie refresh failed: ${err.message}`);
                }
            }
        });

        // 2. Handle Downloader Close & Metadata Embedding
        downloader.on('close', async (code) => {
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
            const child = fork(DLP_PATH, [artistUrl, media, album, track]);
            let output = '';
            let errorOutput = '';

            child.on('message', (msg) => {
                if (msg.type === 'output') {
                    output += msg.data;
                }
            });

            child.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', (code) => {
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
            // Handle asar paths: if we're in an asar archive, we need to use a different path
            let converterPath = CONVERTER_PATH;
            if (process.mainModule && process.mainModule.filename.includes('.asar')) {
                // We're running from asar - use app.getAppPath() instead
                converterPath = path.join(app.getAppPath(), 'scripts', 'link-convert.js');
                console.log(`[Main] Using asar-aware path for link converter: ${converterPath}`);
            }
            
            const child = fork(converterPath, [url, manifestPath]);
            let output = '';
            let errorOutput = '';

            // Add 60 second timeout for the converter process
            timeoutHandle = setTimeout(() => {
                if (!processFinished) {
                    processFinished = true;
                    console.error(`[Main] Link converter timeout after 60s`);
                    try {
                        child.kill();
                    } catch (e) {
                        // ignore
                    }
                    reject(new Error("Link converter timed out - likely Puppeteer crash on Windows"));
                }
            }, 60000);

            child.on('message', (msg) => {
                if (msg.type === 'output') {
                    output += msg.data;
                }
            });

            child.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', (code) => {
                if (processFinished) return; // Already timed out
                processFinished = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);

                try {
                    if (code === 0 && output) {
                        const rawResults = JSON.parse(output.trim());
                        
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
                        
                        console.log(`[Main] Received query: ${JSON.stringify(queryObj)}`);
                        resolve(queryObj);
                    } else {
                        if (errorOutput) console.log(`[Link-Converter Logs]:\n${errorOutput}`);
                        if (code !== 0) {
                            console.error(`[Main] Link converter exited with code ${code}`);
                        }
                        reject(new Error(`Link converter failed: exit code ${code}`));
                    }
                } catch (parseError) {
                    reject(parseError);
                }
            });

            child.on('error', (err) => {
                if (processFinished) return;
                processFinished = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                console.error(`[Main] Fork error: ${err.message}`);
                reject(err);
            });
        } catch (err) {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error(`[Main] Error spawning converter: ${err.message}`);
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
        uiLog(`\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`);
        uiLog(`┃ 🚀 STARTING PIPELINE`);
        uiLog(`┃ URL: ${linkObj.url}`);
        uiLog(`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`);

        try {
            const manifestPath = await getMetaAndCreateManifest(linkObj);
            uiLog(`[1/7] 📁 Manifest: ${manifestPath}`);

            let query;
            try {
                query = await extractQueryFromLinkConversion(manifestPath, linkObj.url);
            } catch (err) {
                uiLog(`[!] ⚠️  Link converter failed: ${err.message}`);
                uiLog(`[!] ⚠️  This often happens on Windows with Puppeteer issues. Skipping.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            if (!query || !query.artistUrl) {
                uiLog(`[!] ⚠️  SKIPPING: Could not extract metadata from URL.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            uiLog(`[2/7] 🏷️  Metadata: ${query.artistUrl} - ${query.album} - ${query.track}`);

            // Check if channelUrl is already a direct YouTube URL (not a search URL)
            let yt_dlp_link = null;
            if (query.channelUrl && query.channelUrl.includes('youtube.com') && 
                (query.channelUrl.includes('/watch?v=') || query.channelUrl.includes('/playlist?list='))) {
                // It's already a direct YouTube link, use it directly
                console.log(`[Main] Direct YouTube URL detected, skipping channel search`);
                yt_dlp_link = query.channelUrl;
            } else {
                // Need to search for the artist channel and find the release
                yt_dlp_link = await extractYoutubeDlpLinkFromQuery(query.channelUrl || query.artistUrl, query.media, query.album, query.track);
            }
            
            if (!yt_dlp_link) {
                uiLog(`[!] ⚠️  SKIPPING: No matching YouTube release found.`);
                if (mainWindow) mainWindow.webContents.send('download-status', { id: linkObj.url, status: 'skipped' });
                return;
            }

            uiLog(`[3/7] 🔗 YouTube Link: ${yt_dlp_link}`);
            await extractGptMeta(manifestPath);
            uiLog(`[4/7] 🤖 GPT Enrichment: Complete`);
            await normalizeMeta(manifestPath);
            uiLog(`[5/7] 🛠️  Normalization: Complete`);
            await updateManifest(manifestPath, yt_dlp_link);
            uiLog(`[6/7] 💾 Final Manifest: Saved`);

            uiLog(`[→] ⬇️  Handoff: Starting Downloader...`);
            await download(manifestPath);

            uiLog(`\n✅ SUCCESS: "${query.album || query.track }" has finished.`);
            deleteManifest(manifestPath);
        } catch (err) {
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
    //setupWindow.webContents.openDevTools();
    setupWindow.on('closed', () => {
        setupWindow = null;
        if (!fs.existsSync(CONFIG_PATH)) app.quit();
    });
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

