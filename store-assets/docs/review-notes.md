# Chrome Web Store Review Notes

Dressing Room is a Manifest V3 shopping extension. It does not auto-inject on every page. The content script is injected only after the user opens the extension popup and chooses an action such as Find photos or Try on visible photos. It then detects product images and displays a small try-on button over eligible images. The extension uses activeTab, scripting, tabs, storage, and a host permission for the hosted generation API.

Users must provide their own OpenAI API key in the popup. The key is stored in chrome.storage.local and is sent only to the HTTPS generation endpoint when a try-on is requested.

The extension does not sell user data and does not inject ads.
