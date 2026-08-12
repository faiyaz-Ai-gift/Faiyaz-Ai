# Faiyaz Gift — Render Image-to-Video

This is a real, Render-ready Image-to-Video web app. It has NO fixed demo response and NO hard-coded demo video.

## What it does

1. User selects JPG/PNG/WEBP image.
2. User writes a motion prompt.
3. Browser sends the image + options to `/api/generate`.
4. Node/Express backend sends the request to `fal-ai/pika/v2.2/image-to-video`.
5. Backend returns the generated video's URL.
6. Browser displays the actual generated video.

## Deploy to Render

1. Create a new Web Service on Render from this project/repository.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add Environment Variable:
   - Key: `FAL_KEY`
   - Value: your fal.ai API key
5. Deploy.

You do NOT put FAL_KEY in `public/index.html`.

## Important

- Generation is real and can incur fal.ai usage charges.
- The backend uses a base64 data URI for the uploaded image. This is convenient but increases request size; the upload is limited to 12 MB.
- For a larger production service, use object storage/fal storage and a queue/webhook architecture.
- Add authentication, rate limiting, abuse protection, usage limits, terms/privacy, and billing before opening this publicly.

## Model

The backend currently uses `fal-ai/pika/v2.2/image-to-video`.
