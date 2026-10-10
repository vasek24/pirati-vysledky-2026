import { describe, it, expect } from 'vitest'
import {
  parseCsuTime,
  percentile,
  missRatio,
  buildSample,
  createFeedState,
  stepFeed,
  formatSampleLine,
  formatHeader,
} from './watch-core.mjs'

const T0 = Date.parse('2026-10-10T18:00:00+02:00')

// Sample factory: a healthy counting feed, overridable per cycle.
function sample(over = {}, now = T0) {
  return {
    now,
    ok: true,
    status: 200,
    error: null,
    latencyMs: 120,
    invalid: false,
    missingMeta: [],
    serverNow: now,
    xCache: 'HIT',
    phase: 'counting',
    counted: 100,
    total: 1120,
    dataAgeS: 60,
    refreshAgeS: 20,
    nextInS: 40,
    nextRefreshAt: now + 40000,
    stale: false,
    complete: true,
    ...over,
  }
}

// Run cycles through the state machine; returns alerts per cycle.
function run(overs, state = createFeedState()) {
  return overs.map((o, i) => stepFeed(state, sample(o, T0 + i * 30000), T0 + i * 30000))
}
const kinds = (alerts) => alerts.map((a) => `${a.kind} ${a.rule}`)

describe('parseCsuTime', () => {
  it('treats a zone-less string as Prague CEST (+02:00)', () => {
    expect(parseCsuTime('2026-10-08T16:39:24')).toBe(Date.parse('2026-10-08T14:39:24Z'))
  })
  it('gives the same instant regardless of process TZ', () => {
    const original = process.env.TZ
    try {
      const out = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Prague'].map((tz) => {
        process.env.TZ = tz
        return parseCsuTime('2026-10-08T16:39:24')
      })
      expect(new Set(out).size).toBe(1)
      expect(out[0]).toBe(1791470364000)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
  it('respects an explicit offset or Z and rejects garbage', () => {
    expect(parseCsuTime('2026-10-08T14:39:24Z')).toBe(1791470364000)
    expect(parseCsuTime('2026-10-08T16:39:24+02:00')).toBe(1791470364000)
    expect(parseCsuTime('nonsense')).toBeNull()
    expect(parseCsuTime(undefined)).toBeNull()
  })
})

describe('window helpers', () => {
  it('percentile uses nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([], 95)).toBeNull()
  })
  it('missRatio counts MISS among known x-cache values only', () => {
    expect(missRatio(['HIT', 'MISS', 'MISS', null])).toEqual({ ratio: 2 / 3, n: 3 })
    expect(missRatio([])).toEqual({ ratio: 0, n: 0 })
  })
})

describe('buildSample', () => {
  const body = {
    refreshedAt: T0 - 20000,
    firstSeenAt: T0 - 999000,
    nextRefreshAt: T0 + 40000,
    servedAt: T0,
    stale: false,
    complete: true,
    refreshing: false,
    generated: '2026-10-10T17:59:00',
    phase: 'counting',
    precincts: { total: 1120, counted: 100, pct: 8.9 },
  }
  const headers = () => new Headers({ 'x-cache': 'HIT', 'x-server-now': String(T0) })

  it('derives ages and flags from a healthy response', () => {
    const s = buildSample({ status: 200, headers: headers(), text: JSON.stringify(body), latencyMs: 90, now: T0 })
    expect(s).toMatchObject({
      ok: true, invalid: false, missingMeta: [], phase: 'counting', counted: 100, total: 1120,
      dataAgeS: 60, refreshAgeS: 20, nextInS: 40, stale: false, complete: true, xCache: 'HIT', serverNow: T0,
    })
  })
  it('flags invalid JSON', () => {
    const s = buildSample({ status: 200, headers: headers(), text: '<html>', latencyMs: 5, now: T0 })
    expect(s.invalid).toBe(true)
  })
  it('lists missing meta fields and missing x-server-now', () => {
    const { stale: _s, nextRefreshAt: _n, ...rest } = body
    const s = buildSample({ status: 200, headers: new Headers(), text: JSON.stringify(rest), latencyMs: 5, now: T0 })
    expect(s.missingMeta).toEqual(['nextRefreshAt', 'stale'])
    expect(s.serverNow).toBeNull()
  })
  it('keeps error / non-200 as not ok', () => {
    expect(buildSample({ status: 503, headers: new Headers(), text: '', latencyMs: 5, now: T0 }).ok).toBe(false)
    const e = buildSample({ error: 'timeout', latencyMs: 10000, now: T0 })
    expect(e).toMatchObject({ ok: false, status: null, error: 'timeout' })
  })
})

describe('alert state machine', () => {
  it('stays silent for a healthy feed', () => {
    expect(run([{}, {}, {}, {}]).flat()).toEqual([])
  })

  it('stale: alerts on the 3rd consecutive stale cycle, once, then resolves', () => {
    const r = run([{ stale: true }, { stale: true }, { stale: true }, { stale: true }, { stale: false }, { stale: false }])
    expect(r.map(kinds)).toEqual([[], [], ['ALERT stale'], [], ['RESOLVED stale'], []])
  })

  it('stale streak resets when a fresh cycle intervenes', () => {
    const r = run([{ stale: true }, { stale: true }, { stale: false }, { stale: true }, { stale: true }])
    expect(r.flat()).toEqual([])
  })

  it('overdue: only in waiting/counting and only beyond 90 s', () => {
    const late = (s) => ({ nextRefreshAt: T0 - s * 1000 })
    const state = createFeedState()
    const a = stepFeed(state, sample({ ...late(89) }), T0)
    const b = stepFeed(state, sample({ ...late(91), nextInS: -91 }), T0)
    const c = stepFeed(state, sample({ ...late(300), nextInS: -300 }), T0)
    const d = stepFeed(state, sample({ nextRefreshAt: T0 + 40000 }), T0)
    expect([a, b, c, d].map(kinds)).toEqual([[], ['ALERT overdue'], [], ['RESOLVED overdue']])
    const pre = stepFeed(createFeedState(), sample({ phase: 'pre', ...late(900), nextInS: -900 }), T0)
    expect(pre).toEqual([])
  })

  it('data-age: > 180 s while counting, reports both ages, ignored in pre', () => {
    const state = createFeedState()
    const a = stepFeed(state, sample({ dataAgeS: 181, refreshAgeS: 25 }), T0)
    expect(kinds(a)).toEqual(['ALERT data-age'])
    expect(a[0].detail).toContain('181')
    expect(a[0].detail).toContain('25')
    expect(kinds(stepFeed(state, sample({ dataAgeS: 70 }), T0))).toEqual(['RESOLVED data-age'])
    expect(stepFeed(createFeedState(), sample({ phase: 'pre', dataAgeS: 99999 }), T0)).toEqual([])
    expect(stepFeed(createFeedState(), sample({ phase: 'final', dataAgeS: 99999 }), T0)).toEqual([])
  })

  it('counted regression fires once and clears next cycle', () => {
    const r = run([{ counted: 100 }, { counted: 120 }, { counted: 110 }, { counted: 110 }, { counted: 130 }])
    expect(r.map(kinds)).toEqual([[], [], ['ALERT counted-regression'], ['RESOLVED counted-regression'], []])
    expect(r[2][0].detail).toContain('120')
    expect(r[2][0].detail).toContain('110')
  })

  it('phase regression fires once and clears next cycle', () => {
    const r = run([{ phase: 'counting' }, { phase: 'final' }, { phase: 'counting' }, { phase: 'counting' }])
    expect(r.map(kinds)).toEqual([[], [], ['ALERT phase-regression'], ['RESOLVED phase-regression']])
  })

  it('incomplete', () => {
    const r = run([{ complete: false }, { complete: false }, { complete: true }])
    expect(r.map(kinds)).toEqual([['ALERT incomplete'], [], ['RESOLVED incomplete']])
  })

  it('http: non-200 and fetch errors, without spamming; data rules stay quiet', () => {
    const down = { ok: false, status: 503, phase: null, counted: null, total: null, stale: null, complete: null, nextRefreshAt: null, dataAgeS: null }
    const r = run([{}, down, down, { ok: false, status: null, error: 'timeout', phase: null, counted: null, total: null, stale: null, complete: null, nextRefreshAt: null, dataAgeS: null }, {}])
    expect(r.map(kinds)).toEqual([[], ['ALERT http'], [], [], ['RESOLVED http']])
  })

  it('does not report a counted regression across an outage', () => {
    const down = { ok: false, status: 502, phase: null, counted: null, total: null, stale: null, complete: null, nextRefreshAt: null, dataAgeS: null }
    const r = run([{ counted: 100 }, down, { counted: 100 }])
    expect(r.flat().map((a) => a.rule)).toEqual(['http', 'http'])
  })

  it('bad-response: invalid JSON or missing meta; no-server-now', () => {
    const r = run([{ invalid: true }, { invalid: false, missingMeta: ['stale'] }, {}, { serverNow: null }, {}])
    expect(r.map(kinds)).toEqual([
      ['ALERT bad-response'],
      [],
      ['RESOLVED bad-response'],
      ['ALERT no-server-now'],
      ['RESOLVED no-server-now'],
    ])
  })

  it('latency p95 over the last 10 cycles > 1500 ms', () => {
    const fast = Array(8).fill({ latencyMs: 100 })
    const r = run([...fast, { latencyMs: 2000 }, { latencyMs: 100 }])
    expect(r.flat().map((a) => `${a.kind} ${a.rule}`)).toEqual(['ALERT latency-p95'])
    // the slow sample ages out of the 10-cycle window -> resolves
    const state = createFeedState()
    const all = run([...fast, { latencyMs: 2000 }, ...Array(10).fill({ latencyMs: 100 })], state).flat()
    expect(all.map((a) => `${a.kind} ${a.rule}`)).toEqual(['ALERT latency-p95', 'RESOLVED latency-p95'])
  })

  it('x-cache MISS ratio > 50 % over the last 10 cycles', () => {
    const hits = Array(5).fill({ xCache: 'HIT' })
    const r = run([...hits, ...Array(5).fill({ xCache: 'MISS' }), { xCache: 'MISS' }])
    // 5 HIT + 5 MISS = exactly 50 % (not >), 6th MISS tips it over.
    expect(r.map(kinds).flat()).toEqual(['ALERT miss-ratio'])
    expect(r[10].length).toBe(1)
  })

  it('MISS ratio needs a minimum sample before alerting', () => {
    expect(run([{ xCache: 'MISS' }, { xCache: 'MISS' }]).flat()).toEqual([])
  })
})

describe('formatting', () => {
  it('one-line sample format (snapshot)', () => {
    const line = formatSampleLine('554782', sample({ counted: 120, nextInS: -95, dataAgeS: 75, refreshAgeS: 20, xCache: 'MISS', latencyMs: 134.4 }))
    expect(line).toBe('554782 phase=counting 120/1120 age=75s ref=20s next=-95s stale=n complete=y MISS 200 134ms')
  })
  it('positive next gets a plus sign; failures are compact', () => {
    expect(formatSampleLine('500119', sample())).toBe('500119 phase=counting 100/1120 age=60s ref=20s next=+40s stale=n complete=y HIT 200 120ms')
    expect(formatSampleLine('500119', sample({ ok: false, status: 503, error: null, latencyMs: 40 }))).toBe('500119 FAIL status=503 error=- 40ms')
    expect(formatSampleLine('500119', sample({ ok: false, status: null, error: 'timeout', latencyMs: 10000 }))).toBe('500119 FAIL status=- error=timeout 10000ms')
  })
  it('header line (snapshot)', () => {
    expect(formatHeader({ now: T0, cycle: 3, feeds: 12, ok: 11, alerting: 1, counted: 120, total: 1120 })).toBe(
      '== 2026-10-10T16:00:00Z cycle 3 | feeds ok 11/12 | alerting 1 | Praha 120/1120 ==',
    )
  })
})
