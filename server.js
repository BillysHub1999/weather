const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'tupac-weather-secret',
  resave: false,
  saveUninitialized: false
}));

const USERNAME = 'bs';
const PASSWORD = 'bs1';

function requireAuth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          background: rgba(255,255,255,0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 40px;
          width: 100%;
          max-width: 380px;
          text-align: center;
        }
        h1 { color: #fff; font-size: 1.8rem; margin-bottom: 8px; }
        p { color: rgba(255,255,255,0.5); margin-bottom: 28px; font-size: 0.9rem; }
        input {
          width: 100%;
          padding: 12px 16px;
          margin-bottom: 14px;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 8px;
          background: rgba(255,255,255,0.08);
          color: #fff;
          font-size: 1rem;
          outline: none;
        }
        input::placeholder { color: rgba(255,255,255,0.3); }
        button {
          width: 100%;
          padding: 13px;
          background: #e94560;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        button:hover { opacity: 0.85; }
        .error { color: #e94560; margin-bottom: 16px; font-size: 0.9rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🌤️ Dashboard</h1>
        <p>Lake Oswego Weather & Portland News</p>
        ${req.query.error ? '<div class="error">Invalid username or password</div>' : ''}
        <form method="POST" action="/login">
          <input type="text" name="username" placeholder="Username" required autofocus />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Sign In</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Main dashboard
app.get('/', requireAuth, async (req, res) => {
  try {
    // Fetch weather from Open-Meteo (Lake Oswego, OR coords)
    const weatherRes = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=45.4207&longitude=-122.7009&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles'
    );
    const weatherData = await weatherRes.json();
    const cw = weatherData.current || {};
    const current = {
      temperature_2m: cw.temperature_2m,
      weathercode: cw.weather_code,
      windspeed_10m: cw.wind_speed_10m,
      relativehumidity_2m: cw.relative_humidity_2m,
      apparent_temperature: cw.apparent_temperature
    };

    const weatherCodes = {
      0: '☀️ Clear Sky', 1: '🌤️ Mainly Clear', 2: '⛅ Partly Cloudy', 3: '☁️ Overcast',
      45: '🌫️ Foggy', 48: '🌫️ Icy Fog', 51: '🌦️ Light Drizzle', 53: '🌦️ Drizzle',
      55: '🌧️ Heavy Drizzle', 61: '🌧️ Light Rain', 63: '🌧️ Rain', 65: '🌧️ Heavy Rain',
      71: '🌨️ Light Snow', 73: '❄️ Snow', 75: '❄️ Heavy Snow', 80: '🌦️ Rain Showers',
      81: '🌧️ Heavy Showers', 82: '⛈️ Violent Showers', 95: '⛈️ Thunderstorm'
    };
    const condition = weatherCodes[current.weathercode] || '🌡️ Unknown';

    // Fetch Portland news from RSS
    let newsItems = [];
    try {
      const feed = await parser.parseURL('https://www.oregonlive.com/arc/outboundfeeds/rss/?outputType=xml');
      newsItems = feed.items.slice(0, 8);
    } catch (e) {
      newsItems = [];
    }

    const newsHTML = newsItems.length > 0
      ? newsItems.map(item => `
          <a href="${item.link}" target="_blank" class="news-item">
            <div class="news-title">${item.title}</div>
            <div class="news-date">${item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : ''}</div>
          </a>
        `).join('')
      : '<p class="no-news">Could not load news at this time.</p>';

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Lake Oswego Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460);
            min-height: 100vh;
            color: #fff;
            padding: 20px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            max-width: 900px;
            margin: 0 auto 24px;
          }
          .header h1 { font-size: 1.4rem; color: rgba(255,255,255,0.9); }
          .logout {
            color: rgba(255,255,255,0.4);
            text-decoration: none;
            font-size: 0.85rem;
            border: 1px solid rgba(255,255,255,0.15);
            padding: 6px 12px;
            border-radius: 6px;
            transition: all 0.2s;
          }
          .logout:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
          .grid {
            max-width: 900px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: 340px 1fr;
            gap: 20px;
          }
          @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
          .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 24px;
          }
          .card h2 {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: rgba(255,255,255,0.4);
            margin-bottom: 20px;
          }
          .weather-temp {
            font-size: 4rem;
            font-weight: 700;
            line-height: 1;
            margin-bottom: 8px;
          }
          .weather-condition {
            font-size: 1.1rem;
            color: rgba(255,255,255,0.7);
            margin-bottom: 24px;
          }
          .weather-location {
            font-size: 0.85rem;
            color: rgba(255,255,255,0.4);
            margin-bottom: 20px;
          }
          .weather-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }
          .stat {
            background: rgba(255,255,255,0.05);
            border-radius: 10px;
            padding: 12px;
          }
          .stat-label {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.4);
            margin-bottom: 4px;
          }
          .stat-value {
            font-size: 1.1rem;
            font-weight: 600;
          }
          .news-item {
            display: block;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255,255,255,0.07);
            text-decoration: none;
            color: inherit;
            transition: opacity 0.2s;
          }
          .news-item:last-child { border-bottom: none; }
          .news-item:hover { opacity: 0.75; }
          .news-title {
            font-size: 0.9rem;
            line-height: 1.4;
            margin-bottom: 4px;
            color: rgba(255,255,255,0.85);
          }
          .news-date {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.35);
          }
          .no-news { color: rgba(255,255,255,0.4); font-size: 0.9rem; }
          .updated {
            text-align: center;
            color: rgba(255,255,255,0.2);
            font-size: 0.75rem;
            margin-top: 16px;
            max-width: 900px;
            margin-left: auto;
            margin-right: auto;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📍 Lake Oswego & Portland</h1>
          <a href="/logout" class="logout">Sign Out</a>
        </div>
        <div class="card" style="max-width:900px;margin:0 auto 20px;background:rgba(255,255,255,0.05);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;">
          <h2 style="font-size:0.8rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.4);margin-bottom:16px;">🛰️ Live Radar — Pacific Northwest</h2>
          <div id="map" style="height:360px;border-radius:10px;overflow:hidden;"></div>
        </div>

        <div class="grid">
          <div class="card">
            <h2>🌤️ Current Weather — Lake Oswego, OR</h2>
            <div class="weather-temp">${Math.round(current.temperature_2m)}°F</div>
            <div class="weather-condition">${condition}</div>
            <div class="weather-location">Lake Oswego, Oregon</div>
            <div class="weather-stats">
              <div class="stat">
                <div class="stat-label">Feels Like</div>
                <div class="stat-value">${Math.round(current.apparent_temperature)}°F</div>
              </div>
              <div class="stat">
                <div class="stat-label">Humidity</div>
                <div class="stat-value">${current.relativehumidity_2m}%</div>
              </div>
              <div class="stat">
                <div class="stat-label">Wind Speed</div>
                <div class="stat-value">${Math.round(current.windspeed_10m)} mph</div>
              </div>
            </div>
          </div>
          <div class="card">
            <h2>📰 Latest Portland News</h2>
            ${newsHTML}
          </div>
        </div>
        <div class="updated">Last updated: ${new Date().toLocaleString('en-US', {timeZone:'America/Los_Angeles'})}</div>

        <script>
          // Initialize map centered on Lake Oswego
          const map = L.map('map').setView([45.4207, -122.7009], 8);

          // Base tile layer (dark theme)
          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 19
          }).addTo(map);

          // RainViewer radar overlay
          fetch('https://api.rainviewer.com/public/weather-maps.json')
            .then(r => r.json())
            .then(data => {
              const frames = data.radar.past;
              const latest = frames[frames.length - 1];
              L.tileLayer('https://tilecache.rainviewer.com' + latest.path + '/256/{z}/{x}/{y}/2/1_1.png', {
                opacity: 0.6,
                attribution: 'RainViewer'
              }).addTo(map);
            });

          // Marker for Lake Oswego
          L.marker([45.4207, -122.7009])
            .addTo(map)
            .bindPopup('<b>Lake Oswego, OR</b>')
            .openPopup();
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    res.send('Error loading dashboard: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
