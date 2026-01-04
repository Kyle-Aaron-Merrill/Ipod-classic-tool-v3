# iPod Classic Tool v3

Desktop Electron app that pulls metadata for music (YouTube Music, Spotify, Apple Music, Amazon Music, Tidal), enriches with GPT, normalizes tags, and downloads ready-to-sync files for your iPod Classic.

## What's inside
- Electron UI (start with npm start or packaged installer)
- Puppeteer-based metadata fetchers for all services
- yt-dlp integration (auto-downloads on first use)
- Metadata embedding (node-id3, sharp for covers)
- GPT enrichment pipeline

## Install
### Packaged app (recommended)
- Windows: use dist/iPod Classic Tool Setup 3.0.0.exe (installer) or dist/iPod Classic Tool-3.0.0-portable.exe (no install)
- macOS/Linux: build locally (see Build). Default icon is used if none is set.

### From source (dev/test)
```bash
npm install
npm start
```
Requires Node.js 16+.

## Build
- Windows: npm run build:win
- macOS: npm run build:mac
- Linux: npm run build:linux
- All: npm run build:all

Outputs go to dist/ (installer + portable). Uninstall old versions before installing a new build.

## Run pipeline (what happens)
1) Manifest + metadata fetch (Puppeteer)
2) GPT enrichment
3) Normalization
4) Manifest update with yt-dlp link
5) Download + embed

## Troubleshooting
- Puppeteer timeouts on Windows: fetchers now have launch/nav timeouts; errors log and skip instead of crashing.
- Link converter in packaged apps: asar-safe path handling is built-in.
- Cookie exporter: now forked directly (no npx), with timeout and detailed logs.
- If npm fails: delete node_modules and package-lock.json, then npm install.

## Logs
App log lives in the Electron userData dir (e.g., %APPDATA%/metadata-filler-v3/app.log on Windows). Enhanced logging is enabled for cookie exporter, link converter, and per-track pipelines (unique job IDs).

## Support checklist
- Node.js >= 16+
- First run from source: npm install, npm start
- First packaged run: use the latest dist installer
- For YouTube downloads: yt-dlp auto-downloads; optional manual install if desired.
