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
const BASE_PROVIDERS = [
  { id: 'fal-kling3', name: 'FAL · Kling 3.0 Pro', type: 'fal', model: 'fal-ai/kling-video/v3/pro/image-to-video' },
  { id: 'fal-kling3-standard', name: 'FAL · Kling 3.0 Standard', type: 'fal', model: 'fal-ai/kling-video/v3/standard/image-to-video' },
  { id: 'fal-kling26', name: 'FAL · Kling 2.6 Pro', type: 'fal', model: 'fal-ai/kling-video/v2.6/pro/image-to-video' },
  { id: 'fal-kling16', name: 'FAL · Kling 1.6 Pro', type: 'fal', model: 'fal-ai/kling-video/v1.6/pro/image-to-video' },
  { id: 'fal-wan27', name: 'FAL · Wan 2.7 I2V', type: 'fal', model: 'fal-ai/wan/v2.7/image-to-video' },
  { id: 'fal-wanpro', name: 'FAL · Wan 2.1 Pro I2V', type: 'fal', model: 'fal-ai/wan-pro/image-to-video' },
  { id: 'fal-ltx23', name: 'FAL · LTX 2.3 I2V', type: 'fal', model: 'fal-ai/ltx-2.3/image-to-video' },
  { id: 'fal-pika22', name: 'FAL · Pika 2.2', type: 'fal', model: 'fal-ai/pika/v2.2/image-to-video' },
  { id: 'fal-svd', name: 'FAL · Stable Video Diffusion', type: 'fal', model: 'fal-ai/stable-video' }
];

// Verified image-to-video models currently listed in Replicate's I2V collection.
// They are optional: the router only enables this larger catalog when
// ENABLE_REPLICATE_CATALOG=true, so a single key cannot unexpectedly burn credits
// by trying dozens of paid models after the preferred models fail.
const REPLICATE_CATALOG = [
  ['replicate-kling-v3','Replicate · Kling Video 3.0','kwaivgi/kling-v3-video'],
  ['replicate-kling-v3-omni','Replicate · Kling Video 3.0 Omni','kwaivgi/kling-v3-omni-video'],
  ['replicate-veo31-fast','Replicate · Veo 3.1 Fast','google/veo-3.1-fast'],
  ['replicate-veo31','Replicate · Veo 3.1','google/veo-3.1'],
  ['replicate-runway45','Replicate · Runway Gen-4.5','runwayml/gen-4.5'],
  ['replicate-seedance20','Replicate · Seedance 2.0','bytedance/seedance-2.0'],
  ['replicate-seedance20-fast','Replicate · Seedance 2.0 Fast','bytedance/seedance-2.0-fast'],
  ['replicate-seedance15','Replicate · Seedance 1.5 Pro','bytedance/seedance-1.5-pro'],
  ['replicate-seedance1','Replicate · Seedance 1 Pro','bytedance/seedance-1-pro'],
  ['replicate-seedance1-fast','Replicate · Seedance 1 Pro Fast','bytedance/seedance-1-pro-fast'],
  ['replicate-seedance1-lite','Replicate · Seedance 1 Lite','bytedance/seedance-1-lite'],
  ['replicate-grok-imagine','Replicate · Grok Imagine Video','xai/grok-imagine-video'],
  ['replicate-happyhorse11','Replicate · Happy Horse 1.1','alibaba/happyhorse-1.1'],
  ['replicate-happyhorse10','Replicate · Happy Horse 1.0','alibaba/happyhorse-1.0'],
  ['replicate-luma-ray32','Replicate · Luma Ray 3.2','luma/ray-3.2'],
  ['replicate-luma-ray2-720','Replicate · Luma Ray 2 720p','luma/ray-2-720p'],
  ['replicate-luma-ray2-540','Replicate · Luma Ray 2 540p','luma/ray-2-540p'],
  ['replicate-luma-rayflash2-720','Replicate · Luma Ray Flash 2 720p','luma/ray-flash-2-720p'],
  ['replicate-luma-rayflash2-540','Replicate · Luma Ray Flash 2 540p','luma/ray-flash-2-540p'],
  ['replicate-wan27-i2v','Replicate · Wan 2.7 I2V','wan-video/wan-2.7-i2v'],
  ['replicate-wan27-r2v','Replicate · Wan 2.7 R2V','wan-video/wan-2.7-r2v'],
  ['replicate-wan25-i2v','Replicate · Wan 2.5 I2V','wan-video/wan-2.5-i2v'],
  ['replicate-wan25-i2v-fast','Replicate · Wan 2.5 I2V Fast','wan-video/wan-2.5-i2v-fast'],
  ['replicate-wan22-i2v-fast','Replicate · Wan 2.2 I2V Fast','wan-video/wan-2.2-i2v-fast'],
  ['replicate-wan21-i2v-720','Replicate · Wan 2.1 I2V 720p','wavespeedai/wan-2.1-i2v-720p'],
  ['replicate-wan21-i2v-480','Replicate · Wan 2.1 I2V 480p','wavespeedai/wan-2.1-i2v-480p'],
  ['replicate-vidu-q3','Replicate · Vidu Q3 Pro','vidu/q3-pro'],
  ['replicate-kling25','Replicate · Kling 2.5 Turbo Pro','kwaivgi/kling-v2.5-turbo-pro'],
  ['replicate-kling21','Replicate · Kling 2.1','kwaivgi/kling-v2.1'],
  ['replicate-kling21-master','Replicate · Kling 2.1 Master','kwaivgi/kling-v2.1-master'],
  ['replicate-kling20','Replicate · Kling 2.0','kwaivgi/kling-v2.0'],
  ['replicate-kling16-pro','Replicate · Kling 1.6 Pro','kwaivgi/kling-v1.6-pro'],
  ['replicate-kling16-standard','Replicate · Kling 1.6 Standard','kwaivgi/kling-v1.6-standard'],
  ['replicate-minimax-hailuo23','Replicate · Hailuo 2.3','minimax/hailuo-2.3'],
  ['replicate-minimax-hailuo23-fast','Replicate · Hailuo 2.3 Fast','minimax/hailuo-2.3-fast'],
  ['replicate-minimax-hailuo02','Replicate · Hailuo 02','minimax/hailuo-02'],
  ['replicate-minimax-video01','Replicate · MiniMax Video-01','minimax/video-01'],
  ['replicate-minimax-video01-director','Replicate · MiniMax Video-01 Director','minimax/video-01-director'],
  ['replicate-minimax-video01-live','Replicate · MiniMax Video-01 Live','minimax/video-01-live'],
  ['replicate-leonardo-motion20','Replicate · Leonardo Motion 2.0','leonardoai/motion-2.0'],
  ['replicate-pruna-pvideo','Replicate · Pruna P-Video','prunaai/p-video'],
  ['replicate-pruna-pvideo-animate','Replicate · Pruna P-Video Animate','prunaai/p-video-animate'],
  ['replicate-veo3','Replicate · Veo 3','google/veo-3'],
  ['replicate-veo3-fast','Replicate · Veo 3 Fast','google/veo-3-fast'],
  ['replicate-veo2','Replicate · Veo 2','google/veo-2'],
  ['replicate-ltx23','Replicate · LTX 2.3 Pro','lightricks/ltx-2.3-pro'],
  ['replicate-wan21-i2v','Replicate · Wan 2.1 I2V','wavespeedai/wan-2.1-i2v-480p'],
  ['replicate-svd','Replicate · Stable Video Diffusion','christophy/stable-video-diffusion']
].map(([id,name,model]) => ({ id, name, type:'replicate', model, catalog:true }));

const PROVIDERS = [
  ...BASE_PROVIDERS,
  { id: 'replicate-ltx23-preferred', name: 'Replicate · LTX 2.3 Pro', type: 'replicate', model: 'lightricks/ltx-2.3-pro' },
  { id: 'replicate-wan21-preferred', name: 'Replicate · Wan 2.1 I2V 480p', type: 'replicate', model: 'wavespeedai/wan-2.1-i2v-480p' },
  { id: 'replicate-svd-preferred', name: 'Replicate · Stable Video Diffusion', type: 'replicate', model: 'christophy/stable-video-diffusion' },
  ...(process.env.ENABLE_REPLICATE_CATALOG === 'true' ? REPLICATE_CATALOG : []),
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
    configuredCount: PROVIDERS.filter(configured).length,
    catalogEnabled: process.env.ENABLE_REPLICATE_CATALOG === 'true',
    catalogCount: REPLICATE_CATALOG.length
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
    case 'fal-kling3-standard':
    case 'fal-kling26':
    case 'fal-kling16':
      return { ...base, start_image_url: input.image, duration: String(Math.min(Math.max(input.duration, 5), 10)), generate_audio: false };
    case 'fal-wan27':
      return { prompt: input.prompt, image_url: input.image, duration: String(Math.min(Math.max(input.duration, 5), 10)), resolution: input.resolution === '1080p' ? '1080p' : '720p' };
    case 'fal-wanpro':
      return { prompt: input.prompt, image_url: input.image };
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

async function getReplicateSchema(model) {
  const r = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` }
  });
  const raw = await r.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!r.ok) throw new Error(`Replicate model schema failed (HTTP ${r.status}): ${errorText(data || raw)}`);
  return data?.latest_version?.openapi_schema || data?.openapi_schema || null;
}

function schemaInput(schema, input) {
  const props = schema?.components?.schemas?.Input?.properties || schema?.components?.schemas?.InputSchema?.properties || {};
  const keys = Object.keys(props);
  const out = {};
  const find = (...names) => keys.find(k => names.includes(k)) || keys.find(k => names.some(n => k.toLowerCase() === n.toLowerCase()));
  const imageKey = find('image','input_image','image_url','start_image_url','first_frame_image','first_frame','init_image','reference_image','img');
  const promptKey = find('prompt','text_prompt','positive_prompt','description');
  const negKey = find('negative_prompt','negativePrompt','negative');
  const durationKey = find('duration','video_length','num_frames');
  const ratioKey = find('aspect_ratio','aspect');
  const resolutionKey = find('resolution','output_resolution');
  if (imageKey) out[imageKey] = input.image;
  if (promptKey) out[promptKey] = input.prompt;
  if (negKey) out[negKey] = input.negativePrompt;
  if (ratioKey) out[ratioKey] = input.aspectRatio;
  if (resolutionKey) out[resolutionKey] = input.resolution;
  if (durationKey && durationKey !== 'num_frames') out[durationKey] = input.duration >= 10 ? 10 : 5;
  if (durationKey === 'num_frames') out[durationKey] = input.duration >= 10 ? 25 : 14;
  if (!imageKey) throw new Error(`Replicate model ${schema?.info?.title || 'model'} does not expose a recognized image input field.`);
  return out;
}

function replicateInput(provider, input) {
  // Known schemas get explicit inputs; catalog models use their live Replicate schema.
  if (provider.id.includes('wan21') || provider.model.includes('wan-2.1-i2v')) {
    return { image: input.image, prompt: input.prompt, aspect_ratio: input.aspectRatio, negative_prompt: input.negativePrompt };
  }
  if (provider.id.includes('svd')) {
    return { input_image: input.image, video_length: input.duration >= 10 ? '25_frames_with_svd_xt' : '14_frames_with_svd', sizing_strategy: 'maintain_aspect_ratio', frames_per_second: 8, motion_bucket_id: 180, cond_aug: 0.02 };
  }
  if (provider.id.includes('ltx23')) {
    return { image: input.image, prompt: input.prompt, resolution: input.resolution === '1080p' ? '1080p' : '720p', duration: input.duration >= 10 ? '10' : '6', aspect_ratio: input.aspectRatio, fps: 25, camera_motion: 'none', generate_audio: false };
  }
  return null;
}

async function runReplicate(provider, input) {
  let mapped = replicateInput(provider, input);
  if (!mapped) {
    const schema = await getReplicateSchema(provider.model);
    mapped = schemaInput(schema, input);
  }
  const r = await fetch(`https://api.replicate.com/v1/models/${provider.model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=10'
    },
    body: JSON.stringify({ input: mapped })
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
    job.providerStartedAt = Date.now();
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
      attempts.push({ provider: provider.name, model: provider.model, error: e?.message || String(e), elapsedMs: job.providerStartedAt ? Date.now() - job.providerStartedAt : null });
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
  if (!PROVIDERS.some(configured)) return res.status(503).json({ ok: false, code: 'NO_PROVIDER_CONFIGURED', error: 'No video-generation API is configured. Add FAL_KEY or REPLICATE_API_TOKEN in Render Environment Variables. For the large Replicate catalog, also set ENABLE_REPLICATE_CATALOG=true.' });

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
