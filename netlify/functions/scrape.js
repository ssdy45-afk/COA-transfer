const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // CORS 헤더 설정
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // OPTIONS 요청 처리 (Preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  const { lot_no } = event.queryStringParameters;

  if (!lot_no) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Lot number is required' })
    };
  }

  try {
    // Duksan COA 페이지 스크래핑 로직
    // Vercel 함수와 동일한 로직 구현
    const url = `https://www.duksan.com/coa/${lot_no}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'COA not found',
          details: `HTTP ${response.status}: ${response.statusText}`
        })
      };
    }

    const html = await response.text();
    
    // HTML 파싱 로직 (Vercel 함수와 동일)
    // 실제 파싱 로직은 여기에 구현
    
    const product = {
      name: extractProductName(html),
      code: extractProductCode(html),
      casNumber: extractCasNumber(html),
      mfgDate: extractMfgDate(html),
      expDate: extractExpDate(html)
    };

    const tests = extractTestResults(html);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        product,
        tests,
        rawData: html.substring(0, 500), // 디버깅용
        source: 'netlify-function'
      })
    };

  } catch (error) {
    console.error('Netlify Function Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch COA data',
        details: error.message,
        source: 'netlify-function'
      })
    };
  }
};

// 파싱 헬퍼 함수들
function extractProductName(html) {
  // 실제 파싱 로직 구현
  const match = html.match(/<title>([^<]+)<\/title>/);
  return match ? match[1].trim() : 'Unknown Product';
}

function extractProductCode(html) {
  // 실제 파싱 로직 구현
  return '';
}

function extractCasNumber(html) {
  // 실제 파싱 로직 구현
  return '';
}

function extractMfgDate(html) {
  // 실제 파싱 로직 구현
  return '';
}

function extractExpDate(html) {
  // 실제 파싱 로직 구현
  return '';
}

function extractTestResults(html) {
  // 실제 파싱 로직 구현
  return [];
}
