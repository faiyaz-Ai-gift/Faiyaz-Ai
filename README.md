# Faiyaz Gift — Free AI Image to Video

This version uses a public Hugging Face ZeroGPU Space running LTX 2.3 for real image-to-video generation.

## What changed

- Removed the paid Replicate dependency.
- Removed the FAL dependency.
- No API key is required by this app by default.
- Generation runs asynchronously so a long GPU queue does not keep the Render request open.
- The frontend polls the job and displays the exact provider error when the free service rejects/fails a request.
- 5s and 10s generation are available.

## Free provider

Default provider:
`https://shaundeoOo-ltx-2-3-fast.hf.space`

The Space exposes a Gradio `/generate` API and runs LTX 2.3 on Hugging Face ZeroGPU. Free availability depends on the public Space's queue/limits; this is not an unlimited guaranteed API.

## Render

Deploy as a normal Node service with the included `render.yaml`. No `REPLICATE_API_TOKEN` or `FAL_KEY` is needed.

Optional environment variable:
- `HF_VIDEO_SPACE` — override the public Space URL if you later choose another compatible Gradio Space.
- `HF_TOKEN` — optional; only needed if the selected Space later requires authentication.
