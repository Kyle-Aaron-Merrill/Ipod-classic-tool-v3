/**
 * Embed metadata into MP3 files (Node.js replacement for Python mutagen)
 * Uses: node-id3 for ID3 tagging, sharp for image processing
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import NodeID3 from 'node-id3';
import fetch from 'node-fetch';

/**
 * Download an image from URL and convert to buffer
 */
async function downloadImageAsBuffer(imageUrl) {
    try {
        if (!imageUrl || !imageUrl.startsWith('http')) {
            console.warn(`[Embedder] Invalid image URL: ${imageUrl}`);
            return null;
        }
        
        const response = await fetch(imageUrl, { timeout: 10000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Optimize image size (max 500x500)
        const optimized = await sharp(buffer)
            .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
        
        return optimized;
    } catch (err) {
        console.warn(`[Embedder] Failed to download/process image: ${err.message}`);
        return null;
    }
}

/**
 * Embed metadata into a single MP3 file
 */
async function embedMetadataIntoTrack(filePath, metadata) {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`[Embedder] File not found: ${filePath}`);
            return false;
        }

        // Log what metadata we're working with
        console.log(`[Embedder] Embedding: ${metadata.track_title || 'Unknown'}`);
        console.log(`[Embedder]   Genre: ${metadata.genre}`);
        console.log(`[Embedder]   Mood: ${metadata.mood}`);
        console.log(`[Embedder]   Composer: ${metadata.composer}`);

        // Windows Explorer is picky: stick to ID3v2.3 core aliases it understands
        const year = (metadata.release_date || '').toString().slice(0, 4);
        const trackTotal = metadata.track_total ? `/${metadata.track_total}` : '';
        const tags = {
            title: metadata.track_title || 'Unknown',
            artist: metadata.artist || 'Unknown Artist',
            album: metadata.album || 'Unknown Album',
            performerInfo: metadata.album_artist || metadata.artist, // album artist (TPE2)
            year,
            genre: metadata.genre || '',
            trackNumber: metadata.track_number ? `${metadata.track_number}${trackTotal}` : undefined,
            partOfSet: metadata.disc_number || '1/1',
            publisher: metadata.publisher || '',
            composer: metadata.composer || '',
            copyright: metadata.copyright_text || '',
            encodedBy: metadata.encoded_by || 'iPod Classic Tool v3',
            originalArtist: metadata.contributing_artist || '',
            conductor: metadata.conductors ? `conductor/${metadata.conductors}` : '',
            mood: metadata.mood || '',
            contentGroup: metadata.grouping || '',
            isrc: metadata.isrc || '',
            userDefinedText: [
                { description: 'source_url', value: metadata.source_url || '' }
            ],
            comment: {
                language: 'eng',
                text: metadata.comments || ''
            }
        };

        // Add cover art if available
        if (metadata.cover_url) {
            const imageBuffer = await downloadImageAsBuffer(metadata.cover_url);
            if (imageBuffer) {
                tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3 }, // front cover
                    description: 'Cover Art',
                    imageBuffer: imageBuffer
                };
            }
        }

        // Write tags to file
        return new Promise((resolve, reject) => {
            NodeID3.write(tags, filePath, (err) => {
                if (err) {
                    console.error(`[Embedder] Error writing tags: ${err.message}`);
                    resolve(false);
                } else {
                    console.log(`[Embedder] ✓ Embedded metadata into: ${path.basename(filePath)}`);
                    // Quick sanity check so we know what was actually written
                    const readBack = NodeID3.read(filePath, { noRaw: true });
                    const missingCore = ['title', 'artist', 'album', 'trackNumber', 'year']
                        .filter((field) => !readBack?.[field]);
                    if (missingCore.length) {
                        console.warn(`[Embedder] ⚠️ Missing after write (${path.basename(filePath)}): ${missingCore.join(', ')}`);
                    }
                    resolve(true);
                }
            });
        });
    } catch (err) {
        console.error(`[Embedder] Error embedding metadata: ${err.message}`);
        return false;
    }
}

/**
 * Main function: Process all tracks from manifest
 */
async function embedMetadataFromManifest(manifestPath) {
    try {
        if (!fs.existsSync(manifestPath)) {
            console.error(`[Embedder] Manifest not found: ${manifestPath}`);
            process.exit(1);
        }

        const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const downloadDir = manifestData.music_download_path;
        const tracks = manifestData.Tracks || [];

        console.log(`[Embedder] Processing ${tracks.length} tracks...`);

        let embedded = 0;
        let failed = 0;

        for (const track of tracks) {
            try {
                // Find the MP3 file for this track
                let filePath = track.local_file_path;
                
                // If no stored path, try to build it from track info
                if (!filePath) {
                    const trackNum = String(track.number || 0).padStart(2, '0');
                    const safeTitle = (track.title || 'Unknown')
                        .replace(/[<>:"|?*\\/]/g, ' ')
                        .substring(0, 50);
                    
                    const sessionId = manifestData.session_id || 'unknown';
                    const filename = `${trackNum} - ${safeTitle} - ${sessionId}.mp3`;
                    filePath = path.join(downloadDir, filename);
                }
                
                // Normalize path: convert forward slashes to backslashes on Windows
                filePath = path.normalize(filePath);

                if (fs.existsSync(filePath)) {
                    const metadata = {
                        track_title: track.title,
                        artist: track.artist || manifestData.Primary_Artist,
                        album: manifestData.Album_Title,
                        album_artist: manifestData.Album_Artist || manifestData.Primary_Artist,
                        release_date: manifestData.Release_Date,
                        track_number: track.number,
                        track_total: tracks.length,
                        disc_number: manifestData.disc_number || '1/1',
                        genre: manifestData.genre,
                        publisher: manifestData.publisher,
                        composer: track.composer || (manifestData.composers && manifestData.composers[0]) || manifestData.Primary_Artist,
                        copyright_text: manifestData.Copyright_Statement,
                        encoded_by: manifestData.encoded_by || 'iPod Classic Tool v3',
                        comments: manifestData.comments || manifestData.Note_on_Missing_Data,
                        mood: manifestData.mood,
                        grouping: manifestData.group_description,
                        contributing_artist: track.contributing_artist || (manifestData.contributing_artist && manifestData.contributing_artist.join(', ')),
                        conductors: manifestData.conductors && manifestData.conductors[0],
                        cover_url: manifestData.Cover_Art_URL,
                        source_url: manifestData.Source_URL,
                        isrc: track.isrc || (manifestData.ISRC_Available ? track.isrc : null)
                    };

                    const success = await embedMetadataIntoTrack(filePath, metadata);
                    success ? embedded++ : failed++;
                } else {
                    console.warn(`[Embedder] ❌ Track file not found for: "${track.title}"`);
                    console.warn(`[Embedder]    Expected path: ${filePath}`);
                    console.warn(`[Embedder]    Track status: ${track.status || 'unknown'}`);
                    
                    // Show what files ARE in the directory to help debug
                    const actualFiles = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp3'));
                    if (actualFiles.length > 0) {
                        console.warn(`[Embedder]    Available MP3 files in directory:`);
                        actualFiles.forEach(f => console.warn(`[Embedder]      - ${f}`));
                    } else {
                        console.warn(`[Embedder]    No MP3 files found in directory!`);
                    }
                    
                    failed++;
                }
            } catch (err) {
                console.error(`[Embedder] ❌ Error processing track "${track.title || 'Unknown'}": ${err.message}`);
                console.error(`[Embedder]    Stack: ${err.stack}`);
                failed++;
            }
        }

        console.log(`[Embedder] ✅ Complete: ${embedded} embedded, ${failed} failed`);

    } catch (err) {
        console.error(`[Embedder] Fatal error: ${err.message}`);
    }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const manifestPath = process.argv[2];
    if (!manifestPath) {
        console.error('Usage: node embed_from_manifest.js <manifest_path>');
    } else {
        embedMetadataFromManifest(manifestPath);
    }
}

export { embedMetadataFromManifest, embedMetadataIntoTrack };
