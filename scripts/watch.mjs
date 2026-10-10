// Election-night watcher: read-only GETs against the live tracker API, one compact
// status block per cycle plus ALERT / RESOLVED lines. No dependencies (Node >= 20).
// Usage: node scripts/watch.mjs [baseUrl] [--once] [--interval=30] [--json]
//   baseUrl   default https://praha.dg12.cz
//   --once    print a single cycle and exit
//   --interval=<s>  seconds between cycle starts (default 30, never below 30)
//   --json    one JSON object per line instead of text
// 12 requests per cycle (11 council feeds + /api/prehled), 4 at a time.
import { buildSample, createFeedState, stepFeed, formatSampleLine, formatHeader } from './lib/watch-core.mjs'

const UA = 'pirati-watch/1.0 (+420 777 954 389)'
const TIMEOUT_MS = 10_000
const MIN_INTERVAL_S = 30
const CONCURRENCY = 4
const ZASTUP = [554782, 500119, 500224, 500208, 500178, 500143, 547034, 500097, 539694, 547107, 500216]

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
const base = (args.find((a) => !a.startsWith('--')) || 'https://praha.dg12.cz').replace(/\/+$/, '')
const once = Boolean(flag('once'))
const json = Boolean(flag('json'))
const requested = Number(flag('interval')?.split('=')[1] ?? MIN_INTERVAL_S)
const intervalS = Number.isFinite(requested) ? Math.max(MIN_INTERVAL_S, requested) : MIN_INTERVAL_S
if (!/^https?:\/\//.test(base)) {
    console.error('usage: node scripts/watch.mjs [baseUrl] [--once] [--interval=<s>] [--json]')
    process.exit(2)
}
if (requested < MIN_INTERVAL_S) console.error(`interval raised to ${MIN_INTERVAL_S}s (minimum)`)

const FEEDS = [
    ...ZASTUP.map((z) => ({ id: String(z), path: `/api/volby?z=${z}` })),
    { id: 'prehled', path: '/api/prehled' },
]
const states = new Map(FEEDS.map((f) => [f.id, createFeedState()]))

async function fetchFeed(feed) {
    const t0 = performance.now()
    const now = Date.now()
    try {
        const res = await fetch(base + feed.path, {
            headers: { 'user-agent': UA, accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const text = await res.text()
        return buildSample({ status: res.status, headers: res.headers, text, latencyMs: performance.now() - t0, now: Date.now() })
    } catch (e) {
        const error = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : String(e?.cause?.code || e?.cause?.errors?.[0]?.code || e?.message || e)
        return buildSample({ error, latencyMs: performance.now() - t0, now })
    }
}

const out = (text, obj) => console.log(json ? JSON.stringify(obj) : text)

async function cycle(n) {
    const samples = []
    for (let i = 0; i < FEEDS.length; i += CONCURRENCY) {
        samples.push(...(await Promise.all(FEEDS.slice(i, i + CONCURRENCY).map(fetchFeed))))
    }
    const now = Date.now()
    const alerts = []
    FEEDS.forEach((f, i) => {
        for (const a of stepFeed(states.get(f.id), samples[i], now)) alerts.push({ feed: f.id, ...a })
    })
    const alerting = FEEDS.filter((f) => states.get(f.id).active.size > 0).length
    const overview = samples[FEEDS.length - 1]
    const header = {
        now, cycle: n, feeds: FEEDS.length, ok: FEEDS.length - alerting, alerting,
        counted: overview.counted, total: overview.total,
    }
    out(formatHeader(header), { type: 'header', ...header })
    FEEDS.forEach((f, i) => out('  ' + formatSampleLine(f.id, samples[i]), { type: 'feed', feed: f.id, ...samples[i] }))
    for (const a of alerts) {
        out(`${a.kind} ${a.feed} ${a.rule}${a.detail ? ' ' + a.detail : ''}`, { type: a.kind.toLowerCase(), ...a })
    }
}

for (let n = 1; ; n++) {
    const started = Date.now()
    await cycle(n)
    if (once) break
    await new Promise((r) => setTimeout(r, Math.max(0, intervalS * 1000 - (Date.now() - started))))
}
