import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio'; // You may need to run: npm install cheerio

const OUTPUT_DIR = 'assets/lib-json';
const HTML_FILE = path.join(OUTPUT_DIR, 'apple_music_info.html'); 
const JSON_OUTPUT_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Captures the full HTML content of the Apple Music page.
 */
async function captureAppleMusicData(targetUrl) {
    console.log(`\nSTART: Capturing Apple Music Page for: ${targetUrl}`);

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

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        // Navigate with timeout
        await Promise.race([
            page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Page navigation timeout (65s)')), 65000)
            )
        ]);

        pageContent = await page.content();
        console.log(`✅ Captured HTML from Apple Music`);
    } catch (error) {
        console.error(`❌ Apple Music scraping failed: ${error.message}`);
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
function extractAppleMetadata(html, targetUrl, manifestPath) {
    console.log('START: Extracting metadata from HTML...');
    const $ = cheerio.load(html);

    // Parse JSON-LD for reliable base metadata
    const jsonLdData = $('script[type="application/ld+json"]').html();
    let ldJson = {};
    if (jsonLdData) {
        try {
            ldJson = JSON.parse(jsonLdData);
        } catch (e) {
            console.error("Could not parse JSON-LD");
        }
    }

    // 1. Core Metadata Extraction
    const songTitle = $('h1.album-header-metadata__title').text().trim() || ldJson.name || 'N/A';
    const albumTitle = $('a[data-testid="click-action"][href*="/album/"]').first().text().trim() || 'N/A';
    const primaryArtist = $('a[data-testid="click-action"][href*="/artist/"]').first().text().trim() || ldJson.byArtist?.name || 'N/A';
    const releaseDate = $('div.album-header-metadata__release-date').text().trim() || ldJson.datePublished || 'N/A';

    // 2. Track-Specific Extraction (Prevents the Circular Reference Crash)
    // We target the specific row to get the real track number and duration
    const trackRow = $('.songs-list-row').first(); 
    
    // Convert Cheerio results to primitives (strings/numbers) BEFORE sanitizing
    const actualTrackNumber = parseInt(trackRow.find('.songs-list-row__rank').text().trim()) || 1;
    const trackDuration = trackRow.find('.songs-list-row__length').text().trim() || 'N/A';
    const trackCount = $('.songs-list-row').length; // Numeric value is safe

    const finalMetadata = {
        'Adam_ID_From_URL': targetUrl.split('/').pop(),
        'Source_URL': targetUrl,
        'Album_Title': albumTitle,
        'Primary_Artist': primaryArtist,
        'Release_Date': releaseDate,
        'Track_Count': trackCount, 
        'Cover_Art_URL': $('meta[property="og:image"]').attr('content') || 'N/A',
        'Tracks': [
            {
                "number": actualTrackNumber, // Now correctly scraped
                "title": songTitle,
                "duration": trackDuration, 
            }
        ]
    };

    exportToJson(finalMetadata,manifestPath);
    console.log(`\n🎉 Metadata saved to **${manifestPath}**`);
}

export async function getAppleTrackMeta(adamId, manifestPath) {
    if (!adamId) throw new Error("Missing Adam ID.");

    const targetUrl = `https://music.apple.com/song/${adamId}`;
    const htmlContent = await captureAppleMusicData(targetUrl);

    if (htmlContent) {
        extractAppleMetadata(htmlContent, targetUrl,manifestPath);
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