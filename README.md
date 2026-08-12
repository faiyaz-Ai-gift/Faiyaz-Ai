# Faiyaz Gift — AI Image-to-Video

This version uses a real image-to-video model instead of the old browser-only zoom effect.

## AI model

The server uses **Wan 2.2 I2V Fast** through Replicate. It accepts an input image plus a motion prompt and supports portrait 9:16 output. The model's API supports 81 frames, which is about 5 seconds at 16 fps. See the official model/API documentation for current limits and pricing.

## Render setup

1. Create a Render Web Service from this project.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add this Environment Variable in Render:
   - `REPLICATE_API_TOKEN` = your Replicate API token
5. Deploy.

**Never put the token in `public/index.html` or commit it to GitHub.**

## Free usage note

Replicate is pay-as-you-go and some models can be run free only within its current free limits. A VPN does not make paid API usage free and should not be used to bypass provider billing or regional restrictions. If the account has no usable free allowance, the site will show the provider's exact error instead of generating a fake video.

## Error handling

The frontend expects JSON from the backend. The backend returns structured JSON for configuration, provider, network, and generation errors, so HTML responses such as `Unexpected token '<'` are no longer silently shown as a JSON parsing error.
