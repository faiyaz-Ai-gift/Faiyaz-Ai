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

// Convert the FAL SDK error into a JSON-safe object without exposing FAL_KEY.
function getFalError(err) {
  const body = err?.body ?? err?.response?.data ?? null;
  const status = err?.status ?? err?.statusCode ?? err?.response?.status ?? null;

  let detail = null;
  if (body && typeof body === "object") {
    detail = body.detail ?? body.message ?? body.error ?? null;
  } else if (typeof body === "string") {
    detail = body;
  }

  const message = detail || err?.message || "Video generation failed.";

  return {
    message: String(message),
    status,
    requestId: err?.requestId ?? err?.request_id ?? null,
    body
  };
}

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.FAL_KEY) {
      return res.status(500).json({
        ok: false,
        provider: "fal",
        error: "FAL_KEY is not configured on the server."
      });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Please upload an image." });
    }

    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "Please describe the motion you want." });
    }

    const resolution = ["720p", "1080p"].includes(req.body.resolution)
      ? req.body.resolution : "720p";
    const duration = ["5", "10"].includes(req.body.duration)
      ? req.body.duration : "5";

    const allowedRatios = ["16:9", "9:16", "1:1", "4:5", "5:4", "3:2", "2:3"];
    const aspect_ratio = allowedRatios.includes(req.body.aspect_ratio)
      ? req.body.aspect_ratio : "16:9";

    // FAL accepts a base64 data URI for file inputs.
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
      return res.status(502).json({
        ok: false,
        provider: "fal",
        error: "The video provider returned no video URL.",
        requestId: result?.requestId || null,
        falResponse: result?.data ?? null
      });
    }

    res.json({
      ok: true,
      video: videoUrl,
      requestId: result.requestId || null
    });
  } catch (err) {
    const falError = getFalError(err);
    console.error("Generation error:", JSON.stringify({
      message: falError.message,
      status: falError.status,
      requestId: falError.requestId,
      body: falError.body
    }, null, 2));

    // Return the actual provider payload to the frontend so it can be shown exactly.
    res.status(Number.isInteger(falError.status) && falError.status >= 400 ? falError.status : 502).json({
      ok: false,
      provider: "fal",
      error: falError.message,
      status: falError.status,
      requestId: falError.requestId,
      details: falError.body
    });
  }
});

// Handle upload errors too, so the frontend never receives an empty/"null" message.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      provider: "server",
      error: err.message,
      code: err.code
    });
  }
  if (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({
      ok: false,
      provider: "server",
      error: err.message || "Internal server error."
    });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Faiyaz Gift server running on port ${PORT}`);
});
