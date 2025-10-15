import axios from 'axios';
import https from 'https';

export default async function handler(request, response) {
  console.log('Function started'); // 로그 추가
  
  // CORS 설정
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  try {
    const { lot_no } = request.query;
    console.log('Lot number:', lot_no); // 로그 추가
    
    if (!lot_no) {
      return response.status(400).json({ 
        success: false, 
        error: 'lot_no query parameter is required' 
      });
    }

    // 간단한 테스트 응답
    const testData = {
      success: true,
      product: {
        name: "Acetonitrile [75-05-8]",
        code: "1698",
        lotNumber: lot_no,
        mfgDate: "2024-01-01",
        expDate: "2027-01-01"
      },
      tests: [
        {
          test: "Appearance",
          unit: "-",
          specification: "Clear, colorless liquid",
          result: "Clear, colorless liquid"
        },
        {
          test: "Assay",
          unit: "%",
          specification: "≥ 99.95",
          result: "99.99"
        }
      ],
      count: 2,
      message: "This is test data - API is working"
    };

    console.log('Returning test data'); // 로그 추가
    return response.status(200).json(testData);

  } catch (error) {
    console.error('Error details:', error);
    return response.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
