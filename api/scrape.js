const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

// ★★★ 최종 수정: 최신 라이브러리 및 Vercel 환경을 위한 '안전모드' 실행 옵션 적용 ★★★
async function getBrowserInstance() {
  console.log("Locating Chromium executable path...");
  // Vercel 환경에서는 특정 경로에 브라우저가 위치하므로, 해당 경로를 직접 지정해줄 수 있습니다.
  const executablePath = await chromium.executablePath() || '/usr/bin/chromium-browser';
  console.log(`Executable path found: ${executablePath}`);

  if (!executablePath) {
    throw new Error("Chromium executable not found. The library might have failed to download it.");
  }

  // Vercel과 같은 제한된 환경에서 안정성을 높이는 '안전모드' 옵션을 명시적으로 추가합니다.
  const browserArgs = [
    ...chromium.args,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--single-process'
  ];

  console.log("Launching Puppeteer with safety arguments...");
  const browser = await puppeteer.launch({
    args: browserArgs,
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath,
    headless: 'new',
    ignoreHTTPSErrors: true,
  });
  console.log("Puppeteer launched successfully.");
  return browser;
}

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  let browser = null;
  try {
    console.log("헤드리스 브라우저 실행 시작 (최신 안정 버전)...");
    browser = await getBrowserInstance();
    const page = await browser.newPage();
    
    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`페이지로 이동 중: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log("페이지 로딩 완료.");

    console.log(`Lot 번호 입력: ${lot_no}`);
    await page.type('input[name="lot_no"]', lot_no);
    
    console.log("검색 버튼 클릭 및 결과 페이지 대기...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button.btn-lot-search'), 
    ]);
    console.log("결과 페이지 로딩 완료.");

    const pageContent = await page.content();

    if (pageContent.includes("lot_no를 확인하여 주십시요")) {
      console.log(`'결과 없음' 감지: Lot No - ${lot_no}`);
      return res.status(200).json([]);
    }
    
    const $ = cheerio.load(pageContent);
    const resultTable = $('div.box-body table.table-lot-view');
    const results = [];

    if (resultTable.length > 0) {
      console.log("데이터 테이블 발견. 파싱 시작...");
      resultTable.find('tbody tr').each((i, elem) => {
        const tds = $(elem).find('td');
        if (tds.length === 5) {
          results.push({
            item: $(tds[0]).text().trim(),
            spec: $(tds[1]).text().trim(),
            unit: $(tds[2]).text().trim(),
            method: $(tds[3]).text().trim(),
            result: $(tds[4]).text().trim(),
          });
        }
      });
      console.log(`데이터 파싱 완료. ${results.length}개의 항목 발견.`);
    } else {
      console.log("경고: 결과 페이지는 받았으나, 데이터 테이블을 찾을 수 없습니다.");
    }
    
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json(results);

  } catch (error) {
    console.error('헤드리스 브라우저 처리 중 최종 오류 발생:', error.message);
    res.status(500).json({ error: 'Failed to process the request with headless browser.', details: error.message });
  } finally {
    if (browser !== null) {
      await browser.close();
      console.log("브라우저 종료 완료.");
    }
  }
};

