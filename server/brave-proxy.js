const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/brave-search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Brave API key not configured' });
    }

    console.log(`[BRAVE-PROXY] Searching for: "${q}"`);

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.append('q', q);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
        'User-Agent': 'Game-Shaper-AI/1.0'
      }
    });

    console.log(`[BRAVE-PROXY] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BRAVE-PROXY] Error response: ${errorText}`);
      return res.status(response.status).json({ 
        error: `Brave API error: ${response.status} ${response.statusText}`,
        details: errorText
      });
    }

    const data = await response.json();
    console.log(`[BRAVE-PROXY] Success: ${data.web?.results?.length || 0} results`);
    
    res.json(data);
  } catch (error) {
    console.error('[BRAVE-PROXY] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[BRAVE-PROXY] Server running on port ${PORT}`);
  console.log(`[BRAVE-PROXY] API Key configured: ${!!process.env.VITE_BRAVE_API_KEY || !!process.env.BRAVE_API_KEY}`);
}); 