const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

async function getBrowserInstance() {
  console.log("Launching Puppeteer with @sparticuz/chromium (Vercel optimized)...");

  try {
    const executablePath = await chromium.executablePath();
    console.log("Executable path found:", !!executablePath);

    if (!executablePath) {
      throw new Error('Chromium executable not found via @sparticuz/chromium');
    }

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    
    console.log("Puppeteer launched successfully with @sparticuz/chromium");
    return browser;
  } catch (error) {
    console.error("Browser launch error:", error);
    throw error;
  }
}

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lot_no } = req.query;
  console.log("Received request for lot_no:", lot_no);

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  let browser = null;
  let page = null;

  try {
    console.log("Starting browser instance...");
    browser = await getBrowserInstance();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
    
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'font', 'stylesheet', 'media'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(20000);

    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`Navigating to: ${targetUrl}`);

    const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    if (!response || !response.ok()) {
      throw new Error(`Page load failed: ${response ? response.status() : 'no response'}`);
    }
    console.log("Page loaded successfully");

    await page.waitForSelector('input[name="lot_no"]', { timeout: 10000 });
    await page.focus('input[name="lot_no"]');
    await page.keyboard.type(lot_no, { delay: 50 });

    console.log("Clicking search button...");
    const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    await page.click('button.btn-lot-search');
    await navigationPromise;
    console.log("Search completed, parsing results...");

    const content = await page.content();
    if (content.includes("lot_no를 확인하여 주십시요")) {
      console.log("No results found for the given lot_no.");
      return res.status(200).json([]);
    }

    const $ = cheerio.load(content);
    const results = [];
    const table = $('div.box-body table.table-lot-view');

    if (table.length === 0) {
      console.log("Result table not found on the page.");
      return res.status(200).json([]);
    }

    table.find('tbody tr').each((index, element) => {
      const $cells = $(element).find('td');
      if ($cells.length === 5) {
        results.push({
          item: $cells.eq(0).text().trim(),
          spec: $cells.eq(1).text().trim(),
          unit: $cells.eq(2).text().trim(),
          method: $cells.eq(3).text().trim(),
          result: $cells.eq(4).text().trim(),
        });
      }
    });
    console.log(`Found ${results.length} results.`);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(results);

  } catch (error) {
    console.error('Error details:', error.message);
    res.status(500).json({ error: 'Processing failed', message: error.message });
  } finally {
    if (page) await page.close().catch(e => console.error("Error closing page:", e));
    if (browser) await browser.close().catch(e => console.error("Error closing browser:", e));
  }
};
