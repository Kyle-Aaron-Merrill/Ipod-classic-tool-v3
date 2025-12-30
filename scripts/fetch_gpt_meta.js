/**
 * Fetch GPT metadata for tracks (Node.js replacement for Python OpenAI API)
 * Uses: openai npm package
 */

import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

/**
 * Extract metadata using OpenAI GPT
 */
async function fetchMetadataWithGPT(manifestPath, apiKey) {
    try {
        if (!fs.existsSync(manifestPath)) {
            console.error(`[GPT] Manifest not found: ${manifestPath}`);
            return;
        }

        if (!apiKey) {
            console.warn('[GPT] OpenAI API key not configured. Skipping GPT metadata extraction.');
            return;
        }

        const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const tracks = manifestData.Tracks || [];

        console.log(`[GPT] Processing ${tracks.length} tracks for metadata...`);

        // Initialize OpenAI client
        const client = new OpenAI({ apiKey });

        // Prepare album-level metadata
        let albumMetadata = {};

        // Query GPT once for the album as a whole
        try {
            const albumPrompt = `Extract comprehensive music metadata for the following album:
Album Title: ${manifestData.Album_Title || 'Unknown'}
Artist: ${manifestData.Primary_Artist || 'Unknown'}
Release Date: ${manifestData.Release_Date || 'Unknown'}
Track Count: ${manifestData.Track_Count || 0}

Provide ONLY a valid JSON object (no markdown, no extra text):
{
  "genre": "primary genre",
  "mood": "overall mood/vibe",
  "publisher": "publisher/label name",
  "composers": ["composer1", "composer2"],
  "conductors": ["conductor1"],
  "group_description": "band/group description",
  "rating": 0,
  "comments": "album notes",
  "contributing_artist": ["artist1", "artist2"],
  "parental_rating_reason": "reason if applicable"
}`;

            console.log(`[GPT] Fetching album-level metadata...`);
            const albumMessage = await client.chat.completions.create({
                model: 'gpt-3.5-turbo',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: albumPrompt
                    }
                ]
            });

            const albumResponse = albumMessage.choices[0].message;
            if (albumResponse.content) {
                try {
                    albumMetadata = JSON.parse(albumResponse.content);
                    console.log(`[GPT] ✓ Album metadata: ${albumMetadata.genre} - ${albumMetadata.mood}`);
                } catch (e) {
                    console.warn(`[GPT] Could not parse album metadata response: ${e.message}`);
                }
            }
        } catch (err) {
            console.warn(`[GPT] Error fetching album metadata: ${err.message}`);
        }

        // Process individual tracks
        for (const track of tracks) {
            try {
                const trackPrompt = `Extract music metadata for this specific track:
Album: ${manifestData.Album_Title || 'Unknown'}
Artist: ${manifestData.Primary_Artist || 'Unknown'}
Track: ${track.title || 'Unknown'}
Duration: ${track.duration || 'Unknown'}

Provide ONLY a valid JSON object (no markdown, no extra text) with track-specific fields only:
{
  "isrc": "ISRC code if available"
}`;

                const message = await client.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    max_tokens: 256,
                    messages: [
                        {
                            role: 'user',
                            content: trackPrompt
                        }
                    ]
                });

                const response = message.choices[0].message;
                if (response.content) {
                    try {
                        const metadata = JSON.parse(response.content);
                        console.log(`[GPT] ✓ ${track.title}`);
                        
                        // Update track with ONLY track-specific metadata
                        track.isrc = metadata.isrc || '';
                    } catch (e) {
                        console.warn(`[GPT] Could not parse track response for ${track.title}: ${e.message}`);
                    }
                }
            } catch (err) {
                console.warn(`[GPT] Error processing track "${track.title}": ${err.message}`);
                // Continue to next track on error
            }
        }

        // Merge album-level metadata into manifest root using template field names
        if (Object.keys(albumMetadata).length > 0) {
            manifestData.genre = albumMetadata.genre || '';
            manifestData.mood = albumMetadata.mood || '';
            manifestData.contributing_artist = albumMetadata.contributing_artist || [];
            manifestData.rating = albumMetadata.rating || 0;
            manifestData.comments = albumMetadata.comments || '';
            manifestData.publisher = albumMetadata.publisher || '';
            manifestData.composers = albumMetadata.composers || [];
            manifestData.conductors = albumMetadata.conductors || [];
            manifestData.group_description = albumMetadata.group_description || '';
            manifestData.parental_rating_reason = albumMetadata.parental_rating_reason || '';
        }

        // Save updated manifest
        fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
        console.log(`[GPT] ✅ Metadata extraction complete`);

    } catch (err) {
        console.error(`[GPT] Fatal error: ${err.message}`);
    }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const manifestPath = process.argv[2];
    const apiKey = process.env.OPENAI_API_KEY;

    if (!manifestPath) {
        console.error('Usage: node fetch_gpt_meta.js <manifest_path>');
        console.error('Set OPENAI_API_KEY environment variable for GPT functionality');
        process.exit(1);
    }

    fetchMetadataWithGPT(manifestPath, apiKey);
}

export { fetchMetadataWithGPT };
