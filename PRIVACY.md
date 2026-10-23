# Transora Privacy Policy

Effective date: 2026-10-22

Transora is a Chrome extension that translates web pages with an AI model. You bring your own API key from OpenRouter, Google (Gemini API) or Anthropic (Claude API). This policy explains what data the extension handles, where it goes, and how to delete it.

The short version: Transora has no servers of its own and no user accounts. The developer does not collect, receive, store or sell any of your data. There is no analytics, no tracking and no advertising.

## 1. Data the extension handles

### API keys
- You type your provider API keys into the extension's settings.
- Keys are stored only on your device, in the extension's own IndexedDB database (extension origin). They are not stored in `chrome.storage.sync` and are never synced through your Google account.
- A key is sent only to the provider it belongs to (an OpenRouter key to OpenRouter, a Gemini key to Google, an Anthropic key to Anthropic), as the authentication header of requests you trigger.
- Keys are never sent to the developer and never sent to the optional Cloudflare Worker described below.
- If you use **Export with keys** in Settings, the exported JSON file contains your keys. That file is created on your computer and you decide where it goes. **Export (no keys)** strips keys and the cloud token.

### Page content
- When you translate a page, a section, a dragged region or selected text, the extension reads the text of that part of the page and sends it to the AI provider you selected, together with short context: the page title, host name, site name, the page's meta description and the heading path of each paragraph. The full page URL is not sent.
- Text is sent only when you ask for a translation, or on a site you have set to **Always translate**.
- If you choose **Chrome built-in translator** as the provider, translation runs on your device with Chrome's own model and the text is not sent anywhere. Chrome downloads the language pack from Google once per language pair when you click **Download**.
- By default only visible content is translated: text in collapsed menus, closed tabs and hidden slides is skipped until it is shown, and with lazy mode on, text is translated as you scroll to it.
- Text that is already in your target language, code blocks, form fields and editable areas are not sent.
- The extension does not read or send page content in the background on sites you have not asked it to translate.

### Video subtitles (YouTube)
- When you turn on **Translated subtitles** with the button in the YouTube player, the extension downloads the subtitles of the video you are watching from YouTube (the same file YouTube's own captions use) and sends their text to your AI provider, with the video title and channel name as context. Only the part you are watching is sent: from just before the current position to about two minutes ahead, unless you choose **Translate whole video**.
- To find the subtitle tracks, a small script runs in YouTube pages and reads the track list from the YouTube player. It does not read anything else on the page and sends nothing anywhere.
- The switch is off by default. Your choice and your subtitle style (mode, font, size, colors, position) are stored in `chrome.storage.local`.

### Translation cache
- Translations are cached on your device (IndexedDB) so the same text is not paid for twice. Each entry is keyed by a SHA-256 hash of the source text plus your translation settings, and stores the translated text and the provider and model name.
- The cache is capped at about 150,000 entries; the least recently used entries are removed first.

### Usage statistics
- For each translation request the extension records, on your device: time, provider, model, host name of the page, request type, number of segments and characters, token counts, cost (reported by OpenRouter or estimated from list prices), cache hits, latency, success or error message, and a key fingerprint.
- The key fingerprint is the first 12 hex characters of a SHA-256 hash of the key plus a masked hint such as `sk-or…a9f3` (provider prefix and last four characters). It lets you tell keys apart in the statistics. It cannot be turned back into the key, and the key itself is never stored in usage records.
- Usage statistics are shown only to you in the side panel and options page, and can be exported by you as CSV.

### Settings
- Your preferences (target language, presets, glossary, site rules, display options, cloud URL) are stored on your device in `chrome.storage.local`. The cloud token, like your API keys, is kept in the extension's own IndexedDB, which web pages and content scripts cannot read.
- Site rules store the host name you added and, if available, the site's favicon URL. Favicons are displayed from Chrome's built-in favicon cache.

## 2. Optional cloud sync (off by default)

Transora can use a small Cloudflare Worker whose source is published at https://github.com/nguyenhx2/transora-cloud. If you choose to deploy it to **your own Cloudflare account** and enter its URL and token in Settings, the extension will:

- Send translation cache entries to it: the hashed cache key, the translated text and the provider and model name. It also asks the Worker for cached translations by hashed key. Source text is not sent; only its hash.
- If you also enable **Sync usage**, send your usage records (the fields listed above, including host names and the key fingerprint, but never the key) and download records from your other devices.
- Authenticate every request with the bearer token you set. Connections use HTTPS (the `workers.dev` domain or your own domain).

The Worker runs in your Cloudflare account and stores data in your Workers KV namespace. The developer has no access to it. Cache entries expire after 120 days and usage records after 400 days. Cloudflare processes this data as your provider under Cloudflare's terms and privacy policy.

## 3. Third parties

Data leaves your device only to these services, and only as described above:

| Service | When | What | Privacy policy |
|---|---|---|---|
| OpenRouter | You use an OpenRouter key | Page text to translate, short page context, your key | https://openrouter.ai/privacy |
| Google Gemini API | You use a Gemini key | Page text to translate, short page context, your key | https://policies.google.com/privacy and https://ai.google.dev/gemini-api/terms |
| Anthropic API | You use an Anthropic key | Page text to translate, short page context, your key | https://www.anthropic.com/legal/privacy |
| Your Cloudflare account | You enable cloud sync | Hashed cache keys, translated text, optionally usage records | https://www.cloudflare.com/privacypolicy/ |

Each provider handles your requests under its own terms, which you accepted when you created your API key. Check them for how long they keep prompts and whether they use API data for training. OpenRouter forwards requests to the model vendor you pick; see OpenRouter's settings for provider data policies.

The extension loads no remote code. All of its code, including the Anthropic SDK, is bundled in the package published on the Chrome Web Store.

## 4. What the developer receives

Nothing. Transora has no backend operated by the developer, no telemetry, no crash reporting and no analytics. The developer does not sell, rent or share user data, and does not use it for advertising, credit decisions or any purpose other than providing the translation feature you use.

## 5. Limited Use

The use of information received from Chrome extension APIs and from web pages complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Specifically:

- Page content is used only to provide the translation you requested, and is sent only to the AI provider you configured.
- Data is not transferred to third parties except as needed to provide that feature (your chosen AI provider, and your own Cloudflare Worker if you enable sync), to comply with law, or as part of a merger or acquisition with notice to users.
- Data is not used or transferred for personalized advertising, and is not sold.
- No human reads your data. The developer has no access to it.

## 6. Retention and deletion

All data stays on your device until you delete it:

- **Translation cache:** side panel or options page, Settings, **Clear cache**.
- **Usage statistics:** Usage tab, **Clear** (trash icon).
- **API keys:** clear the key field for each provider in Settings.
- **Everything:** remove the extension at `chrome://extensions`. Chrome deletes the extension's IndexedDB and `chrome.storage` data on uninstall.
- **Cloud data:** stored in your own Cloudflare KV namespace. Delete keys in the Cloudflare dashboard (Workers KV), delete the namespace, or rotate `AUTH_TOKENS` (each token has its own namespace, so data under an old token is no longer reachable and expires on its own).
- **Provider data:** requests already sent to OpenRouter, Google or Anthropic are kept according to their policies. Contact them for deletion.

## 7. Security

- API keys never leave your device except in requests to their own provider over HTTPS.
- The optional Worker requires a bearer token, accepts browser requests only from Chrome extension origins, limits request rates and sizes, and never receives API keys.

## 8. Children

Transora is not directed at children under 13 and does not knowingly collect data from them. It collects no personal data from anyone; see section 4.

## 9. Changes

If this policy changes, the new version will be published at this address with a new effective date, and material changes will be noted in the release notes on the Chrome Web Store listing.

## 10. Contact

Questions or requests: email nguyenhx1@gmail.com, or use the forms on the support page, https://transora.engineeringjournal.dev/support/. Please never include an API key or a Cloud token.
