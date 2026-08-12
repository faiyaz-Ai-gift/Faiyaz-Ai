# Faiyaz Gift — Multi-Provider Image-to-Video

This build uses a server-side multi-provider fallback. The browser never receives provider API keys.

## Render Environment Variables

Add whichever provider keys you have. You do **not** need every key for the app to boot.

- `FAL_KEY` — enables FAL models (LTX 2.3, Kling 3.0 Pro, Wan 2.1, Pika 2.2, Stable Video Diffusion).
- `REPLICATE_API_TOKEN` — enables Replicate models (LTX 2.3 Pro, Wan 2.1 I2V, Stable Video Diffusion).
- `HF_VIDEO_SPACE` — optional custom Hugging Face Gradio image-to-video Space URL.
- `HF_TOKEN` — optional token for the custom Hugging Face Space.

Generation automatically tries configured providers in order and moves to the next provider when a provider fails. If every configured provider fails, the exact provider errors are returned to the frontend.

Never put API keys in `public/index.html`.


## Pixazo provider

Set `PIXAZO_API_KEY` in the Render Environment Variables to enable the Pixazo image-to-video fallback. The server currently supports Pixazo Kling 3.0 Standard, Vidu Q3 Turbo, Wan 2.7, LTX 2.3, and Grok Imagine Video 1.5 Turbo. The browser never receives the API key. Pixazo image-to-video requests require a publicly reachable image URL, so the server temporarily serves each uploaded image from `/uploads/<job-id>.<ext>` while the provider is running and removes it when the job finishes.

Pixazo is usage-based for most video models; this integration does not claim unlimited free video generation.
