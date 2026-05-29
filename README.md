# Pose Try-On MVP

This rebuild is a Chrome extension plus a Vercel-hosted generation API. The extension finds large shopping/product images on normal ecommerce pages, sends selected images to the hosted API, and swaps generated try-on images back into the same page layout.

## Why This Shape

The demo behaves like a browser layer, not a rebuilt shopping site. Product pages keep their native filters, prices, links, and layout. The extension only detects and replaces model/product images, while the Dressing room stores generated looks locally in the user's browser.

OpenAI's image guide says the Image API is the right fit for single prompt image edits, while Responses is better for multi-turn image workflows. This MVP uses the Image API with `gpt-image-2` by default so the extension can submit one source product image plus your reference images and get back a generated render. The `gpt-image-2` model page lists the current snapshot as `gpt-image-2-2026-04-21`.

## Production Shape

Production is hosted on Vercel. Users do not run localhost: they install the extension, paste their OpenAI key in the popup, add a photo, and generate try-ons.

Generated looks are saved in the user's extension storage. The Vercel API is stateless: it edits the image, stores the generated JPG in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is configured, and returns the look to the extension.

## Deploy

```bash
npm install
vercel
```

After Vercel creates the project, set the extension backend URL in:

- `extension/popup.js`
- `extension/content.js`

Both files currently default to:

```js
const DEFAULT_SERVER_URL = "https://dressingroom-gray.vercel.app";
```

Use your actual Vercel production URL before packaging the extension.

Recommended Vercel env vars:

- `BLOB_READ_WRITE_TOKEN`: enables stable generated image URLs through Vercel Blob.
- `OPENAI_IMAGE_MODEL`: optional, defaults to `gpt-image-2`.
- `OPENAI_IMAGE_QUALITY`: optional, defaults to `medium`.
- `OPENAI_API_KEY`: optional fallback only. Normal users paste their own key in the extension.

## Extension

- Open `chrome://extensions`
- Enable Developer mode
- Click "Load unpacked"
- Select `/Users/varunvarshney/Code/Apps/Tools/Tryon/extension`

## Use It

- Open a shopping page with model/product photos.
- Click the Pose extension.
- Paste an OpenAI API key once.
- Upload 1-4 reference photos.
- Click "Generate visible" or use the small Pose buttons on detected images.
- Open "Dressing Room" to see cached looks grouped by domain.

## Notes

- The user's OpenAI key is stored in `chrome.storage.local`, attached by the extension background worker only for `/api/try-on` on the HTTPS generation server, and not saved into generated look records.
- The hosted API does not persist user keys or generated look metadata.
- Start with `OPENAI_IMAGE_QUALITY=medium` to keep iteration costs lower.
- `gpt-image-2` processes edit inputs at high fidelity automatically, so the server omits `input_fidelity` for that model.
- Model reference: https://developers.openai.com/api/docs/models/gpt-image-2
- Use `POSE_MOCK=true` when you want to test the extension flow without calling OpenAI.
- The first version uses heuristics for image detection. Site-specific adapters can be added later for SSENSE, Nike, Loewe, and similar stores.
