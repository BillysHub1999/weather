const express = require('express');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── NEWS ──
app.get('/api/news', async (req, res) => {
  const feeds = [
    { url: 'https://feeds.apnews.com/rss/apf-topnews',              source: 'AP News',      category: 'US' },
    { url: 'https://feeds.npr.org/1001/rss.xml',                     source: 'NPR',          category: 'US' },
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',            source: 'BBC World',    category: 'International' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NY Times',     category: 'International' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',         source: 'BBC Business', category: 'Markets' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw-topstories', source: 'MarketWatch', category: 'Markets' },
    { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html',   source: 'CNBC',         category: 'Markets' },
  ];
  try {
    const allItems = [];
    await Promise.allSettled(feeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        parsed.items.slice(0, 6).forEach(item => {
          allItems.push({ title: item.title, link: item.link, date: item.pubDate,
            source: feed.source, category: feed.category,
            summary: item.contentSnippet?.slice(0, 150) || '' });
        });
      } catch(e) {}
    }));
    allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(allItems);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUT/CALL RATIO (CBOE) ──
app.get('/api/pcr', async (req, res) => {
  try {
    const r = await fetch('https://www.cboe.com/us/options/market_statistics/daily/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await r.text();
    // Parse total P/C ratio from CBOE page
    const match = html.match(/Total Put\/Call Ratio[\s\S]*?<td[^>]*>([\d.]+)<\/td>/i)
      || html.match(/(\d\.\d{2})<\/td>[\s\S]{0,200}?Total/i);
    if (match) {
      return res.json({ pcr: parseFloat(match[1]), source: 'CBOE', date: new Date().toISOString() });
    }
    // Fallback: try CBOE CSV
    const csv = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/SPX_put_call_ratio.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (csv.ok) {
      const d = await csv.json();
      const last = d?.data?.slice(-1)[0];
      if (last) return res.json({ pcr: parseFloat(last[1]), source: 'CBOE SPX', date: last[0] });
    }
    res.json({ pcr: null, error: 'unavailable' });
  } catch(e) { res.json({ pcr: null, error: e.message }); }
});

// ── YIELD CURVE (US Treasury API) ──
app.get('/api/yields', async (req, res) => {
  try {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${ym}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xml = await r.text();
    // Get last entry
    const entries = [...xml.matchAll(/<content[^>]*>([\s\S]*?)<\/content>/g)];
    const last = entries[entries.length - 1]?.[1] || '';
    const get = (tag) => { const m = last.match(new RegExp(`<d:${tag}[^>]*>([\\d.]+)<`)); return m ? parseFloat(m[1]) : null; };
    const y2 = get('BC_2YEAR');
    const y10 = get('BC_10YEAR');
    const y30 = get('BC_30YEAR');
    const y3m = get('BC_3MONTH');
    const spread = (y2 && y10) ? (y10 - y2).toFixed(2) : null;
    const inverted = spread !== null && parseFloat(spread) < 0;
    res.json({ y3m, y2, y10, y30, spread, inverted, date: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRENDING TICKERS (Yahoo Finance) ──
app.get('/api/trending', async (req, res) => {
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/finance/trending/US?count=10&useQuotes=true', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json' }
    });
    const data = await r.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    // Enrich with prices
    const symbols = quotes.map(q => q.symbol).join(',');
    const priceR = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const priceData = await priceR.json();
    const results = (priceData?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice?.toFixed(2),
      change: q.regularMarketChange?.toFixed(2),
      changePct: q.regularMarketChangePercent?.toFixed(2),
      volume: q.regularMarketVolume,
    }));
    res.json(results.slice(0, 10));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
