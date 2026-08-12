const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Free public Hugging Face ZeroGPU Space running LTX 2.3 I2V.
// No FAL key and no Replicate credit are required by this integration.
const VIDEO_SPACE = process.env.HF_VIDEO_SPACE || 'https://shaundeoOo-ltx-2-3-fast.hf.space';
const HF_TOKEN = process.env.HF_TOKEN || '';
const MODEL = 'LTX 2.3 I2V (Hugging Face ZeroGPU)';
const jobs = new Map();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Faiyaz Gift Image-to-Video',
    provider: 'huggingface-zerogpu',
    model: MODEL,
    aiConfigured: true,
    tokenRequired: false,
    fal: false,
    replicate: false,
    space: VIDEO_SPACE
  });
});

function errorText(value) {
  if (!value) return 'The free AI video service returned an empty error.';
  if (typeof value === 'string') return value.slice(0, 4000);
  if (value.error) return errorText(value.error);
  if (value.message) return errorText(value.message);
  if (value.detail) return errorText(value.detail);
  try { return JSON.stringify(value).slice(0, 4000); } catch { return String(value); }
}

function headers() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (HF_TOKEN) h.Authorization = `Bearer ${HF_TOKEN}`;
  return h;
}

function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  return { event, data: dataLines.join('\n') };
}

async function consumeSse(url, job) {
  const r = await fetch(url, { headers: HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {} });
  const rawContentType = r.headers.get('content-type') || '';
  if (!r.ok) {
    const raw = await r.text();
    throw new Error(`Hugging Face result stream failed (HTTP ${r.status}): ${errorText(raw)}`);
  }
  if (!r.body) throw new Error('Hugging Face returned no result stream.');

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
      const msg = parseSseBlock(block);
      if (!msg.data) continue;

      if (msg.event === 'generating' || msg.event === 'heartbeat') {
        job.status = 'processing';
        continue;
      }
      if (msg.event === 'error') {
        let parsed = msg.data;
        try { parsed = JSON.parse(msg.data); } catch {}
        throw new Error(errorText(parsed));
      }
      if (msg.event === 'complete') {
        try { finalResult = JSON.parse(msg.data); }
        catch { throw new Error(`Invalid JSON in Hugging Face completion: ${msg.data.slice(0, 2000)}`); }
        return finalResult;
      }
    }
  }

  // Some proxies omit the final blank line; process the remaining block.
  if (buffer.trim()) {
    const msg = parseSseBlock(buffer);
    if (msg.event === 'complete' && msg.data) {
      try { return JSON.parse(msg.data); } catch {}
    }
  }

  if (finalResult) return finalResult;
  throw new Error(`Hugging Face closed the result stream without a complete event (${rawContentType || 'unknown content type'}).`);
}

async function runRemoteJob(job, input) {
  try {
    job.status = 'starting';
    const start = await fetch(`${VIDEO_SPACE}/gradio_api/call/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ data: [
        input.image,
        input.prompt,
        input.negativePrompt,
        input.resolution,
        input.duration,
        -1,
        'video/h264-mp4',
        false
      ] })
    });

    const startRaw = await start.text();
    let startData;
    try { startData = JSON.parse(startRaw); } catch { startData = null; }
    if (!start.ok) {
      throw new Error(`Hugging Face could not start the free generation (HTTP ${start.status}): ${errorText(startData || startRaw)}`);
    }
    if (!startData?.event_id) {
      throw new Error(`Hugging Face did not return an event ID: ${startRaw.slice(0, 3000)}`);
    }

    job.remoteEventId = startData.event_id;
    job.status = 'processing';
    const result = await consumeSse(`${VIDEO_SPACE}/gradio_api/call/generate/${encodeURIComponent(startData.event_id)}`, job);

    // submit() returns: {video:{url,...}, seed, prompt}
    const payload = Array.isArray(result) ? result[0] : result;
    const video = payload?.video || payload?.output?.video || payload?.output;
    const url = typeof video === 'string' ? video : video?.url;
    if (!url) throw new Error(`Free AI service completed but returned no video URL. Response: ${JSON.stringify(result).slice(0, 4000)}`);

    job.status = 'succeeded';
    job.output = url;
    job.meta = payload?.video || null;
    job.provider = 'huggingface-zerogpu';
    job.model = MODEL;
    job.finishedAt = Date.now();
  } catch (e) {
    job.status = 'failed';
    job.error = e?.message || String(e);
    job.finishedAt = Date.now();
  }
}

app.post('/api/generate', async (req, res) => {
  const { image, prompt, aspectRatio = '9:16', resolution = '720p', duration = 5 } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ ok: false, code: 'INVALID_IMAGE', error: 'A valid image data URL is required.' });
  }
  if (image.length > 500000) {
    return res.status(413).json({ ok: false, code: 'IMAGE_TOO_LARGE', error: 'Compressed image is still too large. Please choose a smaller image.' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_PROMPT', error: 'A motion prompt is required.' });
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    output: null,
    error: null,
    createdAt: Date.now(),
    provider: 'huggingface-zerogpu',
    model: MODEL,
    aspectRatio,
    resolution: resolution === '1080p' ? '1080p' : '720p',
    duration: Number(duration) >= 10 ? 10 : 5
  };
  jobs.set(id, job);

  // Do not keep the browser request open while the free GPU is working.
  // The frontend polls this local job endpoint, so Render's request timeout
  // does not kill a long free generation.
  void runRemoteJob(job, {
    image,
    prompt: prompt.trim(),
    negativePrompt: 'deformed motion, warped faces, extra limbs, duplicate people, changing clothes, changing faces, floating objects, flickering, shaky camera, blurry faces, text, subtitles, watermark, logo',
    resolution: job.resolution,
    duration: job.duration
  });

  res.json({ ok: true, id, status: job.status, provider: job.provider, model: MODEL, duration: job.duration });
});

app.get('/api/generate/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', error: 'Generation job was not found or has expired.' });

  if (job.status === 'failed') {
    return res.status(502).json({ ok: false, code: 'FREE_AI_ERROR', error: job.error, provider: job.provider, model: job.model });
  }
  return res.json({
    ok: true,
    id: job.id,
    status: job.status,
    output: job.output,
    error: job.error,
    provider: job.provider,
    model: job.model,
    meta: job.meta || null
  });
});

// Keep completed jobs briefly so the browser can fetch the video URL.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Faiyaz Gift server running on port ${PORT}`));
