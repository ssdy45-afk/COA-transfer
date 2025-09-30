const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite'); // 한글 인코딩(EUC-KR) 변환을 위한 라이브러리

/**
 * EUC-KR로 인코딩된 웹사이트를 스크래핑하기 위한 axios 인스턴스를 생성합니다.
 * reponseType을 'arraybuffer'로 설정하여 데이터가 텍스트로 자동 변환되며 깨지는 것을 방지합니다.
 */
const createScraperInstance = () => {
  return axios.create({
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
  });
};

// Vercel 서버리스 함수의 메인 핸들러
module.exports = async (req, res) => {
  // 프론트엔드에서 보낸 lot_no 값을 가져옵니다.
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  const scraper = createScraperInstance();
  const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
  
  // 덕산 사이트는 POST 방식으로 데이터를 요청해야 합니다.
  // URLSearchParams를 사용하여 'lot_no=P12345'와 같은 형식의 데이터를 만듭니다.
  const formData = new URLSearchParams();
  formData.append('lot_no', lot_no);

  try {
    // 생성한 axios 인스턴스를 사용하여 덕산 사이트에 POST 요청을 보냅니다.
    const response = await scraper.post(targetUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
      },
    });

    // EUC-KR로 인코딩된 응답 데이터를 UTF-8(우리가 사용하는 표준)로 디코딩합니다.
    const decodedHtml = iconv.decode(response.data, 'EUC-KR');
    
    // 디코딩된 HTML을 cheerio로 로드하여 jQuery처럼 다룰 수 있게 합니다.
    const $ = cheerio.load(decodedHtml);
    
    const results = [];
    // 덕산 사이트의 COA 결과 테이블 구조에 맞춰 데이터를 선택하고 추출합니다.
    // 'div.box-body table.table-lot-view tbody tr'는 결과 테이블의 각 행(row)을 가리킵니다.
    $('div.box-body table.table-lot-view tbody tr').each((i, elem) => {
      const tds = $(elem).find('td'); // 각 행(tr) 안의 모든 열(td)을 찾습니다.
      if (tds.length === 5) { // 열이 5개인 행만 데이터로 간주합니다.
        const item = {
          item: $(tds[0]).text().trim(),
          spec: $(tds[1]).text().trim(),
          unit: $(tds[2]).text().trim(),
          method: $(tds[3]).text().trim(),
          result: $(tds[4]).text().trim(),
        };
        results.push(item);
      }
    });

    // 브라우저가 이전 결과를 캐시(저장)하지 않도록 설정합니다.
    // 이를 통해 항상 최신 데이터를 조회할 수 있습니다.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 추출한 데이터를 JSON 형태로 프론트엔드에 응답합니다.
    res.status(200).json(results);

  } catch (error) {
    // 에러 발생 시 Vercel 서버 로그에 기록하고, 프론트엔드에는 에러 메시지를 보냅니다.
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

