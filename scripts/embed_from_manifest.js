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
        
        const buffer = await response.buffer();
        
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

        // Prepare ID3 tags
        const tags = {
            title: metadata.track_title || 'Unknown',
            artist: metadata.artist || 'Unknown Artist',
            album: metadata.album || 'Unknown Album',
            albumArtist: metadata.album_artist || metadata.artist,
            date: metadata.release_date || '',
            genre: metadata.genre || '',
            TRCK: metadata.track_number || 0,
            TPOS: metadata.disc_number || '1/1',
            TCON: metadata.genre || '',
            TPUB: metadata.publisher || '',
            TCOM: metadata.composer || '',
            TCOP: metadata.copyright_text || '',
            TENC: metadata.encoded_by || 'iPod Classic Tool v3',
            TOPE: metadata.contributing_artist || '',
            TMCL: metadata.conductors ? `conductor/${metadata.conductors}` : '',
            TXXX: [
                {
                    description: 'mood',
                    value: metadata.mood || ''
                },
                {
                    description: 'grouping',
                    value: metadata.grouping || ''
                },
                {
                    description: 'parental_rating_reason',
                    value: metadata.parental_rating_reason || ''
                },
                {
                    description: 'source_url',
                    value: metadata.source_url || ''
                },
                {
                    description: 'isrc',
                    value: metadata.isrc || ''
                }
            ],
            COMM: {
                description: 'Comment',
                text: metadata.comments || ''
            },
            TRAT: metadata.rating ? String(metadata.rating) : ''
        };

        // Add cover art if available
        if (metadata.cover_url) {
            const imageBuffer = await downloadImageAsBuffer(metadata.cover_url);
            if (imageBuffer) {
                tags.APIC = {
                    mime: 'image/jpeg',
                    type: {
                        id: 3, // Front cover
                        name: 'front cover'
                    },
                    description: 'Cover Art',
                    imageBuffer: imageBuffer
                };
            }
        }

        // Write tags to file
        const success = NodeID3.write(tags, filePath);
        if (success) {
            console.log(`[Embedder] ✓ Embedded metadata into: ${path.basename(filePath)}`);
            return true;
        } else {
            console.warn(`[Embedder] Failed to write tags to: ${filePath}`);
            return false;
        }
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
                const trackNum = String(track.number || 0).padStart(2, '0');
                const safeTitle = (track.title || 'Unknown')
                    .replace(/[<>:"|?*]/g, '')
                    .substring(0, 50);
                
                const sessionId = manifestData.session_id || 'unknown';
                const filename = `${trackNum} - ${safeTitle} - ${sessionId}.mp3`;
                const filePath = path.join(downloadDir, filename);

                if (fs.existsSync(filePath)) {
                    const metadata = {
                        track_title: track.title,
                        artist: track.artist || manifestData.Primary_Artist,
                        album: manifestData.Album_Title,
                        album_artist: manifestData.Album_Artist || manifestData.Primary_Artist,
                        release_date: manifestData.Release_Date,
                        track_number: track.number,
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
                        parental_rating_reason: manifestData.parental_rating_reason,
                        rating: manifestData.rating,
                        cover_url: manifestData.Cover_Art_URL,
                        source_url: manifestData.Source_URL,
                        isrc: track.isrc || (manifestData.ISRC_Available ? track.isrc : null)
                    };

                    const success = await embedMetadataIntoTrack(filePath, metadata);
                    success ? embedded++ : failed++;
                } else {
                    console.warn(`[Embedder] Track file not found: ${filename}`);
                    failed++;
                }
            } catch (err) {
                console.error(`[Embedder] Error processing track: ${err.message}`);
                failed++;
            }
        }

        console.log(`[Embedder] ✅ Complete: ${embedded} embedded, ${failed} failed`);
        process.exit(0);

    } catch (err) {
        console.error(`[Embedder] Fatal error: ${err.message}`);
        process.exit(1);
    }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const manifestPath = process.argv[2];
    if (!manifestPath) {
        console.error('Usage: node embed_from_manifest.js <manifest_path>');
        process.exit(1);
    }
    embedMetadataFromManifest(manifestPath);
}

export { embedMetadataFromManifest, embedMetadataIntoTrack };
