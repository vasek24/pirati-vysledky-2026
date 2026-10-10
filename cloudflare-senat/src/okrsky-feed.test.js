import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { markStale } from './edge.js'
import { OKRSKY, batchUrl, createOkrskyRefresher, retryDelay } from './okrsky-feed.js'

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const B1 = fixture('okrsky-2024-b1.xml') // generated 2024-09-21T14:30:00 (after the 2024 close)
const B2 = fixture('okrsky-2024-b2.xml')

// 2024 close constants: the fixtures are real 2024 batches
const R1 = Date.parse('2024-09-21T14:00:00+02:00')
const R2 = Date.parse('2024-09-28T14:00:00+02:00')
const BASE = 'https://csu.test/senat'

const manifest = {
  PIRATE_BACKED: [
    { obvod: 17, no: 2, relation: 'ticket' },
    { obvod: 23, no: 5, relation: 'ticket' },
    { obvod: 20, no: 1, relation: 'endorsed' }, // endorsed only: no map
  ],
  CANDIDATES: Object.fromEntries([
    ...[1, 2, 3, 4, 5, 6].map((n) => [`17:${n}`, {}]),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`23:${n}`, {}]),
    ['20:1', {}],
  ]),
}

const okrsek = ({ obec = 100, okrsek: n = 1, obvod = 17, seq = 1, valid = 100, votes = { 1: 60, 2: 40 } } = {}) =>
  `<OKRSEK CIS_OBEC="${obec}" CIS_OKRSEK="${n}" CIS_OBVOD="${obvod}" PORADI_ZPRAC="${seq}" DATUM_CAS_ZPRAC="2024-09-21T14:30:00" OPAKOVANE="0">`
  + `<UCAST_OKRSEK ZAPSANI_VOLICI="500" VYDANE_OBALKY="${valid}" ODEVZDANE_OBALKY="${valid}" PLATNE_HLASY="${valid}"/>`
  + Object.entries(votes).map(([no, h]) => `<HLASY_OKRSEK PORADOVE_CISLO="${no}" HLASY="${h}"/>`).join('')
  + '</OKRSEK>'
const batch = ({ kolo = 1, n = 1, generated = '2024-09-21T14:30:00', body = okrsek() } = {}) =>
  `<VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI="${generated}"><DAVKA DATUMVOLEB="20240920" KOLO="${kolo}" PORADI_DAVKY="${n}" OKRSKY_DAVKA="1" OKRSKY_CELKEM="4718" OKRSKY_ZPRAC="1"/>${body}</VYSLEDKY_OKRSKY>`
const NOT_FOUND = { status: 404, body: '<!DOCTYPE html><html><body><h1>Chyba 404</h1></body></html>' }

// routes: { 'K1/00001': xml | { status, body } | (url) => … }
function setup({ routes = {}, now = R1 + 40 * 60_000, storage = null, ...opts } = {}) {
  const clock = { t: now }
  const logs = []
  const calls = []
  const pending = []
  const store = storage ?? new Map()
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init })
    const key = url.replace(`${BASE}/odata/okrsky/`, '').replace('vysledky_okrsky_', '').replace('.xml', '')
    const hit = routes[key]
    const res = typeof hit === 'function' ? await hit(url, init, clock) : (hit ?? NOT_FOUND)
    return typeof res === 'string' ? new Response(res, { status: 200 }) : new Response(res.body, { status: res.status })
  })
  const refresher = createOkrskyRefresher({
    now: () => clock.t,
    random: () => 0,
    storage: { get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined), put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)) } },
    fetchImpl,
    userAgent: 'test-agent',
    log: (event, data) => logs.push({ event, ...data }),
    base: BASE,
    manifest,
    pollsCloseR1: R1,
    pollsCloseR2: R2,
    waitUntil: (p) => pending.push(p),
    ...opts,
  })
  const settle = async () => {
    await Promise.all(pending.splice(0))
    await new Promise((r) => setTimeout(r, 0)) // let the unawaited storage put land
  }
  const get = async (obvod = 17, round) => {
    const res = await refresher.get(obvod, round)
    return { ...res, json: res.status === 200 ? JSON.parse(res.body) : null }
  }
  return { refresher, clock, logs, calls, store, settle, get, fetchImpl }
}

const urls = (calls) => calls.map((c) => c.url.replace(`${BASE}/odata/okrsky/`, '').replace('vysledky_okrsky_', '').replace('.xml', ''))

describe('batchUrl', () => {
  it('zero-padded to five digits', () => {
    expect(batchUrl(BASE, 1, 7)).toBe(`${BASE}/odata/okrsky/K1/vysledky_okrsky_00007.xml`)
    expect(batchUrl(BASE, 2, 12345)).toBe(`${BASE}/odata/okrsky/K2/vysledky_okrsky_12345.xml`)
  })
})

describe('retryDelay', () => {
  it('20 s floor, capped at 60 s', () => {
    expect(retryDelay(1, () => 0)).toBe(20_000)
    expect(retryDelay(1, () => 1)).toBe(20_000)
    expect(retryDelay(2, () => 1)).toBe(40_000)
    expect(retryDelay(9, () => 1)).toBe(60_000)
  })
})

describe('the wanted set comes from the manifest (relation ticket only)', () => {
  it('endorsed-only obvody are not tracked', () => {
    const { refresher } = setup()
    expect([...refresher.wanted.entries()]).toEqual([[17, 2], [23, 5]])
  })
})

describe('before the round-1 close', () => {
  it('nothing is fetched; 200 with an empty list, phase waiting, next run at most at the close', async () => {
    const s = setup({ now: R1 - 10_000 })
    const r = await s.get(17)
    expect(s.calls).toHaveLength(0)
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ v: 1, obvod: 17, round: 1, phase: 'waiting', stale: false, counted: 0, precincts: [], batches: { 1: 0, 2: 0 }, generated: null, pirateNo: 2, cands: [1, 2, 3, 4, 5, 6] })
    expect(r.json.nextRefreshAt).toBe(R1) // 10 s to the close
  })

  it('far before the close the cadence is 60 s', async () => {
    const s = setup({ now: R1 - 3_600_000 })
    expect((await s.get(17)).json.nextRefreshAt).toBe(R1 - 3_600_000 + 60_000)
  })
})

describe('round 1: the loop runs until the first 404', () => {
  const routes = { 'K1/00001': B1, 'K1/00002': B2 }

  it('fetches 1, 2, then probes 3 (404 = end); applies both batches for the wanted obvod', async () => {
    const s = setup({ routes })
    const r = await s.get(17)
    expect(urls(s.calls)).toEqual(['K1/00001', 'K1/00002', 'K1/00003'])
    expect(s.calls[0].init.headers['User-Agent']).toBe('test-agent')
    expect(r.json.batches).toEqual({ 1: 2, 2: 0 })
    expect(r.json.generated).toBe('2024-09-21T14:35:00')
    expect(r.json.generatedMs).toBe(Date.parse('2024-09-21T14:35:00+02:00'))
    expect(r.json.counted).toBe(10) // obvod 17: 5 in batch 1 + 5 in batch 2
    expect(r.json.precincts).toHaveLength(10)
    // row shape: [obec, okrsek, voters, valid, ...votes aligned with cands]
    expect(r.json.precincts.find((p) => p[0] === 539601 && p[1] === 16005)).toEqual([539601, 16005, 1124, 355, 2, 237, 29, 10, 5, 72])
    expect(r.json).toMatchObject({ phase: 'counting', stale: false, refreshedAt: s.clock.t, nextRefreshAt: s.clock.t + 60_000 })
    expect(r.json.round).toBe(1)
    // the other wanted obvod is served from the same state
    expect((await s.get(23)).json.counted).toBe(14)
  })

  it('a second request inside the schedule does not refetch', async () => {
    const s = setup({ routes })
    await s.get(17)
    const n = s.calls.length
    s.clock.t += 30_000
    await s.get(17)
    await s.settle()
    expect(s.calls).toHaveLength(n)
  })

  it('when due, the next run starts only from lastBatch+1 (one probe)', async () => {
    const s = setup({ routes })
    await s.get(17)
    s.calls.length = 0
    s.clock.t += 61_000
    await s.get(17) // warm: the refresh runs in the background
    await s.settle()
    expect(urls(s.calls)).toEqual(['K1/00003'])
  })

  it('a new batch arrives later and is picked up; the counted number grows', async () => {
    const routes2 = { ...routes }
    const s = setup({ routes: routes2 })
    await s.get(17)
    routes2['K1/00003'] = batch({ n: 3, generated: '2024-09-21T14:40:00', body: okrsek({ obec: 777, okrsek: 1, seq: 33 }) })
    s.clock.t += 61_000
    await s.get(17)
    await s.settle()
    const r = await s.get(17)
    expect(r.json.batches[1]).toBe(3)
    expect(r.json.counted).toBe(11) // + the new precinct (obvod 17)
  })

  it('markStale (edge.js) can flip the stale flag of this body', async () => {
    const s = setup({ routes })
    const { body } = await s.get(17)
    expect(JSON.parse(markStale(body)).stale).toBe(true)
    expect(body.indexOf('"stale":')).toBeLessThan(300)
  })

  it('a CHYBA batch ends the round without failing', async () => {
    const chyba = '<VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI="2024-09-21T14:40:00"><CHYBA KOD_CHYBY="1">x</CHYBA></VYSLEDKY_OKRSKY>'
    const s = setup({ routes: { 'K1/00001': B1, 'K1/00002': chyba } })
    const r = await s.get(17)
    expect(r.json).toMatchObject({ stale: false, batches: { 1: 1, 2: 0 } })
    expect(s.logs.filter((l) => l.level === 'warn')).toEqual([])
  })

  it('the 404 body is never read (the connection is released)', async () => {
    const cancel = vi.fn(async () => {})
    const s = setup({ routes: { 'K1/00001': () => ({ status: 404, body: 'x' }) } })
    s.fetchImpl.mockImplementation(async () => ({ status: 404, body: { cancel } }))
    await s.get(17)
    expect(cancel).toHaveBeenCalled()
  })

  it('a precinct re-sent in a later batch with a higher PORADI_ZPRAC replaces the earlier row', async () => {
    const s = setup({
      routes: {
        'K1/00001': batch({ body: okrsek({ seq: 5, valid: 100, votes: { 1: 60, 2: 40 } }) }),
        'K1/00002': batch({ n: 2, generated: '2024-09-21T14:35:00', body: okrsek({ seq: 9, valid: 130, votes: { 1: 70, 2: 60 } }) }),
      },
    })
    const r = await s.get(17)
    expect(r.json.precincts).toEqual([[100, 1, 500, 130, 70, 60, 0, 0, 0, 0]])
    expect(s.logs.find((l) => l.event === 'okrsky-run')).toMatchObject({ applied: 2, added: 1, replaced: 1 })
  })
})

describe('gates', () => {
  it('a batch generated before the round close is test data: consumed, never applied; phase stays waiting', async () => {
    const s = setup({ routes: { 'K1/00001': batch({ generated: '2024-09-21T13:59:59', body: okrsek() }) } })
    const r = await s.get(17)
    expect(r.json).toMatchObject({ counted: 0, precincts: [], batches: { 1: 1, 2: 0 }, phase: 'waiting', stale: false })
    expect(urls(s.calls)).toEqual(['K1/00001', 'K1/00002'])
    // the next run starts after the test batch
    s.clock.t += 61_000
    s.calls.length = 0
    await s.get(17)
    await s.settle()
    expect(urls(s.calls)).toEqual(['K1/00002'])
  })

  it('real data after test data: only the post-close batch is applied', async () => {
    const s = setup({
      routes: {
        'K1/00001': batch({ generated: '2024-09-20T10:00:00', body: okrsek({ obec: 1 }) }),
        'K1/00002': batch({ n: 2, generated: '2024-09-21T14:30:00', body: okrsek({ obec: 2 }) }),
      },
    })
    const r = await s.get(17)
    expect(r.json.precincts.map((p) => p[0])).toEqual([2])
    expect(r.json.phase).toBe('counting')
  })

  it('K2 is not probed before the round-2 close, even with data waiting there', async () => {
    const s = setup({ routes: { 'K1/00001': B1, 'K2/00001': batch({ kolo: 2, generated: '2024-09-28T14:40:00' }) }, now: R2 - 1000 })
    await s.get(17)
    expect(urls(s.calls)).toEqual(['K1/00001', 'K1/00002'])
  })

  it('K2 is probed from the close; a K2 batch before the K2 close is test data', async () => {
    const s = setup({
      routes: {
        'K1/00001': B1,
        'K2/00001': batch({ kolo: 2, generated: '2024-09-27T10:00:00', body: okrsek({ obec: 5 }) }), // test data
        'K2/00002': batch({ kolo: 2, n: 2, generated: '2024-09-28T14:40:00', body: okrsek({ obec: 6, votes: { 1: 10, 2: 90 }, valid: 100 }) }),
      },
      now: R2 + 3_600_000,
    })
    const r = await s.get(17)
    expect(urls(s.calls)).toEqual(['K1/00001', 'K1/00002', 'K2/00001', 'K2/00002', 'K2/00003'])
    expect(r.json.batches).toEqual({ 1: 1, 2: 2 })
    // default round: 2 once round 2 holds rows of this obvod; round 1 stays reachable
    expect(r.json.round).toBe(2)
    expect(r.json.precincts).toEqual([[6, 1, 500, 100, 10, 90, 0, 0, 0, 0]])
    const r1 = await s.get(17, 1)
    expect(r1.json.round).toBe(1)
    expect(r1.json.counted).toBe(5)
  })

  it('an obvod without round-2 rows is served in round 1 even after K2 batches exist', async () => {
    const s = setup({ routes: { 'K1/00001': B1, 'K2/00001': batch({ kolo: 2, generated: '2024-09-28T14:40:00', body: okrsek({ obvod: 23 }) }) }, now: R2 + 3_600_000 })
    expect((await s.get(17)).json.round).toBe(1)
    expect((await s.get(23)).json.round).toBe(2)
  })

  it('a K1 URL answering with KOLO=2 is a failure, nothing applied', async () => {
    const s = setup({ routes: { 'K1/00001': batch({ kolo: 2 }) } })
    const r = await s.get(17)
    expect(r.status).toBe(503) // cold start, nothing established
    expect(s.logs.find((l) => l.event === 'okrsky-batch-unusable').error).toMatch(/KOLO 2 in a K1 batch/)
  })

  it('an unparseable DATUM_CAS_GENEROVANI is a failure', async () => {
    const s = setup({ routes: { 'K1/00001': batch({ generated: 'yesterday' }) } })
    expect((await s.get(17)).status).toBe(503)
    expect(s.logs.find((l) => l.event === 'okrsky-batch-unusable').error).toMatch(/bad DATUM_CAS_GENEROVANI/)
  })

  it('a different PORADI_DAVKY than the URL only warns', async () => {
    const s = setup({ routes: { 'K1/00001': batch({ n: 7 }) } })
    const r = await s.get(17)
    expect(r.json.batches[1]).toBe(1)
    expect(s.logs.find((l) => l.event === 'okrsky-batch-number')).toMatchObject({ batch: 1, davka: 7 })
  })
})

describe('caps, deadline, resume', () => {
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`K1/${String(i + 1).padStart(5, '0')}`, batch({ n: i + 1, body: okrsek({ obec: 1000 + i, seq: i + 1 }) })]))

  it('at most 40 batches per run, the rest resumes soon (+5 s) and then finishes', async () => {
    const s = setup({ routes: many(45) })
    const r = await s.get(17)
    expect(urls(s.calls)).toHaveLength(40)
    expect(r.json.batches[1]).toBe(40)
    expect(r.json.nextRefreshAt).toBe(s.clock.t + OKRSKY.RESUME_MS)
    s.calls.length = 0
    s.clock.t += 6000
    await s.get(17)
    await s.settle()
    expect(urls(s.calls)).toEqual(['K1/00041', 'K1/00042', 'K1/00043', 'K1/00044', 'K1/00045', 'K1/00046'])
    const r2 = await s.get(17)
    expect(r2.json.batches[1]).toBe(45)
    expect(r2.json.counted).toBe(45)
    expect(r2.json.nextRefreshAt).toBe(s.clock.t + 60_000)
  })

  it('the 12 s deadline stops the loop between requests (progress is kept and resumes)', async () => {
    const slow = (xml) => async (_u, _i, clock) => {
      clock.t += 5000
      return xml
    }
    const s = setup({
      routes: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`K1/${String(i + 1).padStart(5, '0')}`, slow(batch({ n: i + 1, body: okrsek({ obec: 2000 + i, seq: i + 1 }) }))])),
    })
    const r = await s.get(17)
    expect(urls(s.calls)).toHaveLength(3) // 5 s, 10 s, 15 s ≥ 12 s
    expect(r.json.batches[1]).toBe(3)
    expect(r.json.stale).toBe(false)
    expect(r.json.nextRefreshAt).toBe(s.clock.t + OKRSKY.RESUME_MS)
  })

  it('a request that hangs is cut at the request timeout and counts as a failure', async () => {
    const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    const s = setup({ routes: { 'K1/00001': hang }, requestTimeoutMs: 20 })
    const r = await s.get(17)
    expect(r.status).toBe(503)
    expect(s.logs.find((l) => l.event === 'okrsky-fetch-failed').error).toMatch(/timeout 20 ms/)
  })
})

describe('failures keep the last good data and set stale', () => {
  const good = { 'K1/00001': B1, 'K1/00002': B2 }

  it('a 500 after good data: stale:true, same rows, retry in 20 s; the next success clears stale', async () => {
    const routes = { ...good }
    const s = setup({ routes })
    await s.get(17)
    routes['K1/00003'] = { status: 500, body: 'oops' }
    s.clock.t += 61_000
    await s.get(17)
    await s.settle()
    const failed = await s.get(17)
    expect(failed.status).toBe(200)
    expect(failed.json).toMatchObject({ stale: true, counted: 10, batches: { 1: 2, 2: 0 } })
    expect(failed.json.nextRefreshAt).toBe(s.clock.t + 20_000)
    expect(s.logs.find((l) => l.event === 'okrsky-fetch-failed')).toMatchObject({ round: 1, batch: 3, error: 'upstream HTTP 500', failures: 1 })
    delete routes['K1/00003']
    s.clock.t += 21_000
    await s.get(17)
    await s.settle()
    expect((await s.get(17)).json.stale).toBe(false)
  })

  it.each([
    ['403', { status: 403, body: 'no' }, /upstream HTTP 403/],
    ['a 200 HTML page', { status: 200, body: NOT_FOUND.body }, /root element is html/],
    ['a truncated XML', B1.replace('</VYSLEDKY_OKRSKY>', ''), /truncated/],
    ['a network error', () => { throw new Error('connection reset') }, /connection reset/],
  ])('%s is a failure (only 404 and CHYBA end a round)', async (_n, route, re) => {
    const s = setup({ routes: { ...good, 'K1/00003': route } })
    const r = await s.get(17)
    expect(r.json).toMatchObject({ stale: true, batches: { 1: 2, 2: 0 }, counted: 10 }) // progress before the failure is kept
    expect(s.logs.filter((l) => l.level === 'warn').map((l) => l.error).join(' ')).toMatch(re)
  })

  it('cold start failure with nothing to serve: 503 unavailable, and within the backoff no new run', async () => {
    const s = setup({ routes: { 'K1/00001': { status: 500, body: '' } } })
    const r = await s.get(17)
    expect(r.status).toBe(503)
    expect(r.body).toBe('{"error":"unavailable"}')
    expect(r.meta).toMatchObject({ stale: true, phase: null })
    const n = s.calls.length
    s.clock.t += 5000
    expect((await s.get(17)).status).toBe(503)
    expect(s.calls).toHaveLength(n)
    s.clock.t += 20_000 // backoff over, still failing
    expect((await s.get(17)).status).toBe(503)
    expect(s.calls.length).toBeGreaterThan(n)
  })

  it('the backoff grows with repeated failures (random fixed at 0 = floor, 1 = top)', async () => {
    const s = setup({ routes: { ...good, 'K1/00003': { status: 500, body: '' } }, random: () => 1 })
    await s.get(17)
    expect((await s.get(17)).json.nextRefreshAt).toBe(s.clock.t + 20_000)
    s.clock.t += 21_000
    await s.get(17)
    await s.settle()
    expect((await s.get(17)).json.nextRefreshAt).toBe(s.clock.t + 40_000)
  })
})

describe('persistence', () => {
  it('rehydrates after a restart and resumes from lastBatch+1 without refetching', async () => {
    const routes = { 'K1/00001': B1, 'K1/00002': B2 }
    const a = setup({ routes })
    await a.get(17)
    await a.settle()
    expect([...a.store.keys()].sort()).toEqual(['meta', 'r1', 'r2'])
    expect(a.store.get('r1').lastBatch).toBe(2)
    expect(a.store.get('meta')).toMatchObject({ schema: `${OKRSKY.SCHEMA}:17,23`, base: BASE })

    const b = setup({ routes, storage: a.store, now: a.clock.t + 120_000 })
    const r = await b.get(17)
    expect(r.json.counted).toBe(10) // served from storage immediately
    await b.settle()
    expect(urls(b.calls)).toEqual(['K1/00003']) // due: one probe only
    expect(b.logs.some((l) => l.event === 'okrsky-rehydrated')).toBe(true)
  })

  it('a stored state of another schema (or base, or wanted set) is discarded', async () => {
    const routes = { 'K1/00001': B1 }
    const a = setup({ routes })
    await a.get(17)
    await a.settle()
    for (const patch of [{ schema: 'old' }, { base: 'https://elsewhere' }]) {
      const store = new Map(a.store)
      store.set('meta', { ...store.get('meta'), ...patch })
      const b = setup({ routes, storage: store })
      await b.get(17)
      expect(b.logs.some((l) => l.event === 'okrsky-rehydrate-discarded')).toBe(true)
      expect(urls(b.calls)[0]).toBe('K1/00001') // starts again from batch 1
    }
  })

  it('a corrupt stored round is discarded, not trusted', async () => {
    const a = setup({ routes: { 'K1/00001': B1 } })
    await a.get(17)
    await a.settle()
    const store = new Map(a.store)
    store.set('r1', { lastBatch: 'x', applied: 1, precincts: [] })
    const b = setup({ routes: { 'K1/00001': B1 }, storage: store })
    await b.get(17)
    expect(b.logs.find((l) => l.event === 'okrsky-rehydrate-discarded').reason).toBe('invalid')
  })

  it('a storage read failure builds nothing and overwrites nothing (503 until a read succeeds)', async () => {
    const s = setup({ routes: { 'K1/00001': B1 } })
    const failing = createOkrskyRefresher({
      now: () => s.clock.t, random: () => 0, fetchImpl: s.fetchImpl, userAgent: 'x', log: () => {}, base: BASE, manifest, pollsCloseR1: R1, pollsCloseR2: R2,
      storage: { get: async () => { throw new Error('disk') }, put: vi.fn() },
    })
    const r = await failing.get(17)
    expect(r.status).toBe(503)
    expect(s.calls).toHaveLength(0)
  })

  it('a failing put does not break serving', async () => {
    const s = setup({ routes: { 'K1/00001': B1 } })
    const logs = []
    const r = createOkrskyRefresher({
      now: () => s.clock.t, random: () => 0, fetchImpl: s.fetchImpl, userAgent: 'x', log: (e, d) => logs.push({ e, ...d }), base: BASE, manifest, pollsCloseR1: R1, pollsCloseR2: R2,
      storage: { get: async () => undefined, put: async () => { throw new Error('quota') } },
    })
    expect((await r.get(17)).status).toBe(200)
    await new Promise((res) => setTimeout(res, 0))
    expect(logs.some((l) => l.e === 'okrsky-storage-put-failed')).toBe(true)
  })
})

describe('phases and cadence', () => {
  const routes = { 'K1/00001': B1, 'K1/00002': B2 }

  it('no batch for 30 min → idle, 10 min cadence (capped at the round-2 close)', async () => {
    const s = setup({ routes })
    await s.get(17)
    s.clock.t += 31 * 60_000
    const stale = await s.get(17) // due: refresh in the background, nothing new
    await s.settle()
    const r = await s.get(17)
    expect(stale.json.phase).toBe('idle') // computed from the clock at response time
    expect(r.json).toMatchObject({ phase: 'idle', nextRefreshAt: s.clock.t + 10 * 60_000, stale: false })
  })

  it('idle never sleeps past the round-2 close', async () => {
    const s = setup({ routes, now: R2 - 60 * 60_000 })
    await s.get(17)
    s.clock.t = R2 - 5 * 60_000 // 55 min without a new batch, 5 min to the round-2 close
    await s.get(17)
    await s.settle()
    expect((await s.get(17)).json).toMatchObject({ phase: 'idle', nextRefreshAt: R2 })
  })

  it('a new batch after idle turns the phase back to counting', async () => {
    const r2 = { ...routes }
    const s = setup({ routes: r2 })
    await s.get(17)
    s.clock.t += 31 * 60_000
    await s.get(17)
    await s.settle()
    r2['K1/00003'] = batch({ n: 3, generated: '2024-09-21T15:00:00', body: okrsek({ obec: 9 }) })
    s.clock.t += 11 * 60_000
    await s.get(17)
    await s.settle()
    expect((await s.get(17)).json).toMatchObject({ phase: 'counting', nextRefreshAt: s.clock.t + 60_000 })
  })

  it('after the round-2 close without any K2 batch the cadence is 60 s (waiting), not idle', async () => {
    const s = setup({ routes, now: R2 + 60_000 })
    const r = await s.get(17)
    expect(r.json.phase).toBe('waiting')
    expect(r.json.nextRefreshAt).toBe(s.clock.t + 60_000)
  })

  it('no wanted obvod in the manifest: nothing is fetched', async () => {
    const s = setup({ routes })
    const none = createOkrskyRefresher({
      now: () => s.clock.t, random: () => 0, storage: { get: async () => undefined, put: async () => {} }, fetchImpl: s.fetchImpl, userAgent: 'x', log: () => {}, base: BASE,
      manifest: { PIRATE_BACKED: [{ obvod: 20, no: 1, relation: 'endorsed' }], CANDIDATES: { '20:1': {} } }, pollsCloseR1: R1, pollsCloseR2: R2,
    })
    await none.get(20)
    expect(s.calls).toHaveLength(0)
  })
})
