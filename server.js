const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { fal } = require("@fal-ai/client");

const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.FAL_KEY) {
  console.warn("FAL_KEY is not set. Add it in Render Environment Variables.");
}

fal.config({ credentials: process.env.FAL_KEY });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Faiyaz Gift Image-to-Video API" });
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.FAL_KEY) {
      return res.status(500).json({ error: "FAL_KEY is not configured on the server." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Please upload an image." });
    }

    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Please describe the motion you want." });
    }

    const resolution = ["720p", "1080p"].includes(req.body.resolution)
      ? req.body.resolution : "720p";
    const duration = ["5", "10"].includes(req.body.duration)
      ? req.body.duration : "5";

    const allowedRatios = ["16:9", "9:16", "1:1", "4:5", "5:4", "3:2", "2:3"];
    const aspect_ratio = allowedRatios.includes(req.body.aspect_ratio)
      ? req.body.aspect_ratio : "16:9";

    // fal accepts a base64 data URI for file inputs.
    const imageUrl =
      `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const result = await fal.subscribe("fal-ai/pika/v2.2/image-to-video", {
      input: {
        image_url: imageUrl,
        prompt,
        aspect_ratio,
        resolution,
        duration
      },
      logs: false
    });

    const videoUrl = result?.data?.video?.url;
    if (!videoUrl) {
      return res.status(502).json({ error: "The video provider returned no video URL." });
    }

    res.json({
      ok: true,
      video: videoUrl,
      requestId: result.requestId || null
    });
  } catch (err) {
    console.error("Generation error:", err);
    const message = err?.body?.detail || err?.message || "Video generation failed.";
    res.status(500).json({ error: message });
  }
});


app.post("/api/generate-image", async (req, res) => {
  try {
    if (!process.env.FAL_KEY) {
      return res.status(500).json({ error: "FAL_KEY is not configured on the server. Add it in Render Environment Variables." });
    }
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Please describe the image you want." });

    const allowedSizes = ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"];
    const image_size = allowedSizes.includes(req.body?.image_size) ? req.body.image_size : "portrait_16_9";
    const num_images = Math.min(4, Math.max(1, Number(req.body?.num_images) || 1));
    const output_format = ["jpeg", "png"].includes(req.body?.output_format) ? req.body.output_format : "jpeg";

    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt,
        image_size,
        num_images,
        output_format,
        num_inference_steps: 4,
        enable_safety_checker: true
      },
      logs: false
    });

    const images = Array.isArray(result?.data?.images) ? result.data.images.filter(x => x?.url) : [];
    if (!images.length) return res.status(502).json({ error: "The image provider returned no image URL." });
    res.json({ ok: true, images, requestId: result.requestId || null });
  } catch (err) {
    console.error("Image generation error:", err);
    const message = err?.body?.detail || err?.message || "Image generation failed.";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Faiyaz Gift server running on port ${PORT}`);
});
