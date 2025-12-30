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

        for (const track of tracks) {
            try {
                const prompt = `Extract music metadata for the following track:
Album: ${manifestData.Album_Title || 'Unknown'}
Artist: ${manifestData.Primary_Artist || 'Unknown'}
Track: ${track.title || 'Unknown'}

Provide in JSON format:
{
  "genre": "genre here",
  "mood": "mood here",
  "energy_level": "high/medium/low",
  "description": "brief description"
}`;

                const message = await client.messages.create({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 1024,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                });

                const response = message.content[0];
                if (response.type === 'text') {
                    try {
                        const metadata = JSON.parse(response.text);
                        console.log(`[GPT] ✓ ${track.title}: ${metadata.genre} (${metadata.mood})`);
                        
                        // Update track with GPT metadata
                        track.genre = metadata.genre || track.genre;
                        track.mood = metadata.mood || '';
                        track.energy_level = metadata.energy_level || '';
                    } catch {
                        console.warn(`[GPT] Could not parse response for ${track.title}`);
                    }
                }
            } catch (err) {
                console.warn(`[GPT] Error processing track "${track.title}": ${err.message}`);
                // Continue to next track on error
            }
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
