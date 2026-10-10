import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseResultsXml } from '../src/xml.js'
import { normalize } from '../src/normalize.js'
import { derive } from '../src/derive.js'
import { phaseOfSnapshot } from '../src/refresh.js'
import * as manifest from '../src/manifest.js'
import { STAGES, buildScenario, mapaJson, navigJson, obvodJson, pragueLocal, renderXml, stageModel } from './mock-upstream.mjs'
import {
  USER_AGENT, compareDerived, compareMapa, compareNavig, compareOursToXml, compareXmlToJson, checkSums, formatTable, politeGet,
  recompute, sevFor, summarize, timing, verify,
} from './verify-against-csu.mjs'

const fx = (p) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8')
const json = (p) => JSON.parse(fx(`csu-json/${p}`))
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-17T14:00:00+02:00')
const NOW = R2 + 86400000
const none = { CANDIDATES: {}, PIRATE_BACKED: [] }

// 2024 final data, re-stamped after both closes so the gates stay open (as pipeline.test.js does)
const XML24 = fx('se2024-final.xml').replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-18T10:00:00"')
const xml24 = parseResultsXml(XML24)
const asApi = (snap) => ({ refreshedAt: NOW, nextRefreshAt: NOW + 600000, servedAt: NOW, stale: false, phase: phaseOfSnapshot(snap), ...snap })
const ours24 = () => structuredClone(asApi(derive(normalize(xml24, { manifest: none, now: NOW, pollsCloseR1: R1, pollsCloseR2: R2 }))))
const fields = (items) => items.map((i) => `${i.obvod}|${i.field}|${i.sev}`)
// ČSÚ's own JSON carries a different stamp than the XML; the original 2024 stamps are kept for the JSON tests
const xmlObvod = (n) => ({ ...parseResultsXml(fx('se2024-final.xml')).obvody.find((o) => o.n === n), generated: '2026-09-14T10:18:49' })

describe('ours vs ČSÚ XML', () => {
  it('a snapshot built from the same XML has no mismatch', () => {
    expect(compareOursToXml(ours24(), xml24)).toEqual([])
    expect(compareOursToXml(ours24(), xml24, 17)).toEqual([])
  })
  it('a wrong vote is a fail when the stamps are equal and a lag when they differ', () => {
    const o = ours24()
    o.obvody.find((x) => x.n === 5).candidates.find((c) => c.no === 5).votes2 -= 1
    expect(fields(compareOursToXml(o, xml24))).toEqual(['5|#5 Přemysl Rabas votes2|fail'])
    o.generated = '2026-10-18T09:59:00'
    expect(fields(compareOursToXml(o, xml24)).filter((f) => f.includes('votes2'))).toEqual(['5|#5 Přemysl Rabas votes2|lag'])
  })
  it('detects a missing obvod, a changed counted-precinct number and a lost official flag', () => {
    const o = ours24()
    o.obvody = o.obvody.filter((x) => x.n !== 8)
    o.obvody.find((x) => x.n === 2).rounds[1].okrskyZprac -= 1
    const f = fields(compareOursToXml(o, xml24))
    expect(f).toContain('*|obvody count|fail')
    expect(f).toContain('8|obvod|fail')
    expect(f).toContain('2|round 1 okrskyZprac|fail')
    o.obvody.find((x) => x.n === 2).candidates.find((c) => c.st1 === 'ZVOLEN').st1 = null
    expect(fields(compareOursToXml(o, xml24)).some((x) => x.includes('st1|fail'))).toBe(true)
  })
})

describe('ČSÚ XML vs ČSÚ obvod JSON (column mapping verified on obvod 5 and 17)', () => {
  it.each([5, 17])('obvod %i: every mapped column equals the XML', (n) => {
    expect(compareXmlToJson(xmlObvod(n), json(`se2024-obvod-${n}.json`))).toEqual([])
  })
  it('obvod 17 (decided in round 1): postupuje [] and zvoleny = the ZVOLEN_1KOLO candidate', () => {
    const j = json('se2024-obvod-17.json')
    expect(j.postupuje).toEqual([])
    expect(xmlObvod(17).candidates.find((c) => c.st1 === 'ZVOLEN').no).toBe(j.zvoleny)
    expect(j.vysledky.every((r) => r[7] === null)).toBe(true) // no round-2 votes: null, not 0
  })
  it('obvod 5 (runoff): non-finalists carry 0 in the round-2 columns, finalists the XML votes', () => {
    const j = json('se2024-obvod-5.json')
    expect(j.vysledky.filter((r) => r[7] > 0).map((r) => r[0])).toEqual(j.postupuje)
  })
  it('catches a rounded (not truncated) percentage, a wrong vote, flags and sums', () => {
    const j = json('se2024-obvod-5.json')
    j.vysledky[1][6] = 23.34 // 5043/21611 = 23.335: ČSÚ truncates to 23.33
    j.vysledky[4][7] = 6863
    j.zvoleny = 2
    j.postupuje = [2, 6]
    j.prehled[0][9] += 1
    const f = fields(compareXmlToJson(xmlObvod(5), j))
    expect(f).toEqual(expect.arrayContaining(['5|#2 pct1|lag', '5|#5 votes2|lag', '5|zvoleny|lag', '5|postupuje|lag', '5|round 1 platneHlasy|lag']))
    expect(f.some((x) => x.includes('Σ'))).toBe(false)
  })
  it('equal stamps make the same difference a fail', () => {
    const j = json('se2024-obvod-17.json')
    j.generovano = '2026-09-14T10:18:49'
    j.vysledky[0][5] += 1
    expect(compareXmlToJson(xmlObvod(17), j).every((m) => m.sev === 'fail')).toBe(true)
    expect(sevFor('a', 'a')).toBe('fail')
    expect(sevFor('a', 'b')).toBe('lag')
    expect(sevFor(null, null)).toBe('lag')
  })
  it('an empty pre-count JSON (prehled [], vysledky []) is consistent with an XML obvod without counted precincts', () => {
    const empty = { generovano: 'x', prehled: [], vysledky: [], postupuje: [], zvoleny: null }
    const frozen = parseResultsXml(fx('se2026-frozen.xml')).obvody.find((o) => o.n === 30)
    expect(compareXmlToJson({ ...frozen, generated: 'y' }, empty)).toEqual([])
    expect(fields(compareXmlToJson({ ...frozen, generated: 'y' }, { ...empty, postupuje: [2] }))).toEqual(['30|postupuje (pre-count)|lag'])
  })
  it('an empty JSON against an XML obvod that HAS counted precincts is reported', () => {
    const empty = { generovano: 'x', prehled: [], vysledky: [], postupuje: [], zvoleny: null }
    expect(fields(compareXmlToJson(xmlObvod(5), empty))).toEqual(expect.arrayContaining(['5|prehled round 1|lag', '5|candidate count|lag']))
  })
})

describe('independent rules vs derive.js', () => {
  it('2024 final: no difference in state, rank, status, official, majority, outlook, gap, summary, phase', () => {
    expect(compareDerived(ours24(), xml24)).toEqual([])
  })
  it('every mock stage (empty, partial counts, awaiting flags, official, runoff counting, ties) agrees', () => {
    for (const seed of [2026, 7]) {
      const sc = buildScenario(undefined, seed)
      STAGES.forEach((stage, i) => {
        const stamp = R1 + (i + 10) * 60000
        const xml = parseResultsXml(renderXml(sc, stageModel(sc, stage), pragueLocal(stamp)))
        const ours = asApi(derive(normalize(xml, { manifest, now: stamp + 1000, pollsCloseR1: R1, pollsCloseR2: R1 + 1000 })))
        expect(compareDerived(ours, xml), `${stage} seed ${seed}`).toEqual([])
      })
    }
  })
  it('reports a wrong state, status, outlook and summary', () => {
    const o = ours24()
    const sc = buildScenario()
    const xml = parseResultsXml(renderXml(sc, stageModel(sc, 'counting-60'), pragueLocal(R1 + 600000)))
    const mid = asApi(derive(normalize(xml, { manifest, now: R1 + 601000, pollsCloseR1: R1, pollsCloseR2: R1 + 1000 })))
    mid.obvody[0].state = 'counted'
    mid.obvody[1].candidates[0].status = 'second'
    mid.obvody[2].candidates[1].outlook = 'out'
    mid.summary.counting -= 1
    mid.phase = 'idle'
    const f = fields(compareDerived(mid, xml))
    expect(f).toEqual(expect.arrayContaining([`${mid.obvody[0].n}|state|fail`, '*|summary.counting|fail', '*|phase|fail']))
    expect(f.some((x) => x.includes('status'))).toBe(true)
    expect(f.some((x) => x.includes('outlook'))).toBe(true)
    expect(o.obvody.length).toBe(27)
  })
  it('recompute on hand-made cases (spec §3.1)', () => {
    const cand = (no, votes1, o = {}) => ({ no, votes1, votes2: null, st1: null, st2: null, ...o })
    const u = (z, c, valid) => ({ okrskyZprac: z, okrskyCelkem: c, platneHlasy: valid })
    const mandate = recompute({ candidates: [cand(1, 600), cand(2, 300), cand(3, 99)], ucast: { 1: u(10, 10, 999) } })
    expect(mandate.state).toBe('counted')
    expect(mandate.candidates[1]).toMatchObject({ outlook: 'mandate', gap: null, majority: true, status: 'leading', rank: 1 })
    expect(mandate.candidates[2]).toMatchObject({ outlook: 'out', gap: 300, status: 'second' })
    const split = recompute({ candidates: [cand(1, 40), cand(2, 30), cand(3, 30)], ucast: { 1: u(5, 10, 100) } })
    expect(split.state).toBe('counting')
    expect(split.candidates[1]).toMatchObject({ outlook: 'advance', gap: 10, majority: false })
    expect(split.candidates[2]).toMatchObject({ rank: 2, outlook: 'advance', gap: 10, status: 'second' }) // tie for 2nd: all tied second-placed advance
    expect(split.candidates[3]).toMatchObject({ rank: 2, outlook: 'advance', gap: 10 })
    const tieFirst = recompute({ candidates: [cand(1, 40), cand(2, 40), cand(3, 20)], ucast: { 1: u(5, 10, 100) } })
    expect(tieFirst.candidates[1]).toMatchObject({ outlook: 'advance', gap: 0 })
    expect(tieFirst.candidates[2]).toMatchObject({ outlook: 'advance', gap: 0 })
    const flags = recompute({ candidates: [cand(1, 40, { st1: '2.KOLO' }), cand(2, 35, { st1: '2.KOLO' }), cand(3, 25, { st1: 'NEZVOLEN' })], ucast: { 1: u(10, 10, 100) } })
    expect(flags.state).toBe('runoff')
    expect(Object.values(flags.candidates).map((c) => c.status)).toEqual(['advancing', 'advancing', 'notAdvancing'])
    const r2 = recompute({
      candidates: [cand(1, 40, { st1: '2.KOLO', votes2: 51 }), cand(2, 35, { st1: '2.KOLO', votes2: 49 }), cand(3, 25, { st1: 'NEZVOLEN' })],
      ucast: { 1: u(10, 10, 100), 2: u(3, 10, 100) },
    })
    expect(r2.state).toBe('runoff-counting')
    expect(r2.candidates[1]).toMatchObject({ status: 'runoffLeading', outlook: 'lead', gap: 2, rank: 1 })
    expect(r2.candidates[2]).toMatchObject({ status: 'runoffBehind', outlook: 'trail', gap: 2 })
    expect(r2.candidates[3]).toMatchObject({ status: 'notAdvancing', rank: null, outlook: null })
    const shoda = recompute({
      candidates: [cand(1, 40, { st1: '2.KOLO', votes2: 50, st2: 'NEZVOLEN_SHODA_HLASU' }), cand(2, 35, { st1: '2.KOLO', votes2: 50, st2: 'NEZVOLEN_SHODA_HLASU' })],
      ucast: { 1: u(10, 10, 75), 2: u(10, 10, 100) },
    })
    expect(shoda.state).toBe('tie')
    expect(shoda.candidates[1].status).toBe('runoffTie')
    const won = recompute({ candidates: [cand(1, 40, { st1: '2.KOLO', votes2: 51, st2: 'ZVOLEN' }), cand(2, 35, { st1: '2.KOLO', votes2: 49, st2: 'NEZVOLEN' })], ucast: { 1: u(10, 10, 75), 2: u(10, 10, 100) } })
    expect(won).toMatchObject({ state: 'elected', decidedRound: 2 })
  })
})

describe('the mock\'s ČSÚ side files agree with the verifier on every stage', () => {
  it('vysled/obvod/<n>.json, mapa_vitez.json and navig/obvody.json equal the XML / the derived snapshot', () => {
    const sc = buildScenario()
    STAGES.forEach((stage, i) => {
      const stamp = R1 + (i + 10) * 60000
      const generated = pragueLocal(stamp)
      const model = stageModel(sc, stage)
      const xml = parseResultsXml(renderXml(sc, model, generated))
      const ours = asApi(derive(normalize(xml, { manifest, now: stamp + 1000, pollsCloseR1: R1, pollsCloseR2: R1 + 1000 })))
      for (const o of xml.obvody) expect(compareXmlToJson({ ...o, generated }, obvodJson(model, o.n, generated)), `${stage} obvod ${o.n}`).toEqual([])
      expect(compareMapa(ours, mapaJson(model, generated)), `${stage} mapa`).toEqual([])
      expect(compareNavig(ours, navigJson(model, generated)), `${stage} navig`).toEqual([])
    })
  })
})

describe('sums, mapa_vitez, navig, timing', () => {
  it('Σ votes = PLATNE_HLASY on both sides; a broken sum and stale:true are failures', () => {
    expect(checkSums(ours24(), xml24)).toEqual([])
    const o = ours24()
    o.stale = true
    o.obvody[0].candidates[0].votes1 += 5
    expect(fields(checkSums(o, xml24))).toEqual(['2|ours round 1 Σ votes vs PLATNE_HLASY|fail', '*|stale|fail'])
  })
  it.each([2, 5, 17])('mapa_vitez sample: obvod %i agrees with our snapshot', (n) => {
    expect(compareMapa(ours24(), json('se2024-mapa-vitez-sample.json'), n)).toEqual([])
  })
  it('mapa_vitez mismatch: wrong votes, leader and round', () => {
    const m = json('se2024-mapa-vitez-sample.json')
    m.obvody['5'].hlasu = 1
    m.obvody['5'].kandCislo = 2
    m.obvody['5'].kolo = 1
    expect(fields(compareMapa(ours24(), m, 5))).toEqual(expect.arrayContaining(['5|kolo|lag', '5|hlasu|lag', '5|kandCislo|lag']))
  })
  it('mapa_vitez: an uncounted obvod has no leader; a leader reported anyway is a mismatch', () => {
    const sc = buildScenario()
    const xml = parseResultsXml(renderXml(sc, stageModel(sc, 'frozen'), pragueLocal(R1 + 600000)))
    const o = asApi(derive(normalize(xml, { manifest, now: R1 + 601000, pollsCloseR1: R1, pollsCloseR2: R1 + 1000 })))
    const m = { obvody: { 30: { kolo: 1, kandCislo: null, hlasu: 0, procHlasu: 0, procZprac: 0, ukonceno: false, stavZvolen: 0, pocetVitezu: null } } }
    expect(compareMapa(o, m, 30)).toEqual([])
    m.obvody['30'].kandCislo = 2
    expect(fields(compareMapa(o, m, 30))).toEqual(['30|kandCislo|lag'])
  })
  it('navig/obvody.json (2024 final, all 27) agrees; a wrong decided round is reported', () => {
    const nav = json('se2024-navig-obvody.json')
    expect(compareNavig(ours24(), nav)).toEqual([])
    nav.obvody[1].zvoleno_kolo = 1
    expect(fields(compareNavig(ours24(), nav))).toEqual(['5|zvoleno_kolo|lag'])
  })
  it('timing: ok, lag, hard lag, newer-than-ČSÚ', () => {
    const o = { generated: '2026-10-10T16:00:00', generatedMs: Date.parse('2026-10-10T16:00:00+02:00'), refreshedAt: 1000 }
    expect(timing(o, { generated: '2026-10-10T16:01:00' }, 61000).items).toEqual([])
    expect(timing(o, { generated: '2026-10-10T16:01:00' }, 61000).lagSec).toBe(60)
    expect(fields(timing(o, { generated: '2026-10-10T16:05:00' }, 0).items)).toEqual(['*|our lag (s)|lag'])
    expect(fields(timing(o, { generated: '2026-10-10T16:20:00' }, 0).items)).toEqual(['*|our lag (s)|fail'])
    expect(fields(timing(o, { generated: '2026-10-10T15:50:00' }, 0).items)).toEqual(['*|our copy newer than ČSÚ by (s)|lag'])
    expect(fields(timing(o, { generated: 'garbage' }, 0).items)).toEqual(['*|generated|fail'])
  })
})

describe('fetching and output', () => {
  const res = (status, body, headers = {}) => new Response(body, { status, headers })

  it('politeGet sends our User-Agent, remembers validators and serves a 304 from the cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-test-'))
    const seen = []
    const fetchImpl = async (url, init) => {
      seen.push(init.headers)
      return init.headers['If-None-Match'] ? res(304, null) : res(200, '<x/>', { etag: '"abc"', 'last-modified': 'Sat, 10 Oct 2026 12:00:00 GMT' })
    }
    const a = await politeGet('https://csu.test/f.xml', { cacheDir: dir, fetchImpl })
    const b = await politeGet('https://csu.test/f.xml', { cacheDir: dir, fetchImpl })
    expect([a.status, a.body, b.status, b.body, b.fromCache]).toEqual([200, '<x/>', 304, '<x/>', true])
    expect(seen[0]['User-Agent']).toBe(USER_AGENT)
    expect(seen[0]['If-None-Match']).toBeUndefined()
    expect(seen[1]).toMatchObject({ 'If-None-Match': '"abc"', 'If-Modified-Since': 'Sat, 10 Oct 2026 12:00:00 GMT' })
    expect(USER_AGENT).toBe('pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)')
  })

  it('verify(): one request per ČSÚ file, our own User-Agent everywhere, obvod 5 end to end', async () => {
    const calls = []
    const ours = ours24()
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), ua: init.headers['User-Agent'] })
      const u = String(url)
      if (u === 'https://ours.test/api/senat') return res(200, JSON.stringify(ours), { 'x-server-now': String(NOW) })
      if (u.endsWith('/odata/vysledky.xml')) return res(200, XML24)
      if (u.endsWith('/vysled/obvod/5.json')) return res(200, fx('csu-json/se2024-obvod-5.json'))
      if (u.endsWith('/mapa_vitez.json')) return res(200, fx('csu-json/se2024-mapa-vitez-sample.json'))
      if (u.endsWith('/navig/obvody.json')) return res(200, fx('csu-json/se2024-navig-obvody.json'))
      return res(404, 'no')
    }
    const r = await verify({ ourUrl: 'https://ours.test/api/senat', csuBase: 'https://csu.test/senat', only: 5, delayMs: 0, fetchImpl, now: () => NOW })
    expect(r.obvodyCompared).toBe(1)
    expect(r.fetched).toMatchObject({ requests: 4, failed: [] })
    expect(new Set(calls.map((c) => c.url)).size).toBe(calls.length)
    expect(calls.every((c) => c.ua === USER_AGENT)).toBe(true)
    // the only differences are the XML-vs-JSON generation stamps (the JSON sample keeps its 2024 stamp): timing class
    expect(r.mismatches.filter((m) => m.sev === 'fail')).toEqual([])
    expect(summarize(r)).toMatchObject({ fail: 0, ok: true })
  })

  it('verify(): a broken ČSÚ JSON endpoint is a lag-class fetch note (not fatal unless --strict)', async () => {
    const ours = ours24()
    const fetchImpl = async (url) => {
      const u = String(url)
      if (u === 'https://ours.test/api/senat') return res(200, JSON.stringify(ours))
      if (u.endsWith('/odata/vysledky.xml')) return res(200, XML24)
      return res(500, 'boom')
    }
    const r = await verify({ ourUrl: 'https://ours.test/api/senat', csuBase: 'https://csu.test', only: 17, delayMs: 0, fetchImpl, now: () => NOW })
    expect(r.fetched.failed).toEqual(['vysled/obvod/17.json', 'mapa_vitez.json', 'navig/obvody.json'])
    expect(summarize(r)).toMatchObject({ fail: 0, ok: true })
    expect(summarize(r, { strict: true }).ok).toBe(false)
  })

  it('our API not answering 200 aborts the run', async () => {
    await expect(verify({ ourUrl: 'https://ours.test/api/senat', delayMs: 0, fetchImpl: async () => res(503, '{}') })).rejects.toThrow(/503/)
  })

  it('formatTable prints a header plus one row per mismatch', () => {
    expect(formatTable([])).toBe('(no mismatches)')
    const t = formatTable([{ obvod: 5, group: 'xml-vs-json', field: '#2 pct1', ours: 23.34, theirs: 23.33, sev: 'lag' }])
    expect(t.split('\n')).toHaveLength(2)
    expect(t).toMatch(/23\.34\s+23\.33\s+lag/)
  })
})
