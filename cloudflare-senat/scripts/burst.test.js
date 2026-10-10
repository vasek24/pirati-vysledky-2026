import { describe, expect, it } from 'vitest'
import { HARD_CAP_RPS, burst, checkTarget, percentile, summarize } from './burst.mjs'

describe('burst guards and statistics', () => {
  it('accepts only *.workers.dev (and adds the API path); --i-know lifts that, never for volby.gov.cz', () => {
    expect(checkTarget('https://pirati-senat-zaloha-staging.vasek24.workers.dev').pathname).toBe('/api/senat')
    expect(checkTarget('https://x.workers.dev/healthz').pathname).toBe('/healthz')
    expect(() => checkTarget('https://senat.dg12.cz')).toThrow(/refusing senat\.dg12\.cz/)
    expect(checkTarget('https://senat.dg12.cz', { iKnow: true }).hostname).toBe('senat.dg12.cz')
    expect(() => checkTarget('https://volby.gov.cz/appdata/senat/20261009/odata/vysledky.xml', { iKnow: true })).toThrow(/never load the upstream/)
  })
  it('nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1)
    expect([percentile(v, 50), percentile(v, 95), percentile(v, 99), percentile(v, 100)]).toEqual([50, 95, 99, 100])
    expect(percentile([], 50)).toBeNull()
    expect(percentile([7], 99)).toBe(7)
  })
  it('summarize counts statuses, x-cache and errors', () => {
    const s = summarize([
      { status: 200, ms: 10, xcache: 'HIT' }, { status: 200, ms: 20, xcache: 'MISS' }, { status: 503, ms: 30 }, { status: 'ERR', ms: 99 },
    ], 2)
    expect(s).toMatchObject({ requests: 4, rps: 2, status: { 200: 2, 503: 1, ERR: 1 }, xCache: { HIT: 1, MISS: 1, '-': 2 }, errorRate: 0.5 })
    expect(s.ms.max).toBe(30) // ERR is not a latency sample
  })
  it('never exceeds the request-rate cap, whatever is asked', async () => {
    let n = 0
    const fetchImpl = async () => { n++; return new Response('{}', { headers: { 'x-cache': 'HIT' } }) }
    const t0 = Date.now()
    const { rps } = await burst({ url: 'https://x.workers.dev/api/senat', concurrency: 500, seconds: 1, maxRps: 100000, fetchImpl })
    const elapsed = (Date.now() - t0) / 1000
    expect(rps).toBe(HARD_CAP_RPS)
    expect(n / elapsed).toBeLessThanOrEqual(HARD_CAP_RPS * 1.25)
  })
})
