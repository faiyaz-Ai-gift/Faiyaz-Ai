const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { fal } = require('@fal-ai/client');

const app = express();
const PORT = process.env.PORT || 10000;
const FAL_KEY = process.env.FAL_KEY || '';
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const HF_TOKEN = process.env.HF_TOKEN || '';
const HF_VIDEO_SPACE = process.env.HF_VIDEO_SPACE || '';

// Provider order can be changed without touching the frontend.
// A provider is skipped automatically when its required server-side key is absent.
const PROVIDERS = [
  { id: 'fal-ltx23', name: 'FAL · LTX 2.3', type: 'fal', model: 'fal-ai/ltx-2.3/image-to-video' },
  { id: 'fal-kling3', name: 'FAL · Kling 3.0 Pro', type: 'fal', model: 'fal-ai/kling-video/v3/pro/image-to-video' },
  { id: 'fal-wan21', name: 'FAL · Wan 2.1 I2V', type: 'fal', model: 'fal-ai/wan-i2v' },
  { id: 'fal-pika22', name: 'FAL · Pika 2.2', type: 'fal', model: 'fal-ai/pika/v2.2/image-to-video' },
  { id: 'fal-svd', name: 'FAL · Stable Video Diffusion', type: 'fal', model: 'fal-ai/stable-video' },
  { id: 'replicate-ltx23', name: 'Replicate · LTX 2.3 Pro', type: 'replicate', model: 'lightricks/ltx-2.3-pro' },
  { id: 'replicate-wan21', name: 'Replicate · Wan 2.1 I2V', type: 'replicate', model: 'wavespeedai/wan-2.1-i2v-480p' },
  { id: 'replicate-svd', name: 'Replicate · Stable Video Diffusion', type: 'replicate', model: 'christophy/stable-video-diffusion' },
  ...(HF_VIDEO_SPACE ? [{ id: 'hf-space', name: 'Hugging Face Space', type: 'hf-space', model: HF_VIDEO_SPACE }] : [])
];

const jobs = new Map();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function errorText(value) {
  if (value == null || value === '') return 'Provider returned an empty error.';
  if (typeof value === 'string') return value.slice(0, 5000);
  if (value.error) return errorText(value.error);
  if (value.message) return errorText(value.message);
  if (value.detail) return errorText(value.detail);
  if (value.errors) return errorText(value.errors);
  try { return JSON.stringify(value).slice(0, 5000); } catch { return String(value); }
}

function configured(p) {
  if (p.type === 'fal') return Boolean(FAL_KEY);
  if (p.type === 'replicate') return Boolean(REPLICATE_API_TOKEN);
  if (p.type === 'hf-space') return Boolean(HF_VIDEO_SPACE);
  return false;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Faiyaz Gift Image-to-Video',
    mode: 'multi-provider-fallback',
    providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, model: p.model, configured: configured(p) })),
    configuredCount: PROVIDERS.filter(configured).length
  });
});

function falInput(provider, input) {
  const base = {
    prompt: input.prompt,
    negative_prompt: input.negativePrompt,
    duration: String(input.duration),
    aspect_ratio: input.aspectRatio
  };
  switch (provider.id) {
    case 'fal-kling3':
      return { ...base, start_image_url: input.image, duration: String(Math.min(Math.max(input.duration, 3), 15)), generate_audio: false };
    case 'fal-wan21':
      return { image_url: input.image, prompt: input.prompt };
    case 'fal-pika22':
      return { ...base, image_url: input.image, duration: Math.min(Math.max(input.duration, 5), 10), resolution: input.resolution };
    case 'fal-svd':
      return { image_url: input.image, motion_bucket_id: 180, cond_aug: 0.02, fps: 25 };
    default:
      return { ...base, image_url: input.image, generate_audio: false };
  }
}

async function runFal(provider, input) {
  fal.config({ credentials: FAL_KEY });
  const result = await fal.subscribe(provider.model, {
    input: falInput(provider, input),
    logs: false
  });
  const data = result?.data || result;
  const video = data?.video || data?.output?.video || data?.output;
  const url = typeof video === 'string' ? video : video?.url;
  if (!url) throw new Error(`FAL completed but returned no video URL. Response: ${errorText(data)}`);
  return { url, meta: data, requestId: result?.requestId || null };
}

function replicateInput(provider, input) {
  if (provider.id === 'replicate-ltx23') {
    return {
      task: 'image_to_video',
      prompt: input.prompt,
      image: input.image,
      resolution: input.resolution === '1080p' ? '1080p' : '1080p',
      duration: input.duration >= 10 ? '10' : '6',
      aspect_ratio: input.aspectRatio === '9:16' ? '9:16' : '16:9',
      fps: 25,
      camera_motion: 'none',
      generate_audio: false
    };
  }
  if (provider.id === 'replicate-wan21') {
    return {
      image: input.image,
      prompt: input.prompt,
      fast_mode: 'Balanced',
      lora_scale: 1,
      aspect_ratio: input.aspectRatio,
      sample_shift: 3,
      sample_steps: 30,
      negative_prompt: input.negativePrompt,
      sample_guide_scale: 5
    };
  }
  return {
    input_image: input.image,
    video_length: input.duration >= 10 ? '25_frames_with_svd_xt' : '14_frames_with_svd',
    sizing_strategy: 'maintain_aspect_ratio',
    frames_per_second: 8,
    motion_bucket_id: 180,
    cond_aug: 0.02
  };
}

async function runReplicate(provider, input) {
  const r = await fetch(`https://api.replicate.com/v1/models/${provider.model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=10'
    },
    body: JSON.stringify({ input: replicateInput(provider, input) })
  });
  const raw = await r.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!r.ok) throw new Error(`Replicate start failed (HTTP ${r.status}): ${errorText(data || raw)}`);
  if (!data?.id) throw new Error(`Replicate did not return a prediction ID: ${errorText(data || raw)}`);

  let current = data;
  for (let i = 0; i < 900; i++) {
    if (current.status === 'succeeded') {
      const out = current.output;
      const first = Array.isArray(out) ? out[0] : out;
      const url = typeof first === 'string' ? first : first?.url || first?.video?.url;
      if (!url) throw new Error(`Replicate succeeded but returned no video URL: ${errorText(current)}`);
      return { url, meta: current, requestId: current.id };
    }
    if (['failed', 'canceled'].includes(current.status)) {
      throw new Error(`Replicate ${current.status}: ${errorText(current.error || current.logs || current)}`);
    }
    await new Promise(r => setTimeout(r, 2000));
    const sr = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(data.id)}`, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` }
    });
    const sraw = await sr.text();
    try { current = JSON.parse(sraw); } catch { throw new Error(`Replicate returned non-JSON status (HTTP ${sr.status}): ${sraw.slice(0, 2000)}`); }
    if (!sr.ok) throw new Error(`Replicate status failed (HTTP ${sr.status}): ${errorText(current)}`);
  }
  throw new Error('Replicate timed out while waiting for the prediction.');
}

// Kept as an optional final fallback for a user-supplied Gradio Space.
async function runHFSpace(provider, job, input) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (HF_TOKEN) headers.Authorization = `Bearer ${HF_TOKEN}`;
  const start = await fetch(`${provider.model}/gradio_api/call/generate`, {
    method: 'POST', headers,
    body: JSON.stringify({ data: [input.image, input.prompt, input.negativePrompt, input.resolution, input.duration, -1, 'video/h264-mp4', false] })
  });
  const raw = await start.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!start.ok || !data?.event_id) throw new Error(`Hugging Face Space start failed (HTTP ${start.status}): ${errorText(data || raw)}`);
  const sr = await fetch(`${provider.model}/gradio_api/call/generate/${encodeURIComponent(data.event_id)}`, { headers: HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {} });
  if (!sr.ok) throw new Error(`Hugging Face Space stream failed (HTTP ${sr.status}): ${errorText(await sr.text())}`);
  const text = await sr.text();
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const event = (block.match(/^event:\s*(.*)$/m) || [])[1];
    const lines = block.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim());
    if (event === 'error') throw new Error(errorText(lines.join('\n')));
    if (event === 'complete' && lines.length) {
      let payload; try { payload = JSON.parse(lines.join('\n')); } catch { continue; }
      const obj = Array.isArray(payload) ? payload[0] : payload;
      const video = obj?.video || obj?.output?.video || obj?.output;
      const url = typeof video === 'string' ? video : video?.url;
      if (url) return { url, meta: payload };
    }
  }
  throw new Error('Hugging Face Space returned no completed video URL.');
}

async function runProvider(provider, job, input) {
  if (provider.type === 'fal') return runFal(provider, input);
  if (provider.type === 'replicate') return runReplicate(provider, input);
  return runHFSpace(provider, job, input);
}

async function runWithFallback(job, input) {
  const attempts = [];
  for (const provider of PROVIDERS) {
    if (!configured(provider)) {
      attempts.push({ provider: provider.name, skipped: true, reason: 'API key not configured' });
      continue;
    }
    job.provider = provider.id;
    job.model = provider.model;
    job.status = 'starting';
    try {
      const result = await runProvider(provider, job, input);
      job.status = 'succeeded';
      job.output = result.url;
      job.meta = result.meta || null;
      job.requestId = result.requestId || null;
      job.provider = provider.id;
      job.model = provider.model;
      job.attempts = attempts;
      job.finishedAt = Date.now();
      return;
    } catch (e) {
      attempts.push({ provider: provider.name, error: e?.message || String(e) });
      job.status = 'fallback';
      job.error = `${provider.name}: ${e?.message || String(e)}`;
    }
  }
  job.status = 'failed';
  job.error = attempts.filter(x => !x.skipped).map(x => `${x.provider}: ${x.error}`).join('\n\n') || 'No video provider is configured on the server.';
  job.attempts = attempts;
  job.finishedAt = Date.now();
}

app.post('/api/generate', async (req, res) => {
  const { image, prompt, aspectRatio = '9:16', resolution = '720p', duration = 5 } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) return res.status(400).json({ ok: false, code: 'INVALID_IMAGE', error: 'A valid image data URL is required.' });
  if (image.length > 500000) return res.status(413).json({ ok: false, code: 'IMAGE_TOO_LARGE', error: 'Compressed image is still too large. Please choose a smaller image.' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, code: 'INVALID_PROMPT', error: 'A motion prompt is required.' });
  if (!PROVIDERS.some(configured)) return res.status(503).json({ ok: false, code: 'NO_PROVIDER_CONFIGURED', error: 'No video-generation API is configured. Add FAL_KEY or REPLICATE_API_TOKEN in Render Environment Variables.' });

  const id = crypto.randomUUID();
  const job = { id, status: 'queued', output: null, error: null, createdAt: Date.now(), provider: null, model: null, attempts: [] };
  jobs.set(id, job);
  void runWithFallback(job, {
    image,
    prompt: prompt.trim(),
    negativePrompt: 'deformed motion, warped faces, extra limbs, duplicate people, changing clothes, changing faces, floating objects, flickering, shaky camera, blurry faces, text, subtitles, watermark, logo',
    aspectRatio: ['9:16','16:9','1:1','4:5','5:4','3:2','2:3'].includes(aspectRatio) ? aspectRatio : '9:16',
    resolution: resolution === '1080p' ? '1080p' : '720p',
    duration: Number(duration) >= 10 ? 10 : 5
  });
  res.json({ ok: true, id, status: job.status, provider: 'multi-provider-fallback' });
});

app.get('/api/generate/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, code: 'JOB_NOT_FOUND', error: 'Generation job was not found or has expired.' });
  if (job.status === 'failed') return res.status(502).json({ ok: false, code: 'ALL_PROVIDERS_FAILED', error: job.error, provider: job.provider, model: job.model, attempts: job.attempts });
  res.json({ ok: true, id: job.id, status: job.status, output: job.output, error: job.error, provider: job.provider, model: job.model, attempts: job.attempts, meta: job.meta || null });
});

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Faiyaz Gift multi-provider server running on port ${PORT}`));
