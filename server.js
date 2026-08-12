const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Free public Hugging Face ZeroGPU Space.
// It runs Wan 2.2 14B I2V with a fast Lightning-LoRA setup.
const HF_SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const HF_TOKEN = process.env.HF_TOKEN || "";

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

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (HF_TOKEN) h.Authorization = `Bearer ${HF_TOKEN}`;
  return h;
}

function findVideoUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.(mp4|webm|mov)(\?|$)/i.test(value)) return value;
    if (/^https?:\/\//i.test(value) && /gradio|hf\.space|huggingface/i.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item);
      if (found) return found;
    }
  }
  if (typeof value === "object") {
    for (const key of ["url", "video", "path"]) {
      const found = findVideoUrl(value[key]);
      if (found) return found;
    }
    for (const key of Object.keys(value)) {
      const found = findVideoUrl(value[key]);
      if (found) return found;
    }
  }
  return null;
}

async function uploadToSpace(file) {
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype });
  form.append("files", blob, file.originalname || "image.jpg");

  const response = await fetch(`${HF_SPACE}/gradio_api/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face upload failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const paths = await response.json();
  if (!Array.isArray(paths) || !paths[0]) {
    throw new Error("Hugging Face did not return an uploaded image path.");
  }

  return paths[0];
}

async function submitGeneration(filePath, prompt, duration) {
  const data = [
    {
      path: filePath,
      meta: { _type: "gradio.FileData" },
      orig_name: "input-image"
    },
    prompt,
    4,
    "色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走",
    duration,
    1,
    1,
    42,
    true
  ];

  const response = await fetch(`${HF_SPACE}/gradio_api/call/generate_video`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ data })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face generation submit failed (${response.status}): ${text.slice(0, 700)}`);
  }

  const result = await response.json();
  if (!result.event_id) {
    throw new Error("Hugging Face did not return a generation event ID.");
  }
  return result.event_id;
}

async function waitForResult(eventId, timeoutMs = 12 * 60 * 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${HF_SPACE}/gradio_api/call/generate_video/${encodeURIComponent(eventId)}`,
      { headers: authHeaders(), signal: controller.signal }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hugging Face result request failed (${response.status}): ${text.slice(0, 700)}`);
    }

    const text = await response.text();

    // Gradio returns Server-Sent Events. Find the final "complete" event.
    const events = text.split(/\n(?=event:)/g);
    for (const block of events.reverse()) {
      if (!block.includes("event: complete")) continue;

      const dataLine = block
        .split("\n")
        .find(line => line.startsWith("data:"));

      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.slice(5).trim());
      return payload;
    }

    const failed = text.match(/event:\s*error[\s\S]*?data:\s*(.+)/);
    if (failed) {
      throw new Error(String(failed[1]).slice(0, 1000));
    }

    throw new Error("Hugging Face returned no completed video.");
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Video generation timed out. Please try a shorter video.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Faiyaz Gift Image-to-Video API",
    provider: "Hugging Face ZeroGPU",
    model: "Wan2.2-I2V-A14B"
  });
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload an image." });
    }

    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Please describe the motion you want." });
    }

    // The free Space supports about 0.5–5 seconds. Keep requests inside its limits.
    let duration = Number(req.body.duration || 3.5);
    if (!Number.isFinite(duration)) duration = 3.5;
    duration = Math.max(0.5, Math.min(5, duration));

    const filePath = await uploadToSpace(req.file);
    const eventId = await submitGeneration(filePath, prompt, duration);
    const payload = await waitForResult(eventId);

    const videoUrl = findVideoUrl(payload);
    if (!videoUrl) {
      console.error("Unexpected Hugging Face result:", JSON.stringify(payload));
      return res.status(502).json({
        error: "The free video provider completed the job but returned no video URL."
      });
    }

    res.json({
      ok: true,
      video: videoUrl,
      provider: "Hugging Face ZeroGPU",
      model: "Wan2.2-I2V-A14B",
      eventId
    });
  } catch (err) {
    console.error("Generation error:", err);
    res.status(500).json({
      error: err?.message || "Video generation failed."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Faiyaz Gift server running on port ${PORT}`);
});
