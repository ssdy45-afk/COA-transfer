import axios from 'axios';
import https from 'https';
import cheerio from 'cheerio';

export default async function handler(request, response) {
  // CORS 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const { lot_no } = request.query;
  console.log("Received request for lot_no:", lot_no);

  if (!lot_no) {
    return response.status(400).json({ 
      success: false,
      error: 'lot_no query parameter is required' 
    });
  }

  if (!/^[A-Z0-9]+$/.test(lot_no)) {
    return response.status(400).json({ 
      success: false,
      error: 'Invalid lot number format' 
    });
  }

  try {
    console.log("Fetching analysis certificate...");
    
    const targetUrl = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log("Target URL:", targetUrl);

    // HTTPS agent 설정
    const httpsAgent = new https.Agent({
      keepAlive: false,
      timeout: 20000, // 타임아웃 20초로 증가
      rejectUnauthorized: false,
    });

    // 요청 설정
    const config = {
      httpsAgent: httpsAgent,
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'Referer': 'https://www.duksan.kr/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    };

    let axiosResponse;
    try {
      axiosResponse = await axios.get(targetUrl, config);
    } catch (directError) {
      console.log('Direct request failed:', directError.message);
      // 프록시 URL 시도 (CORS 우회)
      const proxyUrl = `https://cors-anywhere.herokuapp.com/${targetUrl}`;
      try {
        axiosResponse = await axios.get(proxyUrl, config);
      } catch (proxyError) {
        throw new Error(`All request methods failed: ${directError.message}`);
      }
    }

    console.log("Response received, status:", axiosResponse.status);

    if (axiosResponse.status === 404) {
      return response.status(404).json({ 
        success: false,
        error: 'Analysis certificate not found',
        message: `No certificate found for lot number: ${lot_no}`
      });
    }

    if (axiosResponse.status !== 200) {
      throw new Error(`HTTP ${axiosResponse.status}: ${axiosResponse.statusText}`);
    }

    const $ = cheerio.load(axiosResponse.data);
    let results = [];

    // 테이블 데이터 추출 - 다양한 테이블 구조를 고려
    $('table').each((tableIndex, table) => {
      $(table).find('tr').each((index, element) => {
        const $row = $(element);
        const $cells = $row.find('td, th');
        
        if ($cells.length >= 4) {
          const rowData = {
            test: $cells.eq(0).text().trim(),
            unit: $cells.eq(1).text().trim(),
            specification: $cells.eq(2).text().trim(),
            result: $cells.eq(3).text().trim(),
          };
          
          if (isValidTestRow(rowData)) {
            results.push(rowData);
          }
        }
      });
    });

    // 테이블 데이터가 없을 경우 대체 파싱 시도
    if (results.length === 0) {
      console.log('No results from table parsing, trying alternative methods');
      results = parseAlternativeTests($);
    }

    // 데이터 정제
    results = cleanExtractedData(results);

    // 제품명 추출
    let productName = extractProductName($, axiosResponse.data);
    
    // 제품 코드 추출
    let productCode = extractProductCode(axiosResponse.data);

    // CAS 번호 추출
    let casNumber = extractCasNumber(axiosResponse.data);

    // 제조일자 추출
    let mfgDate = extractMfgDate(axiosResponse.data);

    // 유통기한 추출
    let expDate = extractExpDate(axiosResponse.data);

    // 원본 HTML의 일부를 rawData로 저장 (디버깅용)
    const rawData = $('body').text().substring(0, 2000);

    const responseData = {
      success: true,
      product: {
        name: productName || 'Unknown Product',
        code: productCode,
        casNumber: casNumber,
        lotNumber: lot_no,
        mfgDate: mfgDate,
        expDate: expDate || '3 years after Mfg. Date'
      },
      tests: results,
      rawData: rawData,
      count: results.length,
      source: 'duksan-direct'
    };

    console.log(`Successfully parsed: ${productName} (Code: ${productCode}, CAS: ${casNumber}), ${results.length} tests`);
    
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    response.status(200).json(responseData);

  } catch (error) {
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    let statusCode = 500;
    let errorMessage = error.message;

    if (error.code === 'ECONNABORTED') {
      statusCode = 408;
      errorMessage = 'The website took too long to respond. Please try again.';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      statusCode = 503;
      errorMessage = 'Cannot connect to the website. It might be down or blocking requests.';
    } else if (error.response) {
      statusCode = error.response.status;
      errorMessage = `The website returned an error: ${error.response.status} ${error.response.statusText}`;
    }

    response.status(statusCode).json({ 
      success: false,
      error: 'Failed to fetch analysis certificate',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// 헬퍼 함수들 (Vercel 버전)
function extractProductName($, html) {
  let productName = '';
  
  // Certificate of Analysis 제목 다음에 오는 텍스트를 찾음
  const coaMatch = html.match(/Certificate of Analysis\s*[-:]?\s*([^\n\r<]+)/i);
  if (coaMatch) {
    productName = coaMatch[1].trim();
  }
  
  if (!productName) {
    // h1, h2, h3, b, strong 태그에서 제품명 찾기
    $('h1, h2, h3, b, strong').each((i, el) => {
      const text = $(el).text().trim();
      if (text && !text.includes('Certificate') && !text.includes('Analysis') && 
          !text.includes('REAGENTS') && !text.includes('DUKSAN') && text.length > 2) {
        if (!/^\d+$/.test(text)) {
          productName = text;
          return false;
        }
      }
    });
  }

  if (!productName) {
    // 테이블 앞의 요소에서 제품명 찾기
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

  // 제품명에서 불필요한 공백과 개행 제거
  if (productName) {
    productName = productName.replace(/\s+/g, ' ').trim();
  }

  return productName;
}

function extractProductCode(html) {
  let productCode = '';
  const codeMatch = html.match(/Product code\.?\s*[.:]?\s*(\d+)/i);
  if (codeMatch) {
    productCode = codeMatch[1];
  } else {
    const altCodeMatch = html.match(/(?:code|Code)\s*[.:]?\s*(\d+)/i);
    if (altCodeMatch) {
      productCode = altCodeMatch[1];
    }
  }
  return productCode;
}

function extractCasNumber(html) {
  let casNumber = '';
  const casMatch = html.match(/\[([^\]]+)\]/);
  if (casMatch) {
    casNumber = casMatch[1];
  }
  return casNumber;
}

function extractMfgDate(html) {
  let mfgDate = '';
  const mfgMatch = html.match(/Mfg\. Date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (mfgMatch) {
    mfgDate = mfgMatch[1];
  } else {
    // 대체 패턴: Manufacturing Date 등
    const altMfgMatch = html.match(/(?:Manufacturing|Mfg|Made).*?Date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i);
    if (altMfgMatch) {
      mfgDate = altMfgMatch[1];
    }
  }
  return mfgDate;
}

function extractExpDate(html) {
  let expDate = '';
  const expMatch = html.match(/Exp\. Date\s*:\s*([^\n\r<]+)/i);
  if (expMatch) {
    expDate = expMatch[1].trim();
  } else {
    // 대체 패턴: Expiry Date, Expiration Date 등
    const altExpMatch = html.match(/(?:Expiry|Expiration|Exp)\.?\s*Date\s*[:\-]?\s*([^\n\r<]+)/i);
    if (altExpMatch) {
      expDate = altExpMatch[1].trim();
    }
  }
  return expDate;
}

function parseAlternativeTests($) {
  const results = [];
  
  $('tr').each((index, element) => {
    const $row = $(element);
    const cells = [];
    
    $row.find('td, th').each((i, cell) => {
      cells.push($(cell).text().trim());
    });
    
    if (cells.length >= 4) {
      const testItem = {
        test: cells[0],
        unit: cells[1],
        specification: cells[2],
        result: cells[3]
      };
      
      if (isValidTestRow(testItem)) {
        results.push(testItem);
      }
    }
  });
  
  return results;
}

function isValidTestRow(item) {
  return item.test && 
         item.test.length > 1 && 
         !item.test.match(/^(TESTS|UNIT|SPECIFICATION|RESULTS|항목|시험항목|Test|Item)$/i) &&
         !item.test.includes('TESTS') &&
         !item.test.includes('UNIT') &&
         !item.test.includes('SPECIFICATION') &&
         !item.test.includes('RESULTS') &&
         !item.test.includes('항목') &&
         !item.test.includes('시험항목');
}

function cleanExtractedData(results) {
  return results.map(item => ({
    test: item.test.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    unit: item.unit.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    specification: item.specification.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    result: item.result.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
  })).filter(item => 
    item.test && 
    item.test.length > 1 && 
    !item.test.match(/^(TESTS|UNIT|SPECIFICATION|RESULTS)$/i)
  );
}
