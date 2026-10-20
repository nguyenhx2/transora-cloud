// Transora Cloud: optional Cloudflare Worker that gives a user a translation cache shared across
// their devices and a place to sync usage history. It never sees provider API keys — only
// cache keys (SHA-256 hashes), translated text and usage counters.
//
// HTTP contract (used by src/background/cloud.ts; keep backward compatible):
//   GET  /v1/health                         → { ok, version, namespace }
//   POST /v1/cache/get   { keys: string[] } → { ok, hits: Record<key, text> }
//   POST /v1/cache/put   { entries: {k,t,m}[] } → { ok, stored, written }
//   POST /v1/usage/push  { device, records } → { ok, stored }
//   GET  /v1/usage/pull[?cursor=…]          → { ok, records, cursor? }  (cursor present when more pages exist)
// All endpoints need `Authorization: Bearer <token>`; errors are { ok: false, error }.
// GET /privacy is public: the privacy policy page (PRIVACY.md) for the Chrome Web Store listing.

import { privacyPage } from './privacy';

export interface Env {
  CACHE: KVNamespace;
  /** Comma-separated access tokens; each token gets its own isolated namespace. */
  AUTH_TOKENS: string;
  /**
   * Optional comma-separated list of allowed browser origins. Entries are exact origins
   * ("chrome-extension://abcdef…") or "chrome-extension://*". Default: "chrome-extension://*".
   * Requests without an Origin header (curl, scripts) are not affected.
   */
  ALLOWED_ORIGINS?: string;
  /** Workers Rate Limiting binding (see wrangler.jsonc). Absent in some local setups; then no limit applies. */
  RATE_LIMITER?: RateLimit;
}

const VERSION = '0.2.0';
const CACHE_TTL = 60 * 60 * 24 * 120; // 120 days
const USAGE_TTL = 60 * 60 * 24 * 400;

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB per request body
const MAX_KEYS = 200; // keys per cache/get and entries per cache/put
const MAX_VALUE = 20_000; // characters per translated text
const MAX_META = 80; // characters of entry metadata (model id)
const MAX_RECORDS_PER_PUSH = 500;
const KV_BULK = 100; // KV bulk get accepts at most 100 keys per call

// usage/pull budget per request. Each pushed batch is one KV value holding up to 500 records,
// so these bound both KV operations (the per-invocation limit is 1,000) and response size.
const PULL_PAGE = 50; // keys listed (and fetched in one bulk get) per step
const PULL_MAX_VALUES = 200;
const PULL_MAX_RECORDS = 20_000;

// Usage keys. Legacy (v0.1): `u:<ns>:<YYYY-MM-DD>:<device>:<ms>` (lists oldest first).
// Current: `v:<ns>:<13-digit reverse ms>:<device>` so a KV list returns the newest batches first.
const REV_BASE = 9_999_999_999_999;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

// ---------- CORS ----------

function originAllowed(origin: string, env: Env): boolean {
  const list = (env.ALLOWED_ORIGINS || 'chrome-extension://*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.some((o) => (o.endsWith('://*') ? origin.startsWith(o.slice(0, -1)) && origin.length > o.length - 1 : o === origin));
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !originAllowed(origin, env)) return {};
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

const json = (data: unknown, status: number, extra: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });

// ---------- auth ----------

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

/** Returns the caller's namespace (derived from their token) or null when unauthorized. */
async function authorize(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 512 || !env.AUTH_TOKENS) return null;
  const allowed = env.AUTH_TOKENS.split(',').map((t) => t.trim()).filter(Boolean);
  // Compare against every token so timing does not reveal which (if any) matched.
  let ok = false;
  for (const t of allowed) ok = timingSafeEqual(t, token) || ok;
  if (!ok) return null;
  return (await sha256(token)).slice(0, 16);
}

/** True when the request may proceed. Fails open if the binding is missing or errors (local dev). */
async function withinRateLimit(env: Env, key: string): Promise<boolean> {
  if (!env.RATE_LIMITER) return true;
  try {
    return (await env.RATE_LIMITER.limit({ key })).success;
  } catch (e) {
    console.error('rate limiter error', e);
    return true;
  }
}

// ---------- input validation ----------

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'payload too large');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'payload too large');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'bad request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad request');
  return body as Record<string, unknown>;
}

/** Cache keys are lowercase hex SHA-256 digests (see keyFor in src/background/translator.ts). */
const isHashKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);
const isDevice = (d: unknown): d is string => typeof d === 'string' && /^[\w-]{8,64}$/.test(d);

// Whitelist of UsageRecord fields (src/shared/types.ts) with their types and max string lengths.
// Unknown fields are dropped. Enum-like fields are checked as short strings, not exact values,
// so a newer extension version can add providers or kinds without a worker update.
const NUM_FIELDS = [
  'ts',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cost',
  'segments',
  'chars',
  'cacheHits',
  'cachedChars',
  'latencyMs',
] as const;
const STR_FIELDS: Record<string, number> = {
  provider: 32,
  model: 200,
  host: 253,
  kind: 32,
  costSource: 32,
  error: 500,
  keyId: 64,
  keyHint: 32,
};

type CleanRecord = Record<string, string | number | boolean>;

function cleanRecord(r: unknown, device: string): CleanRecord | null {
  if (!r || typeof r !== 'object') return null;
  const src = r as Record<string, unknown>;
  if (typeof src.ts !== 'number' || !Number.isFinite(src.ts)) return null;
  const out: CleanRecord = {};
  for (const f of NUM_FIELDS) {
    const v = src[f];
    if (typeof v === 'number' && Number.isFinite(v)) out[f] = v;
  }
  for (const [f, max] of Object.entries(STR_FIELDS)) {
    const v = src[f];
    if (typeof v === 'string') out[f] = v.slice(0, max);
  }
  if (typeof src.ok === 'boolean') out.ok = src.ok;
  out.device = device;
  return out;
}

// ---------- KV helpers ----------

/** Bulk text get in chunks of 100 keys (one KV operation per chunk instead of one per key). */
async function kvGetMany(kv: KVNamespace, keys: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += KV_BULK) {
    const chunk = keys.slice(i, i + KV_BULK);
    if (!chunk.length) continue;
    const res = await kv.get(chunk, 'text');
    for (const k of chunk) out.set(k, res.get(k) ?? null);
  }
  return out;
}

// ---------- handlers ----------

async function cacheGet(req: Request, env: Env, ns: string) {
  const { keys } = await readJson(req);
  const valid = [...new Set((Array.isArray(keys) ? keys : []).filter(isHashKey))].slice(0, MAX_KEYS);
  const values = await kvGetMany(env.CACHE, valid.map((k) => `t:${ns}:${k}`));
  const hits: Record<string, string> = {};
  for (const k of valid) {
    const v = values.get(`t:${ns}:${k}`);
    if (v != null) hits[k] = v;
  }
  return { ok: true, hits };
}

// Write budget: KV allows 100,000 reads but only 1,000 writes per day on the free plan, and a
// write costs ~10x a read on paid plans. So cache/put first reads the target keys (bulk get,
// cheap) and only writes entries that are missing or changed. Trade-offs:
//  - A skipped entry keeps its original 120-day TTL; frequently used translations still expire
//    and are re-translated after that. Refreshing TTLs on read would spend the write budget.
//  - Two devices putting the same key at the same moment can both write; harmless (same value).
//  - Entries stay one KV value per key (format `t:<ns>:<sha256>` → text, metadata { m }), so
//    entries written by v0.1 keep working. Packing many translations into one value would cut
//    writes further but needs read-modify-write and loses data under concurrent puts.
async function cachePut(req: Request, env: Env, ns: string) {
  const { entries } = await readJson(req);
  const seen = new Set<string>();
  const valid: { k: string; t: string; m: string }[] = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (valid.length >= MAX_KEYS) break;
    if (!e || typeof e !== 'object') continue;
    const { k, t, m } = e as Record<string, unknown>;
    if (!isHashKey(k) || typeof t !== 'string' || !t || t.length > MAX_VALUE || seen.has(k)) continue;
    seen.add(k);
    valid.push({ k, t, m: typeof m === 'string' ? m.slice(0, MAX_META) : '' });
  }
  const existing = await kvGetMany(env.CACHE, valid.map((e) => `t:${ns}:${e.k}`));
  const toWrite = valid.filter((e) => existing.get(`t:${ns}:${e.k}`) !== e.t);
  await Promise.all(
    toWrite.map((e) => env.CACHE.put(`t:${ns}:${e.k}`, e.t, { expirationTtl: CACHE_TTL, metadata: { m: e.m } })),
  );
  return { ok: true, stored: valid.length, written: toWrite.length };
}

// One KV write per push (records are packed into a single value). The extension batches records
// (every 20 translations or every 5 minutes), which keeps usage sync well under the write budget.
async function usagePush(req: Request, env: Env, ns: string) {
  const { device, records } = await readJson(req);
  if (!isDevice(device) || !Array.isArray(records)) throw new HttpError(400, 'bad request');
  const clean = records
    .slice(0, MAX_RECORDS_PER_PUSH)
    .map((r) => cleanRecord(r, device))
    .filter((r): r is CleanRecord => r !== null);
  if (!clean.length) return { ok: true, stored: 0 };
  const rev = String(REV_BASE - Date.now()).padStart(13, '0');
  const suffix = crypto.randomUUID().slice(0, 8);
  await env.CACHE.put(`v:${ns}:${rev}:${device}:${suffix}`, JSON.stringify(clean), { expirationTtl: USAGE_TTL });
  return { ok: true, stored: clean.length };
}

// Returns usage batches newest first: current `v:` keys, then legacy `u:` keys. Each request is
// bounded (PULL_MAX_VALUES values / PULL_MAX_RECORDS records); when more remain, the response
// carries `cursor`, to be passed back as `?cursor=` for the next page. Clients that ignore the
// cursor get the newest page only.
async function usagePull(url: URL, env: Env, ns: string) {
  const raw = url.searchParams.get('cursor') || '';
  let phase: 'v' | 'u' = 'v';
  let kvCursor: string | undefined;
  if (raw) {
    const m = /^([vu]):(.*)$/s.exec(raw);
    if (!m || m[2].length > 2048) throw new HttpError(400, 'bad cursor');
    phase = m[1] as 'v' | 'u';
    kvCursor = m[2] || undefined;
  }

  const records: CleanRecord[] = [];
  let values = 0;
  for (;;) {
    const list = await env.CACHE.list({ prefix: `${phase}:${ns}:`, cursor: kvCursor, limit: PULL_PAGE });
    const got = await kvGetMany(
      env.CACHE,
      list.keys.map((k) => k.name),
    );
    for (const [name, v] of got) {
      if (!v) continue;
      values++;
      let arr: unknown;
      try {
        arr = JSON.parse(v);
      } catch {
        console.error('corrupt usage value', name);
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const dev = (r as { device?: unknown })?.device;
        const c = cleanRecord(r, isDevice(dev) ? dev : 'unknown-device');
        if (c) records.push(c);
      }
    }
    if (list.list_complete) {
      if (phase === 'u') return { ok: true, records };
      phase = 'u';
      kvCursor = undefined;
    } else kvCursor = list.cursor;
    if (values >= PULL_MAX_VALUES || records.length >= PULL_MAX_RECORDS) {
      return { ok: true, records, cursor: `${phase}:${kvCursor ?? ''}` };
    }
  }
}

// ---------- entry ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Public pages (no token, no Origin check): the privacy policy linked from the store listing.
    const { pathname: publicPath } = new URL(req.url);
    if ((req.method === 'GET' || req.method === 'HEAD') && (publicPath === '/privacy' || publicPath === '/privacy/')) return privacyPage();

    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, env);
    // Browsers only send Origin for cross-origin requests; refuse ones from origins we do not
    // serve. Requests without Origin (curl, scripts) go on to token auth as before.
    if (origin && !cors['access-control-allow-origin']) {
      return json({ ok: false, error: 'origin not allowed' }, 403, {});
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '86400',
        },
      });
    }

    const url = new URL(req.url);
    const { pathname } = url;
    const ns = await authorize(req, env);
    if (!ns) {
      // Throttle token guessing per client IP (counts failed attempts only).
      const ip = req.headers.get('cf-connecting-ip') || 'unknown';
      if (!(await withinRateLimit(env, `fail:${ip}`))) return json({ ok: false, error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' });
      return json({ ok: false, error: 'unauthorized' }, 401, cors);
    }
    if (!(await withinRateLimit(env, `ns:${ns}`))) {
      return json({ ok: false, error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' });
    }

    try {
      let result: unknown;
      if (req.method === 'GET' && pathname === '/v1/health') result = { ok: true, version: VERSION, namespace: ns };
      else if (req.method === 'POST' && pathname === '/v1/cache/get') result = await cacheGet(req, env, ns);
      else if (req.method === 'POST' && pathname === '/v1/cache/put') result = await cachePut(req, env, ns);
      else if (req.method === 'POST' && pathname === '/v1/usage/push') result = await usagePush(req, env, ns);
      else if (req.method === 'GET' && pathname === '/v1/usage/pull') result = await usagePull(url, env, ns);
      else return json({ ok: false, error: 'not found' }, 404, cors);
      return json(result, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.publicMessage }, e.status, cors);
      console.error(`${req.method} ${pathname} failed`, e);
      return json({ ok: false, error: 'internal error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
