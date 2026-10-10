// Cloudflare Worker pirati-senat-zaloha: výsledky voleb do Senátu 2026 (senat.dg12.cz).
// Statika ze ../senat/dist (assets) + /api/senat + /healthz. Samostatný od
// pražského Workeru (žádný import z cloudflare/, src/ ani api/), spec §1, §2.
//
// Jedna instance Durable Objectu `SenatFeed` ('senat') je JEDINÝ obnovovatel
// dat: drží poslední ověřený snapshot (refresh.js), obsluhuje ho okamžitě a na
// pozadí ho obnovuje podmíněným GETem z volby.gov.cz. Před DO je Cache API
// (per datacentrum, TTL z edge.js) a 20min záložní kopie pro případ, že DO
// selže. Hlavička x-cache: HIT/MISS/LASTRESORT/UNAVAILABLE slouží k ověření.
import { DurableObject } from 'cloudflare:workers'
import * as manifest from './manifest.js'
import { LAST_RESORT_TTL, cacheControlFor, edgeTtl, lastResortRequest, markStale, withTimeout } from './edge.js'
import { USER_AGENT, createSenatFeed } from './feed.js'
import { createRefresher } from './refresh.js'

const DEFAULT_CSU_BASE = 'https://volby.gov.cz/appdata/senat/20261009'
const DEFAULT_POLLS_CLOSE_R1 = '2026-10-10T14:00:00+02:00'
const DEFAULT_POLLS_CLOSE_R2 = '2026-10-17T14:00:00+02:00'
const JSON_TYPE = 'application/json; charset=utf-8'
const RPC_TIMEOUT_MS = 13_000 // nad 12s lhůtou buildu v refresheru, pod 25s timeoutem klienta
const CRON_TIMEOUT_MS = 15_000
const FAIL_LOG_EVERY_MS = 10_000

// jeden JSON řádek na událost, úroveň podle data.level
function log(event, data = {}) {
  const { level, ...rest } = data
  const method = level === 'error' || level === 'warn' ? level : 'info'
  let line
  try {
    line = JSON.stringify({ event, level: method, ...rest })
  } catch {
    line = JSON.stringify({ event, level: method, unserializable: true })
  }
  console[method](line)
}

// POLLS_CLOSE_R2 (přepis, když se 2. kolo posune): jen datum a čas S OFFSETEM. Datum bez času
// (`2026-10-24` = půlnoc UTC = 02:00 CEST) nebo čas bez offsetu (čte se jako UTC) by hradlo
// 2. kola otevřely špatně, proto se odmítnou. 2. kolo musí být po 1. kole, nejdéle o 30 dní.
const ISO_WITH_OFFSET = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$/
const MAX_R2_AFTER_R1_MS = 30 * 24 * 3600 * 1000

// Konfigurace jen z env, nikdy z požadavku. Špatná hodnota = výjimka při startu DO.
export function readConfig(env) {
  const pollsCloseR1 = Date.parse(DEFAULT_POLLS_CLOSE_R1)
  const rawR2 = env.POLLS_CLOSE_R2 || DEFAULT_POLLS_CLOSE_R2
  const pollsCloseR2 = ISO_WITH_OFFSET.test(rawR2) ? Date.parse(rawR2) : NaN
  if (!Number.isFinite(pollsCloseR2) || !(pollsCloseR2 > pollsCloseR1) || !(pollsCloseR2 < pollsCloseR1 + MAX_R2_AFTER_R1_MS)) {
    throw new Error(`invalid POLLS_CLOSE_R2: ${rawR2} (need YYYY-MM-DDTHH:mm[:ss]+HH:mm, after ${DEFAULT_POLLS_CLOSE_R1}, within 30 days)`)
  }
  return { base: (env.CSU_BASE || DEFAULT_CSU_BASE).replace(/\/+$/, ''), pollsCloseR1, pollsCloseR2 }
}

export class SenatFeed extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    const { base, pollsCloseR1, pollsCloseR2 } = readConfig(env)
    // Obnova na pozadí přežije odeslání odpovědi, protože DO zůstává živý, dokud
    // má rozpracované I/O (stahování z ČSÚ); ctx.waitUntil je v DO no-op.
    this.refresher = createRefresher({
      now: Date.now,
      random: Math.random,
      storage: { get: (k) => this.ctx.storage.get(k), put: (o) => this.ctx.storage.put(o) },
      feed: createSenatFeed({
        baseUrl: base, fetchImpl: (...args) => fetch(...args), userAgent: USER_AGENT, manifest, now: Date.now, pollsCloseR1, pollsCloseR2,
      }),
      base,
      log,
      pollsCloseR1,
      pollsCloseR2,
      requireManifestSet: true, // ostrý feed: cold start s chybějícím obvodem se nepublikuje
      waitUntil: (p) => this.ctx.waitUntil(p),
    })
  }

  // Odpověď feedu ze stored snapshotu: { status, body, cacheControl, stale, phase }.
  // `body` je hotový JSON řetězec z refresheru (neparsuje se znovu).
  async run() {
    const { status, body, meta } = await this.refresher.get()
    const ok = status === 200
    return {
      status,
      body,
      cacheControl: ok ? cacheControlFor(edgeTtl({ nextRefreshAt: meta.nextRefreshAt, now: Date.now(), stale: meta.stale, phase: meta.phase })) : 'no-store',
      stale: meta.stale,
      phase: meta.phase,
    }
  }
}

// JEDINÝ vstup do Durable Objectu (HTTP route i cron): feed nemá fetch(), volá se RPC run().
const callFeed = (env) => env.SENAT_FEED.get(env.SENAT_FEED.idFromName('senat'), { locationHint: 'weur' }).run()

const sMaxAge = (cacheControl) => Number(/s-maxage=(\d+)/.exec(cacheControl || '')?.[1]) || 0

// JEDINÝ výstup odpovědí API (HIT, MISS, LASTRESORT, 503): x-server-now je čas
// serveru pro korekci hodin klienta. Žádná CORS hlavička.
function reply(request, { status, headers, body }, cacheState) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: { ...headers, 'x-cache': cacheState, 'x-server-now': String(Date.now()), 'x-content-type-options': 'nosniff' },
  })
}

// x-server-now na KAŽDÉ odpovědi (405, /healthz, 404 i statika). Odpověď z ASSETS má neměnné
// hlavičky, proto se obalí novou Response (stav, tělo i cache hlavičky zůstanou).
export function withServerNow(res) {
  const out = new Response(res.body, res)
  out.headers.set('x-server-now', String(Date.now()))
  return out
}

let failLoggedAt = 0

// V poruše by log na každý požadavek diváka byl neomezený — nejvýš jednou za 10 s na isolate
function logFeedFailure(reason) {
  const t = Date.now()
  if (t - failLoggedAt < FAIL_LOG_EVERY_MS) return
  failLoggedAt = t
  log('feed-failed', { level: 'warn', reason: String(reason) })
}

// DO selhal (výjimka, timeout nebo 5xx): poslední dobrá odpověď ze záložní kopie
// jako stale:true, jinak 503 JSON (necachuje se). Označená kopie se vloží do
// HLAVNÍ cache na ≤ 5 s, aby se v poruše každý požadavek nevracel do přetíženého DO.
async function lastResort(request, ctx, cache, cacheKey, lastResortKey) {
  const copy = await cache.match(lastResortKey).catch(() => null)
  if (!copy) {
    return reply(request, {
      status: 503,
      headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'unavailable' }),
    }, 'UNAVAILABLE')
  }
  const body = markStale(await copy.text())
  const clientCache = 'public, max-age=0, s-maxage=5'
  ctx.waitUntil(cache.put(cacheKey, new Response(body, {
    status: 200,
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': 'public, max-age=5, s-maxage=5',
      'x-client-cache-control': clientCache,
      'x-lastresort': '1',
    },
  })).catch(() => {}))
  return reply(request, { status: 200, headers: { 'content-type': JSON_TYPE, 'cache-control': clientCache, 'x-lastresort': '1' }, body }, 'LASTRESORT')
}

async function api(request, env, ctx, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', 'x-server-now': String(Date.now()), 'x-content-type-options': 'nosniff' },
    })
  }
  // Normalizovaná cesta: klíč cache, ostatní parametry se zahodí (náhodné ?x= nesmí obejít cache)
  const cache = caches.default
  const cacheKey = new Request(`${url.origin}/api/senat`)
  const lastResortKey = lastResortRequest(cacheKey.url)
  const hit = await cache.match(cacheKey)
  if (hit) {
    const headers = Object.fromEntries(hit.headers)
    headers['cache-control'] = headers['x-client-cache-control']
    delete headers['x-client-cache-control']
    return reply(request, { status: hit.status, headers, body: hit.body }, 'HIT')
  }

  let out = null
  try {
    // zaseknuté DO nesmí držet diváky až do timeoutu klienta
    out = await withTimeout(callFeed(env), RPC_TIMEOUT_MS)
  } catch (error) {
    logFeedFailure(error?.message || error)
  }
  // 5xx se nikdy necachuje; klient po 503 nechá poslední snapshot a zkouší znovu
  if (!out || out.status >= 500) {
    if (out) logFeedFailure(`status ${out.status}`)
    return lastResort(request, ctx, cache, cacheKey, lastResortKey)
  }

  const headers = { 'content-type': JSON_TYPE, 'cache-control': out.cacheControl }
  const ttl = sMaxAge(out.cacheControl)
  if (out.status === 200 && ttl > 0) {
    // Cache API bere TTL spolehlivě z max-age, proto stejná hodnota i tam;
    // klient dostane původní hlavičku z x-client-cache-control (HIT cesta)
    ctx.waitUntil(cache.put(cacheKey, new Response(out.body, {
      status: 200,
      headers: {
        'content-type': JSON_TYPE,
        'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}`,
        'x-client-cache-control': out.cacheControl,
      },
    })))
    // 20min záložní kopie pod samostatným klíčem (fragment by hlavní klíč přepsal)
    ctx.waitUntil(cache.put(lastResortKey, new Response(out.body, {
      status: 200,
      headers: {
        'content-type': JSON_TYPE,
        'cache-control': `public, max-age=${LAST_RESORT_TTL}, s-maxage=${LAST_RESORT_TTL}`,
      },
    })))
  }
  return reply(request, { status: out.status, headers, body: out.body }, 'MISS')
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api/senat') return api(request, env, ctx, url)
    // uptime check: konstantní odpověď, nikdy nesahá na DO
    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'x-server-now': String(Date.now()), 'x-content-type-options': 'nosniff' } })
    }
    // SPA má jedinou routu `/`; 404 z assets zůstává 404
    return withServerNow(await env.ASSETS.fetch(request))
  },

  // Cron každou minutu: totéž co požadavek diváka, o tom, zda je obnova na řadě,
  // rozhoduje sám DO. Nikdy nevyhazuje; vypršení 15 s lhůty RPC nezruší práci v DO.
  async scheduled(event, env) {
    try {
      const out = await withTimeout(callFeed(env), CRON_TIMEOUT_MS)
      log('cron', { status: out.status, stale: out.stale, phase: out.phase })
    } catch (error) {
      log('cron-failed', { level: 'warn', error: String(error?.message || error) })
    }
  },
}
