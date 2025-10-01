const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  try {
    // 검색 페이지 가져오기
    const searchResponse = await axios.get('https://www.duksan.kr/product/pro_lot_search.php', {
      params: { lot_no },
      timeout: 10000
    });

    const $ = cheerio.load(searchResponse.data);
    const results = [];

    // 결과 테이블 파싱
    $('div.box-body table.table-lot-view tbody tr').each((index, element) => {
      const $row = $(element);
      const $cells = $row.find('td');
      
      if ($cells.length === 5) {
        results.push({
          item: $cells.eq(0).text().trim(),
          spec: $cells.eq(1).text().trim(),
          unit: $cells.eq(2).text().trim(),
          method: $cells.eq(3).text().trim(),
          result: $cells.eq(4).text().trim(),
        });
      }
    });

    if (results.length === 0 && searchResponse.data.includes("lot_no를 확인하여 주십시요")) {
      return res.status(200).json([]);
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(results);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message
    });
  }
};
