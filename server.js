const express = require('express');
const fetch = require('node-fetch');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// ── STOCK FUTURES ──
app.get('/api/stocks', async (req, res) => {
  try {
    const symbols = [
      { symbol: 'ES=F',  name: 'S&P 500',  type: 'index' },
      { symbol: 'NQ=F',  name: 'NASDAQ',   type: 'index' },
      { symbol: 'GC=F',  name: 'Gold',     type: 'commodity' },
      { symbol: 'SI=F',  name: 'Silver',   type: 'commodity' },
      { symbol: 'CL=F',  name: 'Crude Oil',type: 'commodity' },
      { symbol: 'DX-Y.NYB', name: 'USD Index', type: 'currency' },
    ];

    const results = await Promise.all(symbols.map(async (s) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${s.symbol}?interval=1d&range=2d`;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = await r.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return { ...s, error: true };

        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose;
        const change = price - prev;
        const changePct = (change / prev) * 100;

        return {
          ...s,
          price: price?.toFixed(2),
          change: change?.toFixed(2),
          changePct: changePct?.toFixed(2),
          currency: meta.currency || 'USD',
          marketState: meta.marketState,
        };
      } catch(e) {
        return { ...s, error: true };
      }
    }));

    res.json(results);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEWS ──
app.get('/api/news', async (req, res) => {
  const feeds = [
    { url: 'https://feeds.apnews.com/rss/apf-topnews',           source: 'AP News',     category: 'US' },
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        source: 'BBC World',   category: 'International' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',     source: 'BBC Business',category: 'Business' },
    { url: 'https://feeds.npr.org/1001/rss.xml',                  source: 'NPR',         category: 'US' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NY Times', category: 'International' },
  ];

  try {
    const allItems = [];
    await Promise.allSettled(feeds.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        parsed.items.slice(0, 5).forEach(item => {
          allItems.push({
            title: item.title,
            link: item.link,
            date: item.pubDate,
            source: feed.source,
            category: feed.category,
            summary: item.contentSnippet?.slice(0, 150) || ''
          });
        });
      } catch(e) {}
    }));

    // Sort by date, newest first
    allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(allItems.slice(0, 20));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WEATHER ──
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
