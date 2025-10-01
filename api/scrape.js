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
    console.log("Fetching analysis certificate with optimized request...");
    
    const url = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log("Target URL:", url);

    // 더 빠른 DNS lookup을 위한 설정
    const httpsAgent = new (require('https').Agent)({
      keepAlive: true,
      maxSockets: 1,
      timeout: 8000,
    });

    const response = await axios.get(url, {
      httpsAgent: httpsAgent,
      timeout: 8000, // 8초로 단축 (Vercel 제한 고려)
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Connection': 'close', // keep-alive 대신 close
      },
      maxRedirects: 2,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    console.log("Response received, status:", response.status);

    if (response.status === 404) {
      return res.status(404).json({ 
        error: 'Analysis certificate not found',
        message: `No certificate found for lot number: ${lot_no}`
      });
    }

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const $ = cheerio.load(response.data);
    const results = [];

    // 테이블 데이터 추출
    $('table tr').each((index, element) => {
      const $row = $(element);
      const $cells = $row.find('td');
      
      if ($cells.length >= 4) {
        const rowData = {
          test: $cells.eq(0).text().trim(),
          unit: $cells.eq(1).text().trim(),
          specification: $cells.eq(2).text().trim(),
          result: $cells.eq(3).text().trim(),
        };
        
        if (rowData.test || rowData.result) {
          results.push(rowData);
        }
      }
    });

    const responseData = {
      success: true,
      product: {
        lotNumber: lot_no,
      },
      tests: results,
    };

    console.log(`Successfully parsed ${results.length} test results`);
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error:', error.message);

    // 타임아웃 에러인 경우
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({ 
        error: 'Request timeout',
        message: 'The website took too long to respond. Please try again.',
        suggestion: 'This might be due to network latency or the website being temporarily slow.'
      });
    }

    res.status(500).json({ 
      error: 'Failed to fetch analysis certificate',
      message: error.message
    });
  }
};
