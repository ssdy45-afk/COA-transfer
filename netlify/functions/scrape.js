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
    // Duksan COA 페이지 URL
    const url = `https://www.duksan.com/coa/${lot_no}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // HTML 파싱 및 데이터 추출 로직
    // 이 부분은 Vercel 함수와 동일하게 구현
    const product = {
      name: 'Unknown Product',
      code: '',
      casNumber: '',
      mfgDate: '',
      expDate: ''
    };

    const tests = [];
    
    // 간단한 파싱 예시 (실제로는 더 정교한 파싱 필요)
    const productNameMatch = html.match(/Certificate of Analysis\s*-\s*([^<]+)/i);
    if (productNameMatch) {
      product.name = productNameMatch[1].trim();
    }

    // 테스트 데이터 추출 로직 구현
    // ...

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        product,
        tests,
        rawData: html.substring(0, 1000) // 디버깅용
      })
    };

  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch data from Duksan',
        details: error.message 
      })
    };
  }
};
