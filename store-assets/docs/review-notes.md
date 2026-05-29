# Chrome Web Store Review Notes

Dressing Room is a Manifest V3 shopping extension. It runs on shopping pages to detect product images and display a small try-on button over eligible images. The extension uses activeTab, scripting, tabs, storage, and host permissions for http/https pages so it can inject the content script, scan images, and communicate with the hosted generation API.

Users must provide their own OpenAI API key in the popup. The key is stored in chrome.storage.local and is sent only to the HTTPS generation endpoint when a try-on is requested.

The extension does not sell user data and does not inject ads.
