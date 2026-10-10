import { describe, expect, test } from 'vitest'
import { CLOSE_DATE, POLLS_CLOSE, closeDate, closingModel, remaining } from './closing.js'
import { betweenRounds, counting, finalR2, waiting } from './fixtures/scenarios.js'

const MIN = 60000
const pragueParts = (ms) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  )

describe('closing', () => {
  test('both rounds close on a Saturday at 14:00 Prague time, on the date shown in the text', () => {
    for (const k of [1, 2]) {
      const p = pragueParts(POLLS_CLOSE[k])
      expect(p.weekday).toBe('sobota')
      expect(`${p.hour}:${p.minute}`).toBe('14:00')
      expect(CLOSE_DATE[k]).toBe(`${p.day}. ${p.month}.`)
    }
    expect(POLLS_CLOSE[2] - POLLS_CLOSE[1]).toBe(7 * 24 * 60 * MIN)
  })

  test('remaining: minutes, hours with minutes, days with hours; never "0 min"', () => {
    expect(remaining(43 * MIN)).toBe('43 min')
    expect(remaining(59 * MIN + 59000)).toBe('59 min')
    expect(remaining(65 * MIN)).toBe('1 h 5 min')
    expect(remaining(10 * 60 * MIN)).toBe('10 h 0 min')
    expect(remaining(6 * 1440 * MIN + 22 * 60 * MIN + 5 * MIN)).toBe('6 d 22 h')
    expect(remaining(20000)).toBe('1 min')
  })

  test('closingModel: before the round-1 close it counts down to round 1', () => {
    const t = POLLS_CLOSE[1]
    for (const snap of [null, waiting(), counting()]) {
      expect(closingModel(snap, t - 43 * MIN)).toEqual({ round: 1, date: '10. 10.', left: '43 min' })
      expect(closingModel(snap, t - 1)).toEqual({ round: 1, date: '10. 10.', left: '1 min' })
    }
    expect(closingModel(null, NaN)).toBeNull()
    expect(closingModel(waiting(), NaN)).toBeNull()
  })

  // Skutečný tvar ze serveru mezi koly: round 1, phase idle, obvody ve stavu 'runoff' (ne round 2!)
  test('between the rounds a round-1 snapshot with runoff obvody counts down to the ROUND-2 close', () => {
    const s = betweenRounds()
    expect(s.round).toBe(1)
    expect(s.phase).toBe('idle')
    expect(s.obvody.some((o) => o.state === 'runoff')).toBe(true)
    expect(s.summary.runoff).toBeGreaterThan(0)
    const t = POLLS_CLOSE[1]
    expect(closingModel(s, t + 5 * MIN)).toEqual({ round: 2, date: '17. 10.', left: '6 d 23 h' })
    expect(closingModel(s, t + 2 * 1440 * MIN)).toEqual({ round: 2, date: '17. 10.', left: '5 d 0 h' })
    expect(closingModel(s, POLLS_CLOSE[2] - 90 * MIN)).toEqual({ round: 2, date: '17. 10.', left: '1 h 30 min' })
    // after the round-2 close only the freshness line is left
    expect(closingModel(s, POLLS_CLOSE[2])).toBeNull()
    expect(closingModel(s, POLLS_CLOSE[2] + 5 * MIN)).toBeNull()
    expect(closingModel(s, NaN)).toBeNull()
  })

  test('each of the three round-2 signals alone is enough', () => {
    const t = POLLS_CLOSE[1] + MIN
    const base = betweenRounds()
    // all obvody decided in round 1 and no ties: nothing to wait for
    const done = structuredClone(base)
    for (const o of done.obvody) o.state = 'elected'
    Object.assign(done.summary, { decided: done.summary.obvody, runoff: 0, ties: 0, awaitingOfficial: 0, counting: 0, waiting: 0 })
    expect(closingModel(done, t)).toBeNull()
    // 1) summary.runoff
    const bySummary = structuredClone(done)
    bySummary.summary.runoff = 1
    expect(closingModel(bySummary, t)?.round).toBe(2)
    // 1b) summary.ties
    const byTies = structuredClone(done)
    byTies.summary.ties = 1
    expect(closingModel(byTies, t)?.round).toBe(2)
    // 2) an obvod state of runoff / runoff-counting
    for (const state of ['runoff', 'runoff-counting']) {
      const byState = structuredClone(done)
      byState.obvody[0].state = state
      expect(closingModel(byState, t)?.round, state).toBe(2)
    }
    // 3) round 1 with something still undecided but NO official runoff flag yet: no countdown
    const undecided = structuredClone(done)
    undecided.summary.decided -= 1
    expect(closingModel(undecided, t)).toBeNull()
    // ... but a decided round-2 snapshot (the 2024 final) has nothing to wait for
    expect(closingModel(finalR2(), t)).toBeNull()
  })

  test('the countdown follows the Worker close times (snapshot.closes): POLLS_CLOSE_R2 moved to 24. 10. 14:00', () => {
    const R2b = Date.parse('2026-10-24T14:00:00+02:00')
    const s = { ...betweenRounds(), closes: { 1: POLLS_CLOSE[1], 2: R2b } }
    // the old 17. 10. 14:00 no longer ends the countdown, and the date text comes from the override
    expect(closingModel(s, POLLS_CLOSE[2] - 90 * MIN)).toEqual({ round: 2, date: '24. 10.', left: '7 d 1 h' })
    expect(closingModel(s, POLLS_CLOSE[2] + 5 * MIN)).toEqual({ round: 2, date: '24. 10.', left: '6 d 23 h' })
    expect(closingModel(s, R2b - 30 * MIN)).toEqual({ round: 2, date: '24. 10.', left: '30 min' })
    expect(closingModel(s, R2b)).toBeNull()
    // round 1 date also from the server value
    expect(closingModel({ ...s, closes: { 1: POLLS_CLOSE[1] + 24 * 60 * MIN, 2: R2b } }, POLLS_CLOSE[1] - MIN)).toEqual({ round: 1, date: '11. 10.', left: '1 d 0 h' })
    // an unusable `closes` (not numbers, round 2 not after round 1) falls back to the constants
    for (const closes of [{}, { 1: 'x', 2: 'y' }, { 1: R2b, 2: POLLS_CLOSE[1] }, null]) {
      expect(closingModel({ ...s, closes }, POLLS_CLOSE[2] - 90 * MIN)).toEqual({ round: 2, date: '17. 10.', left: '1 h 30 min' })
    }
  })

  test('closeDate is the Prague calendar date of the time (not the UTC one)', () => {
    expect(closeDate(Date.parse('2026-10-24T00:30:00+02:00'))).toBe('24. 10.') // 22:30 UTC the day before
    expect(closeDate(Date.parse('2026-10-24T23:30:00+02:00'))).toBe('24. 10.')
    expect(closeDate(Date.parse('2026-11-08T14:00:00+01:00'))).toBe('8. 11.')
  })

  test('closingModel without a snapshot after the round-1 close stays silent', () => {
    expect(closingModel(null, POLLS_CLOSE[1] + MIN)).toBeNull()
  })
})
