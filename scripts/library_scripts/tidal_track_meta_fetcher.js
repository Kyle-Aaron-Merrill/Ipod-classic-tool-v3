import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';

/**
 * Helper function to safely merge new metadata into an existing JSON manifest
 */
function updateManifestFile(filePath, newData) {
    let existingData = {};

    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            existingData = JSON.parse(content);
        } catch (error) {
            console.error(`[Step 2] ⚠️ Manifest exists but is unreadable. Starting fresh.`);
        }
    }

    // Merge logic: Existing fields are preserved, newData updates or adds fields
    const mergedData = {
        ...existingData,
        ...newData
    };

    fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2));
    return mergedData;
}

/**
 * Fetches Tidal Track Metadata by scraping the track's public page.
 */
export async function getTidalTrackMetadata(trackId, manifestPath) {
    if (!manifestPath) {
        throw new Error("Manifest path is undefined.");
    }

    // Ensure we have a clean ID
    const cleanId = trackId.toString().match(/\d+/)[0];
    const sourceUrl = `https://tidal.com/track/${cleanId}`;
    let browser;

    try {
        console.error(`[Step 2] 🕸️ Launching browser to scrape track: ${cleanId}`);
        
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Navigate to the track page
        await page.goto(sourceUrl, { waitUntil: 'networkidle' });
        const html = await page.content();
        //fs.writeFileSync("test.html", html);
        // 1. Core Data Extraction from provided HTML structure
        const albumTitle = html.match(/data-test="title".*?>(.*?)<\/h2>/)?.[1] || "Unknown Album";
        const artistName = html.match(/data-test="grid-item-detail-text-title-artist".*?>(.*?)<\/a>/)?.[1] || "Unknown Artist";
        const trackCountText = html.match(/data-test="grid-item-meta-item-count".*?>(\d+)\s*TRACKS<\/span>/)?.[1] || "0";
        const totalDuration = html.match(/\(((\d+:)?\d+:\d+)\)/)?.[1] || "0:00";

        // Pinpoint the specific row for this track ID
        const rowSelector = `div[data-track-id="${cleanId}"]`;
        const trackRow = page.locator(rowSelector);

        if (await trackRow.count() === 0) {
            throw new Error(`Track ${targetTrackId} not found on the page.`);
        }
        
        // Extract specific data points from the target element
        const trackNumber = await trackRow.getAttribute('data-test-track-number');
        const trackTitle = await trackRow.locator('[data-test="table-cell-title"]').innerText();
        const duration = await trackRow.locator('time').innerText();
        const isExplicit = (await trackRow.locator('[data-test="explicit-badge"]').count()) > 0;

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
            "encoded_by": "iPod-Tool",
            "parental_rating_reason": html.toLowerCase().includes('explicit') ? "Explicit lyrics" : "Clean",
            "Tracks": [
                {
                    "number": parseInt(trackNumber),
                    "title": trackTitle.trim(),
                    "duration": duration.trim(),
                    "explicit": isExplicit
                }
            ]
        };

        // 4. Update the manifest using the Read-Merge-Write function
        const mergedResult = updateManifestFile(manifestPath, finalMetadata);

        console.error(`[Step 2] ✅ Successfully merged track manifest: ${path.basename(manifestPath)}`);
        
        // Output for Electron main process
        console.log(JSON.stringify([mergedResult])); 
        return mergedResult;

    } catch (error) {
        console.error('❌ [TIDAL Track Scrape Error]:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}