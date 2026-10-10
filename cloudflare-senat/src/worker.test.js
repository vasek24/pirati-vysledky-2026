import { describe, expect, it, vi } from 'vitest'

// worker.js imports the Cloudflare runtime module; only readConfig and the stateless routes are exercised here
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))
const { default: worker, readConfig, withServerNow } = await import('./worker.js')

const R1 = Date.parse('2026-10-10T14:00:00+02:00')

describe('readConfig: POLLS_CLOSE_R2 override (M2)', () => {
  it('no override: the default 2026-10-17T14:00+02:00 and the default base', () => {
    const c = readConfig({})
    expect(c.pollsCloseR1).toBe(R1)
    expect(c.pollsCloseR2).toBe(Date.parse('2026-10-17T14:00:00+02:00'))
    expect(c.base).toBe('https://volby.gov.cz/appdata/senat/20261009')
    expect(readConfig({ POLLS_CLOSE_R2: '' }).pollsCloseR2).toBe(c.pollsCloseR2) // empty = unset
  })

  it.each([
    ['2026-10-24T14:00:00+02:00', Date.parse('2026-10-24T12:00:00Z')],
    ['2026-10-24T14:00+02:00', Date.parse('2026-10-24T12:00:00Z')],
    ['2026-10-24T12:00:00+00:00', Date.parse('2026-10-24T12:00:00Z')],
    ['2026-10-24T09:00:00-03:00', Date.parse('2026-10-24T12:00:00Z')],
  ])('valid with offset: %s', (value, ms) => {
    expect(readConfig({ POLLS_CLOSE_R2: value }).pollsCloseR2).toBe(ms)
  })

  it.each([
    ['a date only (would open the gate at 02:00 CEST)', '2026-10-24'],
    ['no offset (read as UTC)', '2026-10-24T14:00'],
    ['no offset, with seconds', '2026-10-24T14:00:00'],
    ['Z instead of an offset', '2026-10-24T14:00:00Z'],
    ['an offset without a colon', '2026-10-24T14:00:00+0200'],
    ['a space instead of T', '2026-10-24 14:00:00+02:00'],
    ['an impossible month', '2026-13-24T14:00:00+02:00'],
    ['garbage', 'next saturday'],
    ['earlier than R1', '2026-10-09T14:00:00+02:00'],
    ['equal to R1', '2026-10-10T14:00:00+02:00'],
    ['30 days or more after R1', '2026-11-09T14:00:00+02:00'],
    ['a year later', '2027-10-17T14:00:00+02:00'],
  ])('throws on %s', (_name, value) => {
    expect(() => readConfig({ POLLS_CLOSE_R2: value })).toThrow(/invalid POLLS_CLOSE_R2/)
  })

  it('29 days after R1 is still allowed', () => {
    expect(readConfig({ POLLS_CLOSE_R2: '2026-11-08T14:00:00+01:00' }).pollsCloseR2).toBe(Date.parse('2026-11-08T14:00:00+01:00'))
  })

  it('CSU_BASE is trimmed of trailing slashes', () => {
    expect(readConfig({ CSU_BASE: 'https://x.test/senat//' }).base).toBe('https://x.test/senat')
  })
})

describe('x-server-now on every reply (§2)', () => {
  const NOW = Date.parse('2026-10-10T16:00:00Z')
  // assets answer with immutable headers, as the real ASSETS binding does
  const frozen = (res) => {
    for (const m of ['set', 'append', 'delete']) {
      res.headers[m] = () => {
        throw new TypeError('immutable')
      }
    }
    return res
  }
  const env = {
    ASSETS: {
      fetch: vi.fn(async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname === '/') return frozen(new Response('<html></html>', { status: 200, headers: { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'text/html' } }))
        return frozen(new Response('nope', { status: 404, headers: { 'Cache-Control': 'no-store' } }))
      }),
    },
  }
  const call = (path, init) => worker.fetch(new Request(`https://senat.test${path}`, init), env, { waitUntil() {} })

  it.each([
    ['405 on the API', '/api/senat', { method: 'POST' }, 405],
    ['/healthz', '/healthz', undefined, 200],
    ['an asset', '/', undefined, 200],
    ['a 404 from the assets', '/missing', undefined, 404],
  ])('%s', async (_name, path, init, status) => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    try {
      const res = await call(path, init)
      expect(res.status).toBe(status)
      expect(res.headers.get('x-server-now')).toBe(String(NOW))
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['405 on the API', '/api/senat', { method: 'POST' }],
    ['/healthz', '/healthz', undefined],
  ])('%s carries X-Content-Type-Options: nosniff', async (_n, path, init) => {
    const res = await call(path, init)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('asset replies keep the body, status and cache headers', async () => {
    const res = await call('/')
    expect(await res.text()).toBe('<html></html>')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(res.headers.get('content-type')).toBe('text/html')
    const nf = await call('/missing')
    expect(nf.status).toBe(404)
    expect(nf.headers.get('cache-control')).toBe('no-store')
  })

  it('withServerNow does not mutate the original response', () => {
    const orig = new Response('x', { status: 200 })
    const out = withServerNow(orig)
    expect(out.headers.has('x-server-now')).toBe(true)
    expect(orig.headers.has('x-server-now')).toBe(false)
  })
})
