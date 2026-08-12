# Faiyaz Gift — Multi-Provider Image-to-Video

This build uses a server-side multi-provider fallback. The browser never receives provider API keys.

## Render Environment Variables

Add whichever provider keys you actually have. You do **not** need every key for the app to boot.

- `FAL_KEY` — enables the configured FAL image-to-video models.
- `REPLICATE_API_TOKEN` — enables the configured Replicate models.
- `ENABLE_REPLICATE_CATALOG=true` — enables the larger verified Replicate image-to-video catalog (48 model entries). This is optional because many catalog models are paid and may consume account credit when reached by fallback.
- `HF_VIDEO_SPACE` — optional custom Hugging Face Gradio image-to-video Space URL.
- `HF_TOKEN` — optional token for the custom Hugging Face Space.

Generation automatically tries configured providers in order and moves to the next provider when a provider fails. If every configured provider fails, the frontend shows the provider/model errors instead of hiding them behind a generic message.

The expanded Replicate catalog is based on models currently listed by Replicate's image-to-video collection. Availability, pricing, access, and model input schemas can change; the server discovers the live schema for catalog models before submitting a request.

Never put API keys in `public/index.html`.
