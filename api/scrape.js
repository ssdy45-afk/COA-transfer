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
  timeout: 15000,
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
    // ★★★ 수정: 최신 브라우저 버전으로 User-Agent 업데이트 ★★★
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Referer': 'https://www.duksan.kr/',
    'Origin': 'https://www.duksan.kr',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };

  try {
    // 1단계: 검색 페이지에 GET 요청을 보내 초기 정보를 획득합니다.
    console.log("1단계: GET 요청 시작...");
    const getResponse = await scraper.get(targetUrl, { headers });
    console.log(`1단계: GET 요청 성공 (상태 코드: ${getResponse.status})`);
    
    const initialHtml = iconv.decode(getResponse.data, 'EUC-KR');
    const $initial = cheerio.load(initialHtml);
    const token = $initial('input[name="_token"]').val();

    if (!token) {
        console.error("치명적 오류: 초기 페이지에서 보안 토큰(_token)을 찾을 수 없습니다.");
        console.error("--- 덕산 서버로부터 받은 전체 HTML ---");
        console.error(initialHtml);
        console.error("---------------------------------");
        throw new Error('Initial page did not contain a security token.');
    }
    console.log(`보안 토큰 발견 성공: ${token.substring(0, 10)}...`);

    // 2단계: 획득한 토큰과 Lot 번호로 데이터를 요청합니다.
    const formData = new URLSearchParams();
    formData.append('_token', token);
    formData.append('lot_no', lot_no);
    
    const postHeaders = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    
    console.log("2단계: POST 요청 시작...");
    const postResponse = await scraper.post(targetUrl, formData, { headers: postHeaders });
    console.log(`2단계: POST 요청 성공 (상태 코드: ${postResponse.status})`);

    const decodedHtml = iconv.decode(postResponse.data, 'EUC-KR');

    if (decodedHtml.includes("lot_no를 확인하여 주십시요")) {
        console.log(`'결과 없음' 감지: Lot No - ${lot_no}`);
        return res.status(200).json([]);
    }
    
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
    } else {
        console.log("경고: 결과 페이지는 받았으나, 데이터 테이블을 찾을 수 없습니다.");
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json(results);

  } catch (error) {
    console.error('스크래핑 처리 중 오류 발생:', error.message);
    if (error.response) {
      console.error(`오류 상태 코드: ${error.response.status}`);
    }
    res.status(500).json({ error: 'Failed to process the request.', details: error.message });
  }
};

