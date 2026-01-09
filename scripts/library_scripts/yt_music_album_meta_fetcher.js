import puppeteer from 'puppeteer';
import { downloadChrome } from '@puppeteer/browsers';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import * as cheerio from 'cheerio'; // You may need to run: npm install cheerio
import os from 'os';

const OUTPUT_DIR = 'assets/lib-json';
const HTML_FILE = path.join(OUTPUT_DIR, 'Youtube_Music_music_info.html'); 
const JSON_OUTPUT_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Auto-installs Chromium by letting Puppeteer handle it automatically
 * Sets environment to allow Puppeteer to download on first launch
 */
async function ensureChromiumInstalled() {
    console.log('[Chromium] Downloading Chrome via @puppeteer/browsers...');
    console.log('[Chromium] This may take 2-5 minutes on first install.');
    
    try {
        // Set cache directory to user's home folder (guaranteed writable)
        const cacheDir = os.homedir() + '/.cache/puppeteer';
        process.env.PUPPETEER_CACHE_DIR = cacheDir;
        
        // Explicitly download Chrome - this WAITS for completion
        console.log(`[Chromium] Cache directory: ${cacheDir}`);
        console.log(`[Chromium] ⏳ Starting download... this may take a few minutes...`);
        
        const browserPath = await downloadChrome({ 
            cacheDir: cacheDir,
            buildId: 'latest',
            platform: 'win64'
        });
        
        console.log(`[Chromium] ✅ Chrome successfully downloaded to: ${browserPath}`);
        console.log(`[Chromium] 🔍 Verifying installation...`);
        
        // Verify by launching to ensure it's actually usable
        const testBrowser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        await testBrowser.close();
        console.log(`[Chromium] ✅ Chrome verified and working!`);
        
        return true;
    } catch (err) {
        console.error(`[Chromium] ❌ Failed to download Chrome: ${err.message}`);
        console.error(`[Chromium] Stack: ${err.stack}`);
        return false;
    }
}

/**
 * Captures the full HTML content of the Youtube_Music Music page.
 */
async function captureYoutubeMusicData(targetUrl, retryCount = 0) {
    console.log(`\nSTART: Capturing Youtube_Music Music Page for: ${targetUrl}`);

    let browser = null;
    let pageContent = null;

    try {
        // Launch browser with timeout protection
        browser = await Promise.race([
            puppeteer.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Puppeteer launch timeout (15s)')), 15000)
            )
        ]);

        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Youtube_MusicWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        // Navigate with timeout
        await Promise.race([
            page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Page navigation timeout (65s)')), 65000)
            )
        ]);

        pageContent = await page.content(); 
        console.log(`✅ Captured HTML from YouTube Music`);
    } catch (error) {
        const errorMsg = error.message || error.toString();
        
        // Check if it's a Chrome not found error
        if ((errorMsg.includes('Could not find Chrome') || errorMsg.includes('Could not find Chromium')) && retryCount === 0) {
            console.error(`❌ Chrome/Chromium not found!`);
            console.log(`[Chromium] Auto-installing Chromium...`);
            
            const installSuccess = await ensureChromiumInstalled();
            if (installSuccess) {
                console.log('[Chromium] Retrying YouTube Music capture...');
                // Retry once after installation
                return captureYoutubeMusicData(targetUrl, 1);
            }
        }
        
        console.error(`❌ YouTube Music scraping failed: ${errorMsg}`);
        console.error('❌ This is common on Windows - returning null to skip this item');
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeErr) {
                console.warn(`Browser close warning: ${closeErr.message}`);
            }
        }
    }
    return pageContent;
}

/**
 * Parses the HTML and extracts structured metadata.
 */
function extractYoutubeMusicMetadata(html, targetUrl, manifestPath) {
    console.log('START: Extracting metadata from HTML...');
    const $ = cheerio.load(html);

    // Youtube_Music often stores metadata in a JSON-LD script tag
    const jsonLdData = $('script[type="application/ld+json"]').html();
    let ldJson = {};
    if (jsonLdData) {
        try {
            ldJson = JSON.parse(jsonLdData);
        } catch (e) {
            console.error("Could not parse JSON-LD");
        }
    }

    const header = $('ytmusic-responsive-header-renderer');

    // Artist: Targets all links inside the strapline-text (handles multiple artists)
    const artistLinks = header.find('.strapline-text a');
    let primaryArtist = "";
    let allArtists = [];

    if (artistLinks.length > 0) {
        // Collect all artist names from the links
        artistLinks.each((i, link) => {
            const artistName = $(link).text().trim();
            if (artistName) {
                allArtists.push(artistName);
            }
        });
        
        // Use all artists joined by " & " for multi-artist support
        primaryArtist = allArtists.join(" & ");
        console.log(`📝 Detected ${allArtists.length} artist(s): ${primaryArtist}`);
    }

    // Fallback: Try to extract artist from subtitle if no artist links found
    if (!primaryArtist) {
        const subtitleElement = header.find('yt-formatted-string.subtitle');
        const subtitleText = subtitleElement.text().trim();
        
        // Subtitle format: "Album • Artist • Year • X songs • Y minutes" or "Album • Year"
        const parts = subtitleText.split('•').map(p => p.trim());
        
        // If we have 3+ parts, the second part might be the artist(s)
        if (parts.length >= 2) {
            const possibleArtist = parts[1];
            // Check if it looks like an artist (not a year)
            if (!/^\d{4}$/.test(possibleArtist)) {
                primaryArtist = possibleArtist;
                console.log(`📝 Extracted artist from subtitle: ${primaryArtist}`);
            }
        }
    }

    // Last resort fallback
    if (!primaryArtist) {
        console.warn('⚠️  No artist found in the page - using "Various Artists"');
        primaryArtist = "Various Artists";
    }

    // Album Title: Based on your previous find
    const albumTitle = header.find('h1.style-scope.ytmusic-responsive-header-renderer').text().trim();

    // Total Stats: Contains "10 songs • 43 minutes"
    const secondSubtitle = header.find('.second-subtitle').text().trim();
    const trackCountMatch = secondSubtitle.match(/(\d+)\s+song/i);
    const durationMatch = secondSubtitle.match(/(\d+)\s+minute/i);

    const statedTrackCount = trackCountMatch ? trackCountMatch[1] : 'N/A';
    const totalDuration = durationMatch ? durationMatch[0] : 'N/A';

    // Target the thumbnail renderer that has the 'thumbnail' class, NOT 'strapline-thumbnail'
    const coverArt = $('ytmusic-responsive-header-renderer ytmusic-thumbnail-renderer.thumbnail #img').attr('src');
    
    // Subtitle: This contains "Album • 2017" or "Album • Artist • 2017 • 10 songs • 35 minutes"
    const subtitleElement = header.find('yt-formatted-string.subtitle');
    const subtitleText = subtitleElement.text().trim(); 
    
    // Extraction Logic
    const yearMatch = subtitleText.match(/\b(19|20)\d{2}\b/);
    const releaseYear = yearMatch ? yearMatch[0] : 'N/A';

    const trackList = [];
    $('ytmusic-responsive-list-item-renderer').each((i, el) => {
        const row = $(el);
        
        // Title usually lives in the first formatted string of the first column
        const trackName = row.find('.title-column yt-formatted-string').first().text().trim();
        
        // Duration: Target the fixed-column that has a title attribute containing a colon (:)
        // This is the most robust way to find "3:57" vs other small text columns
        let duration = 'N/A';
        row.find('.fixed-column').each((_, col) => {
            const text = $(col).text().trim();
            if (text.includes(':')) {
                duration = text;
            }
        });
        
        if (trackName) {
            trackList.push({
                number: i + 1,
                title: trackName,
                duration: duration
            });
        }
    });

    const finalMetadata = {
        'Album_ID': new URL(targetUrl).searchParams.get('list'),
        'Album_Title': albumTitle,
        'Primary_Artist': primaryArtist,
        'Track_Count': trackList.length,
        'Total_Duration_Text': totalDuration,
        'Cover_Art_URL': coverArt,
        'Release_Date': releaseYear,
        'Tracks': trackList
    };

        exportToJson(finalMetadata, manifestPath);
        console.log(`\n🎉 Metadata saved to **${manifestPath}**`);
        console.log(finalMetadata);
}

export async function getYoutubeMusicAlbumMeta(adamId, manifestPath) {
    if (!adamId) throw new Error("Missing Adam ID.");

    const targetUrl = `https://music.youtube.com/playlist?list=${adamId}`;
    
    try {
        const htmlContent = await captureYoutubeMusicData(targetUrl);

        if (!htmlContent) {
            console.error('[YouTube Music] Failed to capture page - likely Puppeteer crash');
            throw new Error('YouTube Music metadata extraction failed - Puppeteer could not load page');
        }

        extractYoutubeMusicMetadata(htmlContent, targetUrl, manifestPath);
    } catch (err) {
        console.error(`[YouTube Music] Error in getYoutubeMusicAlbumMeta: ${err.message}`);
        throw err; // Re-throw so caller knows it failed
    }
}

// Helper to fix the encoding specifically
function sanitizeDeep(data) {
    if (typeof data === 'string') {
        return data.replace(/ΓÇÖ/g, "'").replace(/[\u2018\u2019]/g, "'").trim();
    } else if (Array.isArray(data)) {
        return data.map(item => sanitizeDeep(item));
    } else if (typeof data === 'object' && data !== null) {
        const cleanedObj = {};
        for (const [key, value] of Object.entries(data)) {
            cleanedObj[key] = sanitizeDeep(value);
        }
        return cleanedObj;
    }
    return data;
}

function updateManifestFile(filePath, newData) {
    let existingData = {};

    // 1. Read existing data if the file exists
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            existingData = JSON.parse(content);
        } catch (error) {
            console.error(`[Step 2] ⚠️ Manifest exists but is unreadable. Starting fresh.`);
        }
    }

    // 2. Merge data
    // The ...newData comes second so that the newly scraped info 
    // fills in the blanks or updates the existing fields.
    const mergedData = {
        ...existingData,
        ...newData
    };

    // 3. Write back to disk
    fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2));
    return mergedData;
}
/**
 * Helper function to save a JavaScript object to a JSON file.
 */
async function exportToJson(data, filename) {
    // 1. Sanitize the data to handle encoding issues
    const cleanMetadata = sanitizeDeep(data);

    try {
        // 2. Pass the object directly to the merge function
        updateManifestFile(filename, cleanMetadata);
        
        console.log(`✅ Successfully exported metadata to ${filename}`);
    } catch (err) {
        console.error(`❌ Error writing to JSON file ${filename}:`, err.message);
    }
}