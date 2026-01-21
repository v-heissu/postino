const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/fetch', async (req, res) => {
  const { endpoint, body, token, maxPages = 10, delay = 500 } = req.body;

  if (!endpoint || !body || !token) {
    return res.status(400).json({ error: 'Missing endpoint, body, or token' });
  }

  let parsedBody;
  try {
    parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const limit = parsedBody.limit || 1000;
  const maxPagesLimit = maxPages === 0 ? 1000 : maxPages; // 0 = unlimited (capped at 1000)
  let offset = parsedBody.offset || 0;
  let allResults = [];
  let totalFetched = 0;
  let pageCount = 0;

  // Set up SSE for progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (message) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', message })}\n\n`);
  };

  try {
    while (true) {
      const currentBody = { ...parsedBody, offset, limit };
      pageCount++;

      sendProgress(`Fetching page ${pageCount} (offset: ${offset})...`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(currentBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.write(`data: ${JSON.stringify({ type: 'error', error: `API Error ${response.status}: ${errorText}` })}\n\n`);
        res.end();
        return;
      }

      const data = await response.json();

      // Handle different response formats
      let results = [];
      if (Array.isArray(data)) {
        results = data;
      } else if (data.results && Array.isArray(data.results)) {
        results = data.results;
      } else if (data.data && Array.isArray(data.data)) {
        results = data.data;
      } else if (data.items && Array.isArray(data.items)) {
        results = data.items;
      } else {
        // If it's a single object response, wrap it
        results = [data];
      }

      allResults = allResults.concat(results);
      totalFetched += results.length;

      sendProgress(`Page ${pageCount} fetched: ${results.length} items (total: ${totalFetched})`);

      // Stop if we got fewer results than the limit (last page)
      if (results.length < limit) {
        break;
      }

      // Stop if we reached max pages
      if (pageCount >= maxPagesLimit) {
        sendProgress(`Reached max pages limit (${maxPagesLimit})`);
        break;
      }

      offset += limit;

      // Add delay between calls
      if (delay > 0) {
        sendProgress(`Waiting ${delay}ms...`);
        await sleep(delay);
      }
    }

    sendProgress(`Done! Total items fetched: ${allResults.length}`);
    res.write(`data: ${JSON.stringify({ type: 'complete', data: allResults, total: allResults.length })}\n\n`);
    res.end();

  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Postino running on port ${PORT}`);
});
