// Vercel 서버리스 환경에서 실행될 Node.js 함수입니다.
// 필요한 라이브러리를 가져옵니다.
// axios: HTTP 요청을 쉽게 보낼 수 있게 해주는 라이브러리
// cheerio: 서버 환경에서 jQuery처럼 HTML을 다룰 수 있게 해주는 라이브러리
const axios = require('axios');
const cheerio = require('cheerio');

// Vercel의 서버리스 함수는 기본적으로 'handler' 또는 'default' export를 내보내야 합니다.
module.exports = async (req, res) => {
  // --- 1. 프론트엔드에서 보낸 Lot 번호 가져오기 ---
  // 프론트에서 GET 방식으로 /api/scrape?lot_no=값 형태로 요청합니다.
  const { lot_no } = req.query;

  // Lot 번호가 없으면 에러 응답을 보냅니다.
  if (!lot_no) {
    return res.status(400).json({ error: 'lot_no가 필요합니다.' });
  }

  // --- 2. 대상 웹사이트에 데이터 요청하기 ---
  const targetUrl = 'https://www.duksan.co.kr/product/coa_result.php';
  // 덕산 사이트는 form-data 형태로 POST 요청을 받으므로, 요청 본문을 구성합니다.
  const formData = new URLSearchParams();
  formData.append('lot_no', lot_no);

  try {
    // axios를 사용해 대상 URL에 POST 요청을 보냅니다.
    const response = await axios.post(targetUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    // --- 3. 수신한 HTML 데이터 파싱하기 ---
    const html = response.data;
    const $ = cheerio.load(html); // Cheerio로 HTML을 로드합니다.

    const results = [];
    // 덕산 사이트의 결과 테이블 구조에 맞춰 데이터를 추출합니다.
    // 'tbody tr'는 테이블의 바디에 있는 모든 행(row)을 선택합니다.
    $('tbody tr').each((index, element) => {
      // 각 행(tr)에서 열(td)들을 찾습니다.
      const tds = $(element).find('td');
      // 각 열의 텍스트를 추출하여 객체로 만듭니다.
      const rowData = {
        item: $(tds[0]).text().trim(),
        spec: $(tds[1]).text().trim(),
        unit: $(tds[2]).text().trim(),
        method: $(tds[3]).text().trim(),
        result: $(tds[4]).text().trim(),
      };
      results.push(rowData);
    });

    // --- 4. 파싱한 데이터를 JSON 형태로 프론트엔드에 응답하기 ---
    // 성공적으로 데이터를 추출했으면 200 상태 코드와 함께 JSON 데이터를 보냅니다.
    res.status(200).json(results);

  } catch (error) {
    // 스크래핑 과정에서 에러가 발생하면 500 상태 코드와 에러 메시지를 보냅니다.
    console.error('스크래핑 에러:', error);
    res.status(500).json({ error: '데이터를 가져오는 중 오류가 발생했습니다.' });
  }
};
