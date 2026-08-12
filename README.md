# Faiyaz Gift — AI Image & Video Studio

This build opens on **AI Image Generator** by default. Image-to-Video remains available as a separate mode.

## Render
- Build: `npm install`
- Start: `npm start`
- Environment variable: `FAL_KEY`

Image generation uses `fal-ai/flux/schnell` through the server-side FAL API. The browser never receives the API key.
