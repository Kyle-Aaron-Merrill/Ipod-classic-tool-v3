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
    let browser;
    let metadata = {}; // This is your 'info dict'
    
    try {
        console.debug('[extractSpotifyQuery] Launching Puppeteer for URL:', url);
        
        browser = await puppeteer.launch({ 
            headless: true, // Keeping headless = false for easier debugging
            slowMo: 10 
        });
        
        const page = await browser.newPage();
        
        // Navigate to the URL and wait for the network to settle
        await page.goto(url, { waitUntil: 'networkidle2' });

        // --- CORE EXTRACTION LOGIC ---
        // We use page.evaluate() to run code inside the browser context
        metadata = await page.evaluate(() => {
            
            // Selector for the main title (e.g., 'WHAT HAPPENED TO THE STREETS?')
            const titleElement = document.querySelector('h1.encore-text-headline-large');
            
            // Selector for the main artist link
            const artistElement = document.querySelector('a[data-testid="creator-link"]');

            const albumElement = document.querySelector('span.e-91000-text.encore-text-body-small.encore-internal-color-text-subdued > a');
            
            const thumbnailElement = document.querySelector('div[data-testid="cover-art"] img, .main-view-container__scroll-node img[src*="i.scdn.co"]');
            // Selector for release year/date, which is often found below the title/artist
            const releaseYearElement = document.querySelector('span[data-testid="release-date"]'); 

            const songDurationElement = document.querySelector('[data-testid="release-date"] + span + span');
            

            const copyrightElement = document.querySelector('#main-view p[data-encore-id="type"]:last-of-type');

            return {
                Source_URL: window.location.href,
                Primary_Artist: artistElement ? artistElement.textContent.trim() : 'Artist Not Found',
                Album_Title: albumElement ? albumElement.textContent.trim() : 'Album Not Found',
                Release_Date: releaseYearElement ? releaseYearElement.textContent.trim() : 'Year Not Found',
                Copyright_Statement: copyrightElement ? copyrightElement.textContent.replace(/[•·]/g, '').trim() : 'No Copyright Info',
                Cover_Art_URL: thumbnailElement && thumbnailElement.srcset ? thumbnailElement.srcset.split(',').pop().trim().split(' ')[0] : (thumbnailElement ? thumbnailElement.src : 'No Image Found'),
                extractionDate: new Date().toISOString(),
                Tracks: [
                    {
                        "number": null, // Scraped from the Spotify object
                        "title": titleElement ? titleElement.textContent.trim() : 'Title Not Found',
                        "duration": songDurationElement ? songDurationElement.textContent : 'Duration Not Found',
                    }
                ]
            };
        });
        // --- END EXTRACTION LOGIC ---
        
        // Export the structured data to the JSON file
        await exportToJson(metadata, manifestPath);
        
    } catch (err) {
        console.error('[Spotify Extract Error]', err.stack || err);
        // The process exited with code 1, so we should return an empty object or throw
        return {};
    } finally {
        if (browser) {
            await browser.close();
            console.debug('[extractSpotifyQuery] Puppeteer browser closed');
        }
    }
}

export async function getSpotifyTrackMeta(url, media, manifestPath) {
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