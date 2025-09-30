const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
// ★★★ 추가: 쿠키(세션) 관리를 위한 라이브러리 ★★★
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

// 쿠키를 저장하고 관리할 '쿠키 항아리(Cookie Jar)'를 생성합니다.
const jar = new CookieJar();
// axios가 쿠키를 자동으로 사용하도록 설정합니다.
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
  const formData = new URLSearchParams();
  formData.append('lot_no', lot_no);
  
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': targetUrl
  };

  try {
    // ★★★ 수정: 2단계 접근 방식 ★★★
    // 1단계: 먼저 검색 페이지에 GET 요청을 보내 세션 쿠키를 획득합니다.
    await scraper.get(targetUrl, { headers });

    // 2단계: 획득한 쿠키를 사용하여 Lot 번호 데이터와 함께 POST 요청을 보냅니다.
    const response = await scraper.post(targetUrl, formData, { headers });

    const decodedHtml = iconv.decode(response.data, 'EUC-KR');
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
    console.error('Scraping error occurred.');
    if (error.response) {
      console.error('Status:', error.response.status);
      const errorData = iconv.decode(error.response.data, 'EUC-KR');
      console.error('Data:', errorData.substring(0, 500)); // Log first 500 chars
    } else if (error.request) {
      console.error('Request Error: No response received.');
    } else {
      console.error('General Error:', error.message);
    }
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

