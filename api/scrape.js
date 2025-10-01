// vercel.json에 함수 메모리 증가 설정이 필요함
const puppeteer = require('puppeteer');

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  let browser = null;

  try {
    console.log("Launching browser...");
    
    // Vercel 환경에 최적화된 설정
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ],
      headless: 'new',
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // 기본 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setDefaultTimeout(15000);
    await page.setDefaultNavigationTimeout(20000);

    console.log("Navigating to search page...");
    await page.goto('https://www.duksan.kr/product/pro_lot_search.php', {
      waitUntil: 'networkidle2'
    });

    console.log("Filling search form...");
    await page.type('input[name="lot_no"]', lot_no);

    console.log("Submitting form...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button.btn-lot-search')
    ]);

    console.log("Extracting results...");
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('div.box-body table.table-lot-view tbody tr');
      const data = [];
      
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 5) {
          data.push({
            item: cells[0].textContent.trim(),
            spec: cells[1].textContent.trim(),
            unit: cells[2].textContent.trim(),
            method: cells[3].textContent.trim(),
            result: cells[4].textContent.trim(),
          });
        }
      });
      
      return data;
    });

    // 결과 없음 확인
    const pageContent = await page.content();
    if (results.length === 0 && pageContent.includes("lot_no를 확인하여 주십시요")) {
      console.log("No results found");
      return res.status(200).json([]);
    }

    console.log(`Found ${results.length} results`);
    res.status(200).json(results);

  } catch (error) {
    console.error('Browser error:', error.message);
    res.status(500).json({ 
      error: 'Browser processing failed',
      message: error.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
