import axios from 'axios';
import * as https from 'https';           // ✅ ESM namespace import
import * as cheerio from 'cheerio';       // ✅ ESM namespace import

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(200).end();

  const { lot_no } = request.query || {};
  if (!lot_no) return response.status(400).json({ success: false, error: 'lot_no query parameter is required' });
  if (!/^[A-Za-z0-9]+$/.test(lot_no)) return response.status(400).json({ success: false, error: 'Invalid lot number format' });

  try {
    const targetUrl = `https://www.duksan.co.kr/page/03/lot_print.php?lot_num=${encodeURIComponent(lot_no)}`;

    const httpsAgent = new https.Agent({ keepAlive: true, timeout: 30000, rejectUnauthorized: false, keepAliveMsecs: 1000 });
    const config = {
      httpsAgent, timeout: 30000, maxRedirects: 5, decompress: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Referer': 'https://www.duksan.co.kr/',
        'Upgrade-Insecure-Requests': '1',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    };

    let res;
    let usedProxy = false;
    try {
      res = await axios.get(targetUrl, config);
    } catch (e) {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const proxy = await axios.get(proxyUrl, { timeout: 30000 });
      if (proxy.data && proxy.data.contents) {
        res = { status: 200, data: proxy.data.contents, headers: { 'content-type': 'text/html' } };
        usedProxy = true;
      } else {
        throw e;
      }
    }

    if (!res || res.status !== 200) {
      return response.status(502).json({ success: false, error: `Upstream fetch failed (${res?.status || 'no status'})` });
    }

    const html = res.data;
    const $ = cheerio.load(html);

    const bodyText = ($('body').text() || '').replace(/\s+/g, '');
    if (bodyText.length < 50) {
      return response.status(404).json({ success: false, error: 'Analysis certificate not found', message: `No certificate content for lot number: ${lot_no}` });
    }

    let results = [];
    $('table').each((_, table) => {
      $(table).find('tr').each((__, tr) => {
        const $cells = $(tr).find('td, th');
        if ($cells.length >= 4) {
          const row = {
            test: $cells.eq(0).text().trim(),
            unit: $cells.eq(1).text().trim(),
            specification: $cells.eq(2).text().trim(),
            result: $cells.eq(3).text().trim(),
          };
          if (isValidTestRow(row)) results.push(row);
        }
      });
    });
    if (results.length === 0) results = parseAlternativeTests($);

    const productName = extractProductName($, html);
    const productCode = extractProductCode($, html);
    const casNumber = extractCasNumber(html);
    const mfgDate = extractMfgDate(html);
    const expDate = extractExpDate(html);

    if (results.length === 0) {
      return response.status(404).json({ success: false, error: 'No test data found', message: 'Certificate found but no test rows could be extracted' });
    }

    return response.status(200).json({
      success: true,
      product: {
        name: productName || 'Chemical Product',
        code: productCode,
        casNumber,
        lotNumber: lot_no,
        mfgDate: mfgDate || new Date().toISOString().split('T')[0],
        expDate: expDate || '3 years after Mfg. Date',
      },
      tests: cleanExtractedData(results),
      count: results.length,
      source: usedProxy ? 'proxy' : 'direct',
    });
  } catch (error) {
    const msg = String(error?.message || 'Unknown error');
    let statusCode = 502;
    if (/timeout|ETIMEDOUT|Abort/i.test(msg)) statusCode = 408;
    if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EHOSTUNREACH/i.test(msg)) statusCode = 503;
    return response.status(statusCode).json({ success: false, error: 'Failed to fetch analysis certificate', message: msg });
  }
}

function isValidTestRow(item) {
  return item.test && item.test.length > 1 && !/^(TESTS|UNIT|SPECIFICATION|RESULTS|항목|시험항목|Test|Item)$/i.test(item.test);
}
function cleanExtractedData(results) {
  return results.map(item => ({
    test: (item.test || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    unit: (item.unit || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    specification: (item.specification || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
    result: (item.result || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(),
  })).filter(it => it.test && it.test.length > 1 && !/^(TESTS|UNIT|SPECIFICATION|RESULTS)$/i.test(it.test));
}
function parseAlternativeTests($) {
  const results = [];
  $('p, li, div').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const m = text.match(/^(.{2,40}?)\s{2,}([^\s].{0,60}?)\s{2,}([^\s].{0,60})$/);
    if (m) results.push({ test: m[1], unit: '', specification: m[2], result: m[3] });
  });
  return results;
}
function extractProductName($, html) {
  const h = $('h1,h2,h3').first().text().trim();
  if (h) return h;
  const m = html.match(/([A-Za-z][A-Za-z0-9\s\-]+)\s*\[\d{2}-\d{2}-\d{1}\]/);
  return m ? m[1] : '';
}
function extractProductCode($, html) {
  const codeLabel = $('td,th').filter((_, el) => /Product\s*code/i.test($(el).text())).next().text().trim();
  if (codeLabel) return codeLabel;
  const m = html.match(/Product(?:\s*code|\s*No\.?)\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
  return m ? m[1] : '';
}
function extractCasNumber(html) { const m = html.match(/\b\d{2}-\d{2}-\d\b/); return m ? m[0] : ''; }
function extractMfgDate(html) { const m = html.match(/Mfg\.?\s*Date\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i); return m ? m[1] : ''; }
function extractExpDate(html) { const m = html.match(/Exp\.?\s*Date\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i); return m ? m[1] : ''; }