// Pure helpers for scripts/watch.mjs (no I/O, no app imports).

export const PHASE_RANK = { pre: 0, waiting: 1, counting: 2, final: 3 }
export const WINDOW = 10
const META = ['refreshedAt', 'firstSeenAt', 'nextRefreshAt', 'servedAt', 'stale', 'complete', 'refreshing', 'generated', 'phase', 'precincts']

const STALE_CYCLES = 2 // alert when stale for MORE than this many consecutive cycles
const OVERDUE_MS = 90_000
const DATA_AGE_MAX_S = 180
const LATENCY_P95_MAX_MS = 1500
const MISS_MAX = 0.5
const MIN_SAMPLES = { latency: 3, miss: 5 }

// ČSÚ `generated` is zone-less Prague time; Prague is CEST (+02:00) until 25 Oct 2026.
export function parseCsuTime(s) {
  if (!s || typeof s !== 'string') return null
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+02:00`)
  return Number.isNaN(ms) ? null : ms
}

export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

export function missRatio(values) {
  const known = values.filter((v) => typeof v === 'string' && v)
  if (!known.length) return { ratio: 0, n: 0 }
  return { ratio: known.filter((v) => v === 'MISS').length / known.length, n: known.length }
}

const sec = (ms) => Math.round(ms / 1000)

// Turns one HTTP outcome into a flat sample. `headers` is a Headers-like object.
export function buildSample({ status = null, headers = null, text = '', latencyMs, error = null, now }) {
  const s = {
    now, ok: false, status, error, latencyMs, invalid: false, missingMeta: [], serverNow: null, xCache: null,
    phase: null, counted: null, total: null, dataAgeS: null, refreshAgeS: null, nextInS: null,
    nextRefreshAt: null, stale: null, complete: null,
  }
  if (error || status === null) return { ...s, error: error || 'no response' }
  const sn = Number(headers?.get('x-server-now'))
  s.serverNow = headers?.get('x-server-now') && Number.isFinite(sn) ? sn : null
  s.xCache = headers?.get('x-cache') || null
  s.ok = status === 200
  if (!s.ok) return s
  let j
  try {
    j = JSON.parse(text)
  } catch {
    return { ...s, invalid: true }
  }
  if (!j || typeof j !== 'object') return { ...s, invalid: true }
  s.missingMeta = META.filter((k) => j[k] === undefined || j[k] === null)
  const p = j.precincts
  if (!s.missingMeta.includes('precincts') && !(Number.isFinite(p?.counted) && Number.isFinite(p?.total))) s.missingMeta.push('precincts')
  s.phase = j.phase ?? null
  s.counted = Number.isFinite(p?.counted) ? p.counted : null
  s.total = Number.isFinite(p?.total) ? p.total : null
  s.stale = typeof j.stale === 'boolean' ? j.stale : null
  s.complete = typeof j.complete === 'boolean' ? j.complete : null
  s.nextRefreshAt = Number.isFinite(j.nextRefreshAt) ? j.nextRefreshAt : null
  const gen = parseCsuTime(j.generated)
  s.dataAgeS = gen === null ? null : sec(now - gen)
  s.refreshAgeS = Number.isFinite(j.refreshedAt) ? sec(now - j.refreshedAt) : null
  s.nextInS = s.nextRefreshAt === null ? null : sec(s.nextRefreshAt - now)
  return s
}

export function createFeedState() {
  return { active: new Map(), staleStreak: 0, prevCounted: null, prevRank: null, latencies: [], caches: [] }
}

const push = (arr, v) => {
  arr.push(v)
  if (arr.length > WINDOW) arr.shift()
}

// Advances one feed's state with a new sample. Returns [{kind:'ALERT'|'RESOLVED', rule, detail}].
// A rule value of undefined means "cannot evaluate this cycle": its alert state is left unchanged.
export function stepFeed(state, s, now) {
  const rules = {}
  const full = s.ok && !s.invalid && s.missingMeta.length === 0

  push(state.latencies, s.latencyMs)
  if (s.ok && s.xCache) push(state.caches, s.xCache)

  rules.http = s.ok ? null : `status=${s.status ?? '-'} error=${s.error ?? '-'} latency=${Math.round(s.latencyMs)}ms`
  rules['bad-response'] = !s.ok ? undefined
    : s.invalid ? 'invalid JSON'
      : s.missingMeta.length ? `missing ${s.missingMeta.join(',')}` : null
  rules['no-server-now'] = s.ok ? (s.serverNow === null ? 'x-server-now header missing' : null) : undefined

  const lat = state.latencies
  const p95 = percentile(lat, 95)
  rules['latency-p95'] = lat.length >= MIN_SAMPLES.latency && p95 > LATENCY_P95_MAX_MS ? `p95=${Math.round(p95)}ms over last ${lat.length} cycles` : null

  const miss = missRatio(state.caches)
  rules['miss-ratio'] = !s.ok ? undefined
    : miss.n >= MIN_SAMPLES.miss && miss.ratio > MISS_MAX ? `MISS ${Math.round(miss.ratio * 100)}% over last ${miss.n} cycles` : null

  if (full) {
    state.staleStreak = s.stale ? state.staleStreak + 1 : 0
    rules.stale = state.staleStreak > STALE_CYCLES ? `stale for ${state.staleStreak} consecutive cycles` : null
    const live = s.phase === 'waiting' || s.phase === 'counting'
    rules.overdue = live && now > s.nextRefreshAt + OVERDUE_MS ? `nextRefreshAt overdue by ${sec(now - s.nextRefreshAt)}s (refreshAge=${s.refreshAgeS}s)` : null
    rules['data-age'] = s.phase === 'counting' && s.dataAgeS > DATA_AGE_MAX_S ? `dataAge=${s.dataAgeS}s refreshAge=${s.refreshAgeS}s` : null
    rules['counted-regression'] = state.prevCounted !== null && s.counted < state.prevCounted ? `counted ${state.prevCounted} -> ${s.counted}` : null
    state.prevCounted = s.counted
    const rank = PHASE_RANK[s.phase]
    rules['phase-regression'] = state.prevRank !== null && rank !== undefined && rank < state.prevRank ? `phase went back to ${s.phase}` : null
    if (rank !== undefined) state.prevRank = rank
    rules.incomplete = s.complete === false ? 'complete=false' : null
  }

  const out = []
  for (const [rule, detail] of Object.entries(rules)) {
    if (detail === undefined) continue
    if (detail && !state.active.has(rule)) out.push({ kind: 'ALERT', rule, detail })
    if (detail) state.active.set(rule, detail)
    else if (state.active.delete(rule)) out.push({ kind: 'RESOLVED', rule, detail: '' })
  }
  return out
}

const dash = (v, suffix = '') => (v === null || v === undefined ? '-' : `${v}${suffix}`)
const yn = (v) => (v === null || v === undefined ? '-' : v ? 'y' : 'n')

export function formatSampleLine(feed, s) {
  const ms = `${Math.round(s.latencyMs)}ms`
  if (!s.ok) return `${feed} FAIL status=${dash(s.status)} error=${dash(s.error)} ${ms}`
  const next = s.nextInS === null ? '-' : `${s.nextInS >= 0 ? '+' : ''}${s.nextInS}s`
  return `${feed} phase=${dash(s.phase)} ${dash(s.counted)}/${dash(s.total)} age=${dash(s.dataAgeS, 's')} ref=${dash(s.refreshAgeS, 's')} next=${next} stale=${yn(s.stale)} complete=${yn(s.complete)} ${dash(s.xCache)} ${s.status} ${ms}`
}

export function formatHeader({ now, cycle, feeds, ok, alerting, counted, total }) {
  const t = new Date(now).toISOString().replace(/\.\d+Z$/, 'Z')
  return `== ${t} cycle ${cycle} | feeds ok ${ok}/${feeds} | alerting ${alerting} | Praha ${dash(counted)}/${dash(total)} ==`
}
