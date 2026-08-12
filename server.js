const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const MODEL = 'wan-video/wan-2.2-i2v-fast';
const jobs = new Map();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Faiyaz Gift Image-to-Video',
    provider: REPLICATE_TOKEN ? 'replicate' : 'browser-fallback',
    model: REPLICATE_TOKEN ? MODEL : null,
    aiConfigured: Boolean(REPLICATE_TOKEN),
    fal: false
  });
});

function cleanError(body, status) {
  if (!body) return `Provider returned HTTP ${status}.`;
  if (typeof body === 'string') return body.slice(0, 2000);
  return body.detail || body.error || body.message || JSON.stringify(body).slice(0, 2000);
}

app.post('/api/generate', async (req, res) => {
  if (!REPLICATE_TOKEN) {
    return res.status(503).json({
      ok: false,
      code: 'AI_PROVIDER_NOT_CONFIGURED',
      error: 'AI video generation is not configured on this server. Add REPLICATE_API_TOKEN in Render Environment Variables.'
    });
  }

  const { image, prompt, aspectRatio = '9:16', resolution = '480p', duration = 5 } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, code: 'INVALID_IMAGE', error: 'A valid image data URL is required.' });
  }
  if (image.length > 270000) {
    return res.status(413).json({ ok: false, code: 'IMAGE_TOO_LARGE', error: 'Compressed image is still too large. Please choose a smaller image.' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_PROMPT', error: 'A motion prompt is required.' });
  }

  // Wan 2.2 I2V Fast is best at 81 frames (~5 seconds at 16fps).
  const seconds = Number(duration) >= 10 ? 5 : 5;
  const input = {
    image,
    prompt,
    go_fast: true,
    num_frames: 81,
    resolution: resolution === '720p' ? '720p' : '480p',
    aspect_ratio: ['9:16', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '9:16',
    sample_shift: 12,
    frames_per_second: 16
  };

  try {
    const r = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=1'
      },
      body: JSON.stringify({ input })
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, code: 'REPLICATE_CREATE_ERROR', error: cleanError(data || raw, r.status), providerStatus: r.status });
    }
    const job = {
      id: data.id,
      status: data.status,
      output: data.output || null,
      error: data.error || null,
      createdAt: Date.now()
    };
    jobs.set(job.id, job);
    // Keep completed jobs around briefly for polling.
    setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000);
    res.json({ ok: true, id: job.id, status: job.status, output: job.output, provider: 'replicate', model: MODEL, duration: seconds });
  } catch (e) {
    res.status(502).json({ ok: false, code: 'PROVIDER_NETWORK_ERROR', error: e.message || 'Could not reach the AI provider.' });
  }
});

app.get('/api/generate/:id', async (req, res) => {
  if (!REPLICATE_TOKEN) return res.status(503).json({ ok: false, code: 'AI_PROVIDER_NOT_CONFIGURED', error: 'AI video generation is not configured on this server.' });
  const id = req.params.id;
  try {
    const r = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` }
    });
    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!r.ok) return res.status(r.status).json({ ok: false, code: 'REPLICATE_STATUS_ERROR', error: cleanError(data || raw, r.status), providerStatus: r.status });
    const job = jobs.get(id) || {};
    const response = { ok: true, id, status: data.status, output: data.output || null, error: data.error || null, logs: data.logs || null, provider: 'replicate', model: MODEL };
    jobs.set(id, { ...job, ...response });
    return res.json(response);
  } catch (e) {
    return res.status(502).json({ ok: false, code: 'PROVIDER_NETWORK_ERROR', error: e.message || 'Could not reach the AI provider.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Faiyaz Gift server running on port ${PORT}`));
