import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio'; // You may need to run: npm install cheerio
import { url } from 'inspector';

const OUTPUT_DIR = 'assets/lib-json';
const HTML_FILE = path.join(OUTPUT_DIR, 'Youtube_Music_music_info.html'); 
const JSON_OUTPUT_FILE = path.join(OUTPUT_DIR, 'music_metadata_extracted.json');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
 * Captures the full HTML content of the Youtube_Music Music page.
 */
async function captureYoutubeMusicData(targetUrl) {
    console.log(`\nSTART: Capturing Youtube_Music Music Page for: ${targetUrl}`);

    // Convert music.youtube.com to www.youtube.com to get proper HTML structure with metadata
    let fetchUrl = targetUrl.replace('music.youtube.com', 'www.youtube.com');
    console.log(`   → Converted to: ${fetchUrl}`);

    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }); 
    const page = await browser.newPage();
    let pageContent = null;

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });

    try {
        await page.goto(fetchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait for the player to load - YouTube Music has specific selectors
        await page.waitForFunction(() => {
            return document.querySelector('[role="main"]') || document.querySelector('.music-content');
        }, { timeout: 30000 }).catch(() => {});
        
        // Wait for hero image to load (album art)
        await page.waitForSelector('img.yt-video-attribute-view-model__hero-image', { timeout: 10000 }).catch(() => {});
        
        // Give it extra time to render
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
        
        // Extract metadata directly from the page via JS evaluation
        const metadata = await page.evaluate(() => {
            // YouTube Music renders all content dynamically - we need to look for specific patterns
            
            // Helper: Get all yt-formatted-string elements (YouTube Music UI text)
            const getFormattedStrings = () => {
                return Array.from(document.querySelectorAll('yt-formatted-string'))
                    .map(el => el.textContent?.trim())
                    .filter(text => text && text.length > 2 && text.length < 100);
            };
            
            // Helper: Filter out UI navigation elements
            const filterOutUI = (strings) => {
                const uiElements = [
                    'Home', 'Explore', 'Library', 'Search', 'Sign in', 'Save', 'Share', 
                    'Playing from', 'Who I Am Mix', 'New recommendations', 'Info', 'Shopping', 
                    'Video', 'Song', 'Streaker', 'All', 'Discover', 'Popular', 'Deep cuts',
                    'Workout', 'Chill', 'Pin', 'Edit', 'Create', 'Go to', 'Share playlist',
                    'Recently played', 'Your likes', 'Add to liked songs', 'Remove from library'
                ];
                return strings.filter(s => {
                    // Filter exact matches
                    if (uiElements.includes(s)) return false;
                    // Filter long explanatory text (UI instructions)
                    if (s.includes('Sign in to create') || s.includes('playlists') || s.includes('recommendations')) return false;
                    // Keep duration strings (MM:SS format)
                    if (/^\d{1,2}:\d{2}$/.test(s)) return true;
                    // Filter very short navigation text (but keep artists like "Toro y Moi")
                    if (s.length < 3 && !s.includes(' ')) return false;
                    // Keep everything else
                    return true;
                });
            };
            
            const getTitle = () => {
                const allStrings = getFormattedStrings();
                const filtered = filterOutUI(allStrings);
                
                // The first filtered string after UI elements is usually the track title
                if (filtered.length > 0) {
                    const firstString = filtered[0];
                    // If it's not a URL or very long, it's likely the title
                    if (!firstString.includes('http') && firstString.length < 120) {
                        return firstString;
                    }
                }
                
                // Fallback to parsing from page title
                const pageTitle = document.title;
                if (pageTitle && pageTitle !== 'YouTube Music' && pageTitle.includes(' - ')) {
                    return pageTitle.split(' - ')[0].trim();
                }
                
                return 'Unknown Track';
            };
            
            const getArtist = () => {
                const allStrings = getFormattedStrings();
                const filtered = filterOutUI(allStrings);
                
                // The second filtered string is usually the artist
                if (filtered.length >= 2) {
                    return filtered[1];
                }
                // If only one string, it might be title/artist combined, try to split
                if (filtered.length === 1) {
                    const parts = filtered[0].split(' - ');
                    if (parts.length > 1) {
                        return parts[1];
                    }
                }
                
                return 'Unknown Artist';
            };
            
            const getAlbum = () => {
                // YouTube embeds album name in meta description: "Title · Artist\nAlbum\n℗ Year Label"
                // First try to get description from meta tags
                let description = document.querySelector('meta[name="description"]')?.content || '';
                
                if (!description) {
                    description = document.querySelector('meta[property="og:description"]')?.content || '';
                }
                
                if (description) {
                    const lines = description.split('\n');
                    // Album is typically on the second or third line (after title and artist)
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        // Skip if it starts with ℗ (copyright) or contains "subscriber"
                        if (line && !line.startsWith('℗') && !line.includes('subscriber') && !line.includes('K subscribers')) {
                            // This should be the album name
                            return line;
                        }
                    }
                }
                
                // Method 2: Look for playlist/album link (marked with OLAK) 
                const albumLink = document.querySelector('a[href*="/playlist?list=OLAK"]');
                if (albumLink?.textContent?.trim().length > 2) {
                    const albumText = albumLink.textContent.trim();
                    if (!albumText.includes('subscriber') && albumText.length < 100) {
                        return albumText;
                    }
                }
                
                return 'Unknown Album';
            };
            
            const getDuration = () => {
                const allStrings = getFormattedStrings();
                const filtered = filterOutUI(allStrings);
                
                // Look for duration pattern (MM:SS or M:SS)
                // Duration is usually in the filtered list after filtering out UI elements
                for (const str of filtered) {
                    // Match patterns like "3:29", "1:02", "12:45"
                    if (/^\d{1,2}:\d{2}$/.test(str)) {
                        return str;
                    }
                }
                
                // Check video element's duration property
                const video = document.querySelector('video');
                if (video && video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
                    const mins = Math.floor(video.duration / 60);
                    const secs = Math.floor(video.duration % 60);
                    return `${mins}:${String(secs).padStart(2, '0')}`;
                }
                
                // Last resort: look for any text matching time format
                for (const str of allStrings) {
                    if (/^\d{1,2}:\d{2}$/.test(str)) {
                        return str;
                    }
                }
                
                return 'N/A';
            };
            
            const getCoverArt = () => {
                // YouTube Music stores album art in a specific img element
                const heroImage = document.querySelector('img.yt-video-attribute-view-model__hero-image');
                
                // Look in the page scripts for lh3.googleusercontent URLs (most reliable)
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                    const content = script.textContent;
                    if (content && content.includes('lh3.googleusercontent.com')) {
                        // Extract the URL
                        const match = content.match(/https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9\-_=]+/);
                        if (match) {
                            return match[0];
                        }
                    }
                }
                
                // Fallback: if hero image has src attribute set
                if (heroImage && heroImage.src && heroImage.src.includes('lh3.googleusercontent.com')) {
                    return heroImage.src;
                }
                
                // Last resort: YouTube video thumbnail
                const ogImage = document.querySelector('meta[property="og:image"]')?.content;
                if (ogImage) {
                    return ogImage;
                }
                
                return 'N/A';
            };
            
            return {
                title: getTitle(),
                artist: getArtist(),
                album: getAlbum(),
                coverArt: getCoverArt(),
                duration: getDuration()
            };
        });
        
        pageContent = await page.content();
        
        // Store the extracted metadata in the HTML for later parsing
        pageContent += `\n<!-- EXTRACTED METADATA: ${JSON.stringify(metadata)} -->`;

        // Persist the captured page for offline parsing
        fs.writeFileSync(HTML_FILE, pageContent, 'utf8');
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
function extractYoutubeMusicMetadata(html, targetUrl, manifestPath) {
    console.log('START: Extracting metadata from HTML...');
    const $ = cheerio.load(html);

    // Try to extract pre-captured metadata from HTML comment
    let capturedMetadata = {};
    const metadataMatch = html.match(/<!-- EXTRACTED METADATA: ({.*?}) -->/);
    if (metadataMatch) {
        try {
            capturedMetadata = JSON.parse(metadataMatch[1]);
            console.log('✅ Found pre-captured metadata from Puppeteer');
            console.log('   Duration value:', capturedMetadata.duration);
        } catch (e) {
            console.log('ℹ️ Could not parse pre-captured metadata');
        }
    }

    // Youtube_Music often stores metadata in a JSON-LD script tag (fallback)
    const jsonLdData = $('script[type="application/ld+json"]').html();
    let ldJson = {};
    if (jsonLdData) {
        try {
            ldJson = JSON.parse(jsonLdData);
        } catch (e) {
            console.error("Could not parse JSON-LD");
        }
    }

    // 1. Track Title - Use captured metadata first, then fallbacks
    let trackTitle = capturedMetadata.title || 
                     $('.yt-video-attribute-view-model__title').first().text().trim() || 
                     $('meta[name="title"]').attr('content') || 
                     $('meta[property="og:title"]').attr('content') ||
                     $('title').text().replace(' - YouTube Music', '').replace(' - YouTube', '').trim() ||
                     'Unknown Track';

    // 2. Primary Artist - Use captured metadata first, then fallbacks
    let primaryArtist = capturedMetadata.artist ||
                        $('.yt-video-attribute-view-model__subtitle span').first().text().trim() || 
                        ldJson.artist?.name || 
                        ldJson.name || 
                        $('link[itemprop="name"]').attr('content') || 
                        $('meta[name="author"]').attr('content') || 
                        'Unknown Artist';

    // 3. Album Title - Parse from description or use playlist link
    let albumTitle = capturedMetadata.album ||
                     $('meta[itemprop="album"]').attr('content');
    
    if (!albumTitle) {
        // Try to extract from description: "Title · Artist\nAlbum\n℗ Year Label"
        const description = $('meta[name="description"]').attr('content') || 
                           $('meta[property="og:description"]').attr('content') || '';
        const lines = description.split('\n');
        if (lines.length >= 2) {
            // Second line is usually the album name
            albumTitle = lines[1].trim();
        }
    }
    
    if (!albumTitle) {
        // Fallback: extract from playlist link text
        albumTitle = $('.yt-video-attribute-view-model__secondary-subtitle').first().text().trim();
    }
    
    if (!albumTitle) {
        albumTitle = `${trackTitle} - Single`;
    }

    // 4. Release Date
    const rawReleaseDate = ldJson.uploadDate || ldJson.datePublished;

    // 5. Cover Art - Use captured metadata first, then search HTML
    let coverArt = capturedMetadata.coverArt;
    if (coverArt === 'N/A' || !coverArt) {
        // First try to extract from script data (where YouTube stores image URLs)
        const scriptContent = $('script').map((i, el) => $(el).html()).get().join(' ');
        
        // Look for lh3.googleusercontent.com URLs (album art from YouTube Music)
        const googleMatch = scriptContent.match(/https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9\-_=]+/);
        if (googleMatch) {
            coverArt = googleMatch[0];
        } else {
            // Fallback: YouTube video thumbnail from og:image
            coverArt = $('meta[property="og:image"]').attr('content') || 'N/A';
        }
    }

    // 6. Duration
    const rawDuration = capturedMetadata.duration || ldJson.duration;

    const finalMetadata = {
        "Source_URL": targetUrl,
        'Track_ID': new URL(targetUrl).searchParams.get('v') || 'unknown',
        'Primary_Artist': primaryArtist || 'Unknown Artist',
        'Album_Title': albumTitle || 'Unknown Album',
        "Release_Date": (rawReleaseDate && formatReleaseDate(rawReleaseDate)) || 'N/A',
        "Cover_Art_URL": coverArt || 'N/A',
        "Tracks": [
            {
                "number": 1, 
                "title": trackTitle || 'Unknown Track',
                "duration": (rawDuration && formatDuration(rawDuration)) || 'N/A'
            }
        ]
    };

    exportToJson(finalMetadata, manifestPath);
    console.log(`\n🎉 Metadata saved to **${manifestPath}**`);
    console.log(finalMetadata);
}

export async function getYoutubeMusicTrackMeta(adamId, manifestPath) {
    if (!adamId) throw new Error("Missing Adam ID.");

    // Use the standard YouTube watch URL (YouTube Music pages miss some metadata)
    const targetUrl = `https://www.youtube.com/watch?v=${adamId}`;
    const htmlContent = await captureYoutubeMusicData(targetUrl);

    if (htmlContent) {
        extractYoutubeMusicMetadata(htmlContent, targetUrl, manifestPath);
    } else {
        console.warn(`[YT Music] Failed to capture metadata from ${targetUrl}`);
        // Create a minimal metadata object when page capture fails
        const minimalMetadata = {
            "Source_URL": targetUrl,
            'Track_ID': adamId,
            'Primary_Artist': 'Unknown Artist',
            'Album_Title': 'Unknown Album',
            "Release_Date": 'N/A',
            "Cover_Art_URL": 'N/A',
            "Tracks": [
                {
                    "number": 1,
                    "title": 'Unknown Track',
                    "duration": 'N/A'
                }
            ]
        };
        exportToJson(minimalMetadata, manifestPath);
    }
}

/**
 * Converts ISO 8601 duration (e.g., "PT252S" or "PT3M45S") to MM:SS format.
 */
function formatDuration(duration) {
    if (!duration) return 'N/A';
    
    // If already in MM:SS format, return as-is
    if (/^\d{1,2}:\d{2}$/.test(duration)) {
        return duration;
    }
    
    // If it's HH:MM:SS format, return as-is
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(duration)) {
        return duration;
    }
    
    try {
        // Try to parse ISO 8601 format (PT3M29S)
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 'N/A';
        
        const hours = parseInt(match[1]) || 0;
        const minutes = parseInt(match[2]) || 0;
        const seconds = parseInt(match[3]) || 0;
        
        // Format the duration
        return hours > 0 
            ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } catch (e) {
        return 'N/A';
    }
}

/**
 * Formats YYYY-MM-DD to a clean date string.
 */
function formatReleaseDate(rawDate) {
    if (!rawDate) return 'N/A';
    try {
        if (typeof rawDate !== 'string') return 'N/A';
        const datePart = rawDate.split('T')[0];
        return datePart || 'N/A';
    } catch (e) {
        return 'N/A';
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