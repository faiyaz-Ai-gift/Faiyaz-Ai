const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Free public Hugging Face ZeroGPU Space running LTX 2.3 I2V.
// No FAL key and no Replicate credit are required by this integration.
const VIDEO_SPACE = (process.env.HF_VIDEO_SPACE || 'https://shaundeooo-ltx-2-3-fast.hf.space').replace(/\/$/, '');
const HF_TOKEN = process.env.HF_TOKEN || '';
const MODEL = 'LTX 2.3 Fast I2V (Hugging Face ZeroGPU)';
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
    aiConfigured: Boolean(VIDEO_SPACE),
    tokenRequired: false,
    fal: false,
    replicate: false,
    space: VIDEO_SPACE
  });
});

function errorText(value) {
  if (value === undefined || value === null || value === '') return 'Unknown/empty provider error.';
  if (typeof value === 'string') return value.slice(0, 12000);
  if (value.error !== undefined) return errorText(value.error);
  if (value.detail !== undefined) return errorText(value.detail);
  if (value.message !== undefined) return errorText(value.message);
  if (value.exception !== undefined) return errorText(value.exception);
  try { return JSON.stringify(value).slice(0, 12000); } catch { return String(value); }
}

function responsePreview(raw) {
  if (!raw) return 'EMPTY RESPONSE BODY';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 12000);
}

function headers() {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Faiyaz-Gift-ImageToVideo/1.1'
  };
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
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {})
    }
  });

  const rawContentType = r.headers.get('content-type') || '';
  const rawStatus = `${r.status} ${r.statusText || ''}`.trim();
  if (!r.ok) {
    const raw = await r.text();
    throw new Error(`Hugging Face result stream failed (HTTP ${rawStatus}). Provider response: ${responsePreview(raw)}`);
  }
  if (!r.body) throw new Error(`Hugging Face returned no result stream (HTTP ${rawStatus}, content-type ${rawContentType || 'unknown'}).`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastBlock = '';
  let finalResult = null;

  const handleBlock = (block) => {
    lastBlock = block;
    const msg = parseSseBlock(block);
    if (!msg.data) {
      if (msg.event === 'error') throw new Error(`Hugging Face emitted an empty error event. Raw SSE block: ${responsePreview(block)}`);
      return;
    }

    if (msg.event === 'generating' || msg.event === 'heartbeat' || msg.event === 'process_starts' || msg.event === 'process_generating') {
      job.status = 'processing';
      return;
    }
    if (msg.event === 'error' || msg.event === 'failed') {
      let parsed = msg.data;
      try { parsed = JSON.parse(msg.data); } catch {}
      throw new Error(`Hugging Face generation error: ${errorText(parsed)}${msg.data ? ` | Raw event: ${responsePreview(msg.data)}` : ` | Raw SSE block: ${responsePreview(block)}`}`);
    }
    if (msg.event === 'complete' || msg.event === 'done') {
      try {
        let parsed = JSON.parse(msg.data);
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch {}
        }
        finalResult = parsed;
      } catch (e) {
        throw new Error(`Invalid JSON in Hugging Face completion event: ${responsePreview(msg.data)}`);
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
      handleBlock(block);
      if (finalResult !== null) return finalResult;
    }
  }

  if (buffer.trim()) {
    handleBlock(buffer.trim());
    if (finalResult !== null) return finalResult;
  }

  throw new Error(`Hugging Face closed the result stream without a complete event. Content-Type: ${rawContentType || 'unknown'}. Last SSE block: ${responsePreview(lastBlock)}`);
}

async function runRemoteJob(job, input) {
  try {
    job.status = 'starting';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let start;
    try {
      start = await fetch(`${VIDEO_SPACE}/gradio_api/call/generate`, {
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
        ] }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const startRaw = await start.text();
    let startData = null;
    try { startData = JSON.parse(startRaw); } catch {}

    if (!start.ok) {
      throw new Error(`Hugging Face could not start the free generation (HTTP ${start.status}). Provider response: ${responsePreview(startRaw)}`);
    }
    if (!startData?.event_id) {
      // Gradio normally returns {event_id}. If it ever returns an error JSON,
      // surface that exact payload instead of the old generic/null message.
      throw new Error(`Hugging Face did not return an event ID. HTTP ${start.status}; Content-Type: ${start.headers.get('content-type') || 'unknown'}; Provider response: ${responsePreview(startRaw)}`);
    }

    job.remoteEventId = startData.event_id;
    job.status = 'processing';

    const result = await consumeSse(
      `${VIDEO_SPACE}/gradio_api/call/generate/${encodeURIComponent(startData.event_id)}`,
      job
    );

    // ShaundeOoO/ltx-2.3-fast returns:
    // { video: { url, content_type, ... }, seed, prompt }
    const payload = Array.isArray(result) ? result[0] : result;
    const video = payload?.video || payload?.output?.video || payload?.output;
    const url = typeof video === 'string' ? video : video?.url;

    if (!url) {
      throw new Error(`Free AI service completed but returned no video URL. Exact provider response: ${responsePreview(JSON.stringify(result))}`);
    }

    job.status = 'succeeded';
    job.output = url;
    job.meta = payload?.video || null;
    job.provider = 'huggingface-zerogpu';
    job.model = MODEL;
    job.finishedAt = Date.now();
  } catch (e) {
    const msg = e?.name === 'AbortError'
      ? 'Hugging Face start request timed out after 45 seconds.'
      : (e?.message || String(e));
    job.status = 'failed';
    job.error = msg;
    job.finishedAt = Date.now();
    console.error(`[job ${job.id}] ${msg}`);
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
