import axios from 'axios';
import * as https from 'https';
import * as cheerio from 'cheerio';

// 상수 정의
const DEFAULT_TIMEOUT = 30000;
const KEEP_ALIVE_MSECS = 1000;
const PROXY_SERVICE_URL = 'https://api.allorigins.win/get';

export default async function handler(request, response) {
  // CORS 헤더 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // 요청 검증
  const { lot_no } = request.query || {};
  if (!lot_no) {
    return response.status(400).json({ 
      success: false, 
      error: 'lot_no query parameter is required' 
    });
  }
  
  if (!/^[A-Za-z0-9]+$/.test(lot_no)) {
    return response.status(400).json({ 
      success: false, 
      error: 'Invalid lot number format. Only alphanumeric characters allowed.' 
    });
  }

  try {
    const targetUrl = `https://www.duksan.co.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    const html = await fetchHtmlContent(targetUrl);
    
    if (!html) {
      return response.status(404).json({ 
        success: false, 
        error: 'Analysis certificate not found or empty response',
        message: `No certificate content for lot number: ${lot_no}`
      });
    }

    const $ = cheerio.load(html);
    const results = extractTestData($);
    
    if (results.length === 0) {
      return response.status(404).json({ 
        success: false, 
        error: 'No test data found', 
        message: 'Certificate found but no test rows could be extracted' 
      });
    }

    const productInfo = extractProductInfo($, html, lot_no);
    
    return response.status(200).json({
      success: true,
      product: productInfo,
      tests: cleanExtractedData(results),
      count: results.length,
    });
  } catch (error) {
    const errorMessage = String(error?.message || 'Unknown error');
    const statusCode = getStatusCodeFromError(errorMessage);
    
    return response.status(statusCode).json({ 
      success: false, 
      error: 'Failed to fetch analysis certificate', 
      message: errorMessage 
    });
  }
}

// HTML 내용 가져오기
async function fetchHtmlContent(targetUrl) {
  const config = {
    httpsAgent: new https.Agent({ 
      keepAlive: true, 
      timeout: DEFAULT_TIMEOUT, 
      rejectUnauthorized: false, 
      keepAliveMsecs: KEEP_ALIVE_MSECS 
    }),
    timeout: DEFAULT_TIMEOUT,
    maxRedirects: 5,
    decompress: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Referer': 'https://www.duksan.co.kr/',
      'Upgrade-Insecure-Requests': '1',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  };

  try {
    const response = await axios.get(targetUrl, config);
    return response.data;
  } catch (error) {
    // 직접 요청 실패 시 프록시 사용
    const proxyUrl = `${PROXY_SERVICE_URL}?url=${encodeURIComponent(targetUrl)}`;
    const proxyResponse = await axios.get(proxyUrl, { timeout: DEFAULT_TIMEOUT });
    
    if (proxyResponse.data?.contents) {
      return proxyResponse.data.contents;
    }
    
    throw new Error(`Direct and proxy fetch failed: ${error.message}`);
  }
}

// 테스트 데이터 추출
function extractTestData($) {
  let results = [];
  
  // 테이블 기반 파싱
  $('table').each((_, table) => {
    $(table).find('tr').each((__, tr) => {
      const $cells = $(tr).find('td, th');
      if ($cells.length >= 4) {
        const row = {
          test: $cells.eq(0).text().trim(),
          unit: $cells.eq(1).text().trim(),
          specification: $cells.eq(2).text().trim(),
          result: $cells.eq(3).text().trim(),
        };
        if (isValidTestRow(row)) {
          results.push(row);
        }
      }
    });
  });
  
  // 대체 파싱 방법
  if (results.length === 0) {
    results = parseAlternativeTests($);
  }
  
  return results;
}

// 제품 정보 추출
function extractProductInfo($, html, lotNumber) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  return {
    name: extractProductName($, html) || 'Chemical Product',
    code: extractProductCode($, html),
    casNumber: extractCasNumber(html),
    lotNumber,
    mfgDate: extractMfgDate(html) || currentDate,
    expDate: extractExpDate(html) || '3 years after Mfg. Date',
  };
}

// 유효한 테스트 행인지 확인
function isValidTestRow(item) {
  const excludedPatterns = /^(TESTS|UNIT|SPECIFICATION|RESULTS|항목|시험항목|Test|Item)$/i;
  return item.test && 
         item.test.length > 1 && 
         !excludedPatterns.test(item.test);
}

// 데이터 정리
function cleanExtractedData(results) {
  return results
    .map(item => ({
      test: cleanText(item.test),
      unit: cleanText(item.unit),
      specification: cleanText(item.specification),
      result: cleanText(item.result),
    }))
    .filter(item => 
      item.test && 
      item.test.length > 1 && 
      !/^(TESTS|UNIT|SPECIFICATION|RESULTS)$/i.test(item.test)
    );
}

function cleanText(text) {
  return (text || '')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 대체 파싱 방법
function parseAlternativeTests($) {
  const results = [];
  const textElements = $('p, li, div');
  
  textElements.each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    const match = text.match(/^(.{2,40}?)\s{2,}([^\s].{0,60}?)\s{2,}([^\s].{0,60})$/);
    
    if (match) {
      results.push({ 
        test: match[1], 
        unit: '', 
        specification: match[2], 
        result: match[3] 
      });
    }
  });
  
  return results;
}

// 제품명 추출
function extractProductName($, html) {
  const heading = $('h1, h2, h3').first().text().trim();
  if (heading) return heading;
  
  const match = html.match(/([A-Za-z][A-Za-z0-9\s\-]+)\s*\[\d{2}-\d{2}-\d{1}\]/);
  return match ? match[1] : '';
}

// 제품 코드 추출
function extractProductCode($, html) {
  const codeElement = $('td, th').filter((_, el) => 
    /Product\s*code/i.test($(el).text())
  ).next();
  
  if (codeElement.text().trim()) {
    return codeElement.text().trim();
  }
  
  const match = html.match(/Product(?:\s*code|\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
  return match ? match[1] : '';
}

// CAS 번호 추출
function extractCasNumber(html) {
  const match = html.match(/\b\d{2}-\d{2}-\d\b/);
  return match ? match[0] : '';
}

// 제조일자 추출
function extractMfgDate(html) {
  const match = html.match(/Mfg\.?\s*Date\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match ? match[1] : '';
}

// 유통기한 추출
function extractExpDate(html) {
  const match = html.match(/Exp\.?\s*Date\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match ? match[1] : '';
}

// 에러 메시지에 따른 상태 코드 결정
function getStatusCodeFromError(errorMessage) {
  if (/timeout|ETIMEDOUT|Abort/i.test(errorMessage)) return 408;
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EHOSTUNREACH/i.test(errorMessage)) return 503;
  if (/404|not found/i.test(errorMessage)) return 404;
  return 502;
}
