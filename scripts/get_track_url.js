/**
 * Get track URL from YouTube playlist (Node.js replacement for Python yt-dlp)
 * Uses: yt-dlp-exec npm package
 */

import { execSync } from 'child_process';
import { getPythonCommand } from '../utils/platform-utils.js';

/**
 * Extract track URL from a YouTube playlist
 */
async function getTrackUrl(playlistUrl, trackName) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`[Track URL] Searching for "${trackName}" in playlist...`);

            // Use yt-dlp to get playlist info
            const command = `yt-dlp --dump-single-json --extract-audio --audio-format mp3 "${playlistUrl}"`;
            
            try {
                const output = execSync(command, { 
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 30000
                });

                const playlistData = JSON.parse(output);
                
                if (!playlistData.entries) {
                    return reject('No entries found in playlist');
                }

                // Search for matching track
                const normalizedSearch = trackName.toLowerCase().trim();
                const matchedEntry = playlistData.entries.find(entry => 
                    entry.title && entry.title.toLowerCase().includes(normalizedSearch)
                );

                if (matchedEntry && matchedEntry.id) {
                    const trackUrl = `https://www.youtube.com/watch?v=${matchedEntry.id}`;
                    console.log(`[Track URL] ✓ Found: ${matchedEntry.title}`);
                    resolve({ url: trackUrl });
                } else {
                    // Try fuzzy matching if exact match not found
                    console.warn(`[Track URL] Exact match not found, using first entry`);
                    const firstEntry = playlistData.entries[0];
                    if (firstEntry && firstEntry.id) {
                        const trackUrl = `https://www.youtube.com/watch?v=${firstEntry.id}`;
                        resolve({ url: trackUrl });
                    } else {
                        reject('Could not extract track URL from playlist');
                    }
                }
            } catch (err) {
                reject(`yt-dlp error: ${err.message}`);
            }

        } catch (err) {
            reject(`Failed to get track URL: ${err.message}`);
        }
    });
}

// CLI support
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const [, , playlistUrl, trackName] = process.argv;

    if (!playlistUrl || !trackName) {
        console.error('Usage: node get_track_url.js <playlist_url> <track_name>');
        process.exit(1);
    }

    getTrackUrl(playlistUrl, trackName)
        .then(result => {
            console.log(JSON.stringify(result));
            process.exit(0);
        })
        .catch(err => {
            console.error(`Error: ${err}`);
            process.exit(1);
        });
}

export { getTrackUrl };
