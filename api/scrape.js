// api/scrape.js
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // CORS (필요 시 특정 오리진만 허용하도록 조정)
  const ALLOWED_ORIGINS = ['https://coa-transfer.vercel.app'];
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://coa-transfer.vercel.app');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { lot_no } = req.query;
  if (!lot_no) return res.status(400).json({ success:false, error:'lot_no query parameter is required' });

  // 소문자/하이픈 허용, 길이 가드
  if (!/^[A-Za-z0-9-]{1,40}$/.test(lot_no)) {
    return res.status(400).json({ success:false, error:'Invalid lot number format' });
  }

  // 요청 공통 옵션
  const config = {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; COA-Transfer/1.0; +https://coa-transfer.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
    },
    maxRedirects: 3,
    validateStatus: s => s >= 200 && s < 500
  };

  const targetUrl = `https://www.duksan.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;

  async function fetchOnce(url) {
    return axios.get(url, config);
  }

  // 원본 → (백오프 재시도) → 실패 시 프록시
  let response;
  try {
    try {
      response = await fetchOnce(targetUrl);
      if (response.status >= 500) throw new Error(`Upstream ${response.status}`);
    } catch (e1) {
      // 1차 백오프 재시도
      await new Promise(r => setTimeout(r, 500));
      response = await fetchOnce(targetUrl);
      if (response.status >= 500) throw e1;
    }
  } catch (e2) {
    // 최후 수단 프록시
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    response = await fetchOnce(proxyUrl);
  }

  if (response.status === 404) {
    return res.status(404).json({ success:false, error:'Analysis certificate not found', message:`No certificate for ${lot_no}` });
  }
  if (response.status !== 200 || !response.data) {
    return res.status(502).json({ success:false, error:`Upstream error ${response.status}` });
  }

  // 파싱
  const $ = cheerio.load(response.data);
  const results = [];

  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length >= 4) {
      const row = {
        test: $(tds[0]).text().trim(),
        unit: $(tds[1]).text().trim(),
        specification: $(tds[2]).text().trim(),
        result: $(tds[3]).text().trim(),
      };
      const upper = row.test.toUpperCase();
      if (row.test && !['TESTS','UNIT','SPECIFICATION','RESULTS'].includes(upper)) {
        results.push(row);
      }
    }
  });

  const bodyText = $('body').text();

  // 제품명/코드/CAS/날짜 추출 견고화
  const productName =
    (bodyText.match(/Certificate of Analysis\s*([^\n\r]+)/i)?.[1]?.trim()) ||
    $('h1,h2,h3,strong,b').map((_,el)=>$(el).text().trim()).get()
      .find(t => t && !/Certificate|Analysis|REAGENTS|DUKSAN/i.test(t) && !/^\d+$/.test(t)) || '';

  const productCode =
    (bodyText.match(/Product code\.?\s*([A-Za-z0-9-]+)/i)?.[1]) ||
    (bodyText.match(/(?:code|Code)\s*[.:]?\s*([A-Za-z0-9-]+)/i)?.[1]) || '';

  const casNumber = bodyText.match(/\[([0-9\-]+)\]/)?.[1] || '';

  const mfgDate = bodyText.match(/Mfg\. Date\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || '';
  const expDate = bodyText.match(/Exp\. Date\s*:\s*([^\n\r]+)/i)?.[1]?.trim() || '';

  const rawData = bodyText.slice(0, 2000);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  return res.status(200).json({
    success: true,
    product: {
      name: productName || 'Unknown Product',
      code: productCode || '',
      casNumber,
      lotNumber: lot_no,
      mfgDate,
      expDate
    },
    tests: results,
    rawData,
    count: results.length
  });
};
