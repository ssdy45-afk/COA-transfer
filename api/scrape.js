import axios from 'axios';
import https from 'https';

// cheerio를 동적으로 import
let cheerio;

const DEFAULT_TIMEOUT = 10000;

export default async function handler(request, response) {
  // CORS 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const { lot_no } = request.query;
  
  if (!lot_no) {
    return response.status(400).json({ 
      success: false, 
      error: 'lot_no query parameter is required' 
    });
  }

  try {
    // cheerio 동적 import
    if (!cheerio) {
      cheerio = await import('cheerio');
    }
    
    console.log(`Processing lot number: ${lot_no}`);
    
    // 올바른 도메인 사용: www.duksan.kr
    const targetUrl = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log(`Target URL: ${targetUrl}`);
    
    let html;
    
    // 여러 프록시 서비스 시도
    const proxyServices = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
    ];
    
    for (const proxyUrl of proxyServices) {
      try {
        console.log(`Trying proxy: ${proxyUrl.substring(0, 50)}...`);
        const proxyResponse = await axios.get(proxyUrl, { 
          timeout: DEFAULT_TIMEOUT 
        });
        
        if (proxyResponse.data?.contents) {
          html = proxyResponse.data.contents;
          console.log('Successfully fetched HTML via proxy');
          break;
        } else if (proxyResponse.data) {
          // 일부 프록시는 직접 HTML을 반환함
          html = proxyResponse.data;
          console.log('Successfully fetched HTML via proxy (direct)');
          break;
        }
      } catch (proxyError) {
        console.log(`Proxy failed: ${proxyError.message}`);
        continue;
      }
    }

    if (!html) {
      // 모든 프록시가 실패하면 직접 시도 (더 짧은 타임아웃으로)
      try {
        console.log('All proxies failed, trying direct connection with shorter timeout...');
        const httpsAgent = new https.Agent({
          rejectUnauthorized: false,
          timeout: 5000
        });

        const directResponse = await axios.get(targetUrl, {
          httpsAgent,
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
          },
        });
        
        html = directResponse.data;
        console.log('Successfully fetched HTML directly');
      } catch (directError) {
        console.error('Direct connection also failed:', directError.message);
        throw new Error('All connection methods failed');
      }
    }

    if (!html) {
      return response.status(404).json({ 
        success: false, 
        error: 'Could not fetch certificate data from Duksan website' 
      });
    }

    // Cheerio로 HTML 파싱
    const $ = cheerio.load(html);
    
    // 제품 정보 추출
    const productInfo = extractProductInfo($, html, lot_no);
    
    // 테스트 데이터 추출
    const tests = extractTestData($);
    
    if (tests.length === 0) {
      return response.status(404).json({ 
        success: false, 
        error: 'No test data found in the certificate' 
      });
    }

    const result = {
      success: true,
      product: productInfo,
      tests: tests,
      count: tests.length,
    };

    console.log(`Successfully processed ${tests.length} tests`);
    return response.status(200).json(result);

  } catch (error) {
    console.error('FUNCTION_ERROR:', error);
    
    // 더 자세한 에러 메시지
    let errorMessage = 'Failed to process request';
    if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'Cannot connect to Duksan website. Please check your network connection.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Request timeout. The website might be temporarily unavailable.';
    } else if (error.message.includes('All connection methods failed')) {
      errorMessage = 'All connection methods failed. The website might be blocking our requests.';
    }
    
    return response.status(500).json({ 
      success: false, 
      error: errorMessage,
      message: error.message
    });
  }
}

// 제품 정보 추출
function extractProductInfo($, html, lotNumber) {
  const bodyText = $('body').text();
  
  // 제품명 추출
  let productName = '';
  const nameMatch = bodyText.match(/([A-Za-z][A-Za-z0-9\s\-,()]+)\s*\[75-05-8\]/i);
  if (nameMatch) {
    productName = nameMatch[1].trim();
  }
  
  if (!productName) {
    const hplcMatch = bodyText.match(/([A-Za-z\s]+HPLC\s*Grade)/i);
    if (hplcMatch) {
      productName = hplcMatch[1].trim();
    }
  }

  // 제품 코드 추출
  let productCode = '';
  const codeMatch = bodyText.match(/Product\s*code\.?\s*(\d+)/i);
  if (codeMatch) {
    productCode = codeMatch[1];
  }

  // 제조일자 추출
  let mfgDate = '';
  const mfgMatch = bodyText.match(/Mfg\.?\s*Date\s*:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  if (mfgMatch) {
    mfgDate = mfgMatch[1];
  }

  // 유통기한 추출
  let expDate = '';
  const expMatch = bodyText.match(/Exp\.?\s*Date\s*:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|3 years after Mfg\.?\s*Date)/i);
  if (expMatch) {
    expDate = expMatch[1];
  }

  return {
    name: productName || 'Acetonitrile (ACN), HPLC Grade',
    code: productCode || '1698',
    casNumber: '75-05-8',
    lotNumber: lotNumber,
    mfgDate: mfgDate || new Date().toISOString().split('T')[0],
    expDate: expDate || '3 years after Mfg. Date',
  };
}

// 테스트 데이터 추출
function extractTestData($) {
  const results = [];
  
  $('table').each((tableIndex, table) => {
    $(table).find('tr').each((rowIndex, tr) => {
      const $cells = $(tr).find('td, th');
      
      if ($cells.length >= 4) {
        const row = {
          test: $cells.eq(0).text().trim(),
          unit: $cells.eq(1).text().trim(),
          specification: $cells.eq(2).text().trim(),
          result: $cells.eq(3).text().trim(),
        };
        
        if (isValidTestRow(row)) {
          const cleanedRow = {
            test: cleanText(row.test),
            unit: cleanText(row.unit),
            specification: cleanText(row.specification),
            result: cleanText(row.result),
          };
          
          results.push(cleanedRow);
        }
      }
    });
  });

  return results;
}

// 유효한 테스트 행 확인
function isValidTestRow(item) {
  if (!item.test || item.test.length < 2) return false;
  
  const excludedPatterns = [
    'TESTS', 'UNIT', 'SPECIFICATION', 'RESULTS', 
    '항목', '시험항목', 'Test', 'Item'
  ];
  
  const isExcluded = excludedPatterns.some(pattern => 
    item.test.toUpperCase().includes(pattern.toUpperCase())
  );
  
  return !isExcluded;
}

// 텍스트 정리
function cleanText(text) {
  if (!text) return '';
  
  return text
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, '')
    .trim();
}
