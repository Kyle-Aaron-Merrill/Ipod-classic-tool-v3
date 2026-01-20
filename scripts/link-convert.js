// EMERGENCY: Log immediately before any imports
console.error('[STARTUP] link-convert.js started at', new Date().toISOString());
console.error('[STARTUP] pid:', process.pid);
console.error('[STARTUP] argv:', process.argv);

// Deep debug hooks - install FIRST before any imports
process.on('unhandledRejection', (reason) => {
    console.error('[Link-Convert][UnhandledRejection]', reason?.message || reason);
    if (reason?.stack) console.error('[Link-Convert][Stack]', reason.stack);
});
process.on('uncaughtException', (err) => {
    console.error('[Link-Convert][UncaughtException]', err?.message || err);
    if (err?.stack) console.error('[Link-Convert][Stack]', err.stack);
});

console.error('[STARTUP] About to import puppeteer...');
import puppeteer from "puppeteer";
console.error('[STARTUP] Imported puppeteer');
import { install } from '@puppeteer/browsers';
console.error('[STARTUP] Imported @puppeteer/browsers');
import PuppeteerExtra from 'puppeteer-extra';
console.error('[STARTUP] Imported puppeteer-extra');
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
console.error('[STARTUP] Imported stealth plugin');
import { getPuppeteerLaunchOptions } from '../utils/puppeteer-config.js';
console.error('[STARTUP] Imported getPuppeteerLaunchOptions');
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import { getAmazonAlbumMeta } from './library_scripts/amazon_album_meta_fetcher.js';
import { getAmazonTrackMeta } from './library_scripts/amazon_track_meta_fetcher.js';
import { getSpotifyAlbumMeta } from './library_scripts/spotify_album_meta_fetcher.js';
import { getSpotifyTrackMeta } from './library_scripts/spotify_track_meta_fetcher.js';
import { getAppleAlbumMeta } from './library_scripts/apple_album_meta_fetcher.js';
import { getAppleTrackMeta } from './library_scripts/apple_track_meta_fetcher.js';
import { getYoutubeMusicAlbumMeta } from './library_scripts/yt_music_album_meta_fetcher.js'
import { getYoutubeMusicTrackMeta } from './library_scripts/yt_music_track_meta_fetcher.js'
import { getTidalAlbumMetadata } from './library_scripts/tidal_album_meta_fetcher.js'
import { getTidalTrackMetadata } from './library_scripts/tidal_track_meta_fetcher.js'

// --- Path Configuration ---
// const OUTPUT_DIR = './assets/lib-json';
// const meta_path = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

// Ensure the directory exists so the fetchers don't fail when writing
// if (!fs.existsSync(OUTPUT_DIR)) {
//     fs.mkdirSync(OUTPUT_DIR, { recursive: true });
// }

/**
 * Auto-installs Chromium by letting Puppeteer handle it automatically
 * Sets environment to allow Puppeteer to download on first launch
 */
async function ensureChromiumInstalled() {
    console.error('[Chromium] Downloading Chrome via @puppeteer/browsers...');
    console.error('[Chromium] This may take 2-5 minutes on first install.');
    
    try {
        // Set cache directory to user's home folder (guaranteed writable)
        const cacheDir = os.homedir() + '/.cache/puppeteer';
        process.env.PUPPETEER_CACHE_DIR = cacheDir;
        
        // Explicitly download Chrome - this WAITS for completion
        console.error(`[Chromium] Cache directory: ${cacheDir}`);
        console.error(`[Chromium] ⏳ Starting download... this may take a few minutes...`);
        
        const result = await install({ 
            cacheDir: cacheDir,
            browser: 'chrome',
            buildId: 'stable'
        });
        
        console.error(`[Chromium] ✅ Chrome successfully downloaded to: ${result.executablePath}`);
        console.error(`[Chromium] 🔍 Verifying installation...`);
        
        // Verify by launching to ensure it's actually usable (using configured Chrome path)
        const verifyOptions = getPuppeteerLaunchOptions('install-verify');
        console.error('[Chromium] Verify options:', {
            headless: verifyOptions.headless,
            executablePath: verifyOptions.executablePath || 'auto',
            args: verifyOptions.args
        });
        const testBrowser = await puppeteer.launch(verifyOptions);
        await testBrowser.close();
        console.error(`[Chromium] ✅ Chrome verified and working!`);
        
        return true;
    } catch (err) {
        console.error(`[Chromium] ❌ Failed to download Chrome: ${err.message}`);
        console.error(`[Chromium] Stack: ${err.stack}`);
        return false;
    }
}

/**
 * Resolves a browse/redirect link by opening it in Puppeteer and capturing the final URL.
 * Uses Puppeteer stealth plugin to bypass anti-bot detection.
 * @param {string} initialUrl 
 * @returns {Promise<string>} The resolved destination URL
 */
async function resolveBrowseLink(initialUrl) {
    console.error(`[Link-Convert] Resolving browse link: ${initialUrl}`);
    let browser = null;
    
    try {
        const launchOptionsBrowse = getPuppeteerLaunchOptions('resolve-browse');
        // Use new headless mode for better rendering
        launchOptionsBrowse.headless = 'new';
        launchOptionsBrowse.dumpio = true;
        launchOptionsBrowse.args = launchOptionsBrowse.args.filter(arg => 
            arg !== '--disable-gpu' && !arg.includes('IsolateOrigins')
        );
        
        // Use puppeteer-extra with stealth plugin to bypass YouTube Music detection
        PuppeteerExtra.use(StealthPlugin());
        console.error('[Link-Convert] Launch options for resolveBrowseLink:', {
            headless: launchOptionsBrowse.headless,
            executablePath: launchOptionsBrowse.executablePath || 'auto',
            dumpio: launchOptionsBrowse.dumpio,
            argsCount: launchOptionsBrowse.args.length,
            stealth: 'enabled'
        });
        
        browser = await PuppeteerExtra.launch(launchOptionsBrowse);
        const page = await browser.newPage();
        
        // Set realistic viewport to avoid layout issues
        await page.setViewport({ width: 1280, height: 800 });
        
        // Navigate to the browse URL
        console.error(`[Link-Convert] Navigating to browse link: ${initialUrl}`);
        await page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const currentUrl = await page.url();
        console.error(`[Link-Convert] Current URL after navigation: ${currentUrl}`);
        
        // Wait for page to render
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract playlist ID from page data or current URL
        console.error(`[Link-Convert] Extracting playlist ID from page...`);
        const playlistId = await page.evaluate(() => {
            // 1. Check if URL already changed to playlist URL
            const url = window.location.href;
            if (url.includes('/playlist?list=')) {
                const urlObj = new URL(url);
                const listParam = urlObj.searchParams.get('list');
                if (listParam) return listParam;
            }
            
            // 2. Try to find playlist link on the page
            const links = Array.from(document.querySelectorAll('a[href*="list="]'));
            if (links.length > 0) {
                const linkUrl = new URL(links[0].href);
                return linkUrl.searchParams.get('list');
            }
            
            // 3. Try to find from page metadata or data attributes
            const pageData = document.querySelector('[data-content]');
            if (pageData && pageData.textContent) {
                const matches = pageData.textContent.match(/list[=_]([A-Z0-9]+)/i);
                if (matches) return matches[1];
            }
            
            // 4. Check window object for playlist info
            if (window.ytInitialData) {
                const jsonStr = JSON.stringify(window.ytInitialData);
                const matches = jsonStr.match(/"list":"([A-Z0-9]+)"/);
                if (matches) return matches[1];
            }
            
            return null;
        });
        
        if (playlistId) {
            const resolvedUrl = `https://music.youtube.com/playlist?list=${playlistId}`;
            console.error(`[Link-Convert] ✅ Extracted playlist ID: ${playlistId}`);
            console.error(`[Link-Convert] ✅ Resolved to: ${resolvedUrl}`);
            return resolvedUrl;
        }
        
        // If extraction failed but URL changed, use the new URL
        if (!currentUrl.includes('/browse/')) {
            console.error(`[Link-Convert] ✅ URL auto-resolved to: ${currentUrl}`);
            return currentUrl;
        }
        
        // Fallback: return the current URL (browse link)
        console.error(`[Link-Convert] ⚠️  Could not resolve browse link, returning original: ${currentUrl}`);
        return currentUrl;
    } catch (e) {
        console.error(`[Link-Convert] ❌ Resolution failed: ${e.message}`);
        console.error(`[Link-Convert] Stack: ${e.stack}`);
        return initialUrl;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeErr) {
                console.warn(`[Link-Convert] Browser close error: ${closeErr.message}`);
            }
        }
    }
}

/**
 * Main function to process the URL and return the structured link results.
 */
async function processMusicLink(url) {
    try {
        console.error(`[processMusicLink] Starting with URL: ${url}`);
        let link_results = [];
        let TRACK = null;
        let directYoutubeUrl = null;
        let processUrl = url; // URL to use for metadata extraction

        // 1. Core Logic Flow
        console.error(`[processMusicLink] Step 1: Getting domain...`);
        const DOMAIN = await getDomainService(url);
        console.error(`[processMusicLink] Domain: ${DOMAIN}`);
        
        console.error(`[processMusicLink] Step 2: Getting media type...`);
        const MEDIA = await getMediaType(url, DOMAIN);
        console.error(`[processMusicLink] Media type: ${MEDIA}`);
        
        // SPECIAL CASE: Detect and convert YouTube Music URLs to direct YouTube URLs
        // BUT still extract metadata from the YouTube Music page
        if (DOMAIN === 'youtube music') {
            const urlObj = new URL(url);
            
            // Case 1: Direct track URL (watch?v=...)
            if (MEDIA === 'track' && urlObj.searchParams.has('v')) {
                const trackId = urlObj.searchParams.get('v');
                directYoutubeUrl = `https://www.youtube.com/watch?v=${trackId}`;
                console.error(`[Link-Convert] YouTube Music track detected: ${directYoutubeUrl}`);
            }
            // Case 2: Playlist/Album URL (playlist?list=...)
            else if ((MEDIA === 'album' || urlObj.pathname.includes('/playlist')) && urlObj.searchParams.has('list')) {
                const listId = urlObj.searchParams.get('list');
                directYoutubeUrl = `https://www.youtube.com/playlist?list=${listId}`;
                processUrl = url; // Use the playlist URL for extraction
                console.error(`[Link-Convert] YouTube Music album/playlist detected: ${directYoutubeUrl}`);
            }
            // Case 3: Browse URL that needs resolution
            else if (urlObj.pathname.includes('/browse/')) {
                console.error(`[Link-Convert] YouTube Music browse URL detected, resolving...`);
                try {
                    const resolvedUrl = await resolveBrowseLink(url);
                    const resolvedObj = new URL(resolvedUrl);
                    if (resolvedObj.searchParams.has('list')) {
                        const listId = resolvedObj.searchParams.get('list');
                        directYoutubeUrl = `https://www.youtube.com/playlist?list=${listId}`;
                        processUrl = resolvedUrl; // Use the RESOLVED URL for metadata extraction
                        console.error(`[Link-Convert] Resolved and converted: ${directYoutubeUrl}`);
                    }
                } catch (resolveErr) {
                    console.warn(`[Link-Convert] Browse resolution failed: ${resolveErr.message}, continuing with original URL`);
                }
            }
            
            // Don't return early - still extract metadata from YouTube Music
            // We'll use directYoutubeUrl at the end instead of the search URL
        }
        
        // getArtist handles the fetching and file writing (use processUrl, not original url)
        console.error(`[processMusicLink] Step 3: Getting artist...`);
        const ARTIST = await getArtist(processUrl, DOMAIN, MEDIA);
        console.error(`[processMusicLink] Artist: ${ARTIST}`);
        
        console.error(`[processMusicLink] Step 4: Getting album...`);
        const ALBUM = await getAlbum(DOMAIN);
        console.error(`[processMusicLink] Album: ${ALBUM}`);
        
        if (MEDIA === 'track') {
            console.error(`[processMusicLink] Step 5: Getting track...`);
            TRACK = await getTrack(DOMAIN);
            console.error(`[processMusicLink] Track: ${TRACK}`);
        }

        // 2. Handle the 'Full Album' logic you requested
        if (TRACK === null && MEDIA === 'album') {
            console.error(`[processMusicLink] No track because media type is album, setting to 'Full Album'`);
            TRACK = "Full Album";
        }

        // Use direct YouTube URL if available, otherwise use search URL
        const channelUrl = directYoutubeUrl || getChannelSearchUrl(ARTIST);
        
        // 3. Build the link_results array - Use RESOLVED URL if available
        console.error(`[processMusicLink] Step 6: Building results array...`);
        link_results.push(
            { Captured_URL: processUrl },  // Use processUrl which contains the resolved URL if applicable
            { Service: DOMAIN },
            { Media: MEDIA },
            { Artist: ARTIST },
            { Album: ALBUM },
            { Track: TRACK },
            { ChannelUrl: channelUrl }
        );

        // 4. Final Logs
        console.error(`\n--- Final Results for ${DOMAIN} ---`);
        console.error(`Artist: ${ARTIST}`);
        console.error(`Album: ${ALBUM}`);
        console.error(`Track: ${TRACK}`);

        console.error(`[processMusicLink] About to return results array`);
        // RETURN the array
        return link_results;
    } catch (err) {
        console.error(`[Link-Convert] Error in processMusicLink: ${err.message}`);
        throw err;
    }
}

// Capture the URL from the command line argument
const args = process.argv.slice(2);
let inputUrl = args[0]; 
let manifestPath = args[1];

async function main() {
    try {
        console.error(`[Link-Convert] main() started`);
        let currentLink = inputUrl;

        // --- NEW LOGIC: DETECT AND RESOLVE BROWSE/REDIRECT LINKS ---
        // Common patterns for browse/redirect links in music services
        if (currentLink.includes('browse') || currentLink.includes('googleusercontent') || currentLink.includes('redirect')) {
            try {
                console.error(`[Link-Convert] Attempting to resolve browse link...`);
                inputUrl = await resolveBrowseLink(currentLink);
                console.error(`[Link-Convert] Browse link resolution completed`);
            } catch (resolveErr) {
                console.error(`[Link-Convert] Browse link resolution failed: ${resolveErr.message}`);
                // Continue with original URL
            }
        }
        
        let results;
        let resolvedUrl = inputUrl;  // Track the resolved URL
        try {
            console.error(`[Link-Convert] About to call processMusicLink with URL: ${inputUrl}`);
            results = await processMusicLink(inputUrl);
            console.error(`[Link-Convert] processMusicLink completed, got ${results.length} results`);
            
            // Extract the resolved URL from results
            if (results.length > 0 && results[0].Captured_URL) {
                resolvedUrl = results[0].Captured_URL;
            }
        } catch (processErr) {
            console.error(`[Link-Convert] Processing failed: ${processErr.message}`);
            console.error(`[Link-Convert] Stack: ${processErr.stack}`);
            throw new Error(`Failed to process music link: ${processErr.message}`);
        }
        
        // SAVE RESOLVED URL AND QUERY TO MANIFEST
        if (manifestPath && fs.existsSync(manifestPath)) {
            try {
                console.error(`[Link-Convert] Saving resolved URL and query to manifest...`);
                const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                
                // Build query object from results
                const query = {};
                if (results.length > 0) {
                    // Map results array to query object
                    for (const item of results) {
                        const [key, value] = Object.entries(item)[0];
                        if (value !== undefined) {
                            // Convert key to camelCase for query
                            const camelKey = key.charAt(0).toLowerCase() + key.slice(1).replace(/_([a-z])/g, (g) => g[1].toUpperCase());
                            query[camelKey] = value;
                        }
                    }
                }
                
                // Save to manifest - use lowercase resolved_url to match main.js expectations
                manifestData.resolved_url = resolvedUrl;
                manifestData.Query = query;
                
                fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
                console.error(`[Link-Convert] ✅ Saved to manifest: resolved_url=${resolvedUrl}`);
            } catch (manifestErr) {
                console.warn(`[Link-Convert] Failed to save to manifest: ${manifestErr.message}`);
                // Don't fail - continue with output
            }
        }
        
        // IMPORTANT: Print the final JSON on a single line at the end 
        // so the Electron main process can parse it easily.
        console.error(`[Link-Convert] About to output JSON results...`);
        const output = JSON.stringify(results || []);
        console.error(`[Link-Convert] JSON length: ${output.length} bytes`);

        try {
            process.stdout.write(output + '\n');
            process.stdout.end();
        } catch (writeErr) {
            console.error(`[Link-Convert] Failed to write JSON to stdout: ${writeErr.message}`);
        }

        console.error(`[Link-Convert] JSON output complete, exiting...`);
        process.exit(0);
    } catch (err) {
        const errorMsg = err.message || String(err);
        
        // Check if it's a Chrome not found error and auto-install
        if ((errorMsg.includes('Could not find Chrome') || errorMsg.includes('Could not find Chromium')) && !process.env.CHROMIUM_INSTALL_ATTEMPTED) {
            console.error(`❌ Chrome/Chromium not found!`);
            console.error(`[Chromium] Auto-installing Chromium...`);
            
            // Mark that we've attempted installation to avoid infinite loop
            process.env.CHROMIUM_INSTALL_ATTEMPTED = 'true';
            
            const installSuccess = await ensureChromiumInstalled();
            if (installSuccess) {
                console.error('[Chromium] Retrying link conversion...');
                // Retry the main function
                await main();
                return;
            } else {
                console.error(`❌ Failed to auto-install Chromium`);
            }
        }
        
        console.error(`[Link-Convert] Fatal error: ${errorMsg}`);
        console.error(errorMsg);
        
        // Output minimal JSON error response to stdout
        const errorResponse = JSON.stringify([
            { Captured_URL: inputUrl },
            { Service: 'unknown' },
            { Media: 'unknown' },
            { Artist: null },
            { Album: null },
            { Track: null },
            { ChannelUrl: null },
            { Error: errorMsg }
        ]);
        console.log(errorResponse);
        process.exit(1);
    }
}

main();

async function getDomainService(url){
    console.error(`Getting service from URL: ${url}`)

    try {
        // 1. Ensure the URL is valid for parsing
        const urlObject = new URL(url);
        
        // 2. Access the pathname property (e.g., '/spotify.com/5')
        const pathname = urlObject.pathname;
        const hostname = urlObject.hostname;
        
        // 3. Special handling for YouTube Music detection
        // Check if it's music.youtube.com OR a regular YouTube URL with OLAK playlist (YouTube Music albums)
        if (hostname.includes('music.youtube')) {
            const match = hostname.match(/(music)\.(youtube)\.com/i);
            if (match && match[1] && match[2]) {
                return match[2].toLowerCase() + " " + match[1].toLowerCase(); 
            }
        }
        
        // Detect regular YouTube URLs that are actually YouTube Music content
        if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
            const listParam = urlObject.searchParams.get('list');
            // OLAK playlists are YouTube Music albums
            if (listParam && listParam.startsWith('OLAK')) {
                console.error(`[Domain Detection] YouTube URL with OLAK playlist detected - treating as YouTube Music`);
                return 'youtube music';
            }
            return 'youtube';
        }
        
        // 4. Search for the pattern in the pathname for other services
        if(hostname.includes('amazon') != true){
            const match = pathname.match(/\/(\w+)\.com\//i);
            if (match && match[1]) {
                return match[1].toLowerCase(); 
            }
        }
        else{
            const match = url.match(/(\w+)\.com/i);
            if (match && match[1]) {
                return match[1].toLowerCase(); 
            }
        }

        
        // If the pattern isn't found, fall back to the main domain
        const hostnameParts = urlObject.hostname.split('.');
        // Returns the part before .com, e.g., 'googleusercontent'
        return hostnameParts.length >= 2 ? hostnameParts[hostnameParts.length - 2] : null;

    } catch (e) {
        console.error("Error parsing URL to get target service:", e.message);
        return null;
    }
}

async function getArtist(url, domain, media) {
    console.error(`Getting artist from ${domain}`);

    if (domain === 'amazon'){
        if(media === 'album'){
            await getAmazonAlbumMeta(url.split('/').pop(), 'https://na.mesk.skill.music.a2z.com/api/showHome', manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
        if(media === 'track'){
            const trackId = getAmazonTrackId(url); 
            await getAmazonTrackMeta(trackId, 'https://na.mesk.skill.music.a2z.com/api/cosmicTrack/displayCatalogTrack', manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
    }
    if (domain === 'spotify'){
        if (media === 'album'){
            await getSpotifyAlbumMeta(url,media,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
        else{
            await getSpotifyTrackMeta(url,media,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
    }
    if (domain === 'apple'){
        if (media === 'album'){
            await getAppleAlbumMeta(url.split('/').pop(),manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
        else{
            await getAppleTrackMeta(url.split('/').pop(), manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
    }
    if (domain === 'youtube music'){  
        if (media === 'track'){
            const trackId = getTrackID(url)
            console.error(`[YouTube Music] Track ID: ${trackId}`);
            try {
                await getYoutubeMusicTrackMeta(trackId, manifestPath);
            } catch (err) {
                console.error(`[YouTube Music] Track metadata fetch error: ${err.message}`);
            }
            const artist = extractArtistFromMetadataFile();
            console.error(`[YouTube Music Track] Extracted artist: ${artist || 'NOT FOUND'}`);
            return artist || "Unknown Artist";
        }
        if (media === 'album' || media === 'unknown'){
            // Treat unknown media as album for YouTube Music
            const albumId = getAlbumID(url);
            console.error(`[YouTube Music] Album ID: ${albumId}`);
            try {
                await getYoutubeMusicAlbumMeta(albumId, manifestPath, url);
            } catch (err) {
                console.error(`[YouTube Music] Album metadata fetch error: ${err.message}`);
            }
            const artist = extractArtistFromMetadataFile();
            console.error(`[YouTube Music Album] Extracted artist: ${artist || 'NOT FOUND'}`);
            return artist || "Various Artists";
        }
    }
    if (domain === 'youtube'){
        // Handle regular YouTube URLs that might be music content
        console.error(`[YouTube] Detected regular YouTube domain, attempting music metadata extraction`);
        if (media === 'track'){
            const trackId = getTrackID(url)
            await getYoutubeMusicTrackMeta(trackId, manifestPath);
            const artist = extractArtistFromMetadataFile();
            console.error(`[YouTube Track] Extracted artist: ${artist || 'NOT FOUND'}`);
            return artist || "Unknown Artist";
        }
        if (media === 'album'){
            const albumId = getAlbumID(url);
            console.error(`[YouTube] Processing album/playlist ID: ${albumId}`);
            try {
                await getYoutubeMusicAlbumMeta(albumId, manifestPath, url);
                const artist = extractArtistFromMetadataFile();
                console.error(`[YouTube Album] Extracted artist: ${artist || 'NOT FOUND'}`);
                return artist || "Various Artists";
            } catch (err) {
                console.error(`[YouTube Album] Error during metadata extraction: ${err.message}`);
                return "Various Artists";
            }
        }
    }
    if (domain === 'tidal'){
        if (media === 'album'){
            const tidalUrl = await cleanTidalUrl(url);
            const tidalId = await getTidalId(tidalUrl);
            await getTidalAlbumMetadata(tidalId,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist || "Unknown Artist";
        }
        if (media === 'track'){
            const tidalUrl = await cleanTidalUrl(url);
            const tidalId = await getTidalId(tidalUrl);
            await getTidalTrackMetadata(tidalId,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist || "Unknown Artist";
        }
    }
    
    // Default fallback if no domain/media combination matched
    console.error(`[getArtist] No handler for domain: ${domain}, media: ${media} - returning default`);
    return "Unknown Artist";

}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAlbum(domain){
    console.error(`Getting album from ${domain}`);

    const album = extractAlbumFromMetadataFile();
    return album || "Unknown Album";
}

async function getTrack(domain){
    console.error(`Getting Track from ${domain}`);

    const track = await extractTrackFromMetadataFile();
    return track;
}

async function getMediaType(url, domain) {
    if (!url || typeof url !== 'string') {
        console.error("Invalid URL provided to getMediaType.");
        return 'unknown';
    }

    try {
        const urlObject = new URL(url);
        const path = urlObject.pathname.toLowerCase();
        const searchParams = urlObject.searchParams;

        // --- 1. Priority Track Check (Amazon & General) ---
        // Amazon specific: Check for trackAsin in query params
        // General: Check for /track/, /song/, or /watch
        if (
            searchParams.has('trackAsin') || 
            path.includes('/track/') || 
            path.includes('/song/') || 
            path.includes('/tracks/') || 
            path.includes('/watch')
        ) {
            console.error(`[Media Type] Identified as Track: ${path}`);
            return 'track';
        }

        // --- 2. Album/Playlist Check (including browse URLs) ---
        // If no track indicators are found, check for album indicators
        // YouTube Music browse URLs are always albums/playlists
        if (path.includes('/browse/') || path.includes('/album/') || path.includes('/playlist') || path.includes('/albums/')) {
            console.error(`[Media Type] Identified as Album: ${path}`);
            return 'album';
        }
        
        // --- 3. Domain Fallbacks ---
        if (domain === 'youtube.com' || domain === 'youtu.be') {
            return 'track';
        }

        return 'unknown';

    } catch (e) {
        console.error(`Error processing URL in getMediaType: ${e.message}`);
        return 'unknown';
    }
}


// Now you can use the 'puppeteer' object to launch a browser
async function runBrowserTask(url) {
    let browser; // Declare outside the try block for proper closing
    
    // Define options BEFORE launch, and only include Puppeteer launch options
    const launchOptions = getPuppeteerLaunchOptions('run-browser-task');
    console.error('[Link-Convert] Launch options for runBrowserTask:', {
        headless: launchOptions.headless,
        executablePath: launchOptions.executablePath || 'auto',
        args: launchOptions.args
    });

    try {
        // 1. Pass the LAUNCH options to puppeteer.launch()
        browser = await puppeteer.launch(launchOptions);
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        
        // FIX 2: Set a reliable viewport size for stable headless performance
        await page.setViewport({ width: 1280, height: 720 });

        // 2. Use await for page.goto() and specify navigation options (waitUntil, timeout)
        const navigationOptions = {
            waitUntil: 'networkidle2', // Wait until network activity is low
            timeout: 60000 // Ensure a long timeout for page loading
        };
        
        // 3. The `page.goto()` method needs the URL first, then the navigation options.
        await page.goto(url, navigationOptions); 
        
        // --- Your main logic goes here ---
        console.error(`Successfully navigated to: ${await page.url()}`);
        
        return page;
    } catch (error) {
        console.error(`[Puppeteer Task Failed]: ${error.message}`);
        // Handle the error (e.g., return null or the original URL)
        return null;
        
    } 
}

function extractArtistFromMetadataFile() {
    console.error(`Attempting to read metadata from: ${manifestPath}`);
    
    // Convert relative path to absolute path if needed, or rely on execution directory.
    // If running from the root, './assets/lib-json' is correct.
    const absolutePath = path.resolve(manifestPath); 

    try {
        // 1. Read the JSON file content synchronously
        const rawData = fs.readFileSync(absolutePath, { encoding: 'utf8' });

        // 2. Parse the JSON string into a JavaScript object
        const metadata = JSON.parse(rawData);

        // 3. Extract the Primary_Artist value (or try other common field names)
        let artist = metadata.Primary_Artist || metadata.artist || metadata.Artist || metadata.ARTIST;

        if (artist) {
            console.error(`Successfully extracted artist: ${artist}`);
            return artist;
        } else {
            console.error("⚠️  No artist found. Available keys:", Object.keys(metadata || {}));
            return null;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`❌ Error: Metadata file not found at ${absolutePath}.`);
        } else {
            console.error(`❌ Error reading or parsing metadata file: ${error.message}`);
        }
        return null;
    }
}
async function extractTrackFromMetadataFile() {
    console.error(`Attempting to read metadata from: ${manifestPath}`);
    
    // Convert relative path to absolute path if needed, or rely on execution directory.
    // If running from the root, './assets/lib-json' is correct.
    const absolutePath = path.resolve(manifestPath); 

    try {
        // 1. Read the JSON file content synchronously
        const rawData = fs.readFileSync(absolutePath, { encoding: 'utf8' });

        // 2. Parse the JSON string into a JavaScript object
        const metadata = JSON.parse(rawData);

        // Try multiple possible paths for track title
        let track = null;
        if (metadata?.Tracks?.title) {
            track = metadata.Tracks.title;
        } else if (metadata?.tracklist?.title) {
            track = metadata.tracklist.title;
        } else if (metadata?.Track_Title) {
            track = metadata.Track_Title;
        }

        if (track) {
            console.error(`Successfully extracted track: ${track}`);
            return track;
        } else {
            console.error("⚠️  No track title found in metadata file. Available keys:", Object.keys(metadata || {}));
            return null;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`❌ Error: Metadata file not found at ${absolutePath}.`);
        } else {
            console.error(`❌ Error reading or parsing metadata file: ${error.message}`);
        }
        return null;
    }
}
function extractAlbumFromMetadataFile() {
    console.error(`Attempting to read metadata from: ${manifestPath}`);
    
    // Convert relative path to absolute path if needed, or rely on execution directory.
    // If running from the root, './assets/lib-json' is correct.
    const absolutePath = path.resolve(manifestPath); 

    try {
        // 1. Read the JSON file content synchronously
        const rawData = fs.readFileSync(absolutePath, { encoding: 'utf8' });

        // 2. Parse the JSON string into a JavaScript object
        const metadata = JSON.parse(rawData);

        // 3. Extract the Primary_album value
        const album = metadata.Album_Title;

        if (album) {
            console.error(`Successfully extracted album: ${album}`);
            return album;
        } else {
            console.error("❌ Error: 'Album_Title' field not found in metadata file.");
            return null;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`❌ Error: Metadata file not found at ${absolutePath}.`);
        } else {
            console.error(`❌ Error reading or parsing metadata file: ${error.message}`);
        }
        return null;
    }
}

function getAlbumID(link) {
    const url = new URL(link);
    return url.searchParams.get('list'); 
}

function getTrackID(link) {
    const url = new URL(link);
    return url.searchParams.get('v');
}
async function getTidalId(link){
    const urlParts = new URL(link).pathname.split('/');
    const tidalId = urlParts.pop() || urlParts.pop();
    return tidalId;
}
async function cleanTidalUrl(url) {
    if (!url) return "";
    
    // This regex looks for "/u" specifically at the end of the string
    return url.replace(/\/u$/, "");
}
function getAmazonTrackId(urlStr) {
    try {
        const urlObj = new URL(urlStr);
        // 1. Check if 'trackAsin' exists in the query params (Album-context URL)
        if (urlObj.searchParams.has('trackAsin')) {
            return urlObj.searchParams.get('trackAsin');
        }
        // 2. Otherwise, take the ID from the end of the path (Direct Track URL)
        // Example: /tracks/B085DN6TJ6 -> B085DN6TJ6
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        return pathParts.pop();
    } catch (e) {
        console.error("Error parsing Amazon URL:", e.message);
        return null;
    }
}

function getChannelSearchUrl(channelName) {
    const encodedQuery = encodeURIComponent(channelName);
    
    // This specific 'sp' value filters results to 'Channels' only
    const channelFilter = "EgIQAg%253D%253D"; 
    
    return `https://www.youtube.com/results?search_query=${encodedQuery}&sp=${channelFilter}`;
}

// Demo/test line - commented out to prevent early execution
// const searchUrl = getChannelSearchUrl("Morgan Wallen");
// console.error(`[Main] Searching for channel: ${searchUrl}`);