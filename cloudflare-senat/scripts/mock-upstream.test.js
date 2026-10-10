import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from '../src/manifest.js'
import { parseResultsXml } from '../src/xml.js'
import { normalize } from '../src/normalize.js'
import { derive } from '../src/derive.js'
import { phaseOfSnapshot } from '../src/refresh.js'
import { validateCandidate } from '../src/validate.js'
import { parsePragueTime } from '../src/time.js'
import {
  STAGES, apportion, buildScenario, createMock, expectOf, mulberry32, pragueLocal, renderXml, stageModel, truncPct,
} from './mock-upstream.mjs'

const FROZEN = readFileSync(new URL('../fixtures/se2026-frozen.xml', import.meta.url), 'utf8')
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-10T14:00:01+02:00') // drill override, see drill.mjs
const scenario = buildScenario(FROZEN, 2026)
// stage i is "generated" i minutes after the close, fetched 1 s later: both gates are open
const stamp = (i) => R1 + (i + 10) * 60000
const snapshot = (stage, i, sc = scenario) => {
  const xml = renderXml(sc, stageModel(sc, stage), pragueLocal(stamp(i)))
  return derive(normalize(parseResultsXml(xml), { manifest, now: stamp(i) + 1000, pollsCloseR1: R1, pollsCloseR2: R2 }))
}

describe('helpers', () => {
  it('apportion sums exactly and is proportional', () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33])
    const r = apportion(12345, [0.2, 0.5, 0.3])
    expect(r.reduce((a, b) => a + b, 0)).toBe(12345)
  })
  it('truncPct truncates (ČSÚ), it does not round', () => {
    expect(truncPct(4221, 21611)).toBe('19.53')
    expect(truncPct(5043, 21611)).toBe('23.33') // 23.335 rounds to 23.34
    expect(truncPct(2269, 21611)).toBe('10.49') // 10.4993 rounds to 10.50
    expect(truncPct(1, 0)).toBe('0.00')
    expect(truncPct(1, 3)).toBe('33.33')
  })
  it('pragueLocal is zone-less Prague time and round-trips through parsePragueTime', () => {
    expect(pragueLocal(Date.parse('2026-10-10T12:00:00Z'))).toBe('2026-10-10T14:00:00')
    expect(pragueLocal(Date.parse('2026-12-01T12:00:00Z'))).toBe('2026-12-01T13:00:00')
    const t = Date.parse('2026-10-10T12:34:56Z')
    expect(parsePragueTime(pragueLocal(t))).toBe(t)
  })
  it('the RNG is deterministic', () => {
    expect(mulberry32(7)()).toBe(mulberry32(7)())
    expect(mulberry32(7)()).not.toBe(mulberry32(8)())
  })
})

describe('stage generator', () => {
  it('frozen stage reproduces the real fixture byte for byte (only the stamp is ours)', () => {
    const own = FROZEN.match(/DATUM_CAS_GENEROVANI="([^"]*)"/)[1]
    expect(renderXml(scenario, stageModel(scenario, 'frozen'), own)).toBe(FROZEN)
  })

  it.each(STAGES)('%s: parses, normalises without warnings and derives what the model says', (stage) => {
    const i = STAGES.indexOf(stage)
    const s = snapshot(stage, i)
    const exp = expectOf(stageModel(scenario, stage))
    expect(s.warnings).toEqual([])
    expect(s.summary).toMatchObject(exp.summary)
    expect(s.round).toBe(exp.round)
    expect(phaseOfSnapshot(s)).toBe(exp.phase)
    expect(Object.fromEntries(s.obvody.map((o) => [o.n, o.state]))).toEqual(exp.states)
    expect(s.summary.pirates.total).toBe(18)
    for (const [k, v] of Object.entries(exp.pirates.official)) expect(s.summary.pirates.byStatus[k]).toBe(v)
    const unofficial = Object.entries(s.summary.pirates.byStatus).filter(([k]) => !(k in exp.pirates.official)).reduce((a, [, v]) => a + v, 0)
    expect(unofficial).toBe(exp.pirates.unofficial)
  })

  it('every stage keeps Σ votes = PLATNE_HLASY and precincts <= total, envelopes ordered', () => {
    for (const stage of STAGES) {
      const model = stageModel(scenario, stage)
      for (const o of model.obvody) {
        const check = (u, votes) => {
          expect(votes.reduce((a, b) => a + b, 0)).toBe(u.platne)
          expect(u.okrskyZprac).toBeLessThanOrEqual(u.okrskyCelkem)
          expect(u.platne).toBeLessThanOrEqual(u.odevzdane)
          expect(u.odevzdane).toBeLessThanOrEqual(u.vydane)
          expect(u.vydane).toBeLessThanOrEqual(u.zapsani)
        }
        check(o.u1, o.candidates.map((c) => c.votes1))
        if (o.u2) check(o.u2, o.candidates.filter((c) => c.votes2 !== null).map((c) => c.votes2))
      }
      expect(model.country[1].okrskyCelkem).toBe(5021) // as in the real fixture
    }
  })

  it('stages are monotone: precincts, votes and official flags never go backwards', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const a = stageModel(scenario, STAGES[i - 1])
      const b = stageModel(scenario, STAGES[i])
      b.obvody.forEach((o, j) => {
        const p = a.obvody[j]
        expect(o.u1.okrskyZprac).toBeGreaterThanOrEqual(p.u1.okrskyZprac)
        expect(o.u2?.okrskyZprac ?? 0).toBeGreaterThanOrEqual(p.u2?.okrskyZprac ?? 0)
        o.candidates.forEach((c, k) => {
          const q = p.candidates[k]
          expect(c.votes1).toBeGreaterThanOrEqual(q.votes1)
          expect(c.votes2 ?? 0).toBeGreaterThanOrEqual(q.votes2 ?? 0)
          if (q.st1) expect(c.st1).toBe(q.st1)
          if (q.st2) expect(c.st2).toBe(q.st2)
        })
      })
    }
  })

  it('consecutive stages pass the Worker validator (no rejection, no "older")', () => {
    const ctx = { goodRefreshedAt: stamp(0), pollsCloseR1: R1, base: 'b', goodBase: 'b' }
    let prev = null
    STAGES.forEach((stage, i) => {
      const s = snapshot(stage, i)
      expect(validateCandidate(s, prev, { ...ctx, goodRefreshedAt: stamp(i), now: stamp(i) + 1000 })).toEqual({ outcome: 'ok', quarantinable: false })
      prev = s
    })
  })

  it('scenario shape: 7 decided in round 1 (6 drawn + the two-candidate obvod 48), 20 runoffs, one tie', () => {
    const r1 = snapshot('official-r1', 4)
    expect(r1.summary).toMatchObject({ decided: 7, runoff: 20, waiting: 0, counting: 0 })
    for (const o of r1.obvody) {
      const valid = o.rounds[1].platneHlasy
      const top = Math.max(...o.candidates.map((c) => c.votes1))
      if (o.state === 'elected') {
        expect(2 * top).toBeGreaterThan(valid)
        expect(o.decidedRound).toBe(1)
      } else {
        expect(2 * top).toBeLessThanOrEqual(valid)
        expect(o.candidates.filter((c) => c.st1 === '2.KOLO')).toHaveLength(2)
      }
    }
    const r2 = snapshot('official-r2', 7)
    const ties = r2.obvody.filter((o) => o.state === 'tie')
    expect(ties).toHaveLength(1)
    const [a, b] = ties[0].candidates.filter((c) => c.st2 === 'NEZVOLEN_SHODA_HLASU')
    expect(a.votes2).toBe(b.votes2)
    expect(r2.summary).toMatchObject({ decided: 26, ties: 1 })
    expect(phaseOfSnapshot(r2)).toBe('final')
  })

  it('counting stages show plausible partial counts (not 0, not all)', () => {
    const c25 = stageModel(scenario, 'counting-25')
    const c60 = stageModel(scenario, 'counting-60')
    for (const m of [c25, c60]) {
      for (const o of m.obvody) {
        expect(o.u1.okrskyZprac).toBeGreaterThan(0)
        expect(o.u1.okrskyZprac).toBeLessThan(o.u1.okrskyCelkem)
      }
    }
    const share = (m) => m.country[1].okrskyZprac / m.country[1].okrskyCelkem
    expect(share(c25)).toBeGreaterThan(0.15)
    expect(share(c25)).toBeLessThan(0.35)
    expect(share(c60)).toBeGreaterThan(0.4)
    expect(share(c60)).toBeLessThan(0.8)
  })

  it.each([1, 2, 3, 42, 2026])('seed %i: final round-1 top three never tie, runoff winner/loser never tie', (seed) => {
    const sc = buildScenario(FROZEN, seed)
    const s = snapshot('official-r2', 7, sc)
    expect(s.warnings).toEqual([])
    for (const o of s.obvody) {
      const top = o.candidates.map((c) => c.votes1).sort((x, y) => y - x)
      expect(top[0]).toBeGreaterThan(top[1])
      if (o.state !== 'elected') expect(top[1]).toBeGreaterThan(top[2])
    }
    expect(s.summary.decided + s.summary.ties).toBe(27)
  })
})

describe('mock HTTP server', () => {
  const mock = createMock({ seed: 2026 })
  let base
  const ready = new Promise((ok) => mock.server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${mock.server.address().port}`; ok() }))
  afterAll(() => new Promise((ok) => mock.server.close(ok)))
  const get = (path, headers = {}, init = {}) => fetch(base + path, { headers, ...init })

  it('serves ČSÚ-like headers and answers 304 to both validators', async () => {
    await ready
    const res = await get('/odata/vysledky.xml')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/xml')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const etag = res.headers.get('etag')
    const lm = res.headers.get('last-modified')
    expect(etag).toMatch(/^"[0-9a-f]{8}-[0-9a-f]+"$/)
    expect(Date.parse(res.headers.get('expires')) - Date.parse(lm)).toBe(60000)
    expect(parseResultsXml(await res.text()).obvody).toHaveLength(27)
    expect((await get('/odata/vysledky.xml', { 'If-None-Match': etag })).status).toBe(304)
    expect((await get('/odata/vysledky.xml', { 'If-Modified-Since': lm })).status).toBe(304)
    expect((await get('/odata/vysledky.xml', { 'If-None-Match': '"other"' })).status).toBe(200)
    expect((await get('/appdata/senat/20261009/odata/vysledky.xml')).status).toBe(200)
  })

  it('a stage switch changes the ETag, the generated stamp is "now" and conditional GETs get a full body', async () => {
    await ready
    const first = await get('/odata/vysledky.xml')
    const etag = first.headers.get('etag')
    await first.text()
    const view = await (await get('/stage/counting-25', {}, { method: 'POST' })).json()
    expect(view.stage).toBe('counting-25')
    expect(view.expect.summary.counting).toBe(27)
    expect(Math.abs(parsePragueTime(view.generated) - Date.now())).toBeLessThan(5000)
    const next = await get('/odata/vysledky.xml', { 'If-None-Match': etag })
    expect(next.status).toBe(200)
    expect(next.headers.get('etag')).not.toBe(etag)
    expect((await get('/stage/nonsense')).status).toBe(404)
  })

  it('fault endpoints: 500, html, truncate, slow, off, count', async () => {
    await ready
    await get('/fault/500')
    expect((await get('/odata/vysledky.xml')).status).toBe(500)
    await get('/fault/html')
    const html = await get('/odata/vysledky.xml')
    expect(html.headers.get('content-type')).toBe('text/html')
    expect(await html.text()).toMatch(/<html>/)
    await get('/fault/truncate')
    const cut = await (await get('/odata/vysledky.xml')).text()
    expect(() => parseResultsXml(cut)).toThrow(/truncated|unparsed|no <\/VYSLEDKY>|VYSLEDKY/)
    await get('/fault/slow?ms=300')
    const t0 = Date.now()
    expect((await get('/odata/vysledky.xml')).status).toBe(200)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280)
    await get('/fault/500?count=2')
    expect((await get('/odata/vysledky.xml')).status).toBe(500)
    expect((await get('/odata/vysledky.xml')).status).toBe(500)
    expect((await get('/odata/vysledky.xml')).status).toBe(200) // cleared itself
    await get('/fault/off')
    expect((await get('/stage')).status).toBe(200)
  })

  it('stats count 200 / 304 / errors and record the User-Agent', async () => {
    await ready
    await get('/stats/reset', {}, { method: 'POST' })
    const res = await get('/odata/vysledky.xml', { 'User-Agent': 'qa-test/1' })
    await res.text()
    await get('/odata/vysledky.xml', { 'If-None-Match': res.headers.get('etag'), 'User-Agent': 'qa-test/1' })
    const s = await (await get('/stats')).json()
    expect(s).toMatchObject({ total: 2, full200: 1, notModified304: 1, errors: 0, conditional: 1, userAgents: ['qa-test/1'] })
  })
})
