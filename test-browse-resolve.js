import puppeteer from "puppeteer";
import PuppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getPuppeteerLaunchOptions } from './utils/puppeteer-config.js';

/**
 * Resolves a browse/redirect link by opening it in Puppeteer and capturing the final URL.
 */
async function resolveBrowseLink(initialUrl) {
    console.log(`[Test] Resolving browse link: ${initialUrl}`);
    let browser = null;
    
    try {
        const launchOptionsBrowse = getPuppeteerLaunchOptions('resolve-browse');
        // Use newer Puppeteer headless mode (chrome-headless-shell) for better rendering
        launchOptionsBrowse.headless = 'new';
        launchOptionsBrowse.dumpio = true;
        launchOptionsBrowse.args = launchOptionsBrowse.args.filter(arg => 
            arg !== '--disable-gpu' && !arg.includes('IsolateOrigins')
        );
        console.log('[Test] Override launch options:', {
            headless: launchOptionsBrowse.headless,
            dumpio: launchOptionsBrowse.dumpio,
            argsCount: launchOptionsBrowse.args.length
        });
        
        // Use Puppeteer Extra with stealth plugin
        PuppeteerExtra.use(StealthPlugin());
        browser = await PuppeteerExtra.launch(launchOptionsBrowse);
        const page = await browser.newPage();
        
        // Set realistic viewport
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log(`[Test] Navigating to: ${initialUrl}`);
        await page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        console.log(`[Test] Initial URL after navigation: ${await page.url()}`);
        
        // Wait a bit for page to fully load and render
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Try to extract playlist ID from page data instead of waiting for URL change
        console.log(`[Test] Extracting playlist ID from page data...`);
        const playlistId = await page.evaluate(() => {
            // Try multiple ways to find the playlist link
            // 1. Look for links with list parameter
            const links = Array.from(document.querySelectorAll('a[href*="list="]'));
            if (links.length > 0) {
                console.log(`Found ${links.length} playlist links`);
                const url = new URL(links[0].href);
                return url.searchParams.get('list');
            }
            
            // 2. Try to find from page metadata or data attributes
            const pageData = document.querySelector('[data-content]');
            if (pageData && pageData.textContent) {
                const matches = pageData.textContent.match(/list[=_]([A-Z0-9]+)/i);
                if (matches) return matches[1];
            }
            
            // 3. Check window object for playlist info
            if (window.ytInitialData) {
                const jsonStr = JSON.stringify(window.ytInitialData);
                const matches = jsonStr.match(/"list":"([A-Z0-9]+)"/);
                if (matches) return matches[1];
            }
            
            return null;
        });
        
        if (playlistId) {
            const resolvedUrl = `https://music.youtube.com/playlist?list=${playlistId}`;
            console.log(`[Test] ✅ Extracted playlist ID: ${playlistId}`);
            return resolvedUrl;
        }
        
        // Fallback: try URL change with longer timeout
        console.log(`[Test] No playlist ID found on page, waiting for URL change...`);
        try {
            await page.waitForFunction(() => {
                return !window.location.href.includes('/browse/');
            }, { timeout: 8000 });
            
            const resolvedUrl = await page.url();
            console.log(`[Test] ✅ Resolved to: ${resolvedUrl}`);
            return resolvedUrl;
        } catch (waitErr) {
            console.log(`[Test] URL didn't change within timeout`);
            return initialUrl;
        }
    } catch (e) {
        console.error(`[Test] ❌ Resolution failed: ${e.message}`);
        console.error(`[Test] Stack: ${e.stack}`);
        return initialUrl;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeErr) {
                console.warn(`[Test] Browser close error: ${closeErr.message}`);
            }
        }
    }
}

// Test the function
const testUrl = "https://music.youtube.com/browse/MPREb_B5Bxo8K3VHL";
console.log(`\n🧪 Testing resolveBrowseLink\n`);
console.log(`Input URL: ${testUrl}\n`);

resolveBrowseLink(testUrl).then(result => {
    console.log(`\n✅ Test completed!`);
    console.log(`Result: ${result}`);
    process.exit(0);
}).catch(err => {
    console.error(`\n❌ Test failed: ${err.message}`);
    process.exit(1);
});
