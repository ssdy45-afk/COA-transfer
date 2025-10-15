import axios from 'axios';
import https from 'https';
import cheerio from 'cheerio';

const DEFAULT_TIMEOUT = 15000;

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
    console.log(`Processing lot number: ${lot_no}`);
    
    const targetUrl = `https://www.duksan.co.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;
    console.log(`Target URL: ${targetUrl}`);
    
    let html;
    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
        timeout: DEFAULT_TIMEOUT
      });

      const axiosResponse = await axios.get(targetUrl, {
        httpsAgent,
        timeout: DEFAULT_TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
      });
      
      html = axiosResponse.data;
      console.log('Successfully fetched HTML directly');
    } catch (directError) {
      console.log('Direct fetch failed, trying proxy...');
      
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        const proxyResponse = await axios.get(proxyUrl, { 
          timeout: DEFAULT_TIMEOUT 
        });
        
        if (proxyResponse.data?.contents) {
          html = proxyResponse.data.contents;
          console.log('Successfully fetched HTML via proxy');
        } else {
          throw new Error('Proxy returned no content');
        }
      } catch (proxyError) {
        console.error('Both direct and proxy failed:', proxyError.message);
        throw new Error(`Failed to fetch data: ${directError.message}`);
      }
    }

    if (!html) {
      return response.status(404).json({ 
        success: false, 
        error: 'Could not fetch certificate data' 
      });
    }

    // Cheerio로 HTML 파싱
    const $ = cheerio.load(html);
    
    // 제품 정보 추출
    const productInfo = extractProductInfo($, html, lot_no);
    
    // 테스트 데이터 추출 - 개선된 버전
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
    return response.status(500).json({ 
      success: false, 
      error: 'Failed to process request',
      message: error.message
    });
  }
}

// 제품 정보 추출
function extractProductInfo($, html, lotNumber) {
  // 제품명 추출 - 다양한 방법 시도
  let productName = '';
  
  // 방법 1: 테이블 앞의 텍스트에서 추출
  const bodyText = $('body').text();
  const nameMatch = bodyText.match(/([A-Za-z][A-Za-z0-9\s\-,()]+)\s*\[75-05-8\]/i);
  if (nameMatch) {
    productName = nameMatch[1].trim();
  }
  
  // 방법 2: HPLC Grade 텍스트 주변에서 추출
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

// 테스트 데이터 추출 - 개선된 버전
function extractTestData($) {
  const results = [];
  
  // 모든 테이블 검색
  $('table').each((tableIndex, table) => {
    console.log(`Processing table ${tableIndex}`);
    
    $(table).find('tr').each((rowIndex, tr) => {
      const $cells = $(tr).find('td, th');
      
      // 4개 컬럼을 가진 행만 처리 (Test, Unit, Specification, Results)
      if ($cells.length >= 4) {
        const row = {
          test: $cells.eq(0).text().trim(),
          unit: $cells.eq(1).text().trim(),
          specification: $cells.eq(2).text().trim(),
          result: $cells.eq(3).text().trim(),
        };
        
        // 유효한 테스트 행인지 확인
        if (isValidTestRow(row)) {
          const cleanedRow = {
            test: cleanText(row.test),
            unit: cleanText(row.unit),
            specification: cleanText(row.specification),
            result: cleanText(row.result),
          };
          
          console.log(`Found valid test row: ${cleanedRow.test}`);
          results.push(cleanedRow);
        }
      }
    });
  });

  // 테이블을 찾지 못한 경우 대체 방법 시도
  if (results.length === 0) {
    console.log('No table data found, trying alternative parsing...');
    return parseAlternativeTests($);
  }

  return results;
}

// 대체 파싱 방법
function parseAlternativeTests($) {
  const results = [];
  const testPatterns = [
    'Appearance', 'Absorbance', 'Assay', 'Color', 'Density', 
    'Evaporation residue', 'Fluorescence Background', 'Identification',
    'Gradient Suitability', 'Optical Absorbance', 'Refractive index',
    'Titratable Acid', 'Titratable Base', 'Water'
  ];

  $('td, div, p').each((_, element) => {
    const text = $(element).text().trim();
    
    testPatterns.forEach(pattern => {
      if (text.includes(pattern)) {
        // 인접한 요소에서 데이터 추출 시도
        const rowElement = $(element).closest('tr, div');
        const cells = rowElement.find('td, span');
        
        if (cells.length >= 4) {
          const row = {
            test: cells.eq(0).text().trim(),
            unit: cells.eq(1).text().trim(),
            specification: cells.eq(2).text().trim(),
            result: cells.eq(3).text().trim(),
          };
          
          if (isValidTestRow(row)) {
            results.push({
              test: cleanText(row.test),
              unit: cleanText(row.unit),
              specification: cleanText(row.specification),
              result: cleanText(row.result),
            });
          }
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
