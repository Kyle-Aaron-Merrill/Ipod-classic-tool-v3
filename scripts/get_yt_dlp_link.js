/**
 * Copyright (c) 2025 Kyle Aaron Merrill
 */

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPythonCommand } from '../utils/platform-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const launchOptions = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl'
    ]
};

/**
 * Normalizes strings for better matching (handles apostrophes, slashes, and symbols)
 */
function normalize(str) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/[’‘]/g, "'")             // Handle curly apostrophes
        .replace(/\//g, ' ')               // Convert slashes to spaces
        .replace(/[^a-z0-9\s']/gi, '')     // Remove symbols like parentheses
        .replace(/\s+/g, ' ')              // Collapse multiple spaces
        .trim();                           //
}

/**
 * Navigates to a channel's tab and attempts to find a matching album.
 * Uses specific selectors based on whether it's the releases tab or main page.
 */
async function searchChannelForAlbum(page, channelUrl, targetAlbum) {
    const releasesUrl = `${channelUrl}/releases`.replace(/\/+releases/, '/releases');
    const mainUrl = channelUrl;
    
    const searchAlbumNorm = normalize(targetAlbum);

    // 1. Try Releases Tab with standard grid selectors
    console.error(`[yt-dlp-link] 📂 Attempting Releases Tab: ${releasesUrl}`);
    const releaseSelector = 'ytd-rich-item-renderer, ytd-grid-video-renderer';
    let items = await attemptSearch(page, releasesUrl, releaseSelector);

    // 2. Fallback to Main Channel Page with the lockup-metadata selector
    if (items.length === 0) {
        console.error(`[yt-dlp-link] 🔄 Releases empty. Falling back to Main Page with Lockup Selectors...`);
        // This targets the specific lockup-metadata class you identified
        const lockupSelector = '.yt-lockup-metadata-view-model__title';
        items = await attemptSearch(page, mainUrl, lockupSelector);
    }

    // 3. Match Logic (scored) — prefer exact/edition-aware matches to avoid picking the wrong release
    const editionKeywords = ['legacy', 'edition', 'deluxe', 'expanded', 'remastered', 'legacy edition'];

    const scored = items.map(item => {
        const itemTitleNorm = normalize(item.title);
        let score = 0;

        if (!itemTitleNorm) return { ...item, score: 0 };

        // Strong boost for exact equality
        if (itemTitleNorm === searchAlbumNorm) score += 50;

        // Good boost for containment either way
        if (itemTitleNorm.includes(searchAlbumNorm)) score += 20;
        if (searchAlbumNorm.includes(itemTitleNorm)) score += 10;

        // Token matches (each token matched gives small points)
        searchAlbumNorm.split(' ').forEach(tok => {
            if (tok && itemTitleNorm.includes(tok)) score += 2;
        });

        // If both contain edition keywords, prefer that match (helps pick 'Legacy Edition')
        editionKeywords.forEach(k => {
            if (itemTitleNorm.includes(k) && searchAlbumNorm.includes(k)) score += 8;
            else if (itemTitleNorm.includes(k) || searchAlbumNorm.includes(k)) score += 3;
        });

        return { ...item, score };
    }).sort((a, b) => b.score - a.score);

    if (scored.length > 0 && scored[0].score > 0) {
        console.error(`[yt-dlp-link] ✅ Best Match: "${scored[0].title}" (score=${scored[0].score})`);
        return scored[0];
    }

    return null;
}

async function attemptSearch(page, url, selector) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        return await scrollToLoadAll(page, selector);
    } catch (error) {
        console.error(`[yt-dlp-link] ⚠️ Failed to load ${url}: ${error.message}`);
        return [];
    }
}

export async function get_yt_dlp_link(url, media, album, track) {
    let browser;
    try {
        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        
        // --- SPECIAL HANDLING: YouTube Music browse URLs ---
        // If it's a music.youtube.com browse URL, resolve it to a playlist URL first
        let workingUrl = url;
        if (url.includes('music.youtube.com/browse/')) {
            console.error(`[yt-dlp-link] Detected YouTube Music browse URL, resolving to playlist...`);
            try {
                await page.goto(url, { waitUntil: 'networkidle2' });
                const resolvedUrl = await page.url();
                console.error(`[yt-dlp-link] Resolved to: ${resolvedUrl}`);
                
                if (resolvedUrl.includes('/playlist?list=')) {
                    workingUrl = resolvedUrl;
                    console.error(`[yt-dlp-link] Using resolved playlist URL for search`);
                } else {
                    console.error(`[yt-dlp-link] Could not resolve to playlist, falling back to original`);
                }
            } catch (e) {
                console.error(`[yt-dlp-link] Browse resolution failed: ${e.message}, using original URL`);
            }
        }
        
        // --- STEP 1: Find the Primary Artist Channel ---
        console.error(`[yt-dlp-link] Attempting to find primary channel for: ${workingUrl}`);
        await page.goto(workingUrl, { waitUntil: 'networkidle2' });

        const channelSelector = 'ytd-channel-renderer a#main-link';
        let channelUrl = null;

        try {
            await page.waitForSelector(channelSelector, { timeout: 5000 });
            channelUrl = await page.$eval(channelSelector, el => el.href);
        } catch (e) {
            console.error('[yt-dlp-link] Primary channel not found in search results.');
        }

        // --- STEP 2: Search Primary Channel ---
        let foundAlbum = null;
        if (channelUrl) {
            foundAlbum = await searchChannelForAlbum(page, channelUrl, album);
        }
        
        // 3. Fallback to Topic Channel
        if (!foundAlbum) {
          // FIX: Use the extracted Name, not the URL, to search for Topic
          const artistUrl = new URL(workingUrl);
          
          await page.waitForSelector(channelSelector, { timeout: 5000 });
          const topicChannelUrl = await page.$eval(channelSelector, el => el.href);
          
          foundAlbum = await searchChannelForAlbum(page, topicChannelUrl, album);
        }

        if (foundAlbum) {
            const urlObj = new URL(foundAlbum.url);
            const listId = urlObj.searchParams.get('list');

            // Verification: if the target album name includes edition keywords
            // but the foundAlbum title does not, perform a global playlist search
            const editionKeywords = ['legacy', 'edition', 'deluxe', 'expanded', 'remastered', 'legacy edition'];
            const targetHasEdition = editionKeywords.some(k => album?.toLowerCase().includes(k));

            async function playlistTitleIncludesEdition(playlistUrl) {
                try {
                    await page.goto(playlistUrl, { waitUntil: 'networkidle2' });
                    // Title selector used on playlist pages
                    const title = await page.evaluate(() => {
                        const el = document.querySelector('h1#title') || document.querySelector('h1.title') || document.querySelector('yt-formatted-string#title');
                        return el ? el.textContent.trim().toLowerCase() : '';
                    });
                    return editionKeywords.some(k => title.includes(k));
                } catch (e) {
                    console.error('[yt-dlp-link] Playlist verification failed:', e.message);
                    return false;
                }
            }

            if (track === "Full Album" && listId) {
                // If target requests a specific edition, verify the playlist
                const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
                if (targetHasEdition) {
                    const foundHasEdition = await playlistTitleIncludesEdition(playlistUrl);
                    if (!foundHasEdition) {
                        console.error('[yt-dlp-link] Found playlist lacks edition keyword; searching globally for matching playlists...');
                        // Global search fallback for playlists matching album + edition
                        const searchQuery = encodeURIComponent(`${album} playlist`);
                        const resultsUrl = `https://www.youtube.com/results?search_query=${searchQuery}`;
                        await page.goto(resultsUrl, { waitUntil: 'networkidle2' });
                        // Find playlist links on results page
                        const candidates = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, title: a.textContent.trim() })).filter(i => i.href && i.href.includes('list='));
                        });

                        // Try: prefer candidates whose playlist page links back to the artist channel
                        for (const cand of candidates) {
                            try {
                                await page.goto(cand.href, { waitUntil: 'networkidle2' });
                                const pageHtml = await page.content();
                                // If the playlist page contains the artist channel url, prefer it
                                if (channelUrl && pageHtml.includes(channelUrl)) {
                                    console.error('[yt-dlp-link] Candidate playlist links back to artist channel; selecting.');
                                    return cand.href;
                                }
                                // Also prefer if the playlist title contains edition keywords
                                const titleLower = (cand.title || '').toLowerCase();
                                if (editionKeywords.some(k => titleLower.includes(k))) {
                                    console.error('[yt-dlp-link] Candidate playlist contains edition keyword; selecting.');
                                    return cand.href;
                                }
                            } catch (e) {
                                console.error('[yt-dlp-link] Error inspecting candidate playlist:', e.message);
                            }
                        }
                    }
                }
                return playlistUrl;
            } else if (listId) {
                const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
                return await getTrackUrl(playlistUrl, track);
            }
        }

        return null;
    } catch (err) {
        console.error('[yt-dlp-link] Global Error:', err.message);
        console.log("null"); // Explicitly output null for the main process to catch
        process.exit(0);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Refactored scrolling logic that uses a specific selector to handle page-specific structures.
 */
async function scrollToLoadAll(page, itemSelector, scrollDelay = 500) {
    const collectedItems = new Map();

    try {
        await page.waitForSelector(itemSelector, { timeout: 8000 });
        
        let lastHeight = await page.evaluate('document.documentElement.scrollHeight');
        while (true) {
            const itemsData = await page.evaluate((sel) => {
                const elements = Array.from(document.querySelectorAll(sel));
                return elements.map(el => {
                    // Strategy: Find the nearest link and the best text source inside the element
                    let titleText = "";
                    let href = "";

                    if (el.classList.contains('yt-lockup-metadata-view-model__title')) {
                        // Logic for the specific main page selector you found
                        titleText = el.querySelector('.yt-core-attributed-string')?.textContent || el.textContent;
                        href = el.href || el.querySelector('a')?.href;
                    } else {
                        // Standard grid renderer logic
                        const titleEl = el.querySelector('#video-title, a#video-title-link');
                        titleText = titleEl?.textContent || titleEl?.title;
                        href = el.querySelector('a#video-title-link, a#thumbnail')?.href;
                    }
                    
                    return { title: titleText?.trim() || "", url: href || "" };
                });
            }, itemSelector);

            itemsData.forEach(item => { 
                if (item.url && item.title) collectedItems.set(item.url, item); 
            });

            await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
            await new Promise(r => setTimeout(r, scrollDelay));
            
            let newHeight = await page.evaluate('document.documentElement.scrollHeight');
            if (newHeight === lastHeight) break;
            lastHeight = newHeight;
        }
    } catch (e) {
        console.error(`[scrollToLoadAll] ⚠️ No items found for selector: ${itemSelector}`);
    }
    return Array.from(collectedItems.values());
}

/**
 * Spawns the Python process to find a specific track URL within a playlist
 */
export async function getTrackUrl(playlistUrl, trackName) {
    const pythonScript = path.join(__dirname, 'get_track_url.py');
    const pythonCmd = getPythonCommand();
    return new Promise((resolve, reject) => {
        const pyProcess = spawn(pythonCmd, [pythonScript, playlistUrl, trackName]);
        let result = '';
        pyProcess.stdout.on('data', (d) => result += d.toString());
        pyProcess.on('close', (code) => {
            try {
                const json = JSON.parse(result);
                resolve(json.url);
            } catch (e) { reject(`Python Parse Error: ${result}`); }
        });
    });
}

// CLI Execution Support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [,, url, media, album, track] = process.argv;
    get_yt_dlp_link(url, media, album, track).then(link => {
        // Support both CLI and IPC communication
        if (process.send) {
            process.send({ type: 'output', data: link ? link.trim() : '' });
        } else {
            if (link) process.stdout.write(link.trim());
        }
        process.exit(0);
    }).catch(err => {
        if (process.send) {
            process.send({ type: 'error', data: err.message });
        } else {
            process.stderr.write(err.message);
        }
        process.exit(1);
    });
}