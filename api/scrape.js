const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

async function getBrowserInstance() {
  console.log("Launching Puppeteer with chromium-min...");
  
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    defaultViewport: {
      width: 1280,
      height: 720
    },
    executablePath: await chromium.executablePath(),
    headless: true,
    ignoreHTTPSErrors: true,
  });
  
  console.log("Puppeteer launched successfully");
  return browser;
}

// 나머지 코드는 동일하게 유지
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
    return res.status(400).json({ 
      error: 'lot_no query parameter is required'
    });
  }

  let browser = null;
  let page = null;
  
  try {
    console.log("Starting browser instance...");
    browser = await getBrowserInstance();
    page = await browser.newPage();
    
    // 리소스 제한
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'font', 'stylesheet'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // 타임아웃 설정
    await page.setDefaultNavigationTimeout(20000);
    await page.setDefaultTimeout(15000);

    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`Navigating to: ${targetUrl}`);
    
    await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    
    console.log("Page loaded successfully");
    
    // 입력 필드에 값 설정
    await page.waitForSelector('input[name="lot_no"]', { timeout: 5000 });
    await page.$eval('input[name="lot_no"]', (input, value) => {
      input.value = value;
    }, lot_no);
    
    // 검색 실행
    console.log("Clicking search button...");
    const navigationPromise = page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    
    await page.click('button.btn-lot-search');
    await navigationPromise;
    
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
      const $row = $(element);
      const $cells = $row.find('td');
      
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
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(results);
    
  } catch (error) {
    console.error('Error:', error.message);
    
    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message
    });
    
  } finally {
    // 리소스 정리
    if (page) await page.close().catch(console.error);
    if (browser) await browser.close().catch(console.error);
  }
};
