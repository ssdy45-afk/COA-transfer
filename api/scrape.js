const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

async function getBrowserInstance() {
  console.log("Launching Puppeteer with chrome-aws-lambda...");
  
  try {
    // Chromium 실행 경로 명시적 확인
    const executablePath = await chromium.executablePath;
    console.log("Executable path:", executablePath);
    
    if (!executablePath) {
      throw new Error('Chromium executable not found');
    }

    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
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
      executablePath: executablePath,
      headless: true, // 명시적으로 true로 설정
      ignoreHTTPSErrors: true,
    });
    
    console.log("Puppeteer launched successfully");
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

    // User-Agent 설정 (중요)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // 리소스 제한
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // 타임아웃 설정
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(15000);

    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`Navigating to: ${targetUrl}`);

    const response = await page.goto(targetUrl, { 
      waitUntil: 'networkidle2',
      timeout: 25000
    });

    if (!response.ok()) {
      throw new Error(`Page load failed: ${response.status()}`);
    }

    console.log("Page loaded successfully");

    // 입력 필드 대기 및 값 설정
    await page.waitForSelector('input[name="lot_no"]', { timeout: 10000 });
    await page.focus('input[name="lot_no"]');
    await page.keyboard.type(lot_no, { delay: 100 });

    // 입력값 확인
    const inputValue = await page.$eval('input[name="lot_no"]', el => el.value);
    console.log("Input value confirmed:", inputValue);

    // 검색 실행
    console.log("Clicking search button...");
    
    // 네비게이션 대기 시작
    const navigationPromise = page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 25000
    });

    // 버튼 클릭
    await page.click('button.btn-lot-search');
    
    // 네비게이션 완료 대기
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

    const table = $('div.box-body table.table-lot-view');
    if (table.length === 0) {
      console.log("No result table found");
      return res.status(200).json([]);
    }

    table.find('tbody tr').each((index, element) => {
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(results);

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      lot_no: lot_no
    });

    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message,
      suggestion: 'Please try again with a different lot number'
    });

  } finally {
    // 리소스 정리 (에러 핸들링 추가)
    try {
      if (page) await page.close();
    } catch (e) {
      console.error("Error closing page:", e);
    }
    
    try {
      if (browser) await browser.close();
    } catch (e) {
      console.error("Error closing browser:", e);
    }
    
    console.log("Cleanup completed");
  }
};
