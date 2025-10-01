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

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lot_no } = req.query;
  console.log("Received request for lot_no:", lot_no);

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  // Lot 번호 유효성 검사
  if (!/^[A-Z0-9]+$/.test(lot_no)) {
    return res.status(400).json({ error: 'Invalid lot number format' });
  }

  try {
    console.log("Fetching analysis certificate...");
    
    const url = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log("Target URL:", url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000,
      validateStatus: function (status) {
        return status >= 200 && status < 500; // 404도 허용
      }
    });

    console.log("Response status:", response.status);
    console.log("Content length:", response.data?.length);

    if (response.status === 404) {
      return res.status(404).json({ 
        error: 'Analysis certificate not found',
        message: `No certificate found for lot number: ${lot_no}`
      });
    }

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.data || response.data.length < 100) {
      throw new Error('Empty or invalid response from server');
    }

    const $ = cheerio.load(response.data);
    
    // 페이지에 데이터가 있는지 확인
    if ($('body').text().includes('Certificate of Analysis')) {
      console.log("Certificate page found, parsing data...");
    } else {
      console.log("Warning: Certificate page structure may have changed");
    }

    const results = [];

    // 테이블 데이터 추출 - 더 유연한 선택자 사용
    $('table tr').each((index, element) => {
      const $row = $(element);
      const $cells = $row.find('td');
      
      // 4개 또는 5개 컬럼인 테이블 행 처리
      if ($cells.length >= 4) {
        const rowData = {
          test: $cells.eq(0).text().trim().replace(/\s+/g, ' '),
          unit: $cells.eq(1).text().trim().replace(/\s+/g, ' '),
          specification: $cells.eq(2).text().trim().replace(/\s+/g, ' '),
          result: $cells.eq(3).text().trim().replace(/\s+/g, ' '),
        };
        
        // 빈 행이 아닌 경우만 추가
        if (rowData.test || rowData.result) {
          results.push(rowData);
        }
      }
    });

    // 제품 정보 추출 시도
    const productName = $('h1, h2').first().text().trim() || 'Unknown Product';
    
    // Product code 찾기
    let productCode = '';
    $('strong').each((i, el) => {
      const text = $(el).text();
      if (text.includes('Product code') || text.includes('Product Code')) {
        productCode = $(el).parent().text().replace(/Product code\.?/i, '').trim();
      }
    });

    const responseData = {
      success: true,
      product: {
        name: productName,
        code: productCode,
        lotNumber: lot_no
      },
      tests: results,
      raw: {
        url: url,
        status: response.status
      }
    };

    console.log(`Successfully parsed ${results.length} test results`);
    
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Detailed error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    // 더 구체적인 에러 메시지
    let errorMessage = 'Failed to fetch analysis certificate';
    let statusCode = 500;

    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Cannot connect to the website';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout';
    } else if (error.response) {
      errorMessage = `Website returned error: ${error.response.status}`;
      statusCode = error.response.status;
    }

    res.status(statusCode).json({ 
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
