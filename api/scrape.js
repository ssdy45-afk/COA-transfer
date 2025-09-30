const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite'); // 한글 인코딩(EUC-KR) 변환을 위한 라이브러리

const createScraperInstance = () => {
  return axios.create({
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
  });
};

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  const scraper = createScraperInstance();
  const targetUrl = 'https://www.duksan.kr/product/pro_lot_search.php';
  const formData = new URLSearchParams();
  formData.append('lot_no', lot_no);

  try {
    const response = await scraper.post(targetUrl, formData, {
      headers: {
        // ★★★ 수정: 실제 브라우저 요청을 더 정확하게 모방하기 위해 헤더 정보 강화 ★★★
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        'Referer': targetUrl
      },
    });

    const decodedHtml = iconv.decode(response.data, 'EUC-KR');
    const $ = cheerio.load(decodedHtml);
    
    const resultTable = $('div.box-body table.table-lot-view');

    const results = [];
    if (resultTable.length > 0) {
        resultTable.find('tbody tr').each((i, elem) => {
            const tds = $(elem).find('td');
            if (tds.length === 5) {
                const item = {
                    item: $(tds[0]).text().trim(),
                    spec: $(tds[1]).text().trim(),
                    unit: $(tds[2]).text().trim(),
                    method: $(tds[3]).text().trim(),
                    result: $(tds[4]).text().trim(),
                };
                results.push(item);
            }
        });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=60');
    res.status(200).json(results);

  } catch (error) {
    // ★★★ 개선: 더 자세한 오류 원인을 파악하기 위한 로깅 기능 강화 ★★★
    console.error('Scraping error occurred.');
    if (error.response) {
      // Axios가 서버로부터 응답을 받았으나, 상태 코드가 2xx가 아닌 경우
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      // 응답 데이터가 있을 경우, 디코딩하여 로그로 남깁니다.
      const errorData = iconv.decode(error.response.data, 'EUC-KR');
      console.error('Data:', errorData);
    } else if (error.request) {
      // 요청은 이루어졌으나, 응답을 받지 못한 경우
      console.error('Request Error:', error.request);
    } else {
      // 요청을 설정하는 중에 에러가 발생한 경우
      console.error('General Error:', error.message);
    }
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

