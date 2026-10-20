# Transora Cloud

The optional Cloudflare Worker for Transora, a Chrome extension that translates web pages with AI using your own API key. You deploy it to your own Cloudflare account. It gives you:

- a translation cache shared across your devices, so text you already paid to translate on one computer is free on another;
- a place to sync usage history (cost by day, model, site and key) between devices.

It never receives your AI provider API keys. It stores only SHA-256 hashes of the source text, the translated text, the model name, and usage counters. The free Workers plan is enough for personal use.

## Deploy

You need Node.js 20+ and a Cloudflare account.

```bash
git clone https://github.com/nguyenhx2/transora-cloud
cd transora-cloud
npm install
npx wrangler login

npx wrangler kv namespace create transora-cache   # copy the printed id into wrangler.jsonc ("kv_namespaces")
npx wrangler secret put AUTH_TOKENS               # one or more random tokens, comma-separated
npm run deploy
```

Make a token with `node -e "console.log(crypto.randomUUID())"` or any password generator. Each token gets its own isolated namespace, so you can give different tokens to different people, or rotate one without touching the others.

Then open the extension: **Settings → Cloudflare sync**, enter the worker URL (`https://transora-cloud.<your-subdomain>.workers.dev`) and your token, and press **Test**.

## Security

- **Auth**: every API request needs `Authorization: Bearer <token>`. Failed attempts are rate limited per IP.
- **CORS**: CORS headers are returned only for `chrome-extension://` origins; requests from other web origins get `403`. To allow only your own install, set `ALLOWED_ORIGINS` in `wrangler.jsonc` to `chrome-extension://<extension-id>` (comma-separated for several).
- **Rate limiting**: the `RATE_LIMITER` binding allows 600 requests per 60 seconds per token. Adjust `ratelimits` in `wrangler.jsonc` if needed.
- **Input validation**: request bodies up to 1 MB, at most 200 keys or entries per cache request, translations up to 20,000 characters, keys must be SHA-256 hex, usage records keep only known fields (at most 500 records per push). Internal errors return only `internal error`; details go to the worker log.
- **Few KV writes** (the free plan allows 1,000 a day): `cache/put` skips entries that are already stored with the same content, and each usage push is a single value.
- **Retention**: cache entries expire after 120 days, usage records after 400 days.

## API

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/v1/health` | | `{ ok, version, namespace }` |
| POST | `/v1/cache/get` | `{ keys: string[] }` | `{ ok, hits: Record<key, text> }` |
| POST | `/v1/cache/put` | `{ entries: { k, t, m }[] }` | `{ ok, stored, written }` |
| POST | `/v1/usage/push` | `{ device, records }` | `{ ok, stored }` |
| GET | `/v1/usage/pull` | `?cursor=…` | `{ ok, records, cursor? }` (newest first; `cursor` is present when more pages remain) |
| GET | `/privacy` | | Transora's privacy policy as HTML (public, no token) |

Errors are `{ ok: false, error }` with an HTTP status.

## Develop

```bash
cp .dev.vars.example .dev.vars   # local AUTH_TOKENS
npm run dev                      # http://127.0.0.1:8787
npm run typecheck
```

## Delete your data

Delete the keys in the Cloudflare dashboard (Workers KV), delete the namespace, or remove a token from `AUTH_TOKENS`: data under that token is no longer reachable and expires on its own.

## License

MIT. This repository is published from the Transora source tree; open an issue here for worker bugs.
