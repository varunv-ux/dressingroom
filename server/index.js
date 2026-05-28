import "dotenv/config";
import cors from "cors";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const generatedDir = path.join(dataDir, "generated");
const looksPath = path.join(dataDir, "looks.json");

const port = Number(process.env.PORT || 8787);
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const imageQuality = process.env.OPENAI_IMAGE_QUALITY || "medium";
const mockMode = process.env.POSE_MOCK === "true";
const execFileAsync = promisify(execFile);

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(cors());
app.use(express.json({ limit: "28mb" }));
app.use("/generated", express.static(generatedDir, { fallthrough: false }));

await ensureStorage();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    model: imageModel,
    quality: imageQuality,
    mockMode,
  });
});

app.get("/api/looks", async (_req, res, next) => {
  try {
    const looks = await readLooks();
    res.json({ looks: looks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/looks/by-source", async (req, res, next) => {
  try {
    const sourceUrl = String(req.query.sourceUrl || "");
    if (!sourceUrl) {
      res.status(400).json({ error: "sourceUrl is required" });
      return;
    }

    const sourceHash = hash(sourceUrl);
    const looks = await readLooks();
    const look = looks.find((item) => item.sourceHash === sourceHash);
    const sourceKey = normalizeSourceUrl(sourceUrl);
    const normalizedLook = looks.find((item) => item.sourceKey === sourceKey);
    res.json({ look: look || normalizedLook || null });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/looks/:id", async (req, res, next) => {
  try {
    const looks = await readLooks();
    const nextLooks = looks.filter((look) => look.id !== req.params.id);
    await writeLooks(nextLooks);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/try-on", async (req, res, next) => {
  try {
    const body = normalizeTryOnBody(req.body);
    const looks = await readLooks();
    const sourceHash = hash(body.sourceUrl);
    const sourceKey = normalizeSourceUrl(body.sourceUrl);
    const referenceHash = hash(body.referenceImages.join("|"));
    const cacheKey = hash(`${sourceKey}:${referenceHash}:${imageModel}:${imageQuality}`);
    const cached = looks.find((look) => look.cacheKey === cacheKey);

    if (cached) {
      res.json({ look: cached, cached: true });
      return;
    }

    if (!mockMode && !process.env.OPENAI_API_KEY) {
      res.status(400).json({
        error: "OPENAI_API_KEY is not set. Add it to .env or run with POSE_MOCK=true.",
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
        });

    const id = crypto.randomUUID();
    const fileName = `${id}.jpg`;
    const generatedPath = path.join(generatedDir, fileName);
    const bytes = dataUrlToBuffer(generatedDataUrl);
    await fs.writeFile(generatedPath, bytes);

    const now = new Date().toISOString();
    const look = {
      id,
      cacheKey,
      sourceHash,
      sourceKey,
      sourceUrl: body.sourceUrl,
      generatedUrl: `http://localhost:${port}/generated/${fileName}`,
      pageUrl: body.pageUrl,
      domain: body.domain,
      title: body.title,
      alt: body.alt,
      model: imageModel,
      quality: imageQuality,
      createdAt: now,
      updatedAt: now,
    };

    await writeLooks([look, ...looks]);
    res.json({ look, cached: false });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || "Unexpected server error",
  });
});

app.listen(port, () => {
  console.log(`Pose server listening on http://localhost:${port}`);
  console.log(`Image model: ${imageModel}${mockMode ? " (mock mode)" : ""}`);
});

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

  return {
    sourceUrl,
    pageUrl,
    domain,
    title,
    alt,
    promptHints,
    referenceImages: referenceImages.slice(0, 4),
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

async function editTryOnImage({ sourceDataUrl, referenceImages, prompt }) {
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
      Accept: "image/jpeg,image/png,*/*;q=0.5",
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

  if (contentType.includes("avif")) {
    throw new Error("Source image downloaded as AVIF, which the image edit API does not accept.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const b64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${contentType.split(";")[0]};base64,${b64}`;
}

async function normalizeImageDataUrlForApi(dataUrl) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pose-image-"));
  const inputPath = path.join(tempDir, `input.${extensionForDataUrl(dataUrl)}`);
  const outputPath = path.join(tempDir, "output.jpg");

  try {
    await fs.writeFile(inputPath, dataUrlToBuffer(dataUrl));
    await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", inputPath, "--out", outputPath], {
      timeout: 30000,
    });
    const output = await fs.readFile(outputPath);
    return `data:image/jpeg;base64,${output.toString("base64")}`;
  } catch (error) {
    throw new Error(`Image conversion failed before OpenAI upload: ${error.message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) {
    throw new Error("Expected a base64 image data URL.");
  }

  return Buffer.from(match[1], "base64");
}

function extensionForDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  const mime = (match?.[1] || "jpeg").toLowerCase();
  if (mime.includes("png")) {
    return "png";
  }
  if (mime.includes("webp")) {
    return "webp";
  }
  if (mime.includes("gif")) {
    return "gif";
  }
  return "jpg";
}

async function ensureStorage() {
  await fs.mkdir(generatedDir, { recursive: true });
  try {
    await fs.access(looksPath);
  } catch {
    await fs.writeFile(looksPath, "[]\n");
  }
}

async function readLooks() {
  const raw = await fs.readFile(looksPath, "utf8");
  return JSON.parse(raw).map((look) => ({
    ...look,
    sourceKey: look.sourceKey || normalizeSourceUrl(look.sourceUrl || ""),
  }));
}

async function writeLooks(looks) {
  await fs.writeFile(looksPath, `${JSON.stringify(looks, null, 2)}\n`);
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
