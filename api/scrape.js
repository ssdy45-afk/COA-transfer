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

    // 최적화된 HTTPS agent
    const httpsAgent = new https.Agent({
      keepAlive: false,
      timeout: 15000,
      rejectUnauthorized: false,
    });

    // 요청 설정
    const config = {
      httpsAgent: httpsAgent,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
      },
      maxRedirects: 3,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    };

    let response;
    try {
      response = await axios.get(targetUrl, config);
    } catch (directError) {
      console.log('Direct request failed:', directError.message);
      // 프록시 URL 시도
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      try {
        response = await axios.get(proxyUrl, config);
      } catch (proxyError) {
        throw new Error(`All request methods failed: ${directError.message}`);
      }
    }

    console.log("Response received, status:", response.status);

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
        
        if (rowData.test && rowData.test !== 'TESTS' && rowData.test !== 'UNIT' && 
            rowData.test !== 'SPECIFICATION' && rowData.test !== 'RESULTS') {
          results.push(rowData);
        }
      }
    });

    // 제품명 추출 - 개선된 로직
    let productName = '';
    
    // 방법 1: Certificate of Analysis 다음 텍스트
    const coaText = $('body').text();
    const coaMatch = coaText.match(/Certificate of Analysis\s*([^\n\r]+)/i);
    if (coaMatch) {
      productName = coaMatch[1].trim();
    }
    
    // 방법 2: h1, h2 태그에서 추출
    if (!productName) {
      $('h1, h2, h3, b, strong').each((i, el) => {
        const text = $(el).text().trim();
        if (text && !text.includes('Certificate') && !text.includes('Analysis') && 
            !text.includes('REAGENTS') && !text.includes('DUKSAN') && text.length > 2) {
          // 숫자만 있는 경우 제외
          if (!/^\d+$/.test(text)) {
            productName = text;
            return false; // break
          }
        }
      });
    }

    // 방법 3: 테이블 앞의 텍스트에서 추출
    if (!productName) {
      const firstTable = $('table').first();
      const prevElements = firstTable.prevAll();
      prevElements.each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && !text.includes('Certificate') && 
            !text.includes('REAGENTS') && !/^\d+$/.test(text)) {
          productName = text;
          return false;
        }
      });
    }

    // 제품 코드 추출 - 개선된 로직
    let productCode = '';
    const codeMatch = coaText.match(/Product code\.?\s*(\d+)/i);
    if (codeMatch) {
      productCode = codeMatch[1];
    } else {
      // 대체 패턴 시도
      const altCodeMatch = coaText.match(/(?:code|Code)\s*[.:]?\s*(\d+)/i);
      if (altCodeMatch) {
        productCode = altCodeMatch[1];
      }
    }

    // CAS 번호 추출
    let casNumber = '';
    const casMatch = coaText.match(/\[([^\]]+)\]/);
    if (casMatch) {
      casNumber = casMatch[1];
    }

    // 제조일자 추출
    let mfgDate = '';
    const mfgMatch = coaText.match(/Mfg\. Date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
    if (mfgMatch) {
      mfgDate = mfgMatch[1];
    }

    // 유통기한 추출
    let expDate = '';
    const expMatch = coaText.match(/Exp\. Date\s*:\s*([^\n\r]+)/i);
    if (expMatch) {
      expDate = expMatch[1].trim();
    }

    // 원본 HTML의 일부를 rawData로 저장 (디버깅용)
    const rawData = $('body').text().substring(0, 2000); // 처음 2000자만 저장

    const responseData = {
      success: true,
      product: {
        name: productName || 'Unknown Product',
        code: productCode,
        casNumber: casNumber,
        lotNumber: lot_no,
        mfgDate: mfgDate,
        expDate: expDate
      },
      tests: results,
      rawData: rawData, // 디버깅을 위한 원본 데이터 일부
      count: results.length
    };

    console.log(`Successfully parsed: ${productName} (Code: ${productCode}, CAS: ${casNumber}), ${results.length} tests`);
    
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
        message: 'The website took too long to respond. Please try again.'
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
