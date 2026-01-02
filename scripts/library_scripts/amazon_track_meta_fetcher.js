import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

// --- Configuration & Paths ---
const OUTPUT_DIR = 'assets/lib-json';
// RENAME 1: Updated file names for track data
const INPUT_FILE = path.join(OUTPUT_DIR, 'music_info.json');
const OUTPUT_METADATA_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// =================================================================
// --- Utility Function: findObjectWithKey (UNMODIFIED) ---
// =================================================================
/**
 * Recursively searches an object for an object containing a specific key.
 * @param {object} obj - The object to search.
 * @param {string} targetKey - The key to look for.
 * @returns {object | null} The object containing the key, or null if not found.
 */
function findObjectWithKey(obj, targetKey) {
    if (typeof obj !== 'object' || obj === null) {
        return null;
    }
    if (obj.hasOwnProperty(targetKey)) {
        return obj;
    }
    for (const key in obj) {
        const found = findObjectWithKey(obj[key], targetKey);
        if (found) {
            return found;
        }
    }
    return null;
}

// =================================================================
// --- Main Function: Capture and Save Data (HEADLESS FIXES APPLIED) ---
// =================================================================
/**
 * Navigates to the Amazon Music URL, captures the API response, and saves the raw data.
 * @param {string} targetUrl - The Amazon Music track URL.
 * @param {string} apiUrl - The internal Amazon API URL to intercept.
 * @returns {Promise<object | null>} The raw data object, or null on failure.
 */
async function captureAmazonMusicData(targetUrl, apiUrl, manifestPath) {
    console.log(`\nSTART: Capturing Amazon Music API data for: ${targetUrl}`);

    let browser = null;
    let apiResponseData = null;

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

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        console.log(`Navigating to: ${targetUrl}`);
        
        // Navigation with timeout protection
        const navigationPromise = Promise.race([
            page.goto(targetUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Navigation timeout (65s)')), 65000)
            )
        ]);
        
        const responsePromise = page.waitForResponse(response => {
            return response.url() === apiUrl && response.request().method() === 'POST';
        }, { timeout: 30000 });
        
        await Promise.all([navigationPromise, responsePromise]);

        const apiResponse = await responsePromise;
        apiResponseData = await apiResponse.json();
        
        console.log(`✅ Captured response from: ${apiUrl}`);

    } catch (error) {
        console.error(`❌ Amazon Music scraping failed: ${error.message}`);
        console.error('❌ This is common on Windows - returning null to skip this item');
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('Browser closed.');
            } catch (closeErr) {
                console.warn(`Browser close warning: ${closeErr.message}`);
            }
        }
    }
    
    // --- Build & Save Info Dictionary (Raw Data) ---
    if (apiResponseData) {
        const infoDictionary = {
            'status': 'Success',
            'api_url': apiUrl,
            'target_url': targetUrl,
            'timestamp': new Date().toISOString(),
            'full_api_response': apiResponseData
        };
        try {
            const jsonContent = JSON.stringify(infoDictionary, null, 2);
            //fs.writeFileSync(manifestPath, jsonContent);
            console.log(`\n🎉 Successfully saved raw data to **${manifestPath}**`);
            return infoDictionary;
        } catch (error) {
            console.error(`\n❌ Error writing raw data file ${manifestPath}:`, error.message);
            return null;
        }
    } else {
        console.error('\n❌ Failed to capture API response. Extraction step skipped.');
        return null;
    }
}

// =================================================================
// --- Extraction Function: extractDetailedMetadata (FINAL TRACK LOGIC) ---
// =================================================================
/**
 * Recursively searches an object for a value containing the target copyright statement.
 * @param {object} obj - The object to search.
 * @returns {string | null} The copyright string if found, or null.
 */
function findExactCopyright(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return null;
    }
    
    for (const key in obj) {
        const value = obj[key];
        
        // 1. Check if the value is a string and contains the copyright symbols
        if (typeof value === 'string' && (value.includes('©') || value.includes('℗'))) {
            // Check for a specific known keyword (like the label) for high confidence
            if (value.includes('Big Loud Records')) {
                return value.trim();
            }
            // Fallback: If it's a generic copyright, return it
            if (value.length > 10 && value.match(/(℗|©)\s*\d{4}/)) {
                return value.trim();
            }
        }
        
        // 2. Recurse into nested objects/arrays
        const found = findExactCopyright(value);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * Extracts structured metadata from the raw track API response data.
 * @param {object} jsonObject - The raw data object returned by captureAmazonMusicData.
 */
function extractDetailedMetadata(jsonObject, manifestPath) {
    console.log('\nSTART: Extracting metadata from captured track data...');
    
    // 1. Locate the Primary Template Container
    const mainTemplate = jsonObject.full_api_response.methods[0].template;

    if (!mainTemplate) {
        console.error("❌ Error: Could not locate the main template container at methods[0].template.");
        return;
    }

    // --- 2. Extract and Parse Schema.org Metadata (Primary source for technical data) ---
    let schemaMetadata = {};
    try {
        const seoScript = mainTemplate.templateData.seoHead.script.find(s => s.innerHTML.includes('MusicRecording'));
        if (seoScript) {
            schemaMetadata = JSON.parse(seoScript.innerHTML);
            console.log("✅ Successfully parsed Schema.org metadata.");
        } else {
            console.warn("⚠️ Could not find Schema.org script containing MusicRecording metadata.");
        }
    } catch (error) {
        console.error("❌ Error parsing nested Schema.org JSON:", error.message);
    }
    
    // --- 3. Extract Fields ---
    
    // General Metadata (from Schema.org or Header)
    const trackTitle = schemaMetadata.name || (mainTemplate.headerText && mainTemplate.headerText.text) || 'N/A';
    const rawDuration = schemaMetadata.duration || 'N/A'; // e.g., "PT3M5S"
    const isrc = schemaMetadata.isrcCode || 'N/A';
    const albumTitle = (schemaMetadata.inAlbum && schemaMetadata.inAlbum.name) || 'N/A';

    // Primary Artist
    let primaryArtist = 'N/A (Could not parse)';
    if (schemaMetadata.byArtist && schemaMetadata.byArtist.name) {
        let rawArtist = schemaMetadata.byArtist.name.trim();
        // Extract only the primary artist 
        primaryArtist = rawArtist.split('&')[0].trim();
        primaryArtist = primaryArtist.split(',')[0].trim();
        console.log(`✅ Primary Artist extracted from Schema.org: ${primaryArtist}`);
    } 

    // --- 4. Extract Copyright and Thumbnail (Requires full API search) ---

    // A. Copyright Statement: Use the dedicated search function
    let copyrightStatement = findExactCopyright(jsonObject.full_api_response) || 'N/A';
    console.log(`✅ Copyright Statement extracted: ${copyrightStatement}`);

    // B. Cover Art URL: Search the full response for the image widget
    let coverArtUrl = 'N/A';
    
    // Prioritize the image link from the Schema.org data if available (even though it failed last time, it's the intended spot)
    if (schemaMetadata.image && typeof schemaMetadata.image === 'string') {
        coverArtUrl = schemaMetadata.image;
    } else {
        // Fallback 1: Search for the most common image keys globally
        const imageContainer = findObjectWithKey(jsonObject.full_api_response, 'headerImage');
        if (imageContainer && imageContainer.headerImage) {
            coverArtUrl = imageContainer.headerImage;
        } else {
            // Fallback 2: Search for albumArtUrl
            const albumArtContainer = findObjectWithKey(jsonObject.full_api_response, 'albumArtUrl');
            if (albumArtContainer && albumArtContainer.albumArtUrl) {
                coverArtUrl = albumArtContainer.albumArtUrl;
            }
        }
    }
    console.log(`✅ Cover Art URL extracted: ${coverArtUrl}`);
    
    // --- 5. Build the Final Structured Metadata Dictionary ---
    const finalMetadata = {
        'ASIN_ID_From_URL': jsonObject.target_url.split('/').pop().split('?')[0],
        'Source_URL': jsonObject.target_url,
        'Primary_Artist': primaryArtist,
        'Album_Title': albumTitle,
        'Cover_Art_URL': coverArtUrl, 
        'Copyright_Statement': copyrightStatement, 
        'ISRC': isrc,
        'Note_on_Missing_Data': 'Duration is in ISO 8601 format (e.g., PT3M5S).',
        "Tracks": [
        {
            "number": null, 
            "title": trackTitle,
            "duration": rawDuration
        }
    ]
    };

    // --- STEP 1: SANITIZE BEFORE SAVING ---
    // This replaces the "ΓÇÖ" with a standard "'"
    exportToJson(finalMetadata,manifestPath);
    console.log('\n--- Final Extracted Metadata Summary ---');
    console.log(finalMetadata);
    console.log(`\n🎉 Successfully extracted detailed metadata and saved the structured data to **${manifestPath}**`);
}

// =================================================================
// --- Main Exportable Function (TRACK REWRITE) ---
// =================================================================
/**
 * Main function to execute the scraping and extraction logic for a single track.
 * @param {string} asinId - The Amazon Standard Identification Number (e.g., 'B01H4F8G5K').
 * @param {string} apiUrl - The Amazon internal API URL (e.g., 'https://na.mesk.skill.music.a2z.com/api/showHome').
 */
export async function getAmazonTrackMeta(asinId, apiUrl, manifestPath) {
    if (!asinId || !apiUrl) {
        throw new Error("Missing arguments: Both ASIN ID and API URL must be provided to getAmazonTrackMeta.");
    }

    // RENAME 3: Updated URL path from /albums/ to /tracks/
    const targetUrl = `https://music.amazon.com/tracks/${asinId}`;
    
    const rawData = await captureAmazonMusicData(targetUrl, apiUrl);

    if (rawData) {
        extractDetailedMetadata(rawData, manifestPath);
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
async function exportToJson(data, filename) {
    const cleanMetadata = sanitizeDeep(data); // Ensures curly quotes are fixed
    try {
        // FIX: Pass the object directly, NOT stringified with 'utf8'
        updateManifestFile(filename, cleanMetadata);
        console.log(`✅ Successfully exported metadata to ${filename}`);
    } catch (err) {
        console.error(`❌ Error writing to JSON file ${filename}:`, err.message);
    }
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