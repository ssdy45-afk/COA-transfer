const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

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
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.duksan.kr/', // Referer를 메인 페이지로 변경
    'Origin': 'https://www.duksan.kr',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };

  try {
    // 1단계: 검색 페이지에 GET 요청을 보내 세션 쿠키와 페이지 내용을 획득합니다.
    const getResponse = await scraper.get(targetUrl, { headers });
    const initialHtml = iconv.decode(getResponse.data, 'EUC-KR');
    
    // ★★★ 추가: 정밀 진단을 위해 서버에 받은 HTML의 일부를 기록(로깅)합니다 ★★★
    console.log("--- Duksan 서버로부터 받은 초기 HTML ---");
    console.log(initialHtml.substring(0, 2500)); // 받은 내용의 앞부분 2500자 출력
    console.log("------------------------------------");

    const $initial = cheerio.load(initialHtml);

    // 2단계: 페이지에 숨겨진 보안 토큰(`_token`) 값을 찾아냅니다.
    const token = $initial('input[name="_token"]').val();

    // 토큰을 찾지 못했다면, 이는 보안에 의해 차단되었음을 의미합니다.
    if (!token) {
      console.error("치명적 오류: 서버가 보내준 HTML 페이지에서 보안 토큰(_token)을 찾을 수 없습니다.");
      throw new Error('Security token (_token) not found on the page. The request may have been blocked.');
    }
    console.log(`보안 토큰 발견 성공: ${token.substring(0, 10)}...`);

    // 3단계: 획득한 토큰과 Lot 번호를 포함하여 POST 요청을 보냅니다.
    const formData = new URLSearchParams();
    formData.append('_token', token);
    formData.append('lot_no', lot_no);
    
    // POST 요청 시 Content-Type 헤더를 추가합니다.
    const postHeaders = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    const postResponse = await scraper.post(targetUrl, formData, { headers: postHeaders });

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

    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json(results);

  } catch (error) {
    console.error('스크래핑 처리 중 심각한 오류 발생:', error.message);
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

