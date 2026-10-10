import { describe, expect, test } from 'vitest'
import { ageSeconds, countdown, headerModel } from './freshness.js'
import { T } from './text.js'

const G = Date.parse('2026-10-10T17:42:08+02:00')
const snap = (over) => ({ phase: 'counting', round: 1, generatedMs: G, ...over })

describe('freshness', () => {
  test('ageSeconds is skew-corrected input minus generated, never negative', () => {
    expect(ageSeconds(G, G + 14000)).toBe(14)
    expect(ageSeconds(G, G - 5000)).toBe(0)
    expect(ageSeconds(null, G)).toBeNull()
    expect(ageSeconds(G, NaN)).toBeNull()
  })

  test('countdown', () => {
    expect(countdown(G + 46000, G)).toBe('0:46')
    expect(countdown(null, G)).toBeNull()
  })

  test('counting: live pill, time, age and countdown', () => {
    const m = headerModel({ snapshot: snap(), serverNow: G + 14000, nextAt: G + 60000 })
    expect(m.live).toBe(true)
    expect(m.pill).toBe('ŽIVĚ · 1. KOLO')
    expect(m.fresh).toBe('ČSÚ data z 17:42:08 · před 14 s · další kontrola za 0:46')
  })

  test('round 2 pill', () => {
    expect(headerModel({ snapshot: snap({ round: 2 }), serverNow: G, nextAt: null }).pill).toBe('ŽIVĚ · 2. KOLO')
  })

  test('waiting: no age, pre-election wording, date when not today', () => {
    const w = snap({ phase: 'waiting', generatedMs: Date.parse('2026-10-08T16:40:15+02:00') })
    const m = headerModel({ snapshot: w, serverNow: Date.parse('2026-10-10T12:00:00+02:00'), nextAt: Date.parse('2026-10-10T12:00:46+02:00') })
    expect(m.live).toBe(false)
    expect(m.pill).toBe(T.pillWaiting)
    expect(m.fresh).toBe('ČSÚ data z 8. 10. 16:40:15 · předvolební stav, sčítání ještě nezačalo · další kontrola za 0:46')
  })

  test('idle/final: not pulsing, done pill with the round', () => {
    for (const phase of ['idle', 'final']) {
      const m = headerModel({ snapshot: snap({ phase, round: 2 }), serverNow: G + 90000, nextAt: null })
      expect(m.live).toBe(false)
      expect(m.pill).toBe('SČÍTÁNÍ UKONČENO · 2. KOLO')
      expect(m.fresh).toBe('ČSÚ data z 17:42:08 · před 90 s')
    }
  })

  test('idle in round 2 with no counted round-2 precinct: waiting pill and line, not "done"', () => {
    const obvody = [
      { state: 'elected', rounds: { 1: { okrskyZprac: 5 } } },
      { state: 'runoff', rounds: { 1: { okrskyZprac: 5 }, 2: { okrskyCelkem: 5, okrskyZprac: 0 } } },
    ]
    const m = headerModel({ snapshot: snap({ phase: 'idle', round: 2, obvody }), serverNow: G + 90000, nextAt: null })
    expect(m.live).toBe(false)
    expect(m.pill).toBe('ČEKÁ SE NA VÝSLEDKY 2. KOLA')
    expect(m.fresh).toBe('ČSÚ data z 17:42:08 · sčítání 2. kola ještě nezačalo')
    // a runoff obvod that has no rounds[2] yet counts as waiting too
    obvody[1].rounds = { 1: { okrskyZprac: 5 } }
    expect(headerModel({ snapshot: snap({ phase: 'idle', round: 2, obvody }), serverNow: G, nextAt: null }).pill).toBe(T.pillWaitingR2)
  })

  test('idle in round 2 with every obvod decided stays "done"; round 1 idle never gets the round-2 wording', () => {
    const decided = [{ state: 'elected', rounds: { 1: { okrskyZprac: 5 } } }, { state: 'tie', rounds: { 2: { okrskyZprac: 0 } } }]
    expect(headerModel({ snapshot: snap({ phase: 'idle', round: 2, obvody: decided }), serverNow: G, nextAt: null }).pill).toBe(T.pillDone(2))
    const r1 = [{ state: 'runoff', rounds: { 1: { okrskyZprac: 5 }, 2: { okrskyZprac: 0 } } }]
    expect(headerModel({ snapshot: snap({ phase: 'idle', round: 1, obvody: r1 }), serverNow: G, nextAt: null }).pill).toBe(T.pillDone(1))
    // counting in round 2 is the live pill regardless of obvody
    expect(headerModel({ snapshot: snap({ round: 2, obvody: r1 }), serverNow: G, nextAt: null }).pill).toBe(T.pillLive(2))
  })

  test('round-2 votes without a round-2 UCAST count as counted (no waiting pill); without votes still waiting', () => {
    const runoff = (votes2) => [{ state: 'runoff', rounds: { 1: { okrskyZprac: 5 } }, candidates: [{ votes2 }, { votes2: null }] }]
    const pill = (obvody) => headerModel({ snapshot: snap({ phase: 'idle', round: 2, obvody }), serverNow: G, nextAt: null }).pill
    expect(pill(runoff(120))).toBe(T.pillDone(2))
    expect(pill(runoff(0))).toBe(T.pillWaitingR2)
    expect(pill(runoff(null))).toBe(T.pillWaitingR2)
  })

  test('junk generatedMs drops the time and age but keeps the countdown', () => {
    const m = headerModel({ snapshot: snap({ generatedMs: null }), serverNow: G, nextAt: G + 5000 })
    expect(m.fresh).toBe('další kontrola za 0:05')
  })
})
