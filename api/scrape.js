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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      }
    );

    console.log("Response received, parsing results...");
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
    if (results.length === 0 && response.data.includes("lot_no를 확인하여 주십시요")) {
      console.log("No results found");
      return res.status(200).json([]);
    }

    console.log(`Found ${results.length} results`);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(results);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message
    });
  }
};
