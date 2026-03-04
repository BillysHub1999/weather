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

// ── FEAR & GREED INDEX (CNN) ──
app.get('/api/pcr', async (req, res) => {
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.cnn.com/markets/fear-and-greed',
        'Accept': 'application/json'
      }
    });
    const d = await r.json();
    const fg = d?.fear_and_greed;
    if (fg) {
      return res.json({
        score: Math.round(fg.score),
        rating: fg.rating,
        prev_close: Math.round(fg.previous_close),
        prev_week: Math.round(fg.previous_1_week),
        prev_month: Math.round(fg.previous_1_month),
        timestamp: fg.timestamp
      });
    }
    res.json({ score: null, error: 'unavailable' });
  } catch(e) { res.json({ score: null, error: e.message }); }
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

// ── SECTOR PERFORMANCE (v8 chart endpoint, one at a time) ──
app.get('/api/sectors', async (req, res) => {
  try {
    const etfs = ['XLK','XLV','XLF','XLE','XLI','XLY','XLP','XLRE','XLU','XLB'];
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com'
    };
    const results = await Promise.all(etfs.map(async (sym) => {
      try {
        const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { headers });
        const d = await r.json();
        const meta = d?.chart?.result?.[0]?.meta || {};
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose;
        const pct = price && prev ? ((price - prev) / prev) * 100 : null;
        return { symbol: sym, pct, price };
      } catch(e) { return { symbol: sym, pct: null, price: null }; }
    }));
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRENDING TICKERS (Yahoo Finance query2) ──
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.get('/api/trending', async (req, res) => {
  try {
    const yHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com'
    };
    const trendR = await fetch('https://query2.finance.yahoo.com/v1/finance/trending/US?count=10', { headers: yHeaders });
    const trendData = await trendR.json();
    const symbols = (trendData?.finance?.result?.[0]?.quotes || []).map(q => q.symbol).slice(0, 10);
    if (!symbols.length) return res.json([]);
    // Enrich one at a time to avoid 429
    const results = [];
    for (const sym of symbols) {
      try {
        await sleep(250);
        const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`, { headers: yHeaders });
        const d = await r.json();
        const meta = d?.chart?.result?.[0]?.meta || {};
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose;
        const change = price && prev ? price - prev : null;
        const changePct = change && prev ? (change / prev) * 100 : null;
        results.push({
          symbol: sym,
          name: meta.shortName || meta.longName || sym,
          price: price?.toFixed(2),
          change: change?.toFixed(2),
          changePct: changePct?.toFixed(2),
        });
      } catch(e) { results.push({ symbol: sym, name: sym, price: null, change: null, changePct: null }); }
    }
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
