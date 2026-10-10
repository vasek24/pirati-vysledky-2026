import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// okrsky-worker.js imports the Cloudflare runtime module; the Durable Object base class is a stand-in here
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env } } }))
const { OkrskyFeed, handleOkrskyRequest, readOkrskyConfig, warmOkrsky } = await import('./okrsky-worker.js')

const NOW = Date.parse('2026-10-10T14:40:00+02:00')
const JSON_BODY = '{"v":1,"obvod":30,"round":1,"refreshedAt":1,"nextRefreshAt":2,"servedAt":3,"stale":false,"phase":"counting","precincts":[]}'
const OK = { status: 200, body: JSON_BODY, cacheControl: 'public, max-age=0, s-maxage=5', stale: false, phase: 'counting' }

// minimal Cache API: keyed by URL, stores/clones Responses
function fakeCache() {
  const map = new Map()
  return {
    map,
    match: vi.fn(async (req) => map.get(req.url)?.clone()),
    put: vi.fn(async (req, res) => { map.set(req.url, res.clone()) }),
  }
}

function setup(run) {
  const cache = fakeCache()
  vi.stubGlobal('caches', { default: cache })
  const pending = []
  const ctx = { waitUntil: (p) => pending.push(p) }
  const stub = { run: vi.fn(run) }
  const env = { OKRSKY_FEED: { idFromName: vi.fn((n) => `id:${n}`), get: vi.fn(() => stub) } }
  const call = async (path, init) => {
    const res = await handleOkrskyRequest(new Request(`https://senat.test${path}`, init), env, ctx)
    await Promise.all(pending.splice(0))
    return res
  }
  return { cache, ctx, stub, env, call }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  for (const m of ['info', 'warn']) vi.spyOn(console, m).mockImplementation(() => {}) // the log lines are noise here
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readOkrskyConfig (same rules as readConfig in worker.js)', () => {
  it('defaults', () => {
    expect(readOkrskyConfig({})).toEqual({
      base: 'https://volby.gov.cz/appdata/senat/20261009',
      pollsCloseR1: Date.parse('2026-10-10T14:00:00+02:00'),
      pollsCloseR2: Date.parse('2026-10-17T14:00:00+02:00'),
    })
  })

  it('override with an offset; CSU_BASE without trailing slashes', () => {
    const c = readOkrskyConfig({ POLLS_CLOSE_R2: '2026-10-24T14:00+02:00', CSU_BASE: 'https://x.test/senat//' })
    expect(c.pollsCloseR2).toBe(Date.parse('2026-10-24T12:00:00Z'))
    expect(c.base).toBe('https://x.test/senat')
  })

  it.each(['2026-10-24', '2026-10-24T14:00:00', '2026-10-09T14:00:00+02:00', '2026-11-09T14:00:00+02:00', 'garbage'])('throws on %s', (v) => {
    expect(() => readOkrskyConfig({ POLLS_CLOSE_R2: v })).toThrow(/invalid POLLS_CLOSE_R2/)
  })
})

describe('request validation', () => {
  it.each([
    ['no obvod', '/api/senat-okrsky'],
    ['an obvod with an endorsed Pirate only', '/api/senat-okrsky?obvod=21'],
    ['a non-numeric obvod', '/api/senat-okrsky?obvod=abc'],
    ['a hex-looking obvod', '/api/senat-okrsky?obvod=0x1e'],
    ['a three-digit obvod', '/api/senat-okrsky?obvod=300'],
    ['an empty obvod', '/api/senat-okrsky?obvod='],
    ['two obvody', '/api/senat-okrsky?obvod=30,18'],
  ])('400 JSON for %s, never touches the Durable Object', async (_n, path) => {
    const s = setup(async () => OK)
    const res = await s.call(path)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-obvod' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-server-now')).toBe(String(NOW))
    expect(s.stub.run).not.toHaveBeenCalled()
  })

  it('400 for a bad round', async () => {
    const s = setup(async () => OK)
    const res = await s.call('/api/senat-okrsky?obvod=30&round=3')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-round' })
  })

  it('405 for other methods', async () => {
    const s = setup(async () => OK)
    const res = await s.call('/api/senat-okrsky?obvod=30', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(res.headers.get('x-server-now')).toBe(String(NOW))
  })

  it('the three ticket obvody are accepted (set derived from the manifest)', async () => {
    const s = setup(async () => OK)
    for (const o of [18, 30, 75]) expect((await s.call(`/api/senat-okrsky?obvod=${o}`)).status).toBe(200)
    expect(s.stub.run.mock.calls.map((c) => c[0])).toEqual([18, 30, 75])
  })
})

describe('MISS → HIT', () => {
  it('MISS: body and headers from the Durable Object, cached under the normalised key + the last-resort key', async () => {
    const s = setup(async () => OK)
    const res = await s.call('/api/senat-okrsky?obvod=30&x=random')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(JSON_BODY)
    expect(res.headers.get('x-cache')).toBe('MISS')
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=5')
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-server-now')).toBe(String(NOW))
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect([...s.cache.map.keys()].sort()).toEqual(['https://senat.test/__lastresort/api/senat-okrsky?obvod=30', 'https://senat.test/api/senat-okrsky?obvod=30'])
    expect(s.env.OKRSKY_FEED.idFromName).toHaveBeenCalledWith('okrsky')
    expect(s.stub.run).toHaveBeenCalledWith(30, undefined)
  })

  it('HIT: a repeat (even with another random query) does not reach the Durable Object; client cache-control restored', async () => {
    const s = setup(async () => OK)
    await s.call('/api/senat-okrsky?obvod=30')
    const hit = await s.call('/api/senat-okrsky?obvod=30&cb=12345')
    expect(hit.headers.get('x-cache')).toBe('HIT')
    expect(hit.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=5')
    expect(hit.headers.get('x-client-cache-control')).toBeNull()
    expect(await hit.text()).toBe(JSON_BODY)
    expect(s.stub.run).toHaveBeenCalledTimes(1)
  })

  it('round is part of the cache key and is passed on', async () => {
    const s = setup(async () => OK)
    await s.call('/api/senat-okrsky?obvod=30')
    const r2 = await s.call('/api/senat-okrsky?obvod=30&round=2')
    expect(r2.headers.get('x-cache')).toBe('MISS')
    expect(s.stub.run).toHaveBeenLastCalledWith(30, 2)
    expect(s.cache.map.has('https://senat.test/api/senat-okrsky?obvod=30&round=2')).toBe(true)
  })

  it('different obvody have different cache entries', async () => {
    const s = setup(async () => OK)
    await s.call('/api/senat-okrsky?obvod=30')
    expect((await s.call('/api/senat-okrsky?obvod=18')).headers.get('x-cache')).toBe('MISS')
  })

  it('HEAD: same status and headers, no body', async () => {
    const s = setup(async () => OK)
    const res = await s.call('/api/senat-okrsky?obvod=30', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(res.headers.get('x-cache')).toBe('MISS')
  })

  it('a zero TTL is not cached', async () => {
    const s = setup(async () => ({ ...OK, cacheControl: 'public, max-age=0, s-maxage=0' }))
    await s.call('/api/senat-okrsky?obvod=30')
    expect(s.cache.map.size).toBe(0)
  })
})

describe('failure of the Durable Object never becomes a 5xx while a copy exists', () => {
  const primed = async (run) => {
    let failing = false
    const s = setup(async (...a) => {
      if (failing) return run(...a)
      return OK
    })
    await s.call('/api/senat-okrsky?obvod=30')
    s.cache.map.delete('https://senat.test/api/senat-okrsky?obvod=30') // the main entry expired, the 20 min copy remains
    failing = true
    return s
  }

  it('an exception → LASTRESORT copy with stale:true, cached for ≤ 5 s', async () => {
    const s = await primed(async () => { throw new Error('do down') })
    const res = await s.call('/api/senat-okrsky?obvod=30')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-cache')).toBe('LASTRESORT')
    expect(res.headers.get('x-lastresort')).toBe('1')
    expect(JSON.parse(await res.text()).stale).toBe(true)
    expect(s.cache.map.get('https://senat.test/api/senat-okrsky?obvod=30').headers.get('cache-control')).toBe('public, max-age=5, s-maxage=5')
  })

  it('a 503 from the Durable Object → LASTRESORT', async () => {
    const s = await primed(async () => ({ status: 503, body: '{"error":"unavailable"}', cacheControl: 'no-store', stale: true, phase: null }))
    expect((await s.call('/api/senat-okrsky?obvod=30')).headers.get('x-cache')).toBe('LASTRESORT')
  })

  it('a hung Durable Object is cut at 13 s', async () => {
    const s = await primed(() => new Promise(() => {}))
    const pending = s.call('/api/senat-okrsky?obvod=30')
    await vi.advanceTimersByTimeAsync(13_001)
    expect((await pending).headers.get('x-cache')).toBe('LASTRESORT')
  })

  it('no copy at all → 503 JSON unavailable, no-store, nosniff, x-server-now', async () => {
    const s = setup(async () => { throw new Error('do down') })
    const res = await s.call('/api/senat-okrsky?obvod=30')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
    expect(res.headers.get('x-cache')).toBe('UNAVAILABLE')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-server-now')).toBe(String(NOW))
    expect(s.cache.map.size).toBe(0)
  })
})

describe('warmOkrsky (cron)', () => {
  it('calls the Durable Object once and logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const s = setup(async () => OK)
    await warmOkrsky(s.env)
    expect(s.stub.run).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toContain('okrsky-cron')
  })

  it('never throws, whatever the Durable Object does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = setup(async () => { throw new Error('boom') })
    await expect(warmOkrsky(s.env)).resolves.toBeUndefined()
    expect(warn.mock.calls[0][0]).toContain('okrsky-cron-failed')
    await expect(warmOkrsky({})).resolves.toBeUndefined() // even a missing binding
  })
})

describe('OkrskyFeed (Durable Object) with the real manifest', () => {
  const batch = (generated) => `<VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI="${generated}"><DAVKA DATUMVOLEB="20261009" KOLO="1" PORADI_DAVKY="1" OKRSKY_DAVKA="2" OKRSKY_CELKEM="4718" OKRSKY_ZPRAC="2"/>`
    + '<OKRSEK CIS_OBEC="532053" CIS_OKRSEK="1" CIS_OBVOD="30" PORADI_ZPRAC="1" DATUM_CAS_ZPRAC="2026-10-10T14:30:00" OPAKOVANE="0"><UCAST_OKRSEK ZAPSANI_VOLICI="800" VYDANE_OBALKY="300" ODEVZDANE_OBALKY="300" PLATNE_HLASY="290"/>'
    + '<HLASY_OKRSEK PORADOVE_CISLO="1" HLASY="10"/><HLASY_OKRSEK PORADOVE_CISLO="2" HLASY="58"/><HLASY_OKRSEK PORADOVE_CISLO="6" HLASY="100"/></OKRSEK>'
    + '<OKRSEK CIS_OBEC="999" CIS_OKRSEK="3" CIS_OBVOD="21" PORADI_ZPRAC="2" DATUM_CAS_ZPRAC="2026-10-10T14:31:00" OPAKOVANE="0"><UCAST_OKRSEK ZAPSANI_VOLICI="1" VYDANE_OBALKY="1" ODEVZDANE_OBALKY="1" PLATNE_HLASY="1"/></OKRSEK>'
    + '</VYSLEDKY_OKRSKY>'

  function makeFeed(fetchImpl, env = {}) {
    const store = new Map()
    const pending = []
    const ctx = { storage: { get: async (k) => store.get(k), put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v) } }, waitUntil: (p) => pending.push(p) }
    vi.stubGlobal('fetch', fetchImpl)
    return { feed: new OkrskyFeed(ctx, env), store, pending }
  }

  it('run(30): the Pirate candidate is ballot no 2; endorsed-only precincts are dropped; edge TTL ≤ 5 s while counting', async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith('K1/vysledky_okrsky_00001.xml')
      ? new Response(batch('2026-10-10T14:35:00'), { status: 200 })
      : new Response('<html>404</html>', { status: 404 })))
    const { feed } = makeFeed(fetchImpl)
    const out = await feed.run(30)
    expect(out).toMatchObject({ status: 200, stale: false, phase: 'counting', cacheControl: 'public, max-age=0, s-maxage=5' })
    const body = JSON.parse(out.body)
    expect(body).toMatchObject({ v: 1, obvod: 30, round: 1, pirateNo: 2, cands: [1, 2, 3, 4, 5, 6], counted: 1, batches: { 1: 1, 2: 0 } })
    expect(body.precincts).toEqual([[532053, 1, 800, 290, 10, 58, 0, 0, 0, 100]])
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://volby.gov.cz/appdata/senat/20261009/odata/okrsky/K1/vysledky_okrsky_00001.xml',
      'https://volby.gov.cz/appdata/senat/20261009/odata/okrsky/K1/vysledky_okrsky_00002.xml',
    ])
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/^pirati-senat-zaloha\/0\.1 \(backup mirror/)
  })

  it('run(21) is refused: no precinct map for an endorsed-only obvod', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 404 }))
    const { feed } = makeFeed(fetchImpl)
    expect(await feed.run(21)).toMatchObject({ status: 400, cacheControl: 'no-store' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('upstream down at cold start → 503 no-store (the handler turns it into the last-resort path)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { feed } = makeFeed(vi.fn(async () => new Response('no', { status: 500 })))
    expect(await feed.run(30)).toMatchObject({ status: 503, cacheControl: 'no-store' })
  })

  it('before the round-1 close the Durable Object fetches nothing', async () => {
    vi.setSystemTime(Date.parse('2026-10-10T13:00:00+02:00'))
    const fetchImpl = vi.fn(async () => new Response('x', { status: 404 }))
    const { feed } = makeFeed(fetchImpl)
    const out = await feed.run(30)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(JSON.parse(out.body)).toMatchObject({ phase: 'waiting', counted: 0 })
  })

  it('an invalid POLLS_CLOSE_R2 makes the constructor throw (isolated: only the map fails)', () => {
    expect(() => makeFeed(vi.fn(), { POLLS_CLOSE_R2: '2026-10-24' })).toThrow(/invalid POLLS_CLOSE_R2/)
  })
})
