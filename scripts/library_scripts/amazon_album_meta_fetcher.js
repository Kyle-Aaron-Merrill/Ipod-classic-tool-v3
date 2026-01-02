import puppeteer from 'puppeteer'; // ES Module syntax for library imports
import path from 'path';
import fs from 'fs';

// --- Configuration & Paths ---
const OUTPUT_DIR = 'assets/lib-json';
const INPUT_FILE = path.join(OUTPUT_DIR, 'music_info.json');
const OUTPUT_METADATA_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

// Ensure the output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// =================================================================
// --- Utility Function: findObjectWithKey ---
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
// --- Main Function: Capture and Save Data (Headless Fixes Applied) ---
// =================================================================
/**
 * Navigates to the Amazon Music URL, captures the API response, and saves the raw data.
 * @param {string} targetUrl - The Amazon Music album URL.
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

        // FIX 1: Set a reliable User-Agent and Viewport to prevent headless detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        console.log(`Navigating to: ${targetUrl}`);
        
        // --- RELIABLE WAIT MECHANISM ---
        
        // 2a. Start navigation with timeout protection
        const navigationPromise = Promise.race([
            page.goto(targetUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Navigation timeout (65s)')), 65000)
            )
        ]);
        
        // 2b. Wait for the specific API response we need
        const responsePromise = page.waitForResponse(response => {
            return response.url() === apiUrl && response.request().method() === 'POST';
        }, { timeout: 30000 }); 
        
        // 2c. Wait for both the page to settle and the API call to complete
        await Promise.all([navigationPromise, responsePromise]);

        // 3. Capture the JSON data from the waited response
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
            //fs.writeFileSync(manifestPath, jsonContent, 'utf-8');
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
// --- Extraction Function: extractDetailedMetadata ---
// =================================================================
/**
 * Extracts structured metadata from the raw API response data.
 * @param {object} jsonObject - The raw data object returned by captureAmazonMusicData.
 */
function extractDetailedMetadata(jsonObject, manifestPath) {
    console.log('\nSTART: Extracting metadata from captured data...');
    
    // --- 2. Locate the Metadata Container ---
    const metadataContainer = findObjectWithKey(jsonObject.full_api_response, "headerTertiaryText");

    if (!metadataContainer) {
        console.error("❌ Error: Could not locate the object containing the descriptive metadata.");
        return;
    }

    // --- 3. Extract and Parse Fields ---
    const tertiaryText = metadataContainer.headerTertiaryText || '';
    const parts = tertiaryText.split('•').map(p => p.trim());
    
    const trackCountMatch = tertiaryText.match(/(\d+)\s+SONG(S)?/i);
    const durationMatch = tertiaryText.match(/(\d+\s+HOUR.*)/i) || tertiaryText.match(/(\d+\s+MINUTE.*)/i);
    const datePart = parts.find(p => p.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d+\s+\d{4}/i)) || 'N/A';
    
    // B. Parse the footer (for copyright fallback)
    const footerText = metadataContainer.footer || '';
    
    // --- 4. Build the Final Structured Metadata Dictionary ---
    
    let primaryArtist = 'N/A (Could not parse)';

    // 1. Prioritize 'headerPrimaryText' for the artist name (Most reliable).
    if (metadataContainer.headerPrimaryText && typeof metadataContainer.headerPrimaryText === 'string') {
        let rawArtist = metadataContainer.headerPrimaryText.trim();

        // FIX: Check for multiple artists (separated by comma) and take only the first one.
        if (rawArtist.includes(',')) {
            // Take the first name (e.g., "Morgan Wallen, Lil Wayne..." -> "Morgan Wallen")
            primaryArtist = rawArtist.split(',')[0].trim();
            console.log(`✅ Artist list detected; extracted primary artist: ${primaryArtist}`);
        } else {
            // Use the full name if it's a single artist
            primaryArtist = rawArtist;
            console.log(`✅ Artist found in headerPrimaryText: ${primaryArtist}`);
        }
    } 
    // You can keep the headerSubtitle fallback if you like, but it may not be necessary 
    // since headerPrimaryText is proving reliable for the list.
    // For completeness, I'll keep a simpler fallback to the copyright footer (label name).
    else {
        // 2. Fallback to the copyright footer extraction (extracting the label name/first entity).
        const artistMatch = footerText.match(/\d{4}\s+([^©]*)/i); 
        if (artistMatch && artistMatch[1]) {
            primaryArtist = artistMatch[1].trim();
            console.log(`⚠️ Artist fallback to copyright footer (label): ${primaryArtist}`);
        }
    }

    const methods = jsonObject.full_api_response.methods || [];
    
    // 1. Locate the correct BindTemplateMethod
    const bindMethod = methods.find(m => m.interface === "TemplateListInterface.v1_0.CreateAndBindTemplateMethod");
    const template = bindMethod?.template;
    
    if (!template) {
        console.error("❌ Could not find BindTemplateMethod in the API response.");
        return;
    }

    // 2. Access the widgets (usually the tracklist is in the first or second widget)
    const widgets = template.widgets || [];
    let trackList = [];

    // 3. Look for the 'items' array inside the widgets
    // Amazon often stores tracks in a widget with an 'items' key
    const trackWidget = widgets.find(w => w.items && Array.isArray(w.items));

    if (trackWidget && trackWidget.items) {
        trackList = trackWidget.items.map((item, index) => ({
            number: item.trackNumber || index + 1,
            title: item.primaryText || item.title || "Unknown Track",
            duration: item.secondaryText3 || "N/A", // 'secondaryText3' often holds the 'MM:SS' time
            asin: item.primaryTextLink?.deeplink?.split('/').pop() || "N/A"
        }));
    }

    console.log(`✅ Extracted ${trackList.length} tracks.`);

    const finalMetadata = {
        'ASIN_ID_From_URL': jsonObject.target_url.split('/').pop(),
        'Source_URL': jsonObject.target_url,
        'Album_Title': metadataContainer.headerImageAltText || 'N/A',
        'Primary_Artist': primaryArtist, // Use the extracted variable
        'Release_Date': datePart,
        'Track_Count': trackCountMatch ? parseInt(trackCountMatch[1]) : 'N/A',
        'Total_Duration_Text': durationMatch ? durationMatch[1].trim() : 'N/A',
        'Cover_Art_URL': metadataContainer.headerImage || 'N/A',
        'Copyright_Statement': footerText || 'N/A',
        'Track_List_Available': trackList.length > 0,
        'Tracks': trackList,
        'ISRC_Available': false,
        'Note_on_Missing_Data': 'The full track list and technical identifiers (ISRC/UPC) are not present in this initial API response and require a subsequent fetch.'
    };

    exportToJson(finalMetadata, manifestPath);
    console.log('\n--- Final Extracted Metadata Summary ---');
    console.log(finalMetadata);
    console.log(`\n🎉 Successfully extracted detailed metadata and saved the structured data to **${manifestPath}**`);
}

// =================================================================
// --- Main Exportable Function ---
// =================================================================
/**
 * Main function to execute the scraping and extraction logic.
 * @param {string} asinId - The Amazon Standard Identification Number (e.g., 'B0FZDDZQJZ').
 * @param {string} apiUrl - The Amazon internal API URL (e.g., 'https://na.mesk.skill.music.a2z.com/api/showHome').
 */
export async function getAmazonAlbumMeta(asinId, apiUrl, manifestPath) {
    // ... existing logic ...

    const targetUrl = `https://music.amazon.com/albums/${asinId}`;
    
    // This captures the raw network response
    const rawData = await captureAmazonMusicData(targetUrl, apiUrl);

    if (rawData) {
        // --- ADD THIS LINE ---
        // This triggers the extraction logic that creates the file
        extractDetailedMetadata(rawData, manifestPath); 
        
        return rawData;
    } else {
        console.error("❌ Failed to capture data from Amazon Music.");
        return null;
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