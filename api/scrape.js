import axios from 'axios';
import https from 'https';
import cheerio from 'cheerio';

// Vercel에서 파일 크기 제한을 피하기 위해 간소화
const DEFAULT_TIMEOUT = 10000; // 타임아웃 단축

export default async function handler(request, response) {
  // CORS 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // 요청 검증
  const { lot_no } = request.query;
  if (!lot_no) {
    return response.status(400).json({ 
      success: false, 
      error: 'lot_no query parameter is required' 
    });
  }
  
  // 간단한 검증만 수행
  if (typeof lot_no !== 'string' || lot_no.length > 50) {
    return response.status(400).json({ 
      success: false, 
      error: 'Invalid lot number format' 
    });
  }

  try {
    const targetUrl = `https://www.duksan.co.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    
    // 간소화된 HTTP 요청
    const html = await fetchWithTimeout(targetUrl);
    
    if (!html) {
      return response.status(404).json({ 
        success: false, 
        error: 'Certificate not found for the provided lot number'
      });
    }

    const $ = cheerio.load(html);
    
    // 간단한 내용 확인
    const bodyText = $('body').text().replace(/\s+/g, '');
    if (bodyText.length < 50) {
      return response.status(404).json({ 
        success: false, 
        error: 'No certificate content found' 
      });
    }

    // 기본 테스트 데이터 추출
    const results = [];
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

    if (results.length === 0) {
      return response.status(404).json({ 
        success: false, 
        error: 'No test data found in certificate' 
      });
    }

    // 기본 제품 정보 추출
    const productName = extractProductName($);
    const casNumber = extractCasNumber(html);

    return response.status(200).json({
      success: true,
      product: {
        name: productName || 'Chemical Product',
        casNumber: casNumber || '',
        lotNumber: lot_no,
      },
      tests: cleanTestData(results),
      count: results.length,
    });

  } catch (error) {
    console.error('Error:', error.message);
    
    // Vercel 친화적인 에러 응답
    if (error.message.includes('timeout')) {
      return response.status(408).json({ 
        success: false, 
        error: 'Request timeout' 
      });
    }
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      return response.status(503).json({ 
        success: false, 
        error: 'Service temporarily unavailable' 
      });
    }

    return response.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}

// 간소화된 HTTP 요청 함수
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true
    });

    const response = await axios.get(url, {
      httpsAgent,
      timeout: DEFAULT_TIMEOUT,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });

    clearTimeout(timeoutId);
    return response.data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // 프록시 폴백 시도
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const proxyResponse = await axios.get(proxyUrl, { timeout: DEFAULT_TIMEOUT });
      
      if (proxyResponse.data?.contents) {
        return proxyResponse.data.contents;
      }
    } catch (proxyError) {
      // 프록시도 실패하면 원래 에러 throw
    }
    
    throw error;
  }
}

// 유효성 검사
function isValidTestRow(item) {
  if (!item.test || item.test.length < 2) return false;
  
  const excluded = ['TESTS', 'UNIT', 'SPECIFICATION', 'RESULTS', '항목', '시험항목', 'Test', 'Item'];
  return !excluded.some(pattern => 
    item.test.toUpperCase().includes(pattern.toUpperCase())
  );
}

// 데이터 정리
function cleanTestData(results) {
  return results.map(item => ({
    test: cleanText(item.test),
    unit: cleanText(item.unit),
    specification: cleanText(item.specification),
    result: cleanText(item.result),
  })).filter(item => item.test && item.test.length > 1);
}

function cleanText(text) {
  return (text || '')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 제품명 추출
function extractProductName($) {
  return $('h1, h2, h3').first().text().trim() || '';
}

// CAS 번호 추출
function extractCasNumber(html) {
  const match = html.match(/\b\d{2}-\d{2}-\d\b/);
  return match ? match[0] : '';
}
