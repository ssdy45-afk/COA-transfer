const axios = require('axios');

module.exports = async (req, res) => {
  const { lot_no } = req.query;
  
  try {
    const response = await axios.get(`https://www.duksan.kr/page/03/lot_print.php?lot_num=${lot_no}`);
    
    res.json({
      success: true,
      status: response.status,
      dataLength: response.data.length,
      lot_no: lot_no
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      lot_no: lot_no
    });
  }
};
