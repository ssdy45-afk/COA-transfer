import fetch from 'node-fetch';

export default async function handler(request, response) {
  // CORS 헤더 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  // OPTIONS 요청 처리 (Preflight)
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const { lot_no } = request.query;

  if (!lot_no) {
    return response.status(400).json({ error: 'Lot number is required' });
  }

  try {
    // 여러 가능한 COA URL 시도
    const possibleUrls = [
      `https://www.duksan.co.kr/coa/${lot_no}`,
      `https://www.duksan.com/coa/${lot_no}`,
      `https://duksan.co.kr/coa/${lot_no}`,
      `https://duksan.com/coa/${lot_no}`
    ];

    let html = '';
    let finalUrl = '';

    // 각 URL 시도
    for (const url of possibleUrls) {
      try {
        console.log(`Trying URL: ${url}`);
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
          },
          timeout: 15000
        });

        if (res.ok) {
          html = await res.text();
          finalUrl = url;
          console.log(`Success with URL: ${url}`);
          break;
        }
      } catch (error) {
        console.log(`Failed with URL: ${url}`, error.message);
        continue;
      }
    }

    if (!html) {
      return response.status(404).json({ 
        error: 'COA not found',
        details: '모든 URL에서 데이터를 찾을 수 없습니다.'
      });
    }

    // HTML 파싱 로직
    const product = {
      name: extractProductName(html),
      code: extractProductCode(html),
      casNumber: extractCasNumber(html),
      mfgDate: extractMfgDate(html),
      expDate: extractExpDate(html)
    };

    const tests = extractTestResults(html);

    return response.status(200).json({
      success: true,
      product,
      tests,
      rawData: html.substring(0, 500),
      source: 'vercel-function',
      finalUrl: finalUrl
    });

  } catch (error) {
    console.error('Vercel Function Error:', error);
    
    return response.status(500).json({ 
      error: 'Failed to fetch COA data',
      details: error.message,
      source: 'vercel-function'
    });
  }
}

// 향상된 파싱 함수들
function extractProductName(html) {
  // 다양한 패턴으로 제품명 추출
  const patterns = [
    /<title>([^<]+)<\/title>/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /Certificate of Analysis\s*[-–]\s*([^<]+)/i,
    /<div[^>]*class="[^"]*product-name[^"]*"[^>]*>([^<]+)<\/div>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let name = match[1]
        .replace('Certificate of Analysis', '')
        .replace('COA', '')
        .trim();
      if (name && name !== '') return name;
    }
  }

  // CAS 번호로부터 유추
  const casMatch = html.match(/\[(\d{2,7}-\d{2}-\d)\]/);
  if (casMatch) {
    const cas = casMatch[1];
    const productMap = {
      '75-05-8': 'Acetonitrile (ACN), HPLC Grade',
      '67-64-1': 'Acetone (Certified ACS), Fisher Chemical',
      '67-56-1': 'Methanol (Methyl alcohol), HPLC Grade',
      '142-82-5': 'n-Heptane, HPLC Grade'
      // 추가 제품 매핑...
    };
    return productMap[cas] || `Chemical Product [${cas}]`;
  }

  return 'Chemical Product';
}

function extractProductCode(html) {
  const patterns = [
    /Product code\.?\s*([A-Za-z0-9-]+)/i,
    /Product\s*Code:?\s*([A-Za-z0-9-]+)/i,
    /Item\s*No\.?:?\s*([A-Za-z0-9-]+)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function extractCasNumber(html) {
  const casMatch = html.match(/(\d{2,7}-\d{2}-\d)/);
  return casMatch ? casMatch[1] : '';
}

function extractMfgDate(html) {
  const patterns = [
    /Mfg\.\s*Date\s*:?\s*(\d{4}-\d{2}-\d{2})/i,
    /Manufacturing\s*Date\s*:?\s*(\d{4}-\d{2}-\d{2})/i,
    /제조일자\s*:?\s*(\d{4}-\d{2}-\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return new Date().toISOString().split('T')[0];
}

function extractExpDate(html) {
  const patterns = [
    /Exp\.\s*Date\s*:?\s*([^<]+)/i,
    /Expiration\s*Date\s*:?\s*([^<]+)/i,
    /유통기한\s*:?\s*([^<]+)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  return '3 years after Mfg. Date';
}

function extractTestResults(html) {
  const tests = [];
  
  // 테이블 기반 파싱 시도
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const text = cellMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();
        cells.push(text);
      }
      
      if (cells.length >= 4 && 
          !cells[0].match(/tests|unit|specification|results/i) &&
          cells[0].length > 0) {
        tests.push({
          test: cells[0],
          unit: cells[1],
          specification: cells[2],
          result: cells[3]
        });
      }
    }
  }
  
  // 테이블을 찾지 못한 경우 텍스트 기반 파싱
  if (tests.length === 0) {
    const lines = html.split('\n');
    let inTable = false;
    
    for (const line of lines) {
      const cleanLine = line.replace(/<[^>]*>/g, '').trim();
      
      if (cleanLine.match(/TESTS\s+UNIT\s+SPECIFICATION\s+RESULTS/i)) {
        inTable = true;
        continue;
      }
      
      if (inTable && cleanLine) {
        const parts = cleanLine.split(/\s{2,}/); // 2개 이상의 공백으로 분리
        if (parts.length >= 4) {
          tests.push({
            test: parts[0],
            unit: parts[1],
            specification: parts[2],
            result: parts[3]
          });
        }
      }
    }
  }
  
  return tests;
}
