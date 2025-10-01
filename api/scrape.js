const axios = require('axios');
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

  try {
    console.log("Step 1: Getting search page...");
    
    // 먼저 검색 페이지를 GET으로 가져와서 필요한 정보 확인
    const getResponse = await axios.get('https://www.duksan.kr/product/pro_lot_search.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
    });

    console.log("GET page status:", getResponse.status);
    
    // 쿠키 저장 (세션 유지)
    const cookies = getResponse.headers['set-cookie'];
    
    console.log("Step 2: Submitting search form...");
    
    // POST 요청으로 검색
    const postResponse = await axios.post(
      'https://www.duksan.kr/product/pro_lot_search.php',
      `lot_no=${encodeURIComponent(lot_no)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Origin': 'https://www.duksan.kr',
          'Referer': 'https://www.duksan.kr/product/pro_lot_search.php',
          'Cookie': cookies ? cookies.join('; ') : '',
        },
        timeout: 15000,
        maxRedirects: 0, // 리다이렉트 자동 추적 안함
        validateStatus: function (status) {
          return status >= 200 && status < 400; // 리다이렉트 상태코드도 허용
        }
      }
    );

    console.log("POST response status:", postResponse.status);
    console.log("Response URL:", postResponse.request?.res?.responseUrl);

    const $ = cheerio.load(postResponse.data);
    const results = [];

    // 결과 테이블 파싱
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

    // 결과 없음 확인
    if (results.length === 0) {
      if (postResponse.data.includes("lot_no를 확인하여 주십시요")) {
        console.log("No results found - specific message detected");
      } else {
        console.log("No results found in table");
      }
      return res.status(200).json([]);
    }

    console.log(`Found ${results.length} results`);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(results);

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      lot_no: lot_no,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });

    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message,
      suggestion: 'The website might have changed or requires JavaScript execution'
    });
  }
};
