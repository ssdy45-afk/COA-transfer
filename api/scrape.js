const axios = require('axios');
const https = require('https');
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

  if (!/^[A-Z0-9]+$/.test(lot_no)) {
    return res.status(400).json({ error: 'Invalid lot number format' });
  }

  try {
    console.log("Fetching analysis certificate...");
    
    const targetUrl = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log("Target URL:", targetUrl);

    // 프록시 URL (CORS-anywhere) - 공개 프록시 사용
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/' + targetUrl;
    // 참고: CORS-anywhere는 데모 서버로, production에서는 사용하지 않는 것이 좋습니다.
    // 대체 프록시: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl)

    // 최적화된 HTTPS agent
    const httpsAgent = new https.Agent({
      keepAlive: false,
      timeout: 10000, // 10초
      rejectUnauthorized: false,
    });

    // 요청 설정
    const config = {
      httpsAgent: httpsAgent,
      timeout: 10000, // 10초 타임아웃
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'Pragma': 'no-cache',
      },
      maxRedirects: 3,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    };

    // 직접 요청 시도
    let response;
    try {
      response = await axios.get(targetUrl, config);
    } catch (directError) {
      console.log('Direct request failed, trying proxy...', directError.message);
      // 직접 요청 실패 시 프록시 시도
      try {
        response = await axios.get(proxyUrl, {
          ...config,
          headers: {
            ...config.headers,
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
      } catch (proxyError) {
        throw new Error(`Direct and proxy requests failed: ${directError.message}, ${proxyError.message}`);
      }
    }

    console.log("Response received, status:", response.status);
    console.log("Content length:", response.data.length);

    if (response.status === 404) {
      return res.status(404).json({ 
        success: false,
        error: 'Analysis certificate not found',
        message: `No certificate found for lot number: ${lot_no}`
      });
    }

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const $ = cheerio.load(response.data);
    const results = [];

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
        
        if (rowData.test && rowData.result) {
          results.push(rowData);
        }
      }
    });

    const productName = $('h1:contains("Certificate of Analysis")').next('h2').text().trim() || 
                       $('h2:contains("Certificate of Analysis")').next('h3').text().trim() ||
                       'Unknown Product';

    let productCode = '';
    $('strong').each((i, el) => {
      const text = $(el).text();
      if (text.includes('Product code') || text.includes('Product Code')) {
        productCode = text.replace(/Product code\.?/i, '').trim();
        if (!productCode) {
          productCode = $(el).parent().text().replace(/Product code\.?/i, '').trim();
        }
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
      count: results.length
    };

    console.log(`Successfully parsed ${results.length} test results`);
    
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code
    });

    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({ 
        success: false,
        error: 'Request timeout',
        message: 'The website took too long to respond. Please try again.',
        suggestion: 'This might be temporary. Wait a moment and try again.'
      });
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        success: false,
        error: 'Service unavailable',
        message: 'Cannot connect to the website. It might be down or blocking requests.'
      });
    }

    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch analysis certificate',
      message: error.message
    });
  }
};
