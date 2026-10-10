// Pure refresher of the precinct (okrsek) map data for the Durable Object `OkrskyFeed` (no Cloudflare
// imports, so it is testable with a fake clock, storage and fetch). DETACHED from the 1-minute overall
// snapshot (refresh.js): own state, own cadence, own failure handling; nothing here may touch /api/senat.
//
// One run walks the incremental batches odata/okrsky/K{round}/vysledky_okrsky_NNNNN.xml from
// lastBatch+1 until the first 404 (or CHYBA), at most MAX_BATCHES per run and DEADLINE_MS in total
// (the rest resumes in the next run). Per round the state { lastBatch, applied, generated, precincts }
// is persisted; only the wanted obvody (Pirate ticket) are kept.
//
// Gates (mirror spec §2 of the Senate design): nothing is fetched before the round-1 polls close; K2 is
// probed only from the round-2 close; a batch generated (zone-less Prague time) before its round's close
// is test data: consumed (lastBatch moves on) but never applied.
import { parsePragueTime } from './time.js'
import { applyBatch, candsOf, emptyRound, parseBatchXml, rowsFor, wantedOf } from './okrsky.js'

export const OKRSKY = Object.freeze({
  SCHEMA: 'okr1', // a change of the stored shape discards the stored state
  MAX_BATCHES: 40, // per run
  REQUEST_TIMEOUT_MS: 8000,
  DEADLINE_MS: 12_000,
  ACTIVE_MS: 60_000, // waiting / counting
  IDLE_AFTER_MS: 30 * 60_000, // no new batch for this long = idle
  IDLE_MS: 10 * 60_000,
  RESUME_MS: 5000, // cap or deadline hit with batches still pending
  FLOOR_MS: 20_000,
  RETRY_CAP_MS: 60_000,
  MAX_BYTES: 5_000_000, // one batch is ~0.5 KB per precinct; anything near this is not a batch
})

/** retry(n) = 20 s + random · (min(60 s, 20 s · 2^(n−1)) − 20 s), n ≥ 1 (same curve as refresh.js, copied to stay detached) */
export function retryDelay(failures, random) {
  const n = Math.max(1, failures)
  const top = Math.min(OKRSKY.RETRY_CAP_MS, OKRSKY.FLOOR_MS * 2 ** (n - 1))
  return OKRSKY.FLOOR_MS + random() * (top - OKRSKY.FLOOR_MS)
}

export const batchUrl = (base, round, n) => `${base}/odata/okrsky/K${round}/vysledky_okrsky_${String(n).padStart(5, '0')}.xml`

const UNAVAILABLE = '{"error":"unavailable"}'

// body as text, never more than MAX_BYTES (declared or streamed)
async function readCapped(res) {
  const tooLarge = () => new Error(`response larger than ${OKRSKY.MAX_BYTES} bytes`)
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > OKRSKY.MAX_BYTES) {
    res.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  if (!res.body) return res.text()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > OKRSKY.MAX_BYTES) {
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

const validRound = (r) => r && typeof r === 'object' && Number.isInteger(r.lastBatch) && r.lastBatch >= 0
  && Number.isInteger(r.applied) && r.applied >= 0 && r.precincts && typeof r.precincts === 'object' && !Array.isArray(r.precincts)

export function createOkrskyRefresher({
  now, random, storage, fetchImpl, userAgent, log, base, manifest, pollsCloseR1, pollsCloseR2, waitUntil,
  maxBatches = OKRSKY.MAX_BATCHES, requestTimeoutMs = OKRSKY.REQUEST_TIMEOUT_MS, deadlineMs = OKRSKY.DEADLINE_MS,
}) {
  const wanted = wantedOf(manifest) // obvod → Pirate ballot number
  const schemaKey = `${OKRSKY.SCHEMA}:${[...wanted.keys()].sort((a, b) => a - b).join(',')}`
  const closeOf = { 1: pollsCloseR1, 2: pollsCloseR2 }

  let rounds = { 1: emptyRound(), 2: emptyRound() }
  let meta = { refreshedAt: null, lastNewBatchAt: null }
  let nextRefreshAt = 0
  let established = false // a valid state exists (loaded, or a run finished / made progress)
  let stored = false // both rounds are in the storage (loaded from it, or a full put succeeded): later puts carry only changed rounds
  let stale = false
  let failures = 0
  let loadPromise = null
  let refreshPromise = null

  const emit = (level, event, data) => log(event, { level, ...data })

  // ---- rehydrate (single-flight; false only when reading the storage failed) -------------------
  async function doLoad() {
    let parts
    try {
      parts = await Promise.all([storage.get('meta'), storage.get('r1'), storage.get('r2')])
    } catch (error) {
      emit('error', 'okrsky-rehydrate-failed', { error: String(error?.message || error) })
      return false
    }
    const [m, r1, r2] = parts
    if (m === undefined && r1 === undefined && r2 === undefined) return true
    if (!m || m.schema !== schemaKey || m.base !== base || !Number.isFinite(m.nextRefreshAt) || !validRound(r1) || !validRound(r2)) {
      emit('warn', 'okrsky-rehydrate-discarded', { reason: !m ? 'no-meta' : m.schema !== schemaKey ? 'schema' : m.base !== base ? 'base' : 'invalid' })
      return true
    }
    rounds = { 1: r1, 2: r2 }
    meta = { refreshedAt: Number.isFinite(m.refreshedAt) ? m.refreshedAt : null, lastNewBatchAt: Number.isFinite(m.lastNewBatchAt) ? m.lastNewBatchAt : null }
    nextRefreshAt = m.nextRefreshAt
    established = true
    stored = true
    emit('info', 'okrsky-rehydrated', { lastBatch: [r1.lastBatch, r2.lastBatch] })
    return true
  }

  function load() {
    if (!loadPromise) {
      const p = doLoad().then((ok) => {
        if (!ok && loadPromise === p) loadPromise = null
        return ok
      })
      loadPromise = p
    }
    return loadPromise
  }

  // not awaited: a stuck write must not block the refresher or the responses
  function persist(changed) {
    const obj = { meta: { ...meta, nextRefreshAt, schema: schemaKey, base } }
    const full = !stored
    for (const k of full ? [1, 2] : changed) obj[`r${k}`] = rounds[k]
    try {
      Promise.resolve(storage.put(obj)).then(() => {
        if (full) stored = true
      }).catch((error) => emit('error', 'okrsky-storage-put-failed', { error: String(error?.message || error) }))
    } catch (error) {
      emit('error', 'okrsky-storage-put-failed', { error: String(error?.message || error) })
    }
  }

  // ---- phase / schedule ----------------------------------------------------------------------------
  // waiting  nothing applied yet in an open round (or before the round-1 close): 60 s
  // counting a new batch within the last 30 min: 60 s
  // idle     otherwise: 10 min (but never past the round-2 close, so K2 starts probing on time)
  function phaseAt(t) {
    if (t < pollsCloseR1) return 'waiting'
    if (rounds[1].applied === 0 || (t >= pollsCloseR2 && rounds[2].applied === 0)) return 'waiting'
    if (meta.lastNewBatchAt !== null && t - meta.lastNewBatchAt < OKRSKY.IDLE_AFTER_MS) return 'counting'
    return 'idle'
  }

  function scheduleAfterRun(t, resume) {
    if (resume) return t + OKRSKY.RESUME_MS
    if (t < pollsCloseR1) return Math.min(t + OKRSKY.ACTIVE_MS, pollsCloseR1)
    if (phaseAt(t) !== 'idle') return t + OKRSKY.ACTIVE_MS
    const next = t + OKRSKY.IDLE_MS
    return t < pollsCloseR2 ? Math.min(next, pollsCloseR2) : next
  }

  // ---- one request ------------------------------------------------------------------------------------
  async function fetchOne(url, timeoutMs) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(`timeout ${timeoutMs} ms`)), timeoutMs)
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/xml' }, signal: ac.signal })
      if (res.status !== 200) {
        res.body?.cancel().catch(() => {}) // never read (a 404 is an HTML page): free the connection
        return { status: res.status }
      }
      return { status: 200, text: await readCapped(res) }
    } catch (error) {
      throw new Error(`request failed: ${error?.message || error}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- one refresh ----------------------------------------------------------------------------------------
  async function refreshOnce() {
    const t0 = now()
    const changed = new Set()
    const summary = { applied: 0, gated: 0, added: 0, replaced: 0 }
    let budget = maxBatches
    let failure = null
    let resume = false

    scan: for (const k of wanted.size ? [1, 2] : []) {
      if (t0 < closeOf[k]) continue // round 1 before its close; round 2 before its close: not even probed
      const round = rounds[k]
      for (;;) {
        if (budget === 0 || now() - t0 >= deadlineMs) {
          resume = true
          break scan
        }
        const n = round.lastBatch + 1
        const where = { round: k, batch: n }
        let res
        try {
          res = await fetchOne(batchUrl(base, k, n), Math.min(requestTimeoutMs, Math.max(1, deadlineMs - (now() - t0))))
        } catch (error) {
          failure = { event: 'okrsky-fetch-failed', ...where, error: String(error?.message || error) }
          break scan
        }
        if (res.status === 404) break // no such batch (yet): end of this round
        if (res.status !== 200) {
          failure = { event: 'okrsky-fetch-failed', ...where, error: `upstream HTTP ${res.status}` }
          break scan
        }
        let parsed
        try {
          parsed = parseBatchXml(res.text, { obvody: wanted })
        } catch (error) {
          failure = { event: 'okrsky-batch-unusable', ...where, error: String(error?.message || error) }
          break scan
        }
        if ('chyba' in parsed) break // CHYBA: the batch does not exist
        const generatedMs = parsePragueTime(parsed.generated)
        if (parsed.kolo !== k || generatedMs === null) {
          failure = { event: 'okrsky-batch-unusable', ...where, error: parsed.kolo !== k ? `KOLO ${parsed.kolo} in a K${k} batch` : `bad DATUM_CAS_GENEROVANI "${parsed.generated}"` }
          break scan
        }
        budget -= 1
        changed.add(k)
        if (generatedMs < closeOf[k]) { // test data from before the close: consumed, never applied
          round.lastBatch = n
          summary.gated += 1
          continue
        }
        if (parsed.batch !== n) emit('warn', 'okrsky-batch-number', { ...where, davka: parsed.batch })
        const r = applyBatch(round, parsed, wanted)
        round.lastBatch = n
        summary.applied += 1
        summary.added += r.added
        summary.replaced += r.replaced
      }
    }

    const t = now()
    const progressed = summary.applied + summary.gated > 0
    if (progressed) meta.lastNewBatchAt = t
    if (progressed || !failure) established = true
    if (failure) {
      failures += 1
      stale = true
      nextRefreshAt = t + retryDelay(failures, random)
      const { event, ...data } = failure
      emit('warn', event, { failures, ...data })
    } else {
      failures = 0
      stale = false
      meta.refreshedAt = t
      nextRefreshAt = scheduleAfterRun(t, resume)
    }
    if (progressed) emit('info', 'okrsky-run', { ...summary, lastBatch: [rounds[1].lastBatch, rounds[2].lastBatch], resume })
    if (established) persist(changed)
  }

  function startRefresh() {
    if (!refreshPromise) {
      refreshPromise = refreshOnce()
        .catch((error) => {
          // unexpected error (e.g. a TypeError) = a failure, not a crashed request
          failures += 1
          stale = true
          nextRefreshAt = now() + retryDelay(failures, random)
          emit('warn', 'okrsky-refresh-error', { failures, error: String(error?.message || error) })
        })
        .finally(() => {
          refreshPromise = null
        })
      waitUntil?.(refreshPromise)
    }
    return refreshPromise
  }

  // ---- response -------------------------------------------------------------------------------------------------
  // `stale` is within the first 300 characters (edge.js markStale flips the first occurrence).
  function respond(obvod, roundNo) {
    const t = now()
    if (!established) {
      return { status: 503, body: UNAVAILABLE, meta: { refreshedAt: null, nextRefreshAt, servedAt: t, stale: true, phase: null } }
    }
    const hasRound2 = Object.values(rounds[2].precincts).some((p) => p[0] === obvod)
    const round = roundNo ?? (hasRound2 ? 2 : 1)
    const cands = candsOf(manifest, obvod)
    const precincts = rowsFor(rounds[round], obvod, cands)
    const phase = phaseAt(t)
    const out = {
      v: 1,
      obvod,
      round,
      refreshedAt: meta.refreshedAt,
      nextRefreshAt,
      servedAt: t,
      stale,
      phase,
      generated: rounds[round].generated,
      generatedMs: rounds[round].generated ? parsePragueTime(rounds[round].generated) : null,
      batches: { 1: rounds[1].lastBatch, 2: rounds[2].lastBatch },
      cands,
      pirateNo: wanted.get(obvod),
      counted: precincts.length,
      precincts,
    }
    return { status: 200, body: JSON.stringify(out), meta: { refreshedAt: meta.refreshedAt, nextRefreshAt, servedAt: t, stale, phase } }
  }

  /** Response for one wanted obvod (and optionally a round 1|2): { status, body (JSON string), meta }. */
  async function get(obvod, roundNo) {
    const loaded = await load()
    const t = now()
    if (!established) {
      // rehydrate failed: build nothing and overwrite nothing, the next get() reads again
      if (!loaded) return respond(obvod, roundNo)
      // cold start: wait for one refresh; after a failure → 503, and within the backoff window no new run per request
      if (refreshPromise || t >= nextRefreshAt) await startRefresh()
      return respond(obvod, roundNo)
    }
    if (!refreshPromise && t >= nextRefreshAt) startRefresh()
    return respond(obvod, roundNo)
  }

  return { get, wanted }
}
