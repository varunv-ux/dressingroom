import "dotenv/config";
import { put } from "@vercel/blob";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import sharp from "sharp";

const port = Number(process.env.PORT || 8787);
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const imageQuality = process.env.OPENAI_IMAGE_QUALITY || "medium";
const mockMode = process.env.POSE_MOCK === "true";
const RATE_LIMIT_WINDOW_MS = Number(process.env.POSE_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.POSE_RATE_LIMIT_MAX || 20);
const MAX_REFERENCE_IMAGES = Number(process.env.POSE_MAX_REFERENCE_IMAGES || 4);
const MAX_DATA_URL_BYTES = Number(process.env.POSE_MAX_DATA_URL_BYTES || 8_000_000);

const rateBuckets = new Map();

const app = express();
app.use(cors());
app.use(express.json({ limit: "28mb" }));
app.use("/api/", rateLimit);

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dressing Room</title>
    <style>
      body { background: #f7f4ee; color: #171717; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
      main { display: grid; gap: 18px; margin: 0 auto; max-width: 760px; min-height: 100vh; place-content: center; padding: 32px; }
      h1 { font-size: clamp(40px, 7vw, 72px); letter-spacing: -0.03em; line-height: 0.95; margin: 0; }
      p { color: #5b6472; font-size: 18px; line-height: 1.55; margin: 0; }
      a { color: #b1124a; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Dressing Room</h1>
      <p>Create AI try-ons on shopping pages and save your favorite looks. The Chrome extension uses your own OpenAI API key.</p>
      <p><a href="/privacy">Privacy policy</a></p>
    </main>
  </body>
</html>`);
});

app.get("/privacy", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dressing Room Privacy Policy</title>
    <style>
      body { background: #f7f4ee; color: #171717; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
      main { margin: 0 auto; max-width: 820px; padding: 56px 28px; }
      h1 { font-size: 42px; letter-spacing: -0.02em; margin: 0 0 24px; }
      h2 { font-size: 20px; margin: 32px 0 10px; }
      p, li { color: #4b5565; font-size: 16px; line-height: 1.65; }
      ul { padding-left: 22px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Privacy Policy</h1>
      <p>Dressing Room processes images only when you request an AI try-on from the Chrome extension.</p>
      <h2>Data handled</h2>
      <ul>
        <li>Reference photos selected by the user.</li>
        <li>Product image URLs from shopping pages.</li>
        <li>Generated try-on images.</li>
        <li>OpenAI API key entered by the user.</li>
      </ul>
      <h2>Storage</h2>
      <p>The user's OpenAI API key and Dressing room library are stored in Chrome extension local storage. Generated output images are uploaded to Vercel Blob so they can be displayed later.</p>
      <h2>Hosted API</h2>
      <p>The hosted API does not persist OpenAI API keys, incoming reference photos, or generated look metadata. Reference photos pass through the API only to complete the requested generation and are discarded after the OpenAI response is returned. Requests are rate limited per IP to discourage abuse.</p>
      <h2>Third-party services</h2>
      <p>Dressing Room uses the OpenAI API to generate try-on images and Vercel/Vercel Blob to host the generation API and generated output images.</p>
      <h2>User control</h2>
      <p>Users can remove the extension to clear extension-local library data. Generated images stored in Vercel Blob may remain until deleted by the service operator.</p>
    </main>
  </body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    model: imageModel,
    quality: imageQuality,
    mockMode,
    storage: process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "inline",
  });
});

app.get("/api/looks", (_req, res) => {
  res.json({ looks: [] });
});

app.get("/api/looks/by-source", (_req, res) => {
  res.json({ look: null });
});

app.delete("/api/looks/:id", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/try-on", async (req, res, next) => {
  try {
    const body = normalizeTryOnBody(req.body);
    const sourceKey = normalizeSourceUrl(body.sourceUrl);
    const referenceHash = hash(body.referenceImages.join("|"));
    const cacheKey = hash(`${sourceKey}:${referenceHash}:${imageModel}:${imageQuality}`);

    const apiKey = getRequestOpenAIKey(req);
    if (!mockMode && !apiKey) {
      res.status(400).json({
        error: "OpenAI API key is not set. Add one in the extension settings.",
      });
      return;
    }

    const sourceDataUrl = await toDataUrl(body.sourceUrl, body.pageUrl);
    const generatedDataUrl = mockMode
      ? sourceDataUrl
      : await editTryOnImage({
          sourceDataUrl,
          referenceImages: body.referenceImages,
          prompt: buildTryOnPrompt(body),
          apiKey,
        });

    const id = crypto.randomUUID();
    const generatedUrl = await storeGeneratedImage(id, generatedDataUrl);
    const now = new Date().toISOString();
    const look = {
      id,
      cacheKey,
      sourceHash: hash(body.sourceUrl),
      sourceKey,
      sourceUrl: body.sourceUrl,
      generatedUrl,
      pageUrl: body.pageUrl,
      domain: body.domain,
      title: body.title,
      alt: body.alt,
      model: imageModel,
      quality: imageQuality,
      createdAt: now,
      updatedAt: now,
    };

    res.json({ look, cached: false });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error?.message || error);
  res.status(error.status || 500).json({
    error: error.message || "Unexpected server error",
  });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Pose server listening on http://localhost:${port}`);
    console.log(`Image model: ${imageModel}${mockMode ? " (mock mode)" : ""}`);
  });
}

export default app;

function normalizeTryOnBody(body) {
  const sourceUrl = String(body?.sourceUrl || "");
  const pageUrl = String(body?.pageUrl || "");
  const domain = String(body?.domain || safeDomain(pageUrl) || "unknown");
  const title = String(body?.title || "");
  const alt = String(body?.alt || "");
  const promptHints = String(body?.promptHints || "");
  const referenceImages = Array.isArray(body?.referenceImages)
    ? body.referenceImages.filter((item) => typeof item === "string" && item.startsWith("data:image/"))
    : [];

  if (!sourceUrl) {
    throw badRequest("sourceUrl is required");
  }

  if (!mockMode && referenceImages.length === 0) {
    throw badRequest("At least one reference image data URL is required");
  }

  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw badRequest(`Too many reference images (max ${MAX_REFERENCE_IMAGES}).`);
  }

  referenceImages.forEach((dataUrl) => {
    if (dataUrl.length > MAX_DATA_URL_BYTES) {
      throw badRequest("A reference image is too large.");
    }
  });

  return {
    sourceUrl,
    pageUrl,
    domain,
    title,
    alt,
    promptHints,
    referenceImages: referenceImages.slice(0, MAX_REFERENCE_IMAGES),
  };
}

function buildTryOnPrompt(body) {
  const context = [
    body.title ? `Product/page title: ${body.title}` : "",
    body.alt ? `Image alt text: ${body.alt}` : "",
    body.promptHints ? `Extra instruction: ${body.promptHints}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Create a realistic fashion ecommerce try-on edit.",
    "Use the first image as the source product/editorial image and preserve its store aesthetic, camera angle, composition, crop, lighting, background, garment details, logos, colors, fabric texture, fit, and pose as much as possible.",
    "Use the remaining reference image(s) only to infer the shopper identity, face, hair, and body proportions.",
    "Replace the original model with the shopper while keeping the same garment and brand photography style.",
    "Do not invent a new product, change logos, remove garment details, add text, or change the page-like product photography background.",
    context,
  ]
    .filter(Boolean)
    .join("\n");
}

function getRequestOpenAIKey(req) {
  const auth = String(req.get("authorization") || "").trim();
  if (/^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim();
  }
  const legacy = String(req.get("x-pose-openai-key") || "").trim();
  return legacy || String(process.env.OPENAI_API_KEY || "").trim();
}

function rateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    const retry = Math.ceil((bucket.resetAt - now) / 1000);
    res.set("Retry-After", String(retry));
    res.status(429).json({ error: `Too many requests. Try again in ${retry}s.` });
    return;
  }
  next();
}

async function editTryOnImage({ sourceDataUrl, referenceImages, prompt, apiKey }) {
  const apiSourceDataUrl = await normalizeImageDataUrlForApi(sourceDataUrl);
  const apiReferenceImages = await Promise.all(referenceImages.map(normalizeImageDataUrlForApi));
  const requestBody = {
    model: imageModel,
    images: [
      { image_url: apiSourceDataUrl },
      ...apiReferenceImages.map((image_url) => ({ image_url })),
    ],
    prompt,
    output_format: "jpeg",
    quality: imageQuality,
    size: "auto",
    n: 1,
  };

  if (imageModel !== "gpt-image-2") {
    requestBody.input_fidelity = "high";
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result?.error?.message || result?.error || response.statusText;
    throw new Error(`OpenAI image edit failed: ${message}`);
  }

  const b64 = result?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image edit response did not include b64_json.");
  }

  return `data:image/jpeg;base64,${b64}`;
}

async function toDataUrl(inputUrl, pageUrl = "") {
  if (inputUrl.startsWith("data:image/")) {
    return inputUrl;
  }

  const response = await fetch(inputUrl, {
    headers: {
      Accept: "image/jpeg,image/png,image/webp,image/avif,*/*;q=0.5",
      Referer: pageUrl || inputUrl,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not download source image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Source URL did not return an image. Content-Type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${contentType.split(";")[0]};base64,${b64}`;
}

async function normalizeImageDataUrlForApi(dataUrl) {
  const input = dataUrlToBuffer(dataUrl);
  const output = await sharp(input).rotate().jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

async function storeGeneratedImage(id, dataUrl) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return dataUrl;
  }

  const buffer = dataUrlToBuffer(dataUrl);
  const blob = await put(`looks/${id}.jpg`, buffer, {
    access: "public",
    contentType: "image/jpeg",
  });
  return blob.url;
}

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) {
    throw new Error("Expected a base64 image data URL.");
  }

  return Buffer.from(match[1], "base64");
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return value;
  }
}

function safeDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
