import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { MAX_BODY_BYTES, USER_AGENT, createSenatFeed } from './feed.js'

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const FROZEN = read('se2026-frozen.xml')
// stamped before the closes in the source file: re-stamp after R2 so the close-of-polls gates let it through
const FINAL_2024 = read('se2024-final.xml').replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-18T10:00:00"')
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-17T14:00:00+02:00')
const AFTER = R2 + 86_400_000
const BASE = 'https://csu.test/senat'

const xml = (body, headers = {}) => () => Promise.resolve(new Response(body, { status: 200, headers }))
const status = (code) => () => Promise.resolve(new Response(null, { status: code }))

function mkFeed(fetchImpl, over = {}) {
  return createSenatFeed({
    baseUrl: BASE, fetchImpl, manifest, now: () => AFTER, pollsCloseR1: R1, pollsCloseR2: R2, ...over,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('200', () => {
  it('parses, normalises and derives the frozen 2026 file; returns validators and fetchId', async () => {
    const fetchImpl = vi.fn(xml(FROZEN, { ETag: '"abc"', 'Last-Modified': 'Thu, 08 Oct 2026 14:40:15 GMT' }))
    const out = await mkFeed(fetchImpl).build({})
    expect(out.fetchId).toBe(1)
    expect(out.validators).toEqual({ etag: '"abc"', lastModified: 'Thu, 08 Oct 2026 14:40:15 GMT' })
    expect(out.snapshot).toMatchObject({ v: 1, kind: 'senat', round: 1 })
    expect(out.snapshot.obvody).toHaveLength(27)
    expect(out.snapshot.summary).toMatchObject({ decided: 0, waiting: 27 })
    expect(out.snapshot.summary.pirates.total).toBe(18)
    expect(out.snapshot.warnings).toEqual([])
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/odata/vysledky.xml`)
  })

  it('the 2024 final file (round 2) goes through with the clock after both gates', async () => {
    const out = await mkFeed(xml(FINAL_2024)).build({})
    expect(out.snapshot.round).toBe(2)
    expect(out.snapshot.summary.decided).toBe(27)
  })

  it('uses the injected clock for the close-of-polls gates', async () => {
    const out = await mkFeed(xml(FINAL_2024), { now: () => R1 + 3_600_000 }).build({})
    expect(out.snapshot.round).toBe(1)
    expect(out.snapshot.warnings).toContain('r2-data-suppressed')
  })

  it('missing ETag / Last-Modified headers give nulls', async () => {
    const out = await mkFeed(xml(FROZEN)).build({})
    expect(out.validators).toEqual({ etag: null, lastModified: null })
  })
})

describe('request headers', () => {
  it('always sends User-Agent and Accept; no conditional headers without validators', async () => {
    const fetchImpl = vi.fn(xml(FROZEN))
    await mkFeed(fetchImpl).build({})
    const { headers } = fetchImpl.mock.calls[0][1]
    expect(headers).toEqual({ 'User-Agent': USER_AGENT, Accept: 'application/xml' })
    expect(USER_AGENT).toBe('pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)')
  })

  it('sends If-None-Match and If-Modified-Since from the given validators', async () => {
    const fetchImpl = vi.fn(xml(FROZEN))
    await mkFeed(fetchImpl).build({ validators: { etag: '"abc"', lastModified: 'Thu, 08 Oct 2026 14:40:15 GMT' } })
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      'If-None-Match': '"abc"', 'If-Modified-Since': 'Thu, 08 Oct 2026 14:40:15 GMT',
    })
  })

  it('sends only the validator that exists; empty validators send none', async () => {
    const fetchImpl = vi.fn(xml(FROZEN))
    const feed = mkFeed(fetchImpl)
    await feed.build({ validators: { etag: '"x"', lastModified: null } })
    await feed.build({ validators: { etag: null, lastModified: null } })
    const [a, b] = fetchImpl.mock.calls.map((c) => c[1].headers)
    expect(a['If-None-Match']).toBe('"x"')
    expect(a).not.toHaveProperty('If-Modified-Since')
    expect(b).not.toHaveProperty('If-None-Match')
    expect(b).not.toHaveProperty('If-Modified-Since')
  })

  it('uses a custom user agent when given', async () => {
    const fetchImpl = vi.fn(xml(FROZEN))
    await mkFeed(fetchImpl, { userAgent: 'test-agent' }).build({})
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('test-agent')
  })
})

describe('304', () => {
  it('returns { notModified: true } without parsing', async () => {
    const out = await mkFeed(status(304)).build({ validators: { etag: '"abc"', lastModified: null } })
    expect(out).toEqual({ notModified: true })
  })
})

describe('failures', () => {
  it('HTTP 500 throws with the status', async () => {
    await expect(mkFeed(status(500)).build({})).rejects.toThrow(/HTTP 500/)
  })

  it('HTTP 404 throws too', async () => {
    await expect(mkFeed(status(404)).build({})).rejects.toThrow(/HTTP 404/)
  })

  it.each([
    ['garbage', 'not xml at all <<<'],
    ['empty', ''],
    ['CHYBA', '<CHYBA POPIS="x"/>'],
  ])('a 200 with %s body throws an XML error', async (_name, body) => {
    await expect(mkFeed(xml(body)).build({})).rejects.toThrow(/XML unusable/)
  })

  it('a fetch that rejects throws a clear error', async () => {
    const feed = mkFeed(() => Promise.reject(new Error('connection reset')))
    await expect(feed.build({})).rejects.toThrow(/upstream request failed: connection reset/)
  })

  // fetch that never answers on its own but honours the abort signal
  const hanging = () => (_url, { signal }) => new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

  it('times out after 8 s', async () => {
    const result = mkFeed(hanging()).build({}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(7_999)
    let settled = false
    result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await result
    expect(error.message).toMatch(/upstream request failed: timeout 8000 ms/)
  })

  it("the caller's signal aborts the request earlier", async () => {
    const ac = new AbortController()
    const result = mkFeed(hanging()).build({ signal: ac.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    ac.abort(new Error('deadline'))
    expect((await result).message).toMatch(/upstream request failed: deadline/)
  })

  it('an already aborted caller signal fails at once', async () => {
    const ac = new AbortController()
    ac.abort(new Error('gone'))
    await expect(mkFeed(hanging()).build({ signal: ac.signal })).rejects.toThrow(/gone/)
  })
})

describe('fetchId', () => {
  it('counts HTTP 200 responses only (not 304, not errors), per instance', async () => {
    const replies = [
      () => new Response(FROZEN, { status: 200, headers: { ETag: '"same"' } }),
      () => new Response(null, { status: 304 }),
      () => new Response(null, { status: 500 }),
      () => new Response(FROZEN, { status: 200, headers: { ETag: '"same"' } }),
    ]
    let i = 0
    const feed = mkFeed(() => Promise.resolve(replies[i++]()))
    expect((await feed.build({})).fetchId).toBe(1)
    expect(await feed.build({ validators: { etag: '"same"' } })).toEqual({ notModified: true })
    await expect(feed.build({})).rejects.toThrow()
    const again = await feed.build({})
    expect(again.fetchId).toBe(2) // a repeated identical ETag still gives a new id
    expect(again.validators.etag).toBe('"same"')
    // another instance starts from zero
    expect((await mkFeed(xml(FROZEN)).build({})).fetchId).toBe(1)
  })

  it('an unusable 200 body still counts as a 200 fetch', async () => {
    let body = 'garbage'
    const feed = mkFeed(() => Promise.resolve(new Response(body, { status: 200 })))
    await expect(feed.build({})).rejects.toThrow()
    body = FROZEN
    expect((await feed.build({})).fetchId).toBe(2)
  })
})

describe('L4: body size cap and body cancel', () => {
  // a body of `chunks` x `size` bytes that reports whether it was cancelled
  function stream(chunks, size, init = {}) {
    const state = { cancelled: false, pulled: 0 }
    const body = new ReadableStream({
      pull(controller) {
        if (state.pulled >= chunks) return controller.close()
        state.pulled += 1
        controller.enqueue(new Uint8Array(size).fill(32))
      },
      cancel() {
        state.cancelled = true
      },
    })
    return { state, res: () => Promise.resolve(new Response(body, { status: 200, ...init })) }
  }

  it('a declared content-length above 5 MB is rejected without reading the body', async () => {
    const { state, res } = stream(1, 10, { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })
    await expect(mkFeed(res).build({})).rejects.toThrow(/response larger than 5000000 bytes/)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.pulled).toBeLessThanOrEqual(1) // the stream's own start-up prefetch, never a read
    expect(state.cancelled).toBe(true)
  })

  it('a streamed body above 5 MB (no or false content-length) is rejected and cancelled', async () => {
    const { state, res } = stream(12, 1_000_000)
    await expect(mkFeed(res).build({})).rejects.toThrow(/upstream request failed: response larger than 5000000 bytes/)
    expect(state.cancelled).toBe(true)
    expect(state.pulled).toBeLessThan(9) // stopped soon after the cap, not read to the end
    const lying = stream(12, 1_000_000, { headers: { 'content-length': '100' } })
    await expect(mkFeed(lying.res).build({})).rejects.toThrow(/larger than/)
    expect(lying.state.cancelled).toBe(true)
  })

  it('a rejected oversize body is not counted as a 200 fetch', async () => {
    let big = true
    const feed = mkFeed(() => (big ? stream(12, 1_000_000).res() : Promise.resolve(new Response(FROZEN, { status: 200 }))))
    await expect(feed.build({})).rejects.toThrow()
    big = false
    expect((await feed.build({})).fetchId).toBe(1)
  })

  it('a body just under the cap is read in full (multi-chunk UTF-8 is decoded correctly)', async () => {
    const out = await mkFeed(xml(FROZEN.replace('Cheb', 'Chěb'))).build({})
    expect(out.snapshot.obvody.find((o) => o.n === 3).name).toBe('Chěb')
    const chunked = new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(FROZEN.replace('Cheb', 'Chěb'))
        const cut = bytes.indexOf(0xc4) + 1 // splits the two-byte "ě" between chunks
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      },
    })
    const split = await mkFeed(() => Promise.resolve(new Response(chunked, { status: 200 }))).build({})
    expect(split.snapshot.obvody.find((o) => o.n === 3).name).toBe('Chěb')
  })

  it.each([500, 404, 304])('a %i response body is cancelled, never read', async (code) => {
    const state = { cancelled: false, pulled: 0 }
    const body = new ReadableStream({ pull() { state.pulled += 1 }, cancel() { state.cancelled = true } })
    const feed = mkFeed(() => Promise.resolve(new Response(code === 304 ? null : body, { status: code })))
    const p = feed.build({ validators: { etag: '"x"' } })
    if (code === 304) expect(await p).toEqual({ notModified: true })
    else await expect(p).rejects.toThrow(`HTTP ${code}`)
    await vi.advanceTimersByTimeAsync(0)
    if (code !== 304) expect(state.cancelled).toBe(true)
    expect(state.pulled).toBeLessThanOrEqual(1) // the stream's own start-up pull at most, never a read
  })
})

describe('L6: suppressedByClock', () => {
  it('a file generated after R2 and fetched by a clock before R2 is flagged; the snapshot stays unflagged JSON', async () => {
    const out = await mkFeed(xml(FINAL_2024), { now: () => R1 + 3_600_000 }).build({})
    expect(out.suppressedByClock).toBe(true)
    expect(JSON.stringify(out.snapshot)).not.toContain('suppressedByClock')
  })

  it('a correct clock, or a really pre-close file, is not flagged', async () => {
    expect((await mkFeed(xml(FINAL_2024)).build({})).suppressedByClock).toBe(false)
    expect((await mkFeed(xml(FROZEN)).build({})).suppressedByClock).toBe(false)
    const preClose = read('se2024-final.xml') // stamped 2026-09-14
    expect((await mkFeed(xml(preClose)).build({})).suppressedByClock).toBe(false)
  })
})

describe('invalidate', () => {
  it('exists and is harmless (validators live with the good snapshot, not in the feed)', () => {
    expect(() => mkFeed(xml(FROZEN)).invalidate()).not.toThrow()
  })
})
