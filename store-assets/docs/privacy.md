# Dressing Room Privacy Notes

Dressing Room processes images only when you request a try-on.

## Data handled
- Reference photos selected by the user
- Product image URLs from shopping pages
- Generated try-on images
- OpenAI API key entered by the user

## Where data is stored
- The user's OpenAI API key is stored in Chrome extension local storage.
- The local Dressing room library is stored in Chrome extension local storage.
- Generated output images are uploaded to Vercel Blob so they can be displayed later.

## What is not stored by the hosted API
- The hosted API does not intentionally persist OpenAI API keys.
- The hosted API does not intentionally persist incoming reference photos.
- The hosted API does not intentionally persist generated look metadata.

## Third-party services
- OpenAI API is used to generate try-on images.
- Vercel and Vercel Blob host the generation API and generated output images.

## User control
Users can remove the extension to clear extension-local library data. Generated images stored in Vercel Blob may remain until deleted by the service operator.
