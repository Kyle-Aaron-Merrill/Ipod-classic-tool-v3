import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '../utils/puppeteer-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(...args) {
  console.log('[PuppeteerTest]', ...args);
}

function pathExists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function bytesToHuman(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function dirSize(p) {
  let total = 0;
  if (!pathExists(p)) return 0;
  const stack = [p];
  while (stack.length) {
    const current = stack.pop();
    const stats = fs.statSync(current);
    if (stats.isFile()) total += stats.size;
    else if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    }
  }
  return total;
}

function removeDir(target, force) {
  if (!pathExists(target)) return { removed: false, reason: 'not-found' };
  if (!force) return { removed: false, reason: 'dry-run' };
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: true };
}

const isForce = process.argv.includes('--force');
const isVerbose = process.argv.includes('--verbose');

async function main() {
  log('Starting Puppeteer sanity test');
  log('Node version:', process.version);
  log('CWD:', process.cwd());
  log('Headless env PUPPETEER_HEADLESS =', process.env.PUPPETEER_HEADLESS ?? '(unset)');

  const userHome = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');

  // Known Chromium/Chrome caches used by Puppeteer across versions
  const candidates = [
    { label: 'project build/chrome', path: path.join(process.cwd(), 'build', 'chrome') },
    { label: 'project node_modules/puppeteer/.local-chromium', path: path.join(process.cwd(), 'node_modules', 'puppeteer', '.local-chromium') },
    { label: 'project node_modules/.cache/puppeteer', path: path.join(process.cwd(), 'node_modules', '.cache', 'puppeteer') },
    { label: 'user ~/.cache/puppeteer (Linux/mac style)', path: path.join(userHome, '.cache', 'puppeteer') },
    { label: 'user %LOCALAPPDATA%/puppeteer (Windows)', path: path.join(localAppData, 'puppeteer') },
  ];

  log('Scanning known Chromium locations...');
  for (const c of candidates) {
    const exists = pathExists(c.path);
    const size = exists ? bytesToHuman(dirSize(c.path)) : 'n/a';
    console.log(`- ${c.label}: ${exists ? 'FOUND' : 'missing'}${exists ? `, size=${size}` : ''}`);
  }

  if (isForce) log('Force delete enabled: will remove found Chromium caches');
  else log('Dry-run (default): no deletions. Use --force to remove caches.');

  for (const c of candidates) {
    const res = removeDir(c.path, isForce);
    if (res.removed) console.log(`  removed: ${c.path}`);
    else if (res.reason === 'dry-run' && pathExists(c.path)) console.log(`  would remove: ${c.path}`);
  }

  // Ensure headless true by default for CI-type test unless explicitly disabled
  if (process.env.PUPPETEER_HEADLESS === undefined) process.env.PUPPETEER_HEADLESS = 'true';

  // Try launch with our options first
  log('Attempting to launch Puppeteer with project config...');
  const opts = getPuppeteerLaunchOptions('sanity-test');

  if (isVerbose) log('Launch options:', JSON.stringify({
    headless: opts.headless,
    executablePath: opts.executablePath || '(auto)',
    argsCount: (opts.args || []).length,
  }));

  let browser;
  try {
    browser = await puppeteer.launch(opts);
    const page = await browser.newPage();
    await page.goto('about:blank');
    const ua = await page.evaluate(() => navigator.userAgent);
    log('Launched successfully. UserAgent:', ua);
    const ver = await browser.version();
    log('Browser version:', ver);
    await browser.close();
    log('SUCCESS: Puppeteer can launch without preinstalled Chromium.');
    process.exit(0);
  } catch (err) {
    log('Launch failed with project config. Error:');
    console.error(err?.stack || err);
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }

  // Fallback: try without executablePath (let Puppeteer pick its default)
  log('Retrying with Puppeteer default (no executablePath)...');
  let browser2;
  try {
    const { executablePath, ...rest } = opts;
    browser2 = await puppeteer.launch(rest);
    const page = await browser2.newPage();
    await page.goto('about:blank');
    const ua = await page.evaluate(() => navigator.userAgent);
    log('Fallback launch succeeded. UserAgent:', ua);
    const ver = await browser2.version();
    log('Browser version:', ver);
    await browser2.close();
    log('SUCCESS: Puppeteer default launcher works.');
    process.exit(0);
  } catch (err) {
    log('Fallback launch failed. Error:');
    console.error(err?.stack || err);

    console.log('\nSuggested next steps:');
    console.log('- Run: npm run chrome:install   (downloads a managed Chrome)');
    console.log('- Or bundle Chrome under build/chrome/win64-*/chrome-win64/chrome.exe');
    console.log('- Ensure env PUPPETEER_EXECUTABLE_PATH is set if using a custom path');
    process.exit(1);
  } finally {
    if (browser2) { try { await browser2.close(); } catch {} }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
