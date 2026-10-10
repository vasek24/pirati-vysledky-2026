import { describe, expect, test } from 'vitest'
import { counting, finalR2, runoff, waiting } from './fixtures/scenarios.js'
import { currentRound, defaultObvod, pirateCards, pirateTally, progressOf, sortRows, votesOf } from './view.js'

describe('view selectors', () => {
  test('18 Pirate cards sorted by obvod number (waiting fixture)', () => {
    const cards = pirateCards(waiting())
    expect(cards).toHaveLength(18)
    const ns = cards.map(({ o }) => o.n)
    expect(ns).toEqual([...ns].sort((a, b) => a - b))
    expect(cards.filter(({ c }) => c.pirate === 'ticket')).toHaveLength(3)
    expect(cards.filter(({ c }) => c.pirate === 'endorsed')).toHaveLength(15)
  })

  test('no Pirate cards without manifest data (2024 fixture)', () => {
    expect(pirateCards(finalR2())).toEqual([])
  })

  test('default detail = first obvod with a Pirate candidacy', () => {
    expect(defaultObvod(waiting())).toBe(3)
    expect(defaultObvod(finalR2())).toBe(finalR2().obvody[0].n)
  })

  test('tally buckets sum to the total for every scenario', () => {
    for (const s of [waiting(), counting(), runoff(), finalR2()]) {
      const t = pirateTally(s.summary)
      expect(t.elected + t.advancing + t.top + t.behind + t.out + t.waiting).toBe(t.total)
    }
    const t = pirateTally(runoff().summary)
    expect(t).toMatchObject({ elected: 1, advancing: 3, top: 4, out: 3 })
  })

  test('current round and votes follow rounds[2]', () => {
    const r = runoff()
    const o30 = r.obvody.find((o) => o.n === 30)
    expect(currentRound(o30)).toBe(2)
    const sucharda = o30.candidates.find((c) => c.no === 2)
    expect(votesOf(o30, sucharda)).toBe(2000)
    const o21 = r.obvody.find((o) => o.n === 21)
    expect(currentRound(o21)).toBe(1)
  })

  test('sortRows: by current-round votes, finalists first in round 2, ties by ballot number', () => {
    const r = runoff()
    const rows = sortRows(r.obvody.find((o) => o.n === 30))
    expect(rows.map((c) => c.no).slice(0, 2)).toEqual([2, 6])
    const w = sortRows(waiting().obvody[0])
    expect(w.map((c) => c.no)).toEqual([...w.map((c) => c.no)].sort((a, b) => a - b))
  })

  test('progressOf', () => {
    expect(progressOf({ okrskyZprac: 50, okrskyCelkem: 200 })).toBe(25)
    expect(progressOf({ okrskyZprac: 0, okrskyCelkem: 0 })).toBe(0)
    expect(progressOf(undefined)).toBe(0)
  })
})
