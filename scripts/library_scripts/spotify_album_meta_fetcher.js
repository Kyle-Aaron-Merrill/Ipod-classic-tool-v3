import puppeteer from 'puppeteer'; 
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = 'assets/lib-json';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

/**
 * Helper function to save a JavaScript object to a JSON file.
 */
async function exportToJson(data, filename) {
    const cleanMetadata = sanitizeDeep(data);

    try {
        // FIX: Pass the object directly. 
        // Do not use (JSON.stringify..., 'utf8') inside the function call.
        updateManifestFile(filename, cleanMetadata);
        
        console.log(`✅ Successfully exported metadata to ${filename}`);
    } catch (err) {
        console.error(`❌ Error writing to JSON file ${filename}:`, err.stack || err);
    }
}

async function fetch_meta(url, media, manifestPath) {
    let browser = null;
    let metadata = {}; // This is your 'info dict'
    
    try {
        console.debug('[extractSpotifyQuery] Launching Puppeteer for URL:', url);
        
        // Launch browser with timeout protection
        browser = await Promise.race([
            puppeteer.launch({ 
                headless: true,
                slowMo: 10 
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Puppeteer launch timeout (15s)')), 15000)
            )
        ]);
        
        const page = await browser.newPage();
        
        // Navigate with timeout
        await Promise.race([
            page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Page navigation timeout (65s)')), 65000)
            )
        ]);

        // --- CORE EXTRACTION LOGIC ---
        // We use page.evaluate() to run code inside the browser context
        metadata = await page.evaluate(() => {
            
            // Selector for the main title (e.g., 'WHAT HAPPENED TO THE STREETS?')
            const titleElement = document.querySelector('h1.encore-text-headline-large');
            
            // Selector for the main artist link
            const artistElement = document.querySelector('a[data-testid="creator-link"]');

            // Selector for release year/date, which is often found below the title/artist
            const releaseYearElement = document.querySelector('span[data-testid="release-date"]'); 

            // Selector for all track rows
            const trackRows = document.querySelectorAll('div[data-testid="tracklist-row"]');

            const albumDurationElement = document.querySelector('span[data-encore-id="text"].encore-text-body-small.encore-internal-color-text-subdued span');

            const copyrightElement = document.querySelector('#main-view p[data-encore-id="type"]:last-of-type');

            const thumbnailElement = document.querySelector('button[aria-label="View album artwork"] img');

            const tracklist = [];

            trackRows.forEach((row, index) => {
                // Selectors within a track row (these often have similar class names)
                const trackTitleElement = row.querySelector('div[data-encore-id="text"].encore-text-body-medium');
                const durationElement = row.querySelector('div[data-encore-id="text"].encore-text-body-small.encore-internal-color-text-subdued');
                const trackLinkElement = row.querySelector('a[data-testid="internal-track-link"]');

                tracklist.push({
                    number: index + 1,
                    title: trackTitleElement ? trackTitleElement.textContent.trim() : 'Unknown Title',
                    // The artist for each track can be complex to find if different from album artist,
                    // but for simplicity, we'll focus on title and duration for now.
                    duration: durationElement ? durationElement.textContent : 'Unknown Duration',
                    url: trackLinkElement ? trackLinkElement.href : 'Unknown href'
                    
                });
            });

            return {
                Source_URL: window.location.href,
                Album_Title: titleElement ? titleElement.textContent.trim() : 'Title Not Found',
                Primary_Artist: artistElement ? artistElement.textContent.trim() : 'Artist Not Found',
                Release_Date: releaseYearElement ? releaseYearElement.textContent.trim() : 'Year Not Found',
                Track_Count: tracklist.length,
                Total_Duration_Text: albumDurationElement ? albumDurationElement.textContent.trim() : 'Duration Not Found',
                Copyright_Statement: copyrightElement ? copyrightElement.textContent.replace(/[•·]/g, '').trim() : 'No Copyright Info',
                Cover_Art_URL: thumbnailElement && thumbnailElement.srcset ? thumbnailElement.srcset.split(',').pop().trim().split(' ')[0] : (thumbnailElement ? thumbnailElement.src : 'No Image Found'),
                Tracks: tracklist,
                extractionDate: new Date().toISOString()
            };
        });
        // --- END EXTRACTION LOGIC ---
        
        // Export the structured data to the JSON file
        await exportToJson(metadata, manifestPath);
        
    } catch (err) {
        console.error(`❌ Spotify album scraping failed: ${err.message}`);
        console.error('❌ This is common on Windows with Puppeteer - returning empty object');
        return {};
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.debug('[extractSpotifyQuery] Puppeteer browser closed');
            } catch (closeErr) {
                console.warn(`Browser close warning: ${closeErr.message}`);
            }
        }
    }
}

export async function getSpotifyAlbumMeta(url, media, manifestPath) {
    if (!url || !media) {
        throw new Error("Missing arguments: Both URL and MEDIA must be provided to getSpotifyAlbumMeta.");
    }
    
    // The function now returns the metadata object
    return await fetch_meta(url, media, manifestPath); 
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