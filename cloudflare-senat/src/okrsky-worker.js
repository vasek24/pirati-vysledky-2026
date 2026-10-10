// Precinct map backend of the Senate Worker: Durable Object `OkrskyFeed` + the /api/senat-okrsky route.
// DETACHED from /api/senat: own Durable Object (idFromName('okrsky')), own cadence (okrsky-feed.js), own
// cache keys; a failure here is a failure of the map only. Not wired yet — see WIRING-okrsky.md.
//
// GET/HEAD /api/senat-okrsky?obvod=30[&round=1|2] → JSON { v: 1, obvod, round, refreshedAt, nextRefreshAt,
// servedAt, stale, phase, generated, generatedMs, batches: {1, 2}, cands: [ballot numbers], pirateNo, counted,
// precincts: [[obec, okrsek, voters (registered), valid, ...votes aligned with cands (0 = none or not on that round's ballot)]] }.
import { DurableObject } from 'cloudflare:workers'
import * as manifest from './manifest.js'
import { LAST_RESORT_TTL, cacheControlFor, edgeTtl, lastResortRequest, markStale, withTimeout } from './edge.js'
import { USER_AGENT } from './feed.js'
import { wantedOf } from './okrsky.js'
import { createOkrskyRefresher } from './okrsky-feed.js'

const DEFAULT_CSU_BASE = 'https://volby.gov.cz/appdata/senat/20261009'
const DEFAULT_POLLS_CLOSE_R1 = '2026-10-10T14:00:00+02:00'
const DEFAULT_POLLS_CLOSE_R2 = '2026-10-17T14:00:00+02:00'
const JSON_TYPE = 'application/json; charset=utf-8'
const RPC_TIMEOUT_MS = 13_000 // above the 12 s run deadline of the refresher, below the client timeout
const CRON_TIMEOUT_MS = 15_000
const FAIL_LOG_EVERY_MS = 10_000
const SECURITY = { 'x-content-type-options': 'nosniff' }

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

// Same rules as readConfig in worker.js (copied, not imported: worker.js will import THIS module).
// POLLS_CLOSE_R2 only with date, time AND offset, after round 1 and within 30 days of it.
const ISO_WITH_OFFSET = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$/
const MAX_R2_AFTER_R1_MS = 30 * 24 * 3600 * 1000

export function readOkrskyConfig(env) {
  const pollsCloseR1 = Date.parse(DEFAULT_POLLS_CLOSE_R1)
  const rawR2 = env.POLLS_CLOSE_R2 || DEFAULT_POLLS_CLOSE_R2
  const pollsCloseR2 = ISO_WITH_OFFSET.test(rawR2) ? Date.parse(rawR2) : NaN
  if (!Number.isFinite(pollsCloseR2) || !(pollsCloseR2 > pollsCloseR1) || !(pollsCloseR2 < pollsCloseR1 + MAX_R2_AFTER_R1_MS)) {
    throw new Error(`invalid POLLS_CLOSE_R2: ${rawR2}`)
  }
  return { base: (env.CSU_BASE || DEFAULT_CSU_BASE).replace(/\/+$/, ''), pollsCloseR1, pollsCloseR2 }
}

export class OkrskyFeed extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    const { base, pollsCloseR1, pollsCloseR2 } = readOkrskyConfig(env)
    this.refresher = createOkrskyRefresher({
      now: () => Date.now(),
      random: Math.random,
      storage: { get: (k) => this.ctx.storage.get(k), put: (o) => this.ctx.storage.put(o) },
      fetchImpl: (...args) => fetch(...args),
      userAgent: USER_AGENT,
      log,
      base,
      manifest,
      pollsCloseR1,
      pollsCloseR2,
      waitUntil: (p) => this.ctx.waitUntil(p),
    })
  }

  // { status, body (JSON string), cacheControl, stale, phase }; the body is never parsed again
  async run(obvod, round) {
    if (!this.refresher.wanted.has(obvod)) return { status: 400, body: '{"error":"bad-obvod"}', cacheControl: 'no-store', stale: false, phase: null }
    const { status, body, meta } = await this.refresher.get(obvod, round)
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

// the ONLY entry to the Durable Object (HTTP and cron)
const callFeed = (env, obvod, round) => env.OKRSKY_FEED.get(env.OKRSKY_FEED.idFromName('okrsky'), { locationHint: 'weur' }).run(obvod, round)

const sMaxAge = (cacheControl) => Number(/s-maxage=(\d+)/.exec(cacheControl || '')?.[1]) || 0

// the ONLY output of the route: x-server-now for client clock correction, nosniff, no CORS header
function reply(request, { status, headers, body }, cacheState) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: { ...headers, ...SECURITY, 'x-cache': cacheState, 'x-server-now': String(Date.now()) },
  })
}

const errorReply = (request, status, error, extraHeaders = {}) => reply(request, {
  status,
  headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...extraHeaders },
  body: JSON.stringify({ error }),
}, 'BYPASS')

let failLoggedAt = 0

function logFeedFailure(reason) {
  const t = Date.now()
  if (t - failLoggedAt < FAIL_LOG_EVERY_MS) return
  failLoggedAt = t
  log('okrsky-feed-failed', { level: 'warn', reason: String(reason) })
}

// The Durable Object failed (exception, timeout, 5xx): last good copy as stale:true, else 503 JSON (never cached).
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

export async function handleOkrskyRequest(request, env, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorReply(request, 405, 'method-not-allowed', { Allow: 'GET, HEAD' })
  const url = new URL(request.url)

  let wanted
  try {
    wanted = wantedOf(manifest)
  } catch (error) {
    logFeedFailure(error?.message || error)
    return errorReply(request, 503, 'unavailable')
  }
  const rawObvod = url.searchParams.get('obvod')
  const obvod = /^\d{1,2}$/.test(rawObvod ?? '') ? Number(rawObvod) : NaN
  if (!wanted.has(obvod)) return errorReply(request, 400, 'bad-obvod')
  const rawRound = url.searchParams.get('round')
  if (rawRound !== null && rawRound !== '1' && rawRound !== '2') return errorReply(request, 400, 'bad-round')
  const round = rawRound === null ? undefined : Number(rawRound)

  // cache key = the validated query only: a random ?x= must not bypass the cache
  const cache = caches.default
  const cacheKey = new Request(`${url.origin}/api/senat-okrsky?obvod=${obvod}${round ? `&round=${round}` : ''}`)
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
    out = await withTimeout(callFeed(env, obvod, round), RPC_TIMEOUT_MS)
  } catch (error) {
    logFeedFailure(error?.message || error)
  }
  // 5xx is never cached; the client keeps its last data and tries again
  if (!out || out.status >= 500) {
    if (out) logFeedFailure(`status ${out.status}`)
    return lastResort(request, ctx, cache, cacheKey, lastResortKey)
  }

  const headers = { 'content-type': JSON_TYPE, 'cache-control': out.cacheControl }
  const ttl = sMaxAge(out.cacheControl)
  if (out.status === 200 && ttl > 0) {
    ctx.waitUntil(cache.put(cacheKey, new Response(out.body, {
      status: 200,
      headers: {
        'content-type': JSON_TYPE,
        'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}`,
        'x-client-cache-control': out.cacheControl,
      },
    })))
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

// Cron warm-up (call it in its OWN try/catch in scheduled()): same as a viewer, never throws.
export async function warmOkrsky(env) {
  try {
    const [first] = wantedOf(manifest).keys()
    const out = await withTimeout(callFeed(env, first), CRON_TIMEOUT_MS)
    log('okrsky-cron', { status: out.status, stale: out.stale, phase: out.phase })
  } catch (error) {
    log('okrsky-cron-failed', { level: 'warn', error: String(error?.message || error) })
  }
}
