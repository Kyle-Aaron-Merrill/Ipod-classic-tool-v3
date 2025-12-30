import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';

export async function getTidalAlbumMetadata(id, manifestPath) {
    if (!manifestPath) {
        throw new Error("Manifest path is undefined. Check arguments in link-convert.js");
    }

    const cleanId = id.toString().match(/\d+/)[0];
    const sourceUrl = `https://tidal.com/album/${cleanId}`;
    let browser;

    try {
        console.error(`[Step 2] 🕸️ Launching browser to scrape: ${cleanId}`);
        
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        await page.goto(sourceUrl, { waitUntil: 'networkidle' });
        const html = await page.content();

        // 1. Core Data Extraction from provided HTML structure
        const albumTitle = html.match(/data-test="title".*?>(.*?)<\/h2>/)?.[1] || "Unknown Album";
        const artistName = html.match(/data-test="grid-item-detail-text-title-artist".*?>(.*?)<\/a>/)?.[1] || "Unknown Artist";
        const trackCountText = html.match(/data-test="grid-item-meta-item-count".*?>(\d+)\s*TRACKS<\/span>/)?.[1] || "0";
        const totalDuration = html.match(/\(((\d+:)?\d+:\d+)\)/)?.[1] || "0:00";
        
        // 2. Tracklist Extraction
        // This looks for all spans with the track title class and data-id
        const trackMatches = [...html.matchAll(/class="_titleText_51cccae.*?title="(.*?)"/g)];
        const tracks = trackMatches.map((match, index) => ({
            number: index + 1,
            title: match[1],
            duration: "0:00", // Individual track durations are usually in a separate sibling <td>
            url: `${sourceUrl}`
        }));

        // 3. Fallback/Generated Data for unviable fields
        const releaseYear = html.match(/property="music:release_date" content="(\d{4})/)?.[1] || new Date().getFullYear().toString();
        const coverArt = (html.match(/property="og:image" content="(.*?)"/)?.[1] || "").replace('640x640', '1280x1280');

        const finalMetadata = {
            "Source_URL": sourceUrl,
            "Album_Title": albumTitle,
            "Primary_Artist": artistName,
            "Release_Date": releaseYear,
            "Track_Count": parseInt(trackCountText),
            "Total_Duration_Text": totalDuration.includes(':') ? totalDuration.replace(/:/g, ' min ').replace(' min ', ' hr ', totalDuration.split(':').length === 3 ? 0 : -1) : totalDuration,
            "Cover_Art_URL": coverArt,
            "extractionDate": new Date().toISOString(),
            "Tracks": tracks,
            "encoded_by": "iPod-Tool",
            "parental_rating_reason": html.toLowerCase().includes('explicit') ? "Explicit lyrics" : "Clean",
        };

        // 4. Save and Log
        updateManifestFile(manifestPath, finalMetadata);
        console.error(`[Step 2] ✅ Successfully scraped ${tracks.length} tracks for "${finalMetadata.Album_Title}"`);
        
        console.log(JSON.stringify([finalMetadata])); 
        return finalMetadata;

    } catch (error) {
        console.error('❌ [TIDAL Deep Scrape Error]:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
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