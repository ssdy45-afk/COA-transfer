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
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        'Referer': targetUrl
      },
    });

    const decodedHtml = iconv.decode(response.data, 'EUC-KR');
    const $ = cheerio.load(decodedHtml);
    
    // ★★★ 수정: 결과 테이블이 존재하는지 먼저 확인하는 로직 추가 ★★★
    const resultTable = $('div.box-body table.table-lot-view');

    const results = [];
    if (resultTable.length > 0) {
        // 테이블이 존재할 경우에만 데이터 추출 실행
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
    // 결과가 없으면 results는 빈 배열 `[]`이 됩니다.

    // ★★★ 개선: 캐싱 전략 추가 ★★★
    // Vercel Edge에 결과를 1시간(3600초) 동안 캐싱하도록 설정합니다.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=60');

    // 추출한 데이터를 JSON 형태로 프론트엔드에 응답합니다.
    res.status(200).json(results);

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: 'Failed to scrape the website.', details: error.message });
  }
};

