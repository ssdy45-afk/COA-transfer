const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

// 최신 라이브러리를 사용하여 Vercel 환경에 최적화된 브라우저 실행
async function getBrowserInstance() {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: "new", // 새로운 headless 모드 사용
    ignoreHTTPSErrors: true,
  });
}

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  let browser = null;
  try {
    console.log("헤드리스 브라우저 실행 시작 (최신 라이브러리 사용)...");
    browser = await getBrowserInstance();
    const page = await browser.newPage();
    
    const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
    console.log(`페이지로 이동 중: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    console.log("페이지 로딩 완료.");

    // Lot 번호를 입력하고 폼을 제출합니다.
    console.log(`Lot 번호 입력: ${lot_no}`);
    await page.type('input[name="lot_no"]', lot_no);
    
    console.log("검색 버튼 클릭 및 결과 페이지 대기...");
    // 클릭 후 페이지 이동을 기다립니다.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button.btn-lot-search'), 
    ]);
    console.log("결과 페이지 로딩 완료.");

    const pageContent = await page.content();

    // '결과 없음' 메시지를 먼저 확인합니다.
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

