const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  const { lot_no } = req.query;

  try {
    const response = await axios.post(
      'https://www.duksan.kr/product/pro_lot_search.php',
      `lot_no=${encodeURIComponent(lot_no)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000
      }
    );

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

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
