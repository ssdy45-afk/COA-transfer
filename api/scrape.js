const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// 쿠키를 저장하고 관리할 '쿠키 항아리(Cookie Jar)'를 생성합니다.
const jar = new CookieJar();
const scraper = wrapper(axios.create({
  jar,
  responseType: 'arraybuffer',
  responseEncoding: 'binary',
}));

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
  
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': targetUrl,
    'Origin': 'https://www.duksan.kr', // Origin 헤더 추가
    'DNT': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };

  try {
    // ★★★ 수정: 3단계 접근 방식 (보안 토큰 추가) ★★★
    // 1단계: 먼저 검색 페이지에 GET 요청을 보내 세션 쿠키와 함께 페이지 내용을 획득합니다.
    const getResponse = await scraper.get(targetUrl, { headers });
    const initialHtml = iconv.decode(getResponse.data, 'EUC-KR');
    const $initial = cheerio.load(initialHtml);

    // 2단계: 페이지에 숨겨진 보안 토큰(`_token`) 값을 찾아냅니다.
    const token = $initial('input[name="_token"]').val();
    if (!token) {
        throw new Error('Security token (_token) not found on the page.');
    }

    // 3단계: 획득한 토큰과 Lot 번호를 포함하여 POST 요청을 보냅니다.
    const formData = new URLSearchParams();
    formData.append('_token', token);
    formData.append('lot_no', lot_no);

    const postResponse = await scraper.post(targetUrl, formData, { headers });

    const decodedHtml = iconv.decode(postResponse.data, 'EUC-KR');
    const $ = cheerio.load(decodedHtml);
    
    const resultTable = $('div.box-body table.table-lot-view');
    const results = [];

    if (resultTable.length > 0) {
      resultTable.find('tbody tr').each((i, elem) => {
        const tds = $(elem).find('td');
        if (tds.length === 5) {
          results.push({
            item: $(tds[0]).text().trim(),
            spec: $(tds[1]).text().trim(),
            unit: $(tds[2]).text().trim(),
            method: $(tds[3]).text().trim(),
            result: $(tds[4]).text().trim(),
          });
        }
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=60');
    res.status(200).json(results);

  } catch (error) {
    console.error('Scraping error occurred:', error.message);
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

