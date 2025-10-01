const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no query parameter is required' });
  }

  try {
    // 다양한 가능한 URL 시도
    const urls = [
      'https://www.duksan.kr/product/pro_lot_search.php',
      'https://duksan.kr/product/pro_lot_search.php',
      'https://www.duksan.kr/product/pro_lot_search',
      'https://duksan.kr/product/pro_lot_search'
    ];

    let lastError = null;

    for (const url of urls) {
      try {
        console.log(`Trying URL: ${url}`);
        
        const response = await axios.post(
          url,
          `lot_no=${encodeURIComponent(lot_no)}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
          }
        );

        console.log(`Success with URL: ${url}, status: ${response.status}`);
        
        const $ = cheerio.load(response.data);
        const results = [];

        $('div.box-body table.table-lot-view tbody tr').each((index, element) => {
          const $cells = $(element).find('td');
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

        if (results.length > 0 || response.data.includes("lot_no를 확인하여 주십시요")) {
          return res.status(200).json(results);
        }

      } catch (error) {
        lastError = error;
        console.log(`Failed with URL: ${url}, error: ${error.message}`);
        continue; // 다음 URL 시도
      }
    }

    // 모든 URL 실패
    throw lastError || new Error('All URL attempts failed');

  } catch (error) {
    console.error('All attempts failed:', error.message);
    res.status(500).json({ 
      error: 'All search attempts failed',
      message: error.message
    });
  }
};
