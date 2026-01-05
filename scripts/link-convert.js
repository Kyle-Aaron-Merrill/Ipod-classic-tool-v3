import puppeteer from "puppeteer";
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
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
    console.log('[Chromium] Allowing Puppeteer to auto-download Chromium...');
    console.log('[Chromium] This may take 2-5 minutes on first install.');
    
    try {
        // Ensure PUPPETEER_SKIP_DOWNLOAD is NOT set (allow auto-download)
        delete process.env.PUPPETEER_SKIP_DOWNLOAD;
        
        // Attempt to launch - Puppeteer will auto-download Chromium if missing
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        console.log('[Chromium] ✅ Puppeteer launched successfully with auto-downloaded Chromium!');
        await browser.close();
        return true;
    } catch (err) {
        console.error(`[Chromium] ❌ Failed to launch Puppeteer: ${err.message}`);
        return false;
    }
}

/**
 * Resolves a browse/redirect link by opening it in Puppeteer and capturing the final URL.
 * @param {string} initialUrl 
 * @returns {Promise<string>} The resolved destination URL
 */
async function resolveBrowseLink(initialUrl) {
    console.log(`[Link-Convert] Resolving browse link: ${initialUrl}`);
    let browser = null;
    
    try {
        browser = await Promise.race([
            puppeteer.launch({ 
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    // This forces the browser to look like a standard desktop Chrome
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
                ]
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Puppeteer launch timeout')), 15000)
            )
        ]);
        
        const page = await browser.newPage();
        
        // 1. Navigate and wait for initial network settlement with timeout
        try {
            await Promise.race([
                page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: 30000 }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Navigation timeout')), 35000)
                )
            ]);
        } catch (navErr) {
            console.warn(`[Link-Convert] Navigation failed: ${navErr.message}, returning original URL`);
            return initialUrl;
        }

        // 2. Wait for either the URL to contain 'list=' OR for the internal data to load
        console.error(`[Link-Convert] Waiting for resolution...`);
        let resolvedPlaylistId = null;
        
        try {
            resolvedPlaylistId = await Promise.race([
                page.waitForFunction(() => {
                    // Check A: Has the URL updated itself?
                    const urlParams = new URLSearchParams(window.location.search);
                    if (urlParams.has('list')) return urlParams.get('list');

                    // Check B: Is the ID available in the canonical link?
                    const canonical = document.querySelector('link[rel="canonical"]')?.href;
                    if (canonical && canonical.includes('list=')) {
                        return new URLSearchParams(new URL(canonical).search).get('list');
                    }

                    // Check C: Is the ID hidden in the page's data object? (Most reliable for SPAs)
                    if (window.ytInitialData) {
                        const findId = (obj) => {
                            for (let key in obj) {
                                if (key === 'playlistId' && typeof obj[key] === 'string') return obj[key];
                                if (obj[key] && typeof obj[key] === 'object') {
                                    const found = findId(obj[key]);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        return findId(window.ytInitialData);
                    }
                    return false;
                }, { polling: 'mutation', timeout: 15000 }).then(handle => handle.jsonValue()),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Wait for resolution timeout')), 20000)
                )
            ]);
        } catch (waitErr) {
            console.warn(`[Link-Convert] Could not resolve browse link: ${waitErr.message}, returning original`);
            return initialUrl;
        }

        if (resolvedPlaylistId) {
            const finalUrl = `https://music.youtube.com/playlist?list=${resolvedPlaylistId}`;
            console.error(`[Link-Convert] ✅ Resolved to: ${finalUrl}`);
            return finalUrl;
        }

        return initialUrl; // Return original if all detection methods fail
    } catch (e) {
        console.error(`[Link-Convert] ❌ Resolution failed: ${e.message}`);
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
        let link_results = [];
        let TRACK = null;
        let directYoutubeUrl = null;
        let processUrl = url; // URL to use for metadata extraction

        // 1. Core Logic Flow
        const DOMAIN = await getDomainService(url);
        const MEDIA = await getMediaType(url, DOMAIN);
        
        // SPECIAL CASE: Detect and convert YouTube Music URLs to direct YouTube URLs
        // BUT still extract metadata from the YouTube Music page
        if (DOMAIN === 'youtube music') {
            const urlObj = new URL(url);
            
            // Case 1: Direct track URL (watch?v=...)
            if (MEDIA === 'track' && urlObj.searchParams.has('v')) {
                const trackId = urlObj.searchParams.get('v');
                directYoutubeUrl = `https://www.youtube.com/watch?v=${trackId}`;
                console.log(`[Link-Convert] YouTube Music track detected: ${directYoutubeUrl}`);
            }
            // Case 2: Playlist/Album URL (playlist?list=...)
            else if ((MEDIA === 'album' || urlObj.pathname.includes('/playlist')) && urlObj.searchParams.has('list')) {
                const listId = urlObj.searchParams.get('list');
                directYoutubeUrl = `https://www.youtube.com/playlist?list=${listId}`;
                processUrl = url; // Use the playlist URL for extraction
                console.log(`[Link-Convert] YouTube Music album/playlist detected: ${directYoutubeUrl}`);
            }
            // Case 3: Browse URL that needs resolution
            else if (urlObj.pathname.includes('/browse/')) {
                console.log(`[Link-Convert] YouTube Music browse URL detected, resolving...`);
                try {
                    const resolvedUrl = await resolveBrowseLink(url);
                    const resolvedObj = new URL(resolvedUrl);
                    if (resolvedObj.searchParams.has('list')) {
                        const listId = resolvedObj.searchParams.get('list');
                        directYoutubeUrl = `https://www.youtube.com/playlist?list=${listId}`;
                        processUrl = resolvedUrl; // Use the RESOLVED URL for metadata extraction
                        console.log(`[Link-Convert] Resolved and converted: ${directYoutubeUrl}`);
                    }
                } catch (resolveErr) {
                    console.warn(`[Link-Convert] Browse resolution failed: ${resolveErr.message}, continuing with original URL`);
                }
            }
            
            // Don't return early - still extract metadata from YouTube Music
            // We'll use directYoutubeUrl at the end instead of the search URL
        }
        
        // getArtist handles the fetching and file writing (use processUrl, not original url)
        const ARTIST = await getArtist(processUrl, DOMAIN, MEDIA);
        const ALBUM = await getAlbum(DOMAIN);
        
        if (MEDIA === 'track') {
            TRACK = await getTrack(DOMAIN);
        }

        // 2. Handle the 'Full Album' logic you requested
        if (TRACK === null && MEDIA === 'album') {
            console.log("No track because media type is album");
            TRACK = "Full Album";
        }

        // Use direct YouTube URL if available, otherwise use search URL
        const channelUrl = directYoutubeUrl || getChannelSearchUrl(ARTIST);
        
        // 3. Build the link_results array
        link_results.push(
            { Captured_URL: inputUrl },
            { Service: DOMAIN },
            { Media: MEDIA },
            { Artist: ARTIST },
            { Album: ALBUM },
            { Track: TRACK },
            { ChannelUrl: channelUrl }
        );

        // 4. Final Logs
        console.log(`\n--- Final Results for ${DOMAIN} ---`);
        console.log(`Artist: ${ARTIST}`);
        console.log(`Album: ${ALBUM}`);
        console.log(`Track: ${TRACK}`);

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
        let currentLink = inputUrl;

        // --- NEW LOGIC: DETECT AND RESOLVE BROWSE/REDIRECT LINKS ---
        // Common patterns for browse/redirect links in music services
        if (currentLink.includes('browse') || currentLink.includes('googleusercontent') || currentLink.includes('redirect')) {
            try {
                inputUrl = await resolveBrowseLink(currentLink);
            } catch (resolveErr) {
                console.error(`[Link-Convert] Browse link resolution failed: ${resolveErr.message}`);
                // Continue with original URL
            }
        }
        
        let results;
        try {
            results = await processMusicLink(inputUrl);
        } catch (processErr) {
            console.error(`[Link-Convert] Processing failed: ${processErr.message}`);
            throw new Error(`Failed to process music link: ${processErr.message}`);
        }
        
        // IMPORTANT: Print the final JSON on a single line at the end 
        // so the Electron main process can parse it easily.
        const output = JSON.stringify(results);
        
        // Support both CLI and IPC communication
        if (process.send) {
            process.send({ type: 'output', data: output });
        } else {
            console.log(output);
        }
        process.exit(0);
    } catch (err) {
        const errorMsg = err.message || String(err);
        
        // Check if it's a Chrome not found error and auto-install
        if ((errorMsg.includes('Could not find Chrome') || errorMsg.includes('Could not find Chromium')) && !process.env.CHROMIUM_INSTALL_ATTEMPTED) {
            console.error(`❌ Chrome/Chromium not found!`);
            console.log(`[Chromium] Auto-installing Chromium...`);
            
            // Mark that we've attempted installation to avoid infinite loop
            process.env.CHROMIUM_INSTALL_ATTEMPTED = 'true';
            
            const installSuccess = await ensureChromiumInstalled();
            if (installSuccess) {
                console.log('[Chromium] Retrying link conversion...');
                // Retry the main function
                await main();
                return;
            } else {
                console.error(`❌ Failed to auto-install Chromium`);
            }
        }
        
        console.error(`[Link-Convert] Fatal error: ${errorMsg}`);
        if (process.send) {
            process.send({ type: 'error', data: errorMsg });
        } else {
            console.error(errorMsg);
        }
        process.exit(1);
    }
}

main();

async function getDomainService(url){
    console.log(`Getting service from URL: ${url}`)

    try {
        // 1. Ensure the URL is valid for parsing
        const urlObject = new URL(url);
        
        // 2. Access the pathname property (e.g., '/spotify.com/5')
        const pathname = urlObject.pathname;
        const hostname = urlObject.hostname;
        // 3. Search for the pattern in the pathname
        // This regex looks for: a slash, followed by the service name, followed by '.com'
        
        if(hostname.includes('amazon') != true && hostname.includes('music.youtube') != true){
            const match = pathname.match(/\/(\w+)\.com\//i);
            if (match && match[1]) {
                // match[1] is the content captured by the first group '(\w+)'
                return match[1].toLowerCase(); 
            }
        }
        else if (hostname.includes('music.youtube')) {
            // Regex to capture 'music' and 'youtube' separately
            const match = hostname.match(/(music)\.(youtube)\.com/i);
            
            if (match && match[1] && match[2]) {
                // match[2] is 'youtube', match[1] is 'music'
                return match[2].toLowerCase() + " " + match[1].toLowerCase(); 
            }
        }
        else{
            const match = url.match(/(\w+)\.com/i);
            if (match && match[1]) {
                // match[1] is the content captured by the first group '(\w+)'
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
    console.log(`Getting artist from ${domain}`);

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
            await getYoutubeMusicTrackMeta(trackId, manifestPath);
            const artist = extractArtistFromMetadataFile();
            console.log(`[YouTube Music Track] Extracted artist: ${artist || 'NOT FOUND'}`);
            return artist;
        }
        if (media === 'album'){
            const albumId = getAlbumID(url);
            console.log(`[YouTube Music] Processing album ID: ${albumId}`);
            try {
                await getYoutubeMusicAlbumMeta(albumId, manifestPath);
                const artist = extractArtistFromMetadataFile();
                console.log(`[YouTube Music Album] Extracted artist: ${artist || 'NOT FOUND'}`);
                return artist || "Various Artists"; // Provide fallback if extraction fails
            } catch (err) {
                console.error(`[YouTube Music Album] Error during metadata extraction: ${err.message}`);
                return "Various Artists"; // Return fallback on error
            }
        }
    }
    if (domain === 'tidal'){
        if (media === 'album'){
            const tidalUrl = await cleanTidalUrl(url);
            const tidalId = await getTidalId(tidalUrl);
            await getTidalAlbumMetadata(tidalId,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
        if (media === 'track'){
            const tidalUrl = await cleanTidalUrl(url);
            const tidalId = await getTidalId(tidalUrl);
            await getTidalTrackMetadata(tidalId,manifestPath);
            const artist = extractArtistFromMetadataFile();
            return artist;
        }
    }

}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAlbum(domain){
    console.log(`Getting album from ${domain}`);

    const album = extractAlbumFromMetadataFile();
    return album;
}

async function getTrack(domain){
    console.log(`Getting Track from ${domain}`);

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
            console.log(`[Media Type] Identified as Track: ${path}`);
            return 'track';
        }

        // --- 2. Album Check ---
        // If no track indicators are found, check for album indicators
        if (path.includes('/album/') || path.includes('/playlist') || path.includes('/albums/')) {
            console.log(`[Media Type] Identified as Album: ${path}`);
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
    const launchOptions = {
        // FIX 1: Set headless to true to run invisibly in the background.
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--enable-webgl', 
            '--user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"'
        ]
    };

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
        console.log(`Successfully navigated to: ${await page.url()}`);
        
        return page;
    } catch (error) {
        console.error(`[Puppeteer Task Failed]: ${error.message}`);
        // Handle the error (e.g., return null or the original URL)
        return null;
        
    } 
}

function extractArtistFromMetadataFile() {
    console.log(`Attempting to read metadata from: ${manifestPath}`);
    
    // Convert relative path to absolute path if needed, or rely on execution directory.
    // If running from the root, './assets/lib-json' is correct.
    const absolutePath = path.resolve(manifestPath); 

    try {
        // 1. Read the JSON file content synchronously
        const rawData = fs.readFileSync(absolutePath, { encoding: 'utf8' });

        // 2. Parse the JSON string into a JavaScript object
        const metadata = JSON.parse(rawData);

        // 3. Extract the Primary_Artist value
        const artist = metadata.Primary_Artist;

        if (artist) {
            console.log(`Successfully extracted artist: ${artist}`);
            return artist;
        } else {
            console.error("❌ Error: 'Primary_Artist' field not found in metadata file.");
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
    console.log(`Attempting to read metadata from: ${manifestPath}`);
    
    // Convert relative path to absolute path if needed, or rely on execution directory.
    // If running from the root, './assets/lib-json' is correct.
    const absolutePath = path.resolve(manifestPath); 

    try {
        // 1. Read the JSON file content synchronously
        const rawData = fs.readFileSync(absolutePath, { encoding: 'utf8' });

        // 2. Parse the JSON string into a JavaScript object
        const metadata = JSON.parse(rawData);

        const track = metadata.Tracks.title || metadata.tracklist.title || null

        if (track) {
            console.log(`Successfully extracted track: ${track}`);
            return track;
        } else {
            console.error("❌ Error: 'Track_Title' field not found in metadata file.");
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
    console.log(`Attempting to read metadata from: ${manifestPath}`);
    
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
            console.log(`Successfully extracted album: ${album}`);
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

const searchUrl = getChannelSearchUrl("Morgan Wallen");
console.log(`[Main] Searching for channel: ${searchUrl}`);