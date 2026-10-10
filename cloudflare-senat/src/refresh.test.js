import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { CODE_REV } from './rev.js'
import { parsePragueTime } from './time.js'
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'
import { derive } from './derive.js'
import { createSenatFeed } from './feed.js'
import { markStale } from './edge.js'
import { REFRESH, computeNextRefreshAt, createRefresher, phaseOfSnapshot } from './refresh.js'

// Time: vitest fake timers (they mock Date too), `now` = Date.now. Tests run with
// TZ=UTC like the Worker, so the zone-less `generated` has to go through parsePragueTime.
const at = (iso) => Date.parse(iso)
beforeAll(() => {
  expect(new Date().getTimezoneOffset()).toBe(0)
})

const S = 1000
const MIN = 60 * S
const R1 = at('2026-10-10T14:00:00+02:00')
const R2 = at('2026-10-17T14:00:00+02:00')
const T0 = at('2026-10-10T15:00:00+02:00') // after the close, counting
const BASE = 'https://csu.test/senat'

// ČSÚ zone-less Prague time (+02:00) from epoch ms
const csu = (ms) => new Date(ms + 2 * 3600 * S).toISOString().slice(0, 19)

// ---- fixtures ---------------------------------------------------------------

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const FROZEN = read('se2026-frozen.xml')
// stamped before the closes in the source file: re-stamp after R2 so the close-of-polls gates let it through
const FINAL_2024 = read('se2024-final.xml').replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-18T10:00:00"')
const AFTER_R2 = R2 + 86_400_000
const none = { CANDIDATES: {}, PIRATE_BACKED: [] }
const fromXml = (text, m) => derive(normalize(parseResultsXml(text), { manifest: m, now: AFTER_R2, pollsCloseR1: R1, pollsCloseR2: R2 }))

// Derived snapshot built from a hand-made normalised one. An obvod spec:
// { n, z, c, votes: [..], st1: [..], z2, c2, votes2: [..], st2: [..] }
function mkObvod({ n, z = 5, c = 10, votes = [100, 50], st1 = [], z2, c2 = 10, votes2, st2 = [] }) {
  return {
    n,
    name: `Obvod ${n}`,
    rounds: {
      1: { okrskyCelkem: c, okrskyZprac: z, platneHlasy: votes.reduce((a, b) => a + b, 0) },
      ...(z2 != null ? { 2: { okrskyCelkem: c2, okrskyZprac: z2, platneHlasy: (votes2 ?? []).reduce((a, b) => a + b, 0) } } : {}),
    },
    candidates: votes.map((v, i) => ({
      no: i + 1, name: `K${i + 1}`, votes1: v, pct1: 0, st1: st1[i] ?? null,
      votes2: votes2?.[i] ?? null, pct2: null, st2: st2[i] ?? null, pirate: null,
    })),
  }
}

function snap({ generated = csu(T0), z = 5, c = 10, votes = [100, 50], obvody, extra = {} } = {}) {
  const list = obvody ?? [{ n: 3, z, c, votes }, { n: 6, z, c, votes: [70, 80] }]
  return derive({
    v: 1,
    kind: 'senat',
    generated,
    generatedMs: parsePragueTime(generated),
    round: 1,
    country: {},
    obvody: list.map(mkObvod),
    warnings: [],
    ...extra,
  })
}

const ok = (snapshot, fetchId, etag = `"e${fetchId}"`) => ({ snapshot, validators: { etag, lastModified: null }, fetchId })

function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: vi.fn(async (k) => data.get(k)),
    put: vi.fn(async (obj) => {
      for (const [k, v] of Object.entries(obj)) data.set(k, v)
    }),
  }
}

// `build` runs on every feed.build({ signal, validators }); `feed` replaces the fake feed
function setup({ build, feed: realFeed, random = () => 0.5, base = BASE, storage, time = T0, requireManifestSet } = {}) {
  vi.setSystemTime(time)
  const st = storage ?? memStorage()
  const feed = realFeed ?? { build: vi.fn(build ?? (async () => ok(snap(), 1))), invalidate: vi.fn() }
  if (realFeed) vi.spyOn(feed, 'invalidate')
  const log = vi.fn()
  const waitUntil = vi.fn()
  const r = createRefresher({
    now: () => Date.now(),
    random: (...a) => random(...a),
    storage: st,
    feed,
    base,
    log,
    pollsCloseR1: R1,
    pollsCloseR2: R2,
    waitUntil,
    ...(requireManifestSet === undefined ? {} : { requireManifestSet }),
  })
  return { r, st, feed, log, waitUntil }
}

// successive build results: a value, an Error to throw, or a function (args) => result;
// the last step repeats
const script = (...steps) => {
  let i = 0
  return async (args) => {
    const s = steps[Math.min(i++, steps.length - 1)]
    if (typeof s === 'function') return s(args)
    if (s instanceof Error) throw s
    return s
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)
const advance = (ms) => vi.advanceTimersByTimeAsync(ms)
const parse = (res) => JSON.parse(res.body)
// one "round": get() starts a refresh if due, then let it finish
async function poll(r) {
  const res = await r.get()
  await settle()
  await settle()
  return res
}
const events = (log, name) => log.mock.calls.filter(([e]) => e === name)
const sentValidators = (feed, i) => feed.build.mock.calls[i][0].validators

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

// ---- computeNextRefreshAt ----------------------------------------------------

describe('computeNextRefreshAt', () => {
  const base = { failures: 0, random: () => 0.5 }
  const next = (o) => computeNextRefreshAt({ ...base, now: o.refreshedAt, ...o })

  it('counting: zone-less generated is read as Prague time even under TZ=UTC', () => {
    const refreshedAt = at('2026-10-10T14:31:20+02:00')
    const generatedMs = parsePragueTime('2026-10-10T14:31:05')
    expect(next({ phase: 'counting', refreshedAt, generatedMs })).toBe(at('2026-10-10T14:32:05+02:00'))
  })

  it('end to end: zone-less generated from the feed gives nextRefreshAt = G+60 s (not +5 min)', async () => {
    const refreshedAt = at('2026-10-10T14:31:20+02:00')
    const { r, st } = setup({ time: refreshedAt, build: async () => ok(snap({ generated: '2026-10-10T14:31:05' }), 1) })
    const res = await r.get()
    expect(parse(res).nextRefreshAt).toBe(at('2026-10-10T14:32:05+02:00'))
    expect(parse(res).generatedMs).toBe(at('2026-10-10T14:31:05+02:00'))
    expect(st.put.mock.calls[0][0].meta.nextRefreshAt).toBe(at('2026-10-10T14:32:05+02:00'))
  })

  it('counting: clamps G+60 s to [refreshedAt+20 s, refreshedAt+60 s]', () => {
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 - 10 * MIN })).toBe(T0 + 20 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 - 50 * S })).toBe(T0 + 20 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 - 30 * S })).toBe(T0 + 30 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 + 30 * S })).toBe(T0 + 60 * S)
  })

  it('counting: junk generated (null, NaN, > refreshedAt+120 s) → refreshedAt+20 s', () => {
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 + 2 * 3600 * S })).toBe(T0 + 20 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 + 121 * S })).toBe(T0 + 20 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: null })).toBe(T0 + 20 * S)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: NaN })).toBe(T0 + 20 * S)
    // 120 s ahead is still accepted (and capped at +60 s)
    expect(next({ phase: 'counting', refreshedAt: T0, generatedMs: T0 + 120 * S })).toBe(T0 + 60 * S)
  })

  it('waiting +60 s, idle +5 min, final +10 min (generated ignored)', () => {
    const g = { refreshedAt: T0, generatedMs: null }
    expect(next({ phase: 'waiting', ...g })).toBe(T0 + 60 * S)
    expect(next({ phase: 'idle', ...g })).toBe(T0 + 5 * MIN)
    expect(next({ phase: 'final', ...g })).toBe(T0 + 10 * MIN)
  })

  it('days-old generated between the rounds does not mean polling every 20 s (idle)', () => {
    const generatedMs = T0 - 6 * 24 * 3600 * S
    expect(next({ phase: 'idle', refreshedAt: T0, generatedMs })).toBe(T0 + 5 * MIN)
  })

  it('failures → now + retry(n): 20 s, 20–40 s, 20–60 s (random 1 and 0)', () => {
    const f = (failures, random) => computeNextRefreshAt({ phase: 'counting', refreshedAt: T0, generatedMs: null, now: T0, failures, random: () => random }) - T0
    expect([1, 2, 3, 4, 9].map((n) => f(n, 1))).toEqual([20 * S, 40 * S, 60 * S, 60 * S, 60 * S])
    expect([1, 2, 3, 4].map((n) => f(n, 0))).toEqual([20 * S, 20 * S, 20 * S, 20 * S])
  })

  it('exports the constants; the schema carries CODE_REV', () => {
    expect(REFRESH).toMatchObject({ FLOOR_MS: 20_000, DEADLINE_MS: 12_000, MAX_BYTES: 1_500_000, IDLE_MS: 300_000, FINAL_MS: 600_000 })
    expect(REFRESH.SCHEMA).toBe(`1:${CODE_REV}`)
  })
})

// ---- phaseOfSnapshot -------------------------------------------------------------

describe('phaseOfSnapshot', () => {
  const o = (n, spec) => ({ n, ...spec })
  const elected = { st1: ['ZVOLEN', 'NEZVOLEN'], z: 10 }
  const runoff = { st1: ['2.KOLO', '2.KOLO'], z: 10 }

  it('waiting: every okrskyZprac is 0 in every obvod', () => {
    expect(phaseOfSnapshot(snap({ z: 0 }))).toBe('waiting')
  })

  it('counting: something counted but not everything terminal / runoff', () => {
    expect(phaseOfSnapshot(snap({ z: 5 }))).toBe('counting')
    expect(phaseOfSnapshot(snap({ z: 10 }))).toBe('counting') // counted, awaiting the official flag
    expect(phaseOfSnapshot(snap({ obvody: [o(3, { z: 0 }), o(6, { z: 1 })] }))).toBe('counting')
  })

  it('counting: round 2 being counted (runoff-counting) and mixed terminal + counting', () => {
    const r2 = { ...runoff, z2: 3, votes2: [60, 40] }
    expect(phaseOfSnapshot(snap({ obvody: [o(3, r2)] }))).toBe('counting')
    expect(phaseOfSnapshot(snap({ obvody: [o(3, elected), o(6, { z: 4 })] }))).toBe('counting')
    expect(phaseOfSnapshot(snap({ obvody: [o(3, runoff), o(6, r2)] }))).toBe('counting')
  })

  it('counting: round-2 votes without a round-2 UCAST (progress unknown) is never idle', () => {
    const noUcast = { ...runoff, votes2: [60, 40] } // no z2: rounds[2] absent
    const s = snap({ obvody: [o(3, noUcast), o(6, runoff)] })
    expect(s.obvody[0].rounds[2]).toBeUndefined()
    expect(s.obvody[0].state).toBe('runoff-counting')
    expect(phaseOfSnapshot(s)).toBe('counting')
    expect(phaseOfSnapshot(snap({ obvody: [o(3, noUcast)] }))).toBe('counting')
    // all-zero round-2 votes stay a plain runoff
    expect(phaseOfSnapshot(snap({ obvody: [o(3, { ...runoff, votes2: [0, 0] })] }))).toBe('idle')
  })

  it('idle: every obvod elected/tie/runoff with round 2 not counting, not all final', () => {
    expect(phaseOfSnapshot(snap({ obvody: [o(3, runoff), o(6, runoff)] }))).toBe('idle')
    expect(phaseOfSnapshot(snap({ obvody: [o(3, elected), o(6, runoff)] }))).toBe('idle')
    // round 2 started (UCAST present) with Z = 0 is still a runoff
    expect(phaseOfSnapshot(snap({ obvody: [o(3, { ...runoff, z2: 0, votes2: [0, 0] })] }))).toBe('idle')
  })

  it('final: every obvod elected or tie', () => {
    expect(phaseOfSnapshot(snap({ obvody: [o(3, elected), o(6, elected)] }))).toBe('final')
    const tie = { ...runoff, z2: 10, votes2: [50, 50], st2: ['NEZVOLEN_SHODA_HLASU', 'NEZVOLEN_SHODA_HLASU'] }
    expect(phaseOfSnapshot(snap({ obvody: [o(3, elected), o(6, tie)] }))).toBe('final')
    expect(snap({ obvody: [o(6, tie)] }).obvody[0].state).toBe('tie')
  })

  it('no snapshot / no obvody → waiting', () => {
    expect(phaseOfSnapshot(null)).toBe('waiting')
    expect(phaseOfSnapshot({ obvody: [] })).toBe('waiting')
  })

  it('real fixtures: frozen 2026 → waiting, 2024 final → final', () => {
    expect(phaseOfSnapshot(fromXml(FROZEN, manifest))).toBe('waiting')
    expect(phaseOfSnapshot(fromXml(FINAL_2024, none))).toBe('final')
  })
})

// ---- request path ----------------------------------------------------------------

describe('request path', () => {
  it('cold: get() awaits one build and persists {snapshot, meta} in one put', async () => {
    const { r, st, feed, waitUntil } = setup()
    const res = await r.get()
    expect(res.status).toBe(200)
    expect(feed.build).toHaveBeenCalledTimes(1)
    expect(st.put).toHaveBeenCalledTimes(1)
    const [obj] = st.put.mock.calls[0]
    expect(Object.keys(obj).sort()).toEqual(['meta', 'snapshot'])
    expect(typeof obj.snapshot).toBe('string')
    expect(obj.meta).toEqual({
      refreshedAt: T0,
      installedAt: T0,
      nextRefreshAt: T0 + 60 * S, // G = T0 → G+60 s
      validators: { etag: '"e1"', lastModified: null },
      phase: 'counting',
      base: BASE,
      schema: `1:${CODE_REV}`,
    })
    expect(parse(res)).toMatchObject({ refreshedAt: T0, nextRefreshAt: T0 + 60 * S, servedAt: T0, stale: false, phase: 'counting', kind: 'senat', v: 1 })
    expect(res.meta).toEqual({ refreshedAt: T0, nextRefreshAt: T0 + 60 * S, servedAt: T0, stale: false, phase: 'counting' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('body = meta spliced in front of the persisted string; "stale": within the first 300 chars', async () => {
    const { r, st } = setup()
    const res = await r.get()
    const persisted = st.put.mock.calls[0][0].snapshot
    expect(res.body.endsWith(persisted.slice(1))).toBe(true)
    expect(res.body.startsWith('{"refreshedAt":')).toBe(true)
    expect(res.body.slice(0, 300)).toContain('"stale":false')
    expect(res.body.slice(0, 300)).toContain('"phase":"counting"')
    // the persisted string itself carries no response meta
    expect(JSON.parse(persisted)).not.toHaveProperty('stale')
    expect(JSON.parse(persisted)).not.toHaveProperty('refreshedAt')
  })

  it('body header carries closes {1,2} (ms) after "stale":, within the first 300 chars; markStale still works', async () => {
    const { r } = setup()
    const res = await r.get()
    expect(parse(res).closes).toEqual({ 1: R1, 2: R2 })
    expect(res.body.slice(0, 300)).toContain(`"closes":{"1":${R1},"2":${R2}}`)
    expect(res.body.indexOf('"stale":')).toBeLessThan(res.body.indexOf('"closes":'))
    expect(JSON.parse(markStale(res.body)).stale).toBe(true)
    expect(JSON.parse(markStale(res.body)).closes).toEqual({ 1: R1, 2: R2 })
  })

  it('closes follow a POLLS_CLOSE_R2 override (2026-10-24T14:00+02:00)', async () => {
    const R2b = at('2026-10-24T14:00:00+02:00')
    const st = memStorage()
    const r = createRefresher({
      now: () => Date.now(), random: () => 0.5, storage: st, feed: { build: vi.fn(async () => ok(snap(), 1)), invalidate: vi.fn() },
      base: BASE, log: vi.fn(), pollsCloseR1: R1, pollsCloseR2: R2b, waitUntil: vi.fn(),
    })
    vi.setSystemTime(T0)
    expect(parse(await r.get()).closes).toEqual({ 1: R1, 2: R2b })
  })

  it('the body keeps phase after install, after a 304 and after a rehydrate', async () => {
    const a = setup({ build: script(ok(snap({ z: 0 }), 1), { notModified: true }) })
    expect(parse(await a.r.get()).phase).toBe('waiting')
    expect(a.st.data.get('meta').phase).toBe('waiting')
    await advance(61 * S)
    await poll(a.r)
    expect(parse(await a.r.get()).phase).toBe('waiting')
    expect(a.st.data.get('meta').phase).toBe('waiting')
    const b = setup({ storage: a.st, time: Date.now() })
    const res = await b.r.get()
    expect(parse(res).phase).toBe('waiting')
    expect(res.meta.phase).toBe('waiting')
  })

  it('cold with failing build → 503 {"error":"unavailable"}, then backoff without a new build', async () => {
    const { r, feed } = setup({ build: async () => { throw new Error('boom') }, random: () => 1 })
    const res = await r.get()
    expect(res.status).toBe(503)
    expect(res.body).toBe('{"error":"unavailable"}')
    expect(res.meta).toMatchObject({ refreshedAt: null, stale: true, phase: null })
    expect((await r.get()).status).toBe(503)
    expect(feed.build).toHaveBeenCalledTimes(1)
    await advance(20 * S)
    await r.get()
    expect(feed.build).toHaveBeenCalledTimes(2)
  })

  it('not due → no build; due → old snapshot at once, the new one on the next get()', async () => {
    let n = 0
    const { r, feed } = setup({
      build: async () => ok(snap({ generated: csu(Date.now()), votes: [100 + 5 * n, 50] }), ++n),
    })
    await r.get()
    expect(feed.build).toHaveBeenCalledTimes(1)
    await advance(30 * S)
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(100)
    expect(feed.build).toHaveBeenCalledTimes(1)
    await advance(31 * S) // > nextRefreshAt
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(100) // old at once
    expect(feed.build).toHaveBeenCalledTimes(2)
    await settle()
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(105)
  })

  it('2 000 concurrent get() when due → exactly one upstream call, all get the old snapshot at once', async () => {
    let release
    let calls = 0
    const { r, feed } = setup({
      build: () => {
        calls++
        if (calls === 1) return Promise.resolve(ok(snap(), 1))
        return new Promise((resolve) => { release = () => resolve(ok(snap({ generated: csu(Date.now()), votes: [200, 50] }), 2)) })
      },
    })
    await r.get()
    await advance(61 * S)
    const all = await Promise.all(Array.from({ length: 2000 }, () => r.get()))
    expect(feed.build).toHaveBeenCalledTimes(2)
    expect(all.every((x) => x.status === 200 && parse(x).obvody[0].candidates[0].votes1 === 100)).toBe(true)
    release()
    await settle()
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(200)
  })

  it('2 000 concurrent cold get() → exactly one upstream call, all served', async () => {
    const { r, feed } = setup()
    const all = await Promise.all(Array.from({ length: 2000 }, () => r.get()))
    expect(feed.build).toHaveBeenCalledTimes(1)
    expect(all.every((x) => x.status === 200)).toBe(true)
  })
})

// ---- 304 and validator ownership ---------------------------------------------------

describe('304 and validators (H3)', () => {
  it('the first fetch is unconditional; the next one sends the good snapshot validators', async () => {
    const { r, feed } = setup({ build: script(ok(snap(), 1, '"e1"'), { notModified: true }) })
    await r.get()
    expect(sentValidators(feed, 0)).toBeUndefined()
    await advance(61 * S)
    await poll(r)
    expect(sentValidators(feed, 1)).toEqual({ etag: '"e1"', lastModified: null })
  })

  it('304: refreshedAt/nextRefreshAt advance, stale/failures reset, only meta is persisted', async () => {
    const { r, st, log } = setup({ build: script(ok(snap(), 1, '"e1"'), { notModified: true }) })
    await r.get()
    const snapshotStr = st.data.get('snapshot')
    await advance(61 * S)
    const t = Date.now()
    await poll(r)
    const b = parse(await r.get())
    expect(b).toMatchObject({ refreshedAt: t, stale: false, phase: 'counting' })
    expect(b.nextRefreshAt).toBe(t + 20 * S) // G is old → the 20 s floor
    expect(st.put).toHaveBeenCalledTimes(2)
    expect(Object.keys(st.put.mock.calls[1][0])).toEqual(['meta'])
    expect(st.data.get('snapshot')).toBe(snapshotStr) // no new snapshot body
    expect(st.data.get('meta')).toMatchObject({
      refreshedAt: t, installedAt: T0, nextRefreshAt: t + 20 * S, validators: { etag: '"e1"', lastModified: null },
    })
    expect(events(log, 'not-modified')).toHaveLength(1)
  })

  it('attribution-mismatch warnings: one error log each per install, none on a 304', async () => {
    const warned = (w, extra = {}) => snap({ extra: { warnings: w }, ...extra })
    const { r, log } = setup({
      build: script(
        ok(warned(['attribution-mismatch:30:2', 'sum-mismatch:30:1', 'attribution-mismatch:6:1']), 1, '"e1"'),
        { notModified: true },
        { notModified: true },
        ok(warned(['attribution-mismatch:30:2'], { generated: csu(T0 + 90 * S), votes: [110, 50] }), 2, '"e2"'),
      ),
    })
    await r.get()
    const logged = () => events(log, 'attribution-mismatch').map(([, d]) => d)
    expect(logged()).toEqual([
      { level: 'error', obvod: 30, no: 2, warning: 'attribution-mismatch:30:2' },
      { level: 'error', obvod: 6, no: 1, warning: 'attribution-mismatch:6:1' },
    ])
    await advance(61 * S)
    await poll(r) // 304
    await advance(21 * S)
    await poll(r) // 304
    expect(logged()).toHaveLength(2)
    await advance(21 * S)
    await poll(r) // a new install with the same warning: logged once more
    expect(logged()).toHaveLength(3)
    expect(logged()[2]).toMatchObject({ obvod: 30, no: 2 })
  })

  it('a snapshot without attribution warnings logs none', async () => {
    const { r, log } = setup({ build: script(ok(snap({ extra: { warnings: ['sum-mismatch:3:1'] } }), 1)) })
    await r.get()
    expect(events(log, 'attribution-mismatch')).toHaveLength(0)
  })

  it('304 keeps the phase: waiting stays +60 s, idle +5 min, final +10 min', async () => {
    const cases = [
      [snap({ z: 0 }), 60 * S],
      [snap({ obvody: [{ n: 3, z: 10, st1: ['2.KOLO', '2.KOLO'] }] }), 5 * MIN],
      [snap({ obvody: [{ n: 3, z: 10, st1: ['ZVOLEN', 'NEZVOLEN'] }] }), 10 * MIN],
    ]
    for (const [s, gap] of cases) {
      const { r } = setup({ build: script(ok(s, 1), { notModified: true }) })
      await r.get()
      await advance(gap + S)
      const t = Date.now()
      await poll(r)
      expect(parse(await r.get()).nextRefreshAt).toBe(t + gap)
    }
  })

  it('a stored snapshot refreshed only by 304s is still due on its schedule (no new snapshot)', async () => {
    const { r, feed } = setup({ build: script(ok(snap({ z: 0 }), 1), { notModified: true }) })
    await r.get()
    for (let i = 0; i < 4; i++) {
      await advance(61 * S)
      await poll(r)
    }
    expect(feed.build).toHaveBeenCalledTimes(5)
    expect(parse(await r.get())).toMatchObject({ stale: false, refreshedAt: Date.now() })
  })

  it('rehydrated validators are used for the first refresh after a restart', async () => {
    const a = setup({ build: script(ok(snap(), 1, '"e1"')) })
    await a.r.get()
    const b = setup({ storage: a.st, time: T0 + 61 * S, build: script({ notModified: true }) })
    await b.r.get()
    expect(sentValidators(b.feed, 0)).toEqual({ etag: '"e1"', lastModified: null })
    await settle()
    expect(parse(await b.r.get())).toMatchObject({ stale: false, refreshedAt: T0 + 61 * S })
  })

  it('no validators from upstream (no ETag, no Last-Modified) → the next fetch is unconditional', async () => {
    const { r, feed } = setup({ build: script({ snapshot: snap(), validators: { etag: null, lastModified: null }, fetchId: 1 }, ok(snap(), 2)) })
    await r.get()
    await advance(61 * S)
    await poll(r)
    expect(sentValidators(feed, 1)).toBeUndefined()
  })

  it('rejected 200, then 304: stays stale, re-fetches unconditionally (the 304 proves nothing)', async () => {
    const regressed = snap({ generated: csu(T0 + 30 * S), z: 3 }) // counted 5 → 3
    const { r, feed, log } = setup({
      build: script(ok(snap(), 1, '"e1"'), ok(regressed, 2, '"e-bad"'), { notModified: true }, { notModified: true }),
      random: () => 0,
    })
    await r.get()
    await advance(61 * S)
    await poll(r) // rejected
    expect(events(log, 'rejected')[0][1]).toMatchObject({ reason: 'counted-decreased' })
    expect(parse(await r.get()).stale).toBe(true)
    await advance(20 * S)
    await poll(r) // upstream answers 304 anyway
    expect(parse(await r.get())).toMatchObject({ stale: true })
    expect(events(log, 'unexpected-not-modified')).toHaveLength(1)
    await advance(20 * S)
    await poll(r)
    expect(parse(await r.get())).toMatchObject({ stale: true })
    expect(feed.build).toHaveBeenCalledTimes(4)
    expect(sentValidators(feed, 1)).toEqual({ etag: '"e1"', lastModified: null }) // the first refresh is conditional
    expect(sentValidators(feed, 2)).toBeUndefined() // after the rejection: unconditional
    expect(sentValidators(feed, 3)).toBeUndefined()
  })

  it('a rejected response never touches the stored validators or the storage', async () => {
    const { r, st } = setup({
      build: script(ok(snap(), 1, '"e1"'), ok(snap({ generated: csu(T0 + 30 * S), z: 3 }), 2, '"e-bad"')),
      random: () => 0,
    })
    await r.get()
    await advance(61 * S)
    await poll(r)
    expect(parse(await r.get()).stale).toBe(true)
    expect(st.put).toHaveBeenCalledTimes(1)
    expect(st.data.get('meta').validators).toEqual({ etag: '"e1"', lastModified: null })
  })

  it('after a failed build the next fetch is unconditional; a success makes it conditional again', async () => {
    const { r, feed } = setup({
      build: script(ok(snap(), 1, '"e1"'), new Error('boom'), ok(snap({ generated: csu(T0 + 80 * S), votes: [110, 50] }), 3, '"e3"'), { notModified: true }),
      random: () => 0,
    })
    await r.get()
    await advance(61 * S)
    await poll(r) // build fails
    await advance(20 * S)
    await poll(r) // unconditional, ok
    expect(parse(await r.get()).stale).toBe(false)
    await advance(61 * S)
    await poll(r)
    expect([0, 1, 2, 3].map((i) => sentValidators(feed, i))).toEqual([
      undefined, { etag: '"e1"', lastModified: null }, undefined, { etag: '"e3"', lastModified: null },
    ])
  })

  it('after an older response the next fetch is unconditional', async () => {
    const older = snap({ generated: csu(T0 - 10 * S) })
    const { r, feed } = setup({ build: script(ok(snap(), 1, '"e1"'), ok(older, 2, '"eold"'), ok(snap({ generated: csu(T0 + 90 * S) }), 3)) })
    await r.get()
    await advance(61 * S)
    await poll(r) // older
    await advance(20 * S)
    await poll(r)
    expect(sentValidators(feed, 1)).toEqual({ etag: '"e1"', lastModified: null })
    expect(sentValidators(feed, 2)).toBeUndefined()
  })

  it('a snapshot generated in the future is refused (hard reject) even on a cold start', async () => {
    const future = snap({ generated: csu(T0 + 3_600_000) }) // +1 h
    const { r, feed } = setup({ build: async () => ok(future, 1) })
    expect((await r.get()).status).toBe(503)
    expect(feed.invalidate).toHaveBeenCalled()
  })

  it('a 304 with no good snapshot is a failure (cold, nothing to keep)', async () => {
    const { r } = setup({ build: async () => ({ notModified: true }) })
    expect((await r.get()).status).toBe(503)
  })
})

// ---- failures --------------------------------------------------------------------

describe('failures', () => {
  // seed + a build that does `fail` from the second call on
  function failing(fail, opts = {}) {
    let n = 0
    return setup({ build: async (...a) => (n++ === 0 ? ok(snap(), 1) : fail(...a)), ...opts })
  }
  const dueAndRun = async (r, ms) => { await advance(ms); await poll(r) }

  it('build throws: snapshot unchanged, stale:true, retry 20 / 40 / 60 s with random()=1', async () => {
    const { r, feed } = failing(async () => { throw new Error('boom') }, { random: () => 1 })
    await r.get()
    const first = parse(await r.get()).refreshedAt
    await dueAndRun(r, 61 * S)
    let t = Date.now()
    let b = parse(await r.get())
    expect(b).toMatchObject({ stale: true, refreshedAt: first, nextRefreshAt: t + 20 * S })
    expect(b.obvody[0].candidates[0].votes1).toBe(100)
    await dueAndRun(r, 20 * S)
    t = Date.now()
    b = parse(await r.get())
    expect(b.nextRefreshAt).toBe(t + 40 * S)
    await dueAndRun(r, 40 * S)
    t = Date.now()
    b = parse(await r.get())
    expect(b.nextRefreshAt).toBe(t + 60 * S)
    expect(feed.invalidate).toHaveBeenCalledTimes(3) // every non-ok outcome
  })

  it('random()=0 → always 20 s', async () => {
    const { r } = failing(async () => { throw new Error('boom') }, { random: () => 0 })
    await r.get()
    await dueAndRun(r, 61 * S)
    for (let i = 0; i < 3; i++) {
      expect(parse(await r.get()).nextRefreshAt).toBe(Date.now() + 20 * S)
      await dueAndRun(r, 20 * S)
    }
  })

  it('12 s deadline: a build that never settles → stale, and the next refresh is not blocked', async () => {
    let n = 0
    const { r, feed } = setup({ build: () => (n++ === 0 ? Promise.resolve(ok(snap(), 1)) : new Promise(() => {})), random: () => 0 })
    await r.get()
    await advance(61 * S)
    await r.get()
    await advance(11 * S)
    expect(parse(await r.get()).stale).toBe(false)
    await advance(1 * S + 1)
    expect(parse(await r.get())).toMatchObject({ stale: true })
    await advance(20 * S)
    await r.get()
    expect(feed.build).toHaveBeenCalledTimes(3)
  })

  it('the deadline aborts the signal passed to feed.build', async () => {
    let signal
    const { r } = setup({ build: (args) => { signal = args.signal; return new Promise(() => {}) } })
    const pending = r.get()
    await advance(12 * S + 1)
    expect((await pending).status).toBe(503)
    expect(signal.aborted).toBe(true)
  })

  it('rejected candidate → good kept, stale, backoff, feed.invalidate()', async () => {
    const { r, feed, log } = failing(async () => ok(snap({ generated: csu(Date.now()), z: 3 }), 2), { random: () => 1 })
    await r.get()
    await dueAndRun(r, 61 * S)
    const b = parse(await r.get())
    expect(b).toMatchObject({ stale: true, nextRefreshAt: Date.now() + 20 * S })
    expect(b.obvody[0].rounds['1'].okrskyZprac).toBe(5)
    expect(feed.invalidate).toHaveBeenCalledTimes(1)
    expect(events(log, 'rejected')[0][1]).toMatchObject({ reason: 'counted-decreased' })
  })

  it('recovery: a success resets failures and stale', async () => {
    let n = 0
    const { r } = setup({
      build: async () => {
        n++
        if (n === 2) throw new Error('boom')
        return ok(snap({ generated: csu(Date.now()), votes: [100 + n, 50] }), n)
      },
      random: () => 0,
    })
    await r.get()
    await dueAndRun(r, 61 * S)
    expect(parse(await r.get()).stale).toBe(true)
    await dueAndRun(r, 20 * S)
    const b = parse(await r.get())
    expect(b.stale).toBe(false)
    expect(b.obvody[0].candidates[0].votes1).toBe(103)
  })

  it('a build resolving AFTER the 12 s deadline is discarded and cannot overwrite a newer snapshot', async () => {
    let n = 0
    let late
    const { r } = setup({
      random: () => 0,
      build: () => {
        n++
        if (n === 1) return Promise.resolve(ok(snap(), 1))
        if (n === 2) return new Promise((resolve) => { late = () => resolve(ok(snap({ generated: csu(Date.now()), votes: [999, 50] }), 99)) })
        return Promise.resolve(ok(snap({ generated: csu(Date.now()), votes: [200, 50] }), 3))
      },
    })
    await r.get()
    await advance(61 * S)
    await r.get() // build #2 hangs
    await advance(12 * S + 1)
    expect(parse(await r.get()).stale).toBe(true)
    await advance(20 * S)
    await poll(r) // build #3
    expect(parse(await r.get())).toMatchObject({ stale: false })
    late()
    await settle()
    await settle()
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(200)
  })

  it('a storage.put that never settles blocks neither the next refresh nor serving', async () => {
    const st = memStorage()
    st.put.mockImplementation(() => new Promise(() => {}))
    let n = 0
    const { r, feed } = setup({ storage: st, build: async () => ok(snap({ generated: csu(Date.now()), votes: [100 + n++, 50] }), n) })
    expect((await r.get()).status).toBe(200)
    await advance(61 * S)
    await poll(r)
    expect(feed.build).toHaveBeenCalledTimes(2)
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(101)
  })

  it('a rejecting storage.put is logged as storage-put-failed and the in-memory publish stays', async () => {
    const st = memStorage()
    st.put.mockRejectedValue(new Error('disk'))
    const { r, log } = setup({ storage: st })
    expect((await r.get()).status).toBe(200)
    await settle()
    expect(events(log, 'storage-put-failed')).toHaveLength(1)
    expect(events(log, 'storage-put-failed')[0][1]).toMatchObject({ level: 'error' })
  })

  it('an unexpected exception in validation counts as a failure (never throws out of get)', async () => {
    const { r } = failing(async () => ok({ ...snap({ generated: csu(Date.now()) }), obvody: [null] }, 2))
    await r.get()
    await dueAndRun(r, 61 * S)
    expect(parse(await r.get())).toMatchObject({ stale: true })
  })

  it('a hard reject on a cold start is a 503, never installed or quarantined', async () => {
    const { r } = setup({ build: async () => ok({ ...snap(), obvody: [] }, 1) })
    expect((await r.get()).status).toBe(503)
  })
})

// ---- the real feed with an injected fetch -----------------------------------------------

describe('with the real feed', () => {
  // first request: the frozen file with an ETag; from the second on: `second(url, init)`
  function real(second, random = () => 0) {
    let n = 0
    const fetchImpl = vi.fn((url, init) => (n++ === 0
      ? Promise.resolve(new Response(FROZEN, { status: 200, headers: { ETag: '"v1"' } }))
      : second(url, init)))
    const feed = createSenatFeed({ baseUrl: BASE, fetchImpl, manifest, now: () => Date.now(), pollsCloseR1: R1, pollsCloseR2: R2 })
    return { ...setup({ feed, random }), fetchImpl }
  }
  const hanging = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

  it('the frozen file: waiting, 27 obvody, 18 Pirate-backed, the next refresh in 60 s', async () => {
    const { r } = real(() => Promise.reject(new Error('unused')))
    const b = parse(await r.get())
    expect(b).toMatchObject({ phase: 'waiting', stale: false, nextRefreshAt: T0 + 60 * S })
    expect(b.obvody).toHaveLength(27)
    expect(b.summary.pirates.total).toBe(18)
  })

  it('a 304 for the conditional request keeps the snapshot and moves the timestamps', async () => {
    const { r, fetchImpl } = real(() => Promise.resolve(new Response(null, { status: 304 })))
    await r.get()
    await advance(61 * S)
    const t = Date.now()
    await poll(r)
    expect(fetchImpl.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"')
    expect(parse(await r.get())).toMatchObject({ refreshedAt: t, stale: false, nextRefreshAt: t + 60 * S })
  })

  it.each([
    ['HTTP 500', () => Promise.resolve(new Response('oops', { status: 500 }))],
    ['HTTP 503', () => Promise.resolve(new Response(null, { status: 503 }))],
    ['an empty body', () => Promise.resolve(new Response('', { status: 200 }))],
    ['a CHYBA document', () => Promise.resolve(new Response('<CHYBA POPIS="x"/>', { status: 200 }))],
    ['garbage', () => Promise.resolve(new Response('<<< not xml', { status: 200 }))],
    ['a connection error', () => Promise.reject(new Error('ECONNRESET'))],
    ['a request that times out (8 s)', hanging],
  ])('%s keeps the last good snapshot and serves stale:true; the retry is unconditional', async (_name, second) => {
    const { r, fetchImpl } = real(second)
    await r.get()
    await advance(61 * S)
    await r.get()
    await advance(8_001)
    await settle()
    const b = parse(await r.get())
    expect(b).toMatchObject({ stale: true, phase: 'waiting' })
    expect(b.obvody).toHaveLength(27)
    expect(b.refreshedAt).toBe(T0)
    expect(fetchImpl.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"')
    await advance(61 * S)
    await poll(r)
    expect(fetchImpl.mock.calls[2][1].headers).not.toHaveProperty('If-None-Match')
    expect(fetchImpl.mock.calls[2][1].headers).not.toHaveProperty('If-Modified-Since')
  })

  it('a later good answer clears stale', async () => {
    let n = 0
    const { r } = real(() => (n++ === 0
      ? Promise.resolve(new Response(null, { status: 500 }))
      : Promise.resolve(new Response(FROZEN, { status: 200, headers: { ETag: '"v2"' } }))))
    await r.get()
    await advance(61 * S)
    await poll(r)
    expect(parse(await r.get()).stale).toBe(true)
    await advance(20 * S)
    await poll(r)
    expect(parse(await r.get()).stale).toBe(false)
  })
})

// ---- baseline, older replica, regression ------------------------------------------------

describe('baseline, older replica, regression', () => {
  it('pre-close test data as the good snapshot, then a reset to zero after the close is accepted at once', async () => {
    const t1330 = at('2026-10-10T13:30:00+02:00')
    const { r, feed } = setup({
      time: t1330,
      build: script(
        ok(snap({ generated: csu(t1330), z: 50, c: 100, votes: [900, 500] }), 1),
        async () => ok(snap({ generated: csu(Date.now()), z: 0, c: 100, votes: [0, 0] }), 2),
      ),
    })
    await r.get()
    await advance(31 * MIN) // 14:01
    expect(Date.now()).toBeGreaterThan(R1)
    await poll(r)
    const b = parse(await r.get())
    expect(b.obvody[0].rounds['1'].okrskyZprac).toBe(0)
    expect(b.stale).toBe(false)
    expect(feed.invalidate).not.toHaveBeenCalled()
  })

  it('a pre-close snapshot kept alive by 304s after the close does not become the baseline (H2)', async () => {
    const t1357 = at('2026-10-10T13:57:00+02:00')
    // test data stamped 4 min ahead (the future limit is 5 min): generated 14:01 (>= close), fetched at 13:57 (< close)
    const test = snap({ generated: csu(R1 + MIN), z: 50, c: 100, votes: [900, 500] })
    const { r, feed } = setup({
      time: t1357,
      build: script(
        ok(test, 1, '"test"'),
        { notModified: true },
        async () => ok(snap({ generated: csu(Date.now()), z: 0, c: 100, votes: [0, 0] }), 3),
      ),
    })
    await r.get()
    await advance(9 * MIN) // 14:06
    await poll(r) // 304: refreshedAt moves past 14:00, installedAt stays 13:57
    expect(parse(await r.get())).toMatchObject({ stale: false, refreshedAt: Date.now() })
    expect(sentValidators(feed, 1)).toEqual({ etag: '"test"', lastModified: null })
    await advance(2 * MIN)
    await poll(r)
    const b = parse(await r.get())
    expect(b).toMatchObject({ stale: false })
    expect(b.obvody[0].rounds['1'].okrskyZprac).toBe(0) // the real data replaced the test data
  })

  it('older replica: good kept, stale:false, no backoff, feed.invalidate(); never installed after repeats', async () => {
    let n = 0
    const { r, feed, log } = setup({
      build: async () => (n++ === 0
        ? ok(snap({ generated: csu(T0 + 10 * S), z: 8 }), 1)
        : ok(snap({ generated: csu(T0 + 5 * S), z: 6 }), n)),
      random: () => 1,
    })
    await r.get()
    await advance(71 * S)
    for (let i = 0; i < 6; i++) {
      await poll(r)
      const b = parse(await r.get())
      expect(b).toMatchObject({ stale: false, refreshedAt: T0, nextRefreshAt: Date.now() + 20 * S })
      expect(b.obvody[0].rounds['1'].okrskyZprac).toBe(8)
      await advance(20 * S)
    }
    expect(feed.build.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(feed.invalidate.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(events(log, 'older').length).toBeGreaterThanOrEqual(5)
    expect(events(log, 'older')[0][1]).toMatchObject({ level: 'info' })
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
  })

  it('older persisting 10 minutes logs error older-persistent', async () => {
    let n = 0
    const { r, log } = setup({
      build: async () => (n++ === 0
        ? ok(snap({ generated: csu(T0 + 10 * S) }), 1)
        : ok(snap({ generated: csu(T0 + 5 * S) }), n)),
    })
    await r.get()
    await advance(71 * S)
    for (let i = 0; i < 28; i++) { // 9 min 20 s
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'older-persistent')).toHaveLength(0)
    for (let i = 0; i < 6; i++) {
      await poll(r)
      await advance(20 * S)
    }
    const hit = events(log, 'older-persistent')
    expect(hit.length).toBeGreaterThanOrEqual(1)
    expect(hit[0][1]).toMatchObject({ level: 'error' })
  })
})

// ---- quarantine ----------------------------------------------------------------------

describe('quarantine', () => {
  const corrected = () => snap({ generated: csu(T0 + 30 * S), votes: [40, 50] }) // a stable corrected file (votes lower than good)

  // upstream = good file e1, then one stable corrected file e2 (a real server answers 304 only for e2)
  function server() {
    let id = 0
    return async ({ validators }) => {
      if (validators?.etag === '"e2"') return { notModified: true }
      id++
      return id === 1 ? ok(snap(), 1, '"e1"') : ok(corrected(), id, '"e2"')
    }
  }

  it('the same stable corrected file is accepted after 3 distinct 200 fetches over >= 2 min', async () => {
    const { r, feed, log, st } = setup({ build: server(), random: () => 0 })
    await r.get()
    await advance(61 * S)
    const t0 = Date.now()
    let acceptedAt = null
    for (let i = 0; i < 12 && acceptedAt === null; i++) {
      await poll(r)
      if (events(log, 'quarantine-accepted').length) acceptedAt = Date.now()
      else expect(parse(await r.get()).stale).toBe(true)
      await advance(20 * S)
    }
    expect(acceptedAt).not.toBeNull()
    // every refetch while rejected was unconditional: first conditional (e1), then none
    const sent = feed.build.mock.calls.map(([a]) => a.validators?.etag)
    expect(sent[1]).toBe('"e1"')
    expect(sent.slice(2)).toEqual(Array(sent.length - 2).fill(undefined))
    expect(acceptedAt - t0).toBeGreaterThanOrEqual(2 * MIN)
    expect(events(log, 'quarantine-accepted')[0][1]).toMatchObject({ reason: 'votes-decreased' })
    const b = parse(await r.get())
    expect(b.stale).toBe(false)
    expect(b.obvody[0].candidates[0].votes1).toBe(40)
    expect(st.data.get('meta').validators.etag).toBe('"e2"')
    // once installed, the next refresh is conditional on e2 and the 304 is honoured
    await advance(61 * S)
    await poll(r)
    expect(feed.build.mock.calls.at(-1)[0].validators.etag).toBe('"e2"')
    expect(parse(await r.get())).toMatchObject({ stale: false, refreshedAt: Date.now() })
  })

  it('needs >= 2 min even with 3+ distinct fetches', async () => {
    const { r, log } = setup({ build: server(), random: () => 0 })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 5; i++) { // attempts at 0, 20, 40, 60, 80 s
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(100)
  })

  it('replays of the same fetchId do not count', async () => {
    const { r, log } = setup({ build: script(ok(snap(), 1), () => ok(corrected(), 7)), random: () => 0 })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 20; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
    expect(parse(await r.get())).toMatchObject({ stale: true })
  })

  it('a different reason restarts the quarantine count', async () => {
    let n = 0
    const { r, log } = setup({
      random: () => 0,
      build: async () => {
        n++
        if (n === 1) return ok(snap({ z: 5 }), 1)
        // alternates counted-decreased / votes-decreased
        return n % 2
          ? ok(snap({ generated: csu(T0 + 30 * S), z: 3 }), n)
          : ok(snap({ generated: csu(T0 + 30 * S), z: 5, votes: [40, 50] }), n)
      },
    })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 14; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
  })

  it('hard rejects (empty obvody) are never quarantine-accepted', async () => {
    let n = 0
    const { r, log } = setup({
      random: () => 0,
      build: async () => (n++ === 0 ? ok(snap(), 1) : ok({ ...snap({ generated: csu(Date.now()) }), obvody: [] }, n)),
    })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 20; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
    expect(parse(await r.get()).obvody).toHaveLength(2)
  })

  it('a withdrawal (fewer candidates) is quarantinable and accepted', async () => {
    const withdrawn = () => snap({ generated: csu(T0 + 30 * S), obvody: [{ n: 3, z: 5, votes: [100] }, { n: 6, z: 5, votes: [70, 80] }] })
    let id = 0
    const { r, log } = setup({ random: () => 0, build: async () => (++id === 1 ? ok(snap(), 1) : ok(withdrawn(), id)) })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 12 && !events(log, 'quarantine-accepted').length; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')[0][1]).toMatchObject({ reason: 'candidates-fewer' })
    expect(parse(await r.get()).obvody[0].candidates).toHaveLength(1)
  })

  it('a good fetch resets the quarantine', async () => {
    // reject at 61 s, 81 s; accepted-looking progress is cut by a good fetch at 101 s;
    // four more rejects from 121 s: without the reset the old count/firstAt would accept at 181 s
    let n = 0
    const { r, log } = setup({
      random: () => 0,
      build: async () => {
        n++
        if (n === 1) return ok(snap(), 1)
        if (n <= 3) return ok(snap({ generated: csu(T0 + 30 * S), votes: [40, 50] }), n)
        if (n === 4) return ok(snap({ generated: csu(T0 + 60 * S), votes: [110, 50] }), n)
        return ok(snap({ generated: csu(T0 + 90 * S), votes: [40, 50] }), n) // lower than 110
      },
    })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 8; i++) { // fetches at 61, 81, 101, 121, 141, 161, 181, 201 s
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(0)
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(110)
  })
})

// ---- rehydrate -------------------------------------------------------------------------

describe('rehydrate', () => {
  it('a new instance over the same storage serves the snapshot without a build when not due', async () => {
    const a = setup()
    await a.r.get()
    await advance(10 * S)
    const b = setup({ storage: a.st, time: Date.now() })
    const res = await b.r.get()
    expect(res.status).toBe(200)
    expect(b.feed.build).not.toHaveBeenCalled()
    expect(parse(res)).toMatchObject({ refreshedAt: T0, nextRefreshAt: T0 + 60 * S, stale: false, phase: 'counting' })
  })

  it('a rehydrated snapshot that is due refreshes in the background', async () => {
    const a = setup()
    await a.r.get()
    await advance(2 * MIN)
    const b = setup({ storage: a.st, time: Date.now() })
    expect(parse(await b.r.get()).refreshedAt).toBe(T0)
    expect(b.feed.build).toHaveBeenCalledTimes(1)
  })

  it('discards a stored snapshot whose meta.base differs (and its validators)', async () => {
    const a = setup({ base: 'https://csu.test/senat' })
    await a.r.get()
    const b = setup({ storage: a.st, base: 'https://other.test/senat' })
    await b.r.get()
    expect(b.feed.build).toHaveBeenCalledTimes(1)
    expect(sentValidators(b.feed, 0)).toBeUndefined()
    expect(b.st.put.mock.calls.at(-1)[0].meta.base).toBe('https://other.test/senat')
  })

  it.each([
    ['another schema version', `2:${CODE_REV}`],
    ['the pre-CODE_REV schema "1"', '1'],
    ['another CODE_REV (a derive/normalize/manifest change)', '1:000000000000'],
  ])('discards a stored snapshot with %s', async (_name, schema) => {
    const a = setup()
    await a.r.get()
    a.st.data.set('meta', { ...a.st.data.get('meta'), schema })
    const b = setup({ storage: a.st })
    await b.r.get()
    expect(b.feed.build).toHaveBeenCalledTimes(1)
    expect(sentValidators(b.feed, 0)).toBeUndefined() // never a conditional GET answered with a stale-derived 304
    expect(events(b.log, 'rehydrate-discarded')[0][1]).toMatchObject({ reason: 'schema' })
  })

  it('discards meta without installedAt, corrupt storage and a non-object string', async () => {
    const meta = { refreshedAt: T0, installedAt: T0, nextRefreshAt: T0 + 60 * S, base: BASE, schema: REFRESH.SCHEMA, validators: null }
    for (const st of [
      memStorage({ snapshot: JSON.stringify(snap()), meta: { ...meta, installedAt: undefined } }),
      memStorage({ snapshot: '{not json', meta }),
      memStorage({ snapshot: '[1,2,3]', meta }),
    ]) {
      const { r, feed } = setup({ storage: st })
      expect((await r.get()).status).toBe(200)
      expect(feed.build).toHaveBeenCalledTimes(1)
    }
  })

  it('storage.get error: 503 for that call, no build and no put; the next get() retries the rehydrate', async () => {
    const a = setup()
    await a.r.get()
    const st = a.st
    const realGet = st.get.getMockImplementation()
    st.get.mockRejectedValueOnce(new Error('storage down'))
    const b = setup({ storage: st, time: T0 + 5 * S })
    st.put.mockClear()
    const res = await b.r.get()
    expect(res.status).toBe(503)
    expect(b.feed.build).not.toHaveBeenCalled()
    expect(st.put).not.toHaveBeenCalled()
    expect(events(b.log, 'rehydrate-failed')[0][1]).toMatchObject({ level: 'error' })
    st.get.mockImplementation(realGet)
    const ok2 = await b.r.get()
    expect(ok2.status).toBe(200)
    expect(parse(ok2).refreshedAt).toBe(T0)
    expect(b.feed.build).not.toHaveBeenCalled()
  })

  it('two concurrent get() on a fresh instance → one storage read pair, no build', async () => {
    const a = setup()
    await a.r.get()
    const b = setup({ storage: a.st, time: T0 + 5 * S })
    b.st.get.mockClear()
    const [x, y] = await Promise.all([b.r.get(), b.r.get()])
    expect([x.status, y.status]).toEqual([200, 200])
    expect(b.st.get.mock.calls.map(([k]) => k).sort()).toEqual(['meta', 'snapshot'])
    expect(b.feed.build).not.toHaveBeenCalled()
  })
})

// ---- size guard ------------------------------------------------------------------------

describe('size guard', () => {
  it('> 1.5 MB UTF-8 bytes (multi-byte text) → no put, memory only, one log; a 304 does not put either', async () => {
    const big = 'ě'.repeat(800_000) // 800 000 chars, 1 600 000 bytes
    let n = 0
    const { r, st, log } = setup({
      build: script(
        async () => ok(snap({ extra: { note: big } }), ++n),
        { notModified: true },
        async () => ok(snap({ generated: csu(Date.now()), votes: [101, 50], extra: { note: big } }), ++n),
      ),
    })
    const res = await r.get()
    expect(res.status).toBe(200)
    expect(st.put).not.toHaveBeenCalled()
    expect(events(log, 'size-guard')).toHaveLength(1)
    await advance(61 * S)
    await poll(r) // 304
    expect(st.put).not.toHaveBeenCalled()
    await advance(61 * S)
    await poll(r)
    expect(parse(await r.get()).obvody[0].candidates[0].votes1).toBe(101) // memory is refreshed
    expect(st.put).not.toHaveBeenCalled()
    expect(events(log, 'size-guard')).toHaveLength(1)
  })

  it('just under the limit is persisted', async () => {
    const { r, st } = setup({ build: async () => ok(snap({ extra: { note: 'ě'.repeat(700_000) } }), 1) })
    await r.get()
    expect(st.put).toHaveBeenCalledTimes(1)
  })
})

// ---- schedule per phase ------------------------------------------------------------------

describe('schedule per phase after install', () => {
  const nextOf = async (s, time = T0) => {
    const { r } = setup({ time, build: async () => ok(s, 1) })
    return parse(await r.get()).nextRefreshAt - time
  }

  it('waiting 60 s', async () => {
    expect(await nextOf(snap({ z: 0 }))).toBe(60 * S)
  })

  it('counting: G+60 s clamped to [20 s, 60 s]', async () => {
    expect(await nextOf(snap({ generated: csu(T0 - 30 * S) }))).toBe(30 * S)
    expect(await nextOf(snap({ generated: csu(T0 - 5 * MIN) }))).toBe(20 * S)
    expect(await nextOf(snap({ generated: csu(T0 + 40 * S) }))).toBe(60 * S)
  })

  it('counting: junk generated (> refreshedAt+120 s) → 20 s', async () => {
    expect(await nextOf(snap({ generated: csu(T0 + 3 * MIN) }))).toBe(20 * S) // 3 min ahead: junk for scheduling, below the 5 min future limit
  })

  it('idle 5 min', async () => {
    const s = snap({ generated: csu(T0 - 6 * 24 * 3600 * S), obvody: [{ n: 3, z: 10, st1: ['2.KOLO', '2.KOLO'] }, { n: 6, z: 10, st1: ['ZVOLEN', 'NEZVOLEN'] }] })
    expect(phaseOfSnapshot(s)).toBe('idle')
    expect(await nextOf(s)).toBe(5 * MIN)
  })

  it('final 10 min', async () => {
    const s = snap({ obvody: [{ n: 3, z: 10, st1: ['ZVOLEN', 'NEZVOLEN'] }] })
    expect(await nextOf(s)).toBe(10 * MIN)
  })

  it('failure retries override the phase schedule (20 s with random 0)', async () => {
    let n = 0
    const { r } = setup({ random: () => 0, build: async () => { if (n++) throw new Error('boom'); return ok(snap({ obvody: [{ n: 3, z: 10, st1: ['ZVOLEN', 'NEZVOLEN'] }] }), 1) } })
    await r.get()
    await advance(10 * MIN + S)
    await poll(r)
    expect(parse(await r.get()).nextRefreshAt).toBe(Date.now() + 20 * S)
  })
})

// ---- simulated load ------------------------------------------------------------------------

describe('simulated counting night', () => {
  // ČŠÚ publishes a new file every `period` s on the minute; a conditional GET answers 304 until then
  function upstream(period) {
    let calls = 0
    return async ({ validators }) => {
      calls++
      const published = Date.now() - (Date.now() % (period * S))
      const k = (published - T0) / (period * S)
      const etag = `"u${k}"`
      if (validators?.etag === etag) return { notModified: true }
      return ok(snap({ generated: csu(published), z: 5 + Math.max(k, 0), votes: [100 + k, 50] }), calls, etag)
    }
  }
  const run = async (r, ms) => {
    for (let t = 0; t < ms; t += 100) {
      await Promise.all([r.get(), r.get(), r.get(), r.get(), r.get()]) // 50 get()/s
      await advance(100)
    }
  }

  it('ČSÚ publishes every 60 s, 50 get()/s for 5 min → 5–15 upstream calls', async () => {
    const { r, feed } = setup({ build: upstream(60), time: at('2026-10-10T15:00:30+02:00') })
    await run(r, 300 * S)
    const calls = feed.build.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(5)
    expect(calls).toBeLessThanOrEqual(15)
    const b = parse(await r.get())
    expect(b.stale).toBe(false)
    expect(b.obvody[0].candidates[0].votes1).toBeGreaterThanOrEqual(104) // follows the publications
  })

  it('ČSÚ unchanged (304 answers) → about one call per 20 s', async () => {
    const { r, feed } = setup({ build: upstream(24 * 3600), time: at('2026-10-10T15:00:30+02:00') })
    await run(r, 300 * S)
    const calls = feed.build.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(14)
    expect(calls).toBeLessThanOrEqual(16)
    expect(parse(await r.get()).stale).toBe(false)
  })
})

it('idle polls every 60 s from 5 min before the round-2 polls close (first round-2 count is not delayed)', async () => {
  const { computeNextRefreshAt, REFRESH } = await import('./refresh.js')
  const close = Date.parse('2026-10-17T14:00:00+02:00')
  const base = { phase: 'idle', generatedMs: null, failures: 0, random: () => 0.5, pollsCloseR2: close }
  expect(computeNextRefreshAt({ ...base, refreshedAt: close - 3_600_000, now: close - 3_600_000 })).toBe(close - 3_600_000 + REFRESH.IDLE_MS)
  expect(computeNextRefreshAt({ ...base, refreshedAt: close - 60_000, now: close - 60_000 })).toBe(close - 60_000 + REFRESH.WAITING_MS)
  expect(computeNextRefreshAt({ ...base, refreshedAt: close + 3_600_000, now: close + 3_600_000 })).toBe(close + 3_600_000 + REFRESH.WAITING_MS)
})

// ---- review fixes (M1, L5, L6, L7) -----------------------------------------------------------

describe('M1: snapshot and meta never diverge in storage', () => {
  // upstream file that answers 304 only to its current ETag (a real server)
  function server(initial) {
    const state = { snap: initial.snap, etag: initial.etag }
    let n = 0
    const build = vi.fn(async ({ validators }) => (validators?.etag === state.etag
      ? { notModified: true }
      : ok(structuredClone(state.snap), ++n, state.etag)))
    return { state, build }
  }
  const file = (generatedMs, votes1) => snap({ generated: csu(generatedMs), obvody: [{ n: 3, z: 10, c: 10, votes: [votes1, 50] }] })
  const votes1Of = (res) => parse(res).obvody[0].candidates[0].votes1
  const storedVotes1 = (st) => JSON.parse(st.data.get('snapshot')).obvody[0].candidates[0].votes1
  const metaOnlyPuts = (st) => st.put.mock.calls.filter(([o]) => !('snapshot' in o))

  it('probe1: failed put of B, then a refresh, then an eviction must not serve A as fresh', async () => {
    const up = server({ snap: file(T0 - 60 * S, 100), etag: '"A"' })
    const a = setup({ build: up.build })
    await a.r.get()
    expect(a.st.data.get('meta').validators.etag).toBe('"A"')

    up.state.snap = file(T0 + 10 * MIN, 120)
    up.state.etag = '"B"'
    a.st.put.mockRejectedValueOnce(new Error('put failed'))
    await advance(10 * MIN)
    await poll(a.r) // B installed in memory, its put fails
    expect(events(a.log, 'storage-put-failed')).toHaveLength(1)
    expect(votes1Of(await a.r.get())).toBe(120)
    expect(storedVotes1(a.st)).toBe(100) // storage still holds A (and A's meta)

    // the next fetch after a failed put is unconditional (a 304 for "B" would only re-confirm memory)
    await advance(10 * MIN)
    await poll(a.r)
    expect(sentValidators(a.feed, 2)).toBeUndefined()
    expect(storedVotes1(a.st)).toBe(120) // a full put succeeded
    expect(a.st.data.get('meta').validators.etag).toBe('"B"')

    // eviction: a new refresher rehydrates from storage and serves the right numbers
    await advance(11 * MIN)
    const b = setup({ storage: a.st, time: Date.now(), build: up.build })
    await b.r.get()
    await settle()
    const res = await b.r.get()
    expect(parse(res)).toMatchObject({ stale: false })
    expect(votes1Of(res)).toBe(120)
  })

  it('a put that fails after a 304 was answered: no meta-only put in between, eviction refetches in full', async () => {
    const up = server({ snap: file(T0 - 60 * S, 100), etag: '"A"' })
    const a = setup({ build: up.build })
    await a.r.get()

    up.state.snap = file(T0 + 10 * MIN, 120)
    up.state.etag = '"B"'
    let rejectPut
    a.st.put.mockImplementationOnce(() => new Promise((_, reject) => { rejectPut = reject })) // B's put is in flight
    await advance(10 * MIN)
    await poll(a.r) // B in memory, full put pending
    await advance(10 * MIN)
    await poll(a.r) // conditional with "B" -> 304 while the put is still pending
    expect(sentValidators(a.feed, 2)).toEqual({ etag: '"B"', lastModified: null })
    expect(metaOnlyPuts(a.st)).toHaveLength(0) // the 304 did not write meta next to the old snapshot
    rejectPut(new Error('put failed'))
    await settle()
    expect(events(a.log, 'storage-put-failed')).toHaveLength(1)
    expect(storedVotes1(a.st)).toBe(100)
    expect(a.st.data.get('meta').validators.etag).toBe('"A"') // storage is still the consistent A pair

    await advance(11 * MIN)
    const b = setup({ storage: a.st, time: Date.now(), build: up.build })
    await b.r.get()
    await settle()
    expect(sentValidators(b.feed, 0)).toEqual({ etag: '"A"', lastModified: null }) // A's validators, A's snapshot
    expect(votes1Of(await b.r.get())).toBe(120) // upstream has B: a 200, not a 304 on a wrong pair
    expect(parse(await b.r.get()).stale).toBe(false)
  })

  it('after a failed put, meta-only puts stay off until a full put succeeds, then resume', async () => {
    const up = server({ snap: file(T0 - 60 * S, 100), etag: '"A"' })
    const a = setup({ build: up.build })
    await a.r.get()
    up.state.snap = file(T0 + 10 * MIN, 120)
    up.state.etag = '"B"'
    a.st.put.mockRejectedValueOnce(new Error('put failed'))
    await advance(10 * MIN)
    await poll(a.r)
    // the unconditional refetch installs B again: full put (succeeds) -> clean
    await advance(10 * MIN)
    await poll(a.r)
    expect(metaOnlyPuts(a.st)).toHaveLength(0)
    await advance(10 * MIN)
    await poll(a.r) // conditional "B" -> 304 -> meta-only put is allowed again
    expect(metaOnlyPuts(a.st)).toHaveLength(1)
    expect(a.st.data.get('meta').validators.etag).toBe('"B"')
    expect(storedVotes1(a.st)).toBe(120)
  })

  it('a synchronously throwing put is handled the same way', async () => {
    const up = server({ snap: file(T0 - 60 * S, 100), etag: '"A"' })
    const a = setup({ build: up.build })
    await a.r.get()
    up.state.snap = file(T0 + 10 * MIN, 120)
    up.state.etag = '"B"'
    a.st.put.mockImplementationOnce(() => { throw new Error('sync boom') })
    await advance(10 * MIN)
    await poll(a.r)
    expect(events(a.log, 'storage-put-failed')).toHaveLength(1)
    await advance(10 * MIN)
    await poll(a.r)
    expect(sentValidators(a.feed, 2)).toBeUndefined()
  })
})

describe('L5: a permanent older response turns stale on', () => {
  const olderBuild = () => {
    let n = 0
    return async () => (n++ === 0 ? ok(snap({ generated: csu(T0 + 10 * S) }), 1) : ok(snap({ generated: csu(T0 + 5 * S) }), n))
  }

  it('stale:false until OLDER_ERROR_MS, stale:true from then on, cleared by the next ok install', async () => {
    let newer = false
    const base = olderBuild()
    const { r } = setup({ build: async (a) => (newer ? ok(snap({ generated: csu(Date.now()), z: 6 }), 99) : base(a)) })
    await r.get()
    await advance(71 * S)
    const first = Date.now()
    for (let i = 0; Date.now() - first < REFRESH.OLDER_ERROR_MS - 30 * S; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(parse(await r.get()).stale).toBe(false)
    for (let i = 0; i < 6; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(parse(await r.get())).toMatchObject({ stale: true })
    newer = true
    await advance(21 * S)
    await poll(r)
    expect(parse(await r.get())).toMatchObject({ stale: false })
  })
})

describe('L6: a snapshot zeroed by our own clock is installed without validators', () => {
  it('suppressedByClock → null validators in memory and meta; the next fetch is unconditional; the next ok restores them', async () => {
    const { r, st, feed } = setup({
      build: script(
        { ...ok(snap(), 1, '"zeroed"'), suppressedByClock: true },
        ok(snap({ generated: csu(T0 + 2 * MIN), z: 6 }), 2, '"fixed"'),
        { notModified: true },
      ),
    })
    await r.get()
    expect(st.data.get('meta').validators).toEqual({ etag: null, lastModified: null })
    await advance(61 * S)
    await poll(r)
    expect(sentValidators(feed, 1)).toBeUndefined()
    expect(st.data.get('meta').validators).toEqual({ etag: '"fixed"', lastModified: null })
    await advance(61 * S)
    await poll(r)
    expect(sentValidators(feed, 2)).toEqual({ etag: '"fixed"', lastModified: null })
  })

  it('a normal install keeps its validators', async () => {
    const { r, st } = setup({ build: async () => ({ ...ok(snap(), 1, '"keep"'), suppressedByClock: false }) })
    await r.get()
    expect(st.data.get('meta').validators).toEqual({ etag: '"keep"', lastModified: null })
  })

  it('the same holds for a quarantine-accepted install', async () => {
    let n = 0
    const { r, st, log } = setup({
      random: () => 0,
      build: async () => {
        n += 1
        if (n === 1) return ok(snap(), 1, '"g"')
        return { ...ok(snap({ generated: csu(T0 + 30 * S), votes: [40, 50] }), n, '"c"'), suppressedByClock: true }
      },
    })
    await r.get()
    await advance(61 * S)
    for (let i = 0; i < 12 && !events(log, 'quarantine-accepted').length; i++) {
      await poll(r)
      await advance(20 * S)
    }
    expect(events(log, 'quarantine-accepted')).toHaveLength(1)
    expect(st.data.get('meta').validators).toEqual({ etag: null, lastModified: null })
  })
})

describe('L7: the obvod set against the manifest, with no good snapshot', () => {
  const differing = () => ({ ...snap(), warnings: ['obvody-set-differs-from-manifest'] })

  it('requireManifestSet: a cold start with a differing set is a hard reject (503), nothing installed or stored', async () => {
    const { r, st, log } = setup({ requireManifestSet: true, build: async () => ok(differing(), 1) })
    const res = await r.get()
    expect(res.status).toBe(503)
    expect(st.put).not.toHaveBeenCalled()
    expect(events(log, 'rejected')[0][1]).toMatchObject({ reason: 'obvody-set-differs-from-manifest' })
  })

  it('not required (default): the warning stays soft and the snapshot is published', async () => {
    const { r } = setup({ build: async () => ok(differing(), 1) })
    const res = await r.get()
    expect(res.status).toBe(200)
    expect(parse(res).warnings).toContain('obvody-set-differs-from-manifest')
  })

  it('required, a matching set: published as usual', async () => {
    const { r } = setup({ requireManifestSet: true, build: async () => ok(snap(), 1) })
    expect((await r.get()).status).toBe(200)
  })
})
