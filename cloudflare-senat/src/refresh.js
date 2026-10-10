// Pure snapshot refresher for the Durable Object (no Cloudflare imports, so it can
// be tested with a fake clock, storage and feed). Copied and reduced from
// cloudflare/refresh.js (Prague); rules: docs/superpowers/specs/2026-10-10-senate-results-design.md §2, §4.
//
//   feed.build → validateCandidate (ok | older | rejected) → publish + persist,
//   or a 304 (the good snapshot is still current → only the timestamps move).
//
// Validators (ETag/Last-Modified) belong to the GOOD snapshot: they live only in
// good.meta.validators, written by install(). The next fetch after ANY non-ok
// outcome is unconditional, so a stable-but-wrong file is downloaded again and
// quarantine can count distinct HTTP 200 fetches.
import { CODE_REV } from './rev.js'
import { validateCandidate } from './validate.js'

export const REFRESH = Object.freeze({
  SCHEMA: `1:${CODE_REV}`, // a code change (derive/normalize/manifest) discards the stored snapshot
  FLOOR_MS: 20_000, // shortest gap between refreshes
  RETRY_CAP_MS: 60_000,
  WAITING_MS: 60_000,
  COUNTING_MAX_MS: 60_000,
  GENERATED_SKEW_MS: 120_000, // generated further than refreshedAt+120 s = junk / skew
  IDLE_MS: 5 * 60_000, // between the rounds: counted and nothing being counted
  FINAL_MS: 10 * 60_000,
  DEADLINE_MS: 12_000, // total deadline of one build
  QUARANTINE_COUNT: 3,
  QUARANTINE_SPAN_MS: 120_000,
  OLDER_ERROR_MS: 10 * 60_000,
  MAX_BYTES: 1_500_000,
})

/** retry(n) = 20 s + random · (min(60 s, 20 s · 2^(n−1)) − 20 s), n ≥ 1 */
export function retryDelay(failures, random) {
  const n = Math.max(1, failures)
  const top = Math.min(REFRESH.RETRY_CAP_MS, REFRESH.FLOOR_MS * 2 ** (n - 1))
  return REFRESH.FLOOR_MS + random() * (top - REFRESH.FLOOR_MS)
}

/**
 * Phase of a derived snapshot (spec §2), ordered final → idle → waiting → counting:
 *  final    every obvod elected/tie
 *  idle     every obvod elected/tie/runoff (round 2 not counting) and not all final
 *  waiting  no precinct counted in any round of any obvod
 *  counting everything else
 * No snapshot (or no obvody) → 'waiting'.
 */
export function phaseOfSnapshot(snapshot) {
  const obvody = snapshot?.obvody
  if (!Array.isArray(obvody) || !obvody.length) return 'waiting'
  const terminal = (o) => o.state === 'elected' || o.state === 'tie'
  if (obvody.every(terminal)) return 'final'
  if (obvody.every((o) => terminal(o) || o.state === 'runoff')) return 'idle'
  if (obvody.every((o) => Object.values(o.rounds ?? {}).every((r) => r.okrskyZprac === 0))) return 'waiting'
  return 'counting'
}

/**
 * When the snapshot is due next. `generatedMs` = parsePragueTime(snapshot.generated) or null.
 * With `failures > 0` the retry delay counts from `now`.
 */
export function computeNextRefreshAt({ phase, refreshedAt, generatedMs, now, failures = 0, random = Math.random, pollsCloseR2 = NaN }) {
  if (failures > 0) return now + retryDelay(failures, random)
  switch (phase) {
    case 'waiting':
      return refreshedAt + REFRESH.WAITING_MS
    case 'idle':
      // from 5 min before the round-2 polls close the first counted precincts can appear any minute:
      // poll at the waiting cadence so the first round-2 count is not delayed by the idle interval
      if (Number.isFinite(pollsCloseR2) && refreshedAt >= pollsCloseR2 - REFRESH.IDLE_MS) return refreshedAt + REFRESH.WAITING_MS
      return refreshedAt + REFRESH.IDLE_MS
    case 'final':
      return refreshedAt + REFRESH.FINAL_MS
    default: { // counting
      const floor = refreshedAt + REFRESH.FLOOR_MS
      if (!Number.isFinite(generatedMs) || generatedMs > refreshedAt + REFRESH.GENERATED_SKEW_MS) return floor
      return Math.min(Math.max(generatedMs + 60_000, floor), refreshedAt + REFRESH.COUNTING_MAX_MS)
    }
  }
}

const utf8Bytes = (s) => new TextEncoder().encode(s).length
const UNAVAILABLE = '{"error":"unavailable"}'

function withDeadline(fn, ms) {
  const ac = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ac.abort()
      reject(new Error(`build deadline ${ms} ms`))
    }, ms)
  })
  // feed.build need not honour the signal, hence the race with the timer
  return Promise.race([Promise.resolve().then(() => fn(ac.signal)), timeout]).finally(() => clearTimeout(timer))
}

export function createRefresher({ now, random, storage, feed, base, log, pollsCloseR1, pollsCloseR2, waitUntil }) {
  // good = { snapshot (object), str (JSON string), meta, tooBig } | null
  let good = null
  let nextRefreshAt = 0 // in memory; differs from meta.nextRefreshAt after older/failures
  let stale = false
  let failures = 0
  let unconditional = false // set by every non-ok outcome: the next fetch sends no validators
  let quarantine = null
  let olderSince = null
  let olderLoggedAt = null
  let sizeLogged = false
  let loadPromise = null
  let refreshPromise = null

  const emit = (level, event, data) => log(event, { level, ...data })

  // ---- rehydrate (single-flight) ------------------------------------------
  // Returns false only when reading the storage failed (the next get() tries again
  // and nothing is built or persisted until a load succeeds).
  async function doLoad() {
    let snapshotStr
    let meta
    try {
      [snapshotStr, meta] = await Promise.all([storage.get('snapshot'), storage.get('meta')])
    } catch (error) {
      emit('error', 'rehydrate-failed', { error: String(error?.message || error) })
      return false
    }
    if (snapshotStr === undefined && meta === undefined) return true
    if (!meta || typeof snapshotStr !== 'string' || meta.schema !== REFRESH.SCHEMA || meta.base !== base
      || !Number.isFinite(meta.refreshedAt) || !Number.isFinite(meta.installedAt) || !Number.isFinite(meta.nextRefreshAt)) {
      emit('warn', 'rehydrate-discarded', { reason: !meta ? 'no-meta' : meta.schema !== REFRESH.SCHEMA ? 'schema' : meta.base !== base ? 'base' : 'invalid' })
      return true
    }
    let snapshot = null
    if (snapshotStr.length > 2 && snapshotStr[0] === '{') {
      try {
        snapshot = JSON.parse(snapshotStr)
      } catch {
        snapshot = null
      }
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      emit('warn', 'rehydrate-discarded', { reason: 'corrupt' })
      return true
    }
    // failures / stale / quarantine are in memory only: they restart from zero
    good = { snapshot, str: snapshotStr, meta, tooBig: false }
    nextRefreshAt = meta.nextRefreshAt
    emit('info', 'rehydrated', { refreshedAt: meta.refreshedAt })
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

  // ---- persistence -----------------------------------------------------------
  function onPutError(error) {
    emit('error', 'storage-put-failed', { error: String(error?.message || error) })
  }

  // The put is not awaited: a stuck write must not block the refresher or the
  // responses (the in-memory publish stands even if the write fails).
  function persist(obj) {
    try {
      Promise.resolve(storage.put(obj)).catch(onPutError)
    } catch (error) {
      onPutError(error)
    }
  }

  // ---- publication -------------------------------------------------------------
  function install(snapshot, validators, t) {
    const phase = phaseOfSnapshot(snapshot)
    const next = computeNextRefreshAt({
      phase, refreshedAt: t, generatedMs: snapshot.generatedMs, now: t, failures: 0, random, pollsCloseR2,
    })
    const meta = {
      refreshedAt: t,
      installedAt: t, // when this content was fetched (a 304 moves refreshedAt, never installedAt)
      nextRefreshAt: next,
      validators: validators ?? { etag: null, lastModified: null },
      phase,
      base,
      schema: REFRESH.SCHEMA,
    }
    const str = JSON.stringify(snapshot)
    const bytes = utf8Bytes(str)
    good = { snapshot, str, meta, tooBig: bytes > REFRESH.MAX_BYTES }
    nextRefreshAt = next
    stale = false
    failures = 0
    unconditional = false
    quarantine = null
    olderSince = null

    if (good.tooBig) {
      if (!sizeLogged) {
        sizeLogged = true
        emit('warn', 'size-guard', { bytes, max: REFRESH.MAX_BYTES })
      }
      return
    }
    persist({ snapshot: str, meta }) // snapshot and meta in ONE put
  }

  // 304: the good snapshot is still current. Only the timestamps move (validators
  // and snapshot are unchanged), so only meta is persisted.
  function touch(t) {
    const phase = phaseOfSnapshot(good.snapshot)
    const next = computeNextRefreshAt({
      phase, refreshedAt: t, generatedMs: good.snapshot.generatedMs, now: t, failures: 0, random, pollsCloseR2,
    })
    good = { ...good, meta: { ...good.meta, refreshedAt: t, nextRefreshAt: next, phase } }
    nextRefreshAt = next
    stale = false
    failures = 0
    emit('info', 'not-modified', { generated: good.snapshot.generated })
    if (!good.tooBig) persist({ meta: good.meta })
  }

  function fail(t, event, data) {
    failures += 1
    stale = true
    unconditional = true
    nextRefreshAt = computeNextRefreshAt({ phase: 'counting', refreshedAt: t, generatedMs: null, now: t, failures, random })
    feed.invalidate()
    emit('warn', event, { failures, ...data })
  }

  // ---- one refresh ---------------------------------------------------------------
  async function refreshOnce() {
    const prev = good
    // conditional only for the good snapshot's own validators and only when no
    // non-ok outcome is pending
    const v = prev?.meta.validators
    const validators = !unconditional && (v?.etag || v?.lastModified) ? v : undefined
    let candidate
    try {
      candidate = await withDeadline((signal) => feed.build({ signal, validators }), REFRESH.DEADLINE_MS)
    } catch (error) {
      fail(now(), 'build-failed', { error: String(error?.message || error) })
      return
    }
    const t = now()

    if (candidate.notModified) {
      // honoured only as the answer to a conditional request we actually sent;
      // otherwise it proves nothing (stays stale, next fetch unconditional)
      if (!prev || !validators) {
        fail(t, 'unexpected-not-modified', {})
        return
      }
      touch(t)
      return
    }

    // goodRefreshedAt = when the good CONTENT was fetched, not the last 304: an unchanged
    // pre-close (frozen/test) file touched after 14:00 must not become the baseline
    const ctx = { now: t, ...(prev ? { goodRefreshedAt: prev.meta.installedAt, pollsCloseR1, base, goodBase: prev.meta.base } : {}) }
    const verdict = validateCandidate(candidate.snapshot, prev?.snapshot ?? null, ctx)

    if (verdict.outcome === 'older') {
      // lagging ČSÚ replica: good stays, not stale, no backoff; the quarantine is untouched
      stale = false
      failures = 0
      unconditional = true
      feed.invalidate()
      olderSince ??= t
      nextRefreshAt = t + REFRESH.FLOOR_MS
      emit('info', 'older', { generated: candidate.snapshot.generated, good: prev.snapshot.generated })
      if (t - olderSince >= REFRESH.OLDER_ERROR_MS && (olderLoggedAt === null || t - olderLoggedAt >= REFRESH.OLDER_ERROR_MS)) {
        olderLoggedAt = t
        emit('error', 'older-persistent', { sinceMs: t - olderSince })
      }
      return
    }
    olderSince = null
    olderLoggedAt = null

    if (verdict.outcome === 'rejected') {
      const { reason } = verdict
      const fetchId = candidate.fetchId ?? null
      if (quarantine && quarantine.reason === reason) {
        if (fetchId !== null && fetchId !== quarantine.lastFetchId) {
          quarantine = { ...quarantine, count: quarantine.count + 1, lastFetchId: fetchId }
        }
      } else {
        quarantine = { reason, count: 1, firstAt: t, lastFetchId: fetchId }
      }
      if (verdict.quarantinable && prev
        && quarantine.count >= REFRESH.QUARANTINE_COUNT && t - quarantine.firstAt >= REFRESH.QUARANTINE_SPAN_MS) {
        emit('warn', 'quarantine-accepted', { reason, count: quarantine.count, spanMs: t - quarantine.firstAt })
        install(candidate.snapshot, candidate.validators, t)
        return
      }
      fail(t, 'rejected', { reason, quarantineCount: quarantine.count })
      return
    }

    install(candidate.snapshot, candidate.validators, t)
  }

  function startRefresh() {
    if (!refreshPromise) {
      refreshPromise = refreshOnce()
        .catch((error) => {
          // unexpected error (e.g. a TypeError in validation) = a failure, not a crashed request
          fail(now(), 'refresh-error', { error: String(error?.message || error) })
        })
        .finally(() => {
          refreshPromise = null
        })
      waitUntil?.(refreshPromise)
    }
    return refreshPromise
  }

  // ---- response ----------------------------------------------------------------
  // meta (spliced first, so `"stale":` is within the first 300 chars) + the persisted snapshot string
  function respond() {
    if (!good) {
      return {
        status: 503,
        body: UNAVAILABLE,
        meta: { refreshedAt: null, nextRefreshAt, servedAt: now(), stale: true, phase: null },
      }
    }
    const meta = {
      refreshedAt: good.meta.refreshedAt,
      nextRefreshAt,
      servedAt: now(),
      stale,
      phase: phaseOfSnapshot(good.snapshot),
    }
    const body = `{"refreshedAt":${meta.refreshedAt},"nextRefreshAt":${meta.nextRefreshAt},"servedAt":${meta.servedAt},`
      + `"stale":${meta.stale},"phase":"${meta.phase}",${good.str.slice(1)}`
    return { status: 200, body, meta }
  }

  async function get() {
    const loaded = await load()
    const t = now()
    if (!good) {
      // rehydrate failed: build nothing and overwrite nothing, the next get() reads again
      if (!loaded) return respond()
      // cold start: wait for one refresh (12 s deadline); after a failure → 503, and
      // within the backoff window no new build per request
      if (refreshPromise || t >= nextRefreshAt) await startRefresh()
      return respond()
    }
    if (!refreshPromise && t >= nextRefreshAt) startRefresh()
    return respond()
  }

  return { get }
}
