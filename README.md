# Pose Try-On MVP

This rebuild is a Chrome extension plus a local generation server. The extension finds large shopping/product images on normal ecommerce pages, sends selected images to the local server, and swaps generated try-on images back into the same page layout.

## Why This Shape

The demo behaves like a browser layer, not a rebuilt shopping site. Product pages keep their native filters, prices, links, and layout. The extension only detects and replaces model/product images, while the dashboard stores generated looks by source domain.

OpenAI's image guide says the Image API is the right fit for single prompt image edits, while Responses is better for multi-turn image workflows. This MVP uses the Image API with `gpt-image-2` by default so the extension can submit one source product image plus your reference images and get back a generated render. The `gpt-image-2` model page lists the current snapshot as `gpt-image-2-2026-04-21`.

## Run It

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example and add your key:

```bash
cp .env.example .env
```

3. Start the local server:

```bash
npm run dev
```

4. Load the extension:

- Open `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked"
- Select `/Users/varunvarshney/Code/Apps/Tools/Tryon/extension`

5. Use it:

- Open a shopping page with model/product photos.
- Click the Pose extension.
- Upload 1-4 reference photos.
- Click "Generate visible" or use the small Pose buttons on detected images.
- Open "Dressing Room" to see cached looks grouped by domain.

## Notes

- The OpenAI API key stays server-side. The extension never sees it.
- Start with `OPENAI_IMAGE_QUALITY=medium` to keep iteration costs lower.
- `gpt-image-2` processes edit inputs at high fidelity automatically, so the server omits `input_fidelity` for that model.
- Model reference: https://developers.openai.com/api/docs/models/gpt-image-2
- Use `POSE_MOCK=true` when you want to test the extension flow without calling OpenAI.
- The first version uses heuristics for image detection. Site-specific adapters can be added later for SSENSE, Nike, Loewe, and similar stores.
