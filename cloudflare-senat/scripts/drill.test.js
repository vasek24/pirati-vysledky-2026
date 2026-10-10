import { describe, expect, it } from 'vitest'
import * as manifest from '../src/manifest.js'
import { parseResultsXml } from '../src/xml.js'
import { normalize } from '../src/normalize.js'
import { derive } from '../src/derive.js'
import { phaseOfSnapshot } from '../src/refresh.js'
import { STAGES, buildScenario, expectOf, pragueLocal, renderXml, stageModel } from './mock-upstream.mjs'
import { checkBase, checkCadence, checkStage, gaps } from './drill.mjs'

const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const sc = buildScenario()
const api = (stage, i) => {
  const stamp = R1 + (i + 10) * 60000
  const snap = derive(normalize(parseResultsXml(renderXml(sc, stageModel(sc, stage), pragueLocal(stamp))), { manifest, now: stamp + 1000, pollsCloseR1: R1, pollsCloseR2: R1 + 1000 }))
  return { refreshedAt: stamp, servedAt: stamp, stale: false, phase: phaseOfSnapshot(snap), ...snap }
}
const headers = (phase, now = Date.now()) => new Headers({
  'cache-control': `public, max-age=0, s-maxage=${phase === 'final' ? 600 : phase === 'idle' ? 60 : 3}`, 'x-server-now': String(now), 'x-cache': 'MISS',
})
const failed = (checks) => checks.filter((c) => !c.ok).map((c) => c.name)

describe('checkStage', () => {
  it.each(STAGES.map((s, i) => [s, i]))('%s: the Worker output the model predicts passes every check', (stage, i) => {
    const body = api(stage, i)
    const prev = i ? api(STAGES[i - 1], i - 1) : null
    expect(failed(checkStage(expectOf(stageModel(sc, stage)), body, headers(body.phase), { prev }))).toEqual([])
  })
  it('catches a wrong summary, a stale body, a lost obvod state, a decreasing count and bad headers', () => {
    const exp = expectOf(stageModel(sc, 'counting-60'))
    const body = api('counting-60', 2)
    body.summary.counting -= 1
    body.stale = true
    body.obvody[0].state = 'elected'
    const f = failed(checkStage(exp, body, headers('counting')))
    expect(f).toEqual(expect.arrayContaining(['summary.counting', 'stale', 'obvod states (27)']))
    const later = api('counting-60', 2)
    const earlier = api('counting-25', 1)
    expect(failed(checkStage(exp, earlier, headers('counting'), { prev: later }))).toContain('monotone vs previous stage')
    expect(failed(checkStage(exp, later, new Headers({ 'cache-control': 'public, max-age=0, s-maxage=60', 'x-cache': 'LASTRESORT', 'x-server-now': '1' })))).toEqual(['cache-control', 'x-server-now', 'x-cache'])
  })
  it('flags a broken Σ votes invariant', () => {
    const body = api('counting-25', 1)
    body.obvody[3].candidates[0].votes1 += 1
    expect(failed(checkStage(expectOf(stageModel(sc, 'counting-25')), body, headers('counting')))).toContain('Σ votes = PLATNE_HLASY, precincts <= total')
  })
})

describe('cadence helpers and the safety guard', () => {
  const req = (t, status = 304) => ({ t: t * 1000, status, conditional: true })
  it('gaps', () => expect(gaps([0, 20000, 41000])).toEqual([20, 21]))
  it('a 20 s conditional cadence passes; a hammering client, a long silence and a full download fail', () => {
    expect(failed(checkCadence([req(0), req(20), req(40), req(61)]))).toEqual([])
    expect(failed(checkCadence([req(0), req(5), req(10)]))).toEqual(['min gap between polls (s)'])
    expect(failed(checkCadence([req(0), req(120)]))).toEqual(['max gap between polls (s)'])
    expect(failed(checkCadence([req(0), req(20, 200)]))).toEqual(['unchanged file answered 304'])
    expect(failed(checkCadence([req(0)]))).toEqual(['requests in window'])
  })
  it('refuses anything but localhost', () => {
    expect(checkBase('http://localhost:8799').hostname).toBe('localhost')
    expect(checkBase('http://127.0.0.1:8799').hostname).toBe('127.0.0.1')
    for (const bad of ['https://senat.dg12.cz', 'https://pirati-senat-zaloha-staging.vasek24.workers.dev', 'http://10.0.0.5:8799']) expect(() => checkBase(bad)).toThrow(/refusing/)
  })
})
