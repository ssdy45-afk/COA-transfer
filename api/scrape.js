const { chromium } = require('playwright'); // 'playwright-core'에서 'playwright'로 변경
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { lot_no } = req.query;
  console.log("Received request for lot_no:", lot_no);

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  let browser = null;
  let page = null;

  try {
    console.log("Starting browser instance with Playwright...");
    
    // Playwright 브라우저 실행
    browser = await chromium.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    
    page = await browser.newPage();
    
    // 타임아웃 설정
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`Navigating to: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    console.log("Page loaded successfully");

    // 입력 필드에 값 설정
    await page.fill('input[name="lot_no"]', lot_no);
    console.log("Lot number filled");

    // 검색 실행
    console.log("Clicking search button...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button.btn-lot-search')
    ]);

    console.log("Search completed, parsing results...");
    const content = await page.content();

    // 결과 분석
    if (content.includes("lot_no를 확인하여 주십시요")) {
      console.log("No results found");
      return res.status(200).json([]);
    }

    const $ = cheerio.load(content);
    const results = [];

    $('div.box-body table.table-lot-view tbody tr').each((index, element) => {
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

    console.log(`Found ${results.length} results`);
    res.status(200).json(results);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message
    });
  } finally {
    if (page) await page.close().catch(console.error);
    if (browser) await browser.close().catch(console.error);
  }
};
