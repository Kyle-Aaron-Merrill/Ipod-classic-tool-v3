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

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }); 
    const page = await browser.newPage();
    let pageContent = null;

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        pageContent = await page.content(); 
        //fs.writeFileSync(HTML_FILE, pageContent);
        console.log(`✅ Captured and saved HTML to **${HTML_FILE}**`);
    } catch (error) {
        console.error('❌ Navigation failed:', error.message);
    } finally {
        await browser.close();
    }
    return pageContent;
}

/**
 * Parses the HTML and extracts structured metadata.
 */
function extractAppleMetadata(html, targetUrl, manifestPath) {
    console.log('START: Extracting metadata from HTML...');
    const $ = cheerio.load(html);

    // Apple often stores metadata in a JSON-LD script tag
    const jsonLdData = $('script[type="application/ld+json"]').html();
    let ldJson = {};
    if (jsonLdData) {
        try {
            ldJson = JSON.parse(jsonLdData);
        } catch (e) {
            console.error("Could not parse JSON-LD");
        }
    }

    // Attempting to find specific elements if JSON-LD is incomplete
    const albumTitle = $('h1.album-header-metadata__title').text().trim() || ldJson.name || 'N/A';
    const primaryArtist = $('div[data-testid="product-subtitles"] a[data-testid="click-action"]').first().text().trim() || ldJson.byArtist?.name || 'N/A';
    const releaseDate = $('div.album-header-metadata__release-date').text().trim() || ldJson.datePublished || 'N/A';
    
    // Footnote often contains track count and duration: "12 Songs, 45 Minutes"
    const footerText = $('.footer-body p').text().trim();
    const specificSongsListContainer = $('.songs-list.svelte-1nv3ko5.songs-list--album');
    const trackCountMatch = specificSongsListContainer.find('.songs-list-row');
    const durationMatch = footerText.match(/songs?,\s*(.*)/i);

    const totalDuration = durationMatch ? durationMatch[1].split('\n')[0] : 'N/A';

    const lines = footerText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    const copyright = lines.find(l => l.includes('©') || l.includes('℗')) || lines[lines.length - 1];

    const trackList = [];

    $('.songs-list-row').each((index, element) => {
        const row = $(element);

        // --- NEW: SKIP VIDEO TRACKS ---
        // We check for the specific SVG testid that identifies a video track
        const isVideo = row.find('svg[data-testid="track-video-svg"]').length > 0;
        
        if (isVideo) {
            console.log(`[Apple-Fetcher] Skipping video track at position ${index + 1}`);
            return; // In Cheerio's .each, 'return' acts like 'continue'
        }

        // 1. Get Track Number
        const trackNumber = row.find('[data-testid="track-number"]').text().trim();

        // 2. Get Song Title
        const trackTitle = row.find('[data-testid="track-title"]').text().trim();

        // 3. Get Duration (and convert to seconds if needed)
        const durationText = row.find('[data-testid="track-duration"]').text().trim();
        
        // 4. Check for Explicit Badge
        const isExplicit = row.find('[data-testid="explicit-badge"]').length > 0;

        // 5. Get Song URL
        const trackUrl = row.find('a[data-testid="click-action"]').attr('href');

        trackList.push({
            number: parseInt(trackNumber) || index + 1,
            title: trackTitle,
            duration: durationText,
            explicit: isExplicit,
            url: trackUrl
        });
    });

    const finalMetadata = {
        'Adam_ID_From_URL': targetUrl.split('/').pop(),
        'Source_URL': targetUrl,
        'Album_Title': albumTitle,
        'Primary_Artist': primaryArtist,
        'Release_Date': releaseDate,
        'Track_Count': trackCountMatch ? trackCountMatch.length : 'N/A',
        'Total_Duration_Text': totalDuration ? totalDuration.trim() : 'N/A',
        'Cover_Art_URL': $('meta[property="og:image"]').attr('content') || 'N/A',
        'Copyright_Statement': copyright || 'N/A',
        'Tracks': trackList,
        'ISRC_Available': false,
        'Note_on_Missing_Data': 'The full technical identifiers (ISRC/UPC) are not present in this HTML view.'
    };

    exportToJson(finalMetadata,manifestPath)
    console.log(`\n🎉 Metadata saved to **${manifestPath}**`);
    console.log(finalMetadata);
}

export async function getAppleAlbumMeta(adamId, manifestPath) {
    if (!adamId) throw new Error("Missing Adam ID.");

    const targetUrl = `https://music.apple.com/album/${adamId}`;
    const htmlContent = await captureAppleMusicData(targetUrl);

    if (htmlContent) {
        extractAppleMetadata(htmlContent, targetUrl, manifestPath);
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