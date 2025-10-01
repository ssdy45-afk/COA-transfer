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
    console.log("Making HTTP request to search...");
    
    // POST 요청으로 검색
    const response = await axios.post(
      'https://www.duksan.kr/product/pro_lot_search.php',
      `lot_no=${encodeURIComponent(lot_no)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Origin': 'https://www.duksan.kr',
          'Referer': 'https://www.duksan.kr/product/pro_lot_search.php'
        },
        timeout: 15000,
        maxRedirects: 5
      }
    );

    console.log("Response received, status:", response.status);
    console.log("Parsing results...");

    const $ = cheerio.load(response.data);
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
      if (response.data.includes("lot_no를 확인하여 주십시요")) {
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
      lot_no: lot_no
    });

    // 더 상세한 에러 정보
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    }

    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message,
      suggestion: 'Please check the lot number and try again'
    });
  }
};
