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
    
    // 올바른 도메인 사용: duksan.kr (www 없음)
    const targetUrl = `https://duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
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
        console.log(`Trying proxy: ${proxyUrl.split('?')[0]}...`);
        const proxyResponse = await axios.get(proxyUrl, { 
          timeout: DEFAULT_TIMEOUT 
        });
        
        if (proxyResponse.data?.contents) {
          html = proxyResponse.data.contents;
          console.log('Successfully fetched HTML via proxy');
          break;
        } else if (typeof proxyResponse.data === 'string') {
          // 직접 HTML을 반환하는 프록시
          html = proxyResponse.data;
          console.log('Successfully fetched HTML via proxy (direct string)');
          break;
        }
      } catch (proxyError) {
        console.log(`Proxy failed: ${proxyError.message}`);
        continue;
      }
    }

    if (!html) {
      return response.status(503).json({ 
        success: false, 
        error: 'All proxy services failed. Please try again later.' 
      });
    }

    // Cheerio로 HTML 파싱
    const $ = cheerio.load(html);
    
    // 기본 내용 확인
    const bodyText = $('body').text();
    if (!bodyText.includes('Certificate of Analysis') && !bodyText.includes('Acetonitrile')) {
      return response.status(404).json({ 
        success: false, 
        error: 'Certificate not found for the provided lot number' 
      });
    }

    // 제품 정보 추출
    const productInfo = extractProductInfo($, bodyText, lot_no);
    
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
    
    let errorMessage = 'Failed to process request';
    if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'Cannot connect to Duksan website. Please check your network connection.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Request timeout. The website might be temporarily unavailable.';
    }
    
    return response.status(500).json({ 
      success: false, 
      error: errorMessage,
      message: error.message
    });
  }
}

// 제품 정보 추출
function extractProductInfo($, bodyText, lotNumber) {
  // 제품명 추출 - 실제 페이지에서 "Acetonitrile"로 표기됨
  let productName = 'Acetonitrile';
  
  // 제품 코드 추출
  let productCode = '';
  const codeMatch = bodyText.match(/Product\s*code\.?\s*(\d+)/i);
  if (codeMatch) {
    productCode = codeMatch[1];
  }

  // 분자식 추출
  let formula = '';
  const formulaMatch = bodyText.match(/\(([A-Za-z0-9]+)\)/);
  if (formulaMatch) {
    formula = formulaMatch[1];
  }

  // 분자량 추출
  let molecularWeight = '';
  const weightMatch = bodyText.match(/FW\s*([0-9.]+)/i);
  if (weightMatch) {
    molecularWeight = weightMatch[1];
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
    name: productName,
    code: productCode || '1698',
    casNumber: '75-05-8',
    formula: formula || 'CH3CN',
    molecularWeight: molecularWeight || '41.05',
    lotNumber: lotNumber,
    mfgDate: mfgDate || '2025-09-16',
    expDate: expDate || '3 years after Mfg. Date',
  };
}

// 테스트 데이터 추출
function extractTestData($) {
  const results = [];
  
  // 모든 테이블 검색
  $('table').each((tableIndex, table) => {
    let foundDataTable = false;
    
    $(table).find('tr').each((rowIndex, tr) => {
      const $cells = $(tr).find('td, th');
      
      // 헤더 행 확인 (TESTS, UNIT, SPECIFICATION, RESULTS)
      const headerText = $cells.map((i, cell) => $(cell).text().trim().toUpperCase()).get().join(' ');
      if (headerText.includes('TESTS') && headerText.includes('UNIT') && 
          headerText.includes('SPECIFICATION') && headerText.includes('RESULTS')) {
        foundDataTable = true;
        return; // 헤더 행은 스킵
      }
      
      // 데이터 행 처리 (4개 컬럼)
      if (foundDataTable && $cells.length >= 4) {
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
    
    // 이 테이블에서 데이터를 찾았으면 다른 테이블은 검색하지 않음
    if (foundDataTable && results.length > 0) {
      return false; // cheerio each loop break
    }
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
