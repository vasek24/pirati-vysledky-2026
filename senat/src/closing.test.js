import { describe, expect, test } from 'vitest'
import { CLOSE_DATE, POLLS_CLOSE, closingModel, remaining } from './closing.js'

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

  test('closingModel follows the current round and ends at the close', () => {
    const t = POLLS_CLOSE[1]
    expect(closingModel(1, t - 43 * MIN)).toEqual({ date: '10. 10.', left: '43 min' })
    expect(closingModel(1, t - 1)).toEqual({ date: '10. 10.', left: '1 min' })
    expect(closingModel(1, t)).toBeNull()
    expect(closingModel(1, t + 5 * MIN)).toBeNull()
    expect(closingModel(2, t + 5 * MIN)).toEqual({ date: '17. 10.', left: '6 d 23 h' })
    expect(closingModel(2, POLLS_CLOSE[2] - 90 * MIN)).toEqual({ date: '17. 10.', left: '1 h 30 min' })
    expect(closingModel(2, POLLS_CLOSE[2])).toBeNull()
    expect(closingModel(undefined, t - MIN).date).toBe('10. 10.') // bez snapshotu = 1. kolo
    expect(closingModel(1, NaN)).toBeNull()
  })
})
