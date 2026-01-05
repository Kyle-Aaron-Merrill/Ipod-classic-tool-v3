import { getYoutubeMusicAlbumMeta } from './scripts/library_scripts/yt_music_album_meta_fetcher.js';
import fs from 'fs';
import path from 'path';

const playlistId = 'OLAK5uy_nmMzIsNgJfBDYiPrupF45tSFGLzi6g44o';
const testManifestPath = 'test_manifest_output.json';

console.log('Testing YouTube Music Album Fetcher with playlist:', playlistId);
console.log('================================\n');

// Create a test manifest first
const testManifest = {
    session_id: 'test-session',
    source_url: `https://music.youtube.com/playlist?list=${playlistId}`,
    metadata: {}
};

fs.writeFileSync(testManifestPath, JSON.stringify(testManifest, null, 2));
console.log('Created test manifest at:', testManifestPath);

try {
    await getYoutubeMusicAlbumMeta(playlistId, testManifestPath);
    console.log('\n✅ Fetcher completed successfully');
    
    // Read the updated manifest
    const updatedManifest = JSON.parse(fs.readFileSync(testManifestPath, 'utf8'));
    console.log('\nUpdated manifest:');
    console.log(JSON.stringify(updatedManifest, null, 2));
} catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
} finally {
    // Cleanup
    if (fs.existsSync(testManifestPath)) {
        fs.unlinkSync(testManifestPath);
    }
}
