# Testing Plan - iPod Classic Tool v3

## ✅ Completed Tests

### Windows (Primary Development)
- [x] **App Launch**: Successfully starts with Electron
- [x] **Syntax Validation**: All modified files pass Node.js syntax check
  - ✅ `scripts/downloader.js`
  - ✅ `utils/yt-dlp-manager.js`
  - ✅ `scripts/postinstall.js`
- [x] **Dependencies**: npm install works correctly
- [x] **Platform Detection**: Correctly identifies Windows platform

### Code Quality
- [x] **No Breaking Changes**: All modifications backward compatible
- [x] **Proper Imports**: All modules correctly imported
- [x] **Auto-Download Logic**: yt-dlp-manager handles missing binary gracefully

---

## Recommended Testing Checklist

### Functional Tests

#### YouTube Metadata
- [ ] Fetch metadata from YouTube Music URL
- [ ] Verify album title extraction (should be "Outer Peace", not "140K subscribers")
- [ ] Verify cover art extraction (should be googleusercontent URL)
- [ ] Verify artist and track name extraction
- [ ] Verify duration extraction

#### YouTube Downloading
- [ ] Test with system yt-dlp installed
- [ ] Test with missing yt-dlp (should auto-download)
- [ ] Verify download progress reporting
- [ ] Verify MP3 file creation

#### Metadata from Other Sources
- [ ] Spotify metadata extraction
- [ ] Apple Music metadata extraction
- [ ] Amazon Music metadata extraction
- [ ] Tidal metadata extraction

#### File Processing
- [ ] Upload/process manifest files
- [ ] Verify metadata embedding in MP3s
- [ ] Test album art embedding

---

## Platform-Specific Testing

### Windows 10/11
- [ ] App installation via installer
- [ ] Auto-download of yt-dlp on first YouTube download
- [ ] UI responsiveness
- [ ] File operations (downloads, metadata)

### macOS (Intel & Apple Silicon)
- [ ] App launch on macOS
- [ ] yt-dlp auto-download (correct binary for architecture)
- [ ] File permissions for downloaded binaries
- [ ] UI scaling on Retina displays

### Linux (Ubuntu/Debian/Fedora)
- [ ] App launch via AppImage
- [ ] yt-dlp auto-download
- [ ] File permissions
- [ ] Audio processing compatibility

---

## Test Data

### Sample URLs for Testing

**YouTube Music:**
- Track: https://www.youtube.com/watch?v=XOe-Nw2xLKk (Toro y Moi - Who I Am)
  - Expected: Album "Outer Peace", Artist "Toro y Moi"

---

## Known Issues & Workarounds

None currently identified.

---

## Sign-Off

- **Last Updated**: 2025-12-30
- **Platform**: Windows 10/11 (development)
- **Node.js Version**: 16+
- **Status**: ✅ Ready for multi-platform testing
