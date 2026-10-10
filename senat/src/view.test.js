import { describe, expect, test } from 'vitest'
import { counting, finalR2, runoff, runoffEliminatedPirate, waiting } from './fixtures/scenarios.js'
import { currentRound, defaultObvod, isCounted, isOutOfRunoff, pctOf, pirateCards, pirateTally, progressOf, rankOf, roundOf, roundStats, sortRows, votesOf } from './view.js'

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

  test('current round is 2 with rounds[2] OR any votes2 (same rule as the server)', () => {
    const o = { rounds: { 1: { okrskyCelkem: 10, okrskyZprac: 10 } }, candidates: [{ no: 1, votes1: 5, votes2: null }, { no: 2, votes1: 4, votes2: null }] }
    expect(currentRound(o)).toBe(1)
    expect(currentRound({ ...o, rounds: { ...o.rounds, 2: { okrskyCelkem: 10, okrskyZprac: 0 } } })).toBe(2)
    const noUcast = { ...o, candidates: [{ no: 1, votes1: 5, votes2: 0, pct2: 0 }, { no: 2, votes1: 4, votes2: 7, pct2: 100 }] }
    expect(currentRound(noUcast)).toBe(2)
    expect(votesOf(noUcast, noUcast.candidates[1])).toBe(7)
    expect(pctOf(noUcast, noUcast.candidates[1])).toBe(100)
    expect(pctOf(noUcast, { ...noUcast.candidates[1], pct2: null })).toBeNull() // missing share stays null (shown as a dash), not 0
    expect(pctOf(o, { ...o.candidates[0], pct1: null })).toBeNull()
    expect(roundStats(noUcast, 2)).toBeNull()
    expect(isCounted(noUcast, noUcast.candidates[1])).toBe(true)
    expect(isCounted(noUcast, noUcast.candidates[0])).toBe(false) // 0 votes, round-2 stats unknown
    expect(progressOf(roundStats(noUcast, currentRound(noUcast)))).toBe(0)
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

  test('round is chosen per candidate: finalists use round 2, others in a runoff obvod stay on round 1', () => {
    const o = runoffEliminatedPirate().obvody.find((x) => x.n === 30)
    const by = (no) => o.candidates.find((c) => c.no === no)
    expect(currentRound(o)).toBe(2)
    expect([roundOf(o, by(2)), roundOf(o, by(1))]).toEqual([2, 1])
    expect([isOutOfRunoff(o, by(2)), isOutOfRunoff(o, by(1))]).toEqual([false, true])
    expect(votesOf(o, by(1))).toBe(4221)
    expect(pctOf(o, by(1))).toBe(by(1).pct1)
    expect(votesOf(o, by(2))).toBe(2000)
    // round-1 obvod: nobody is "out of runoff"
    const o21 = runoff().obvody.find((x) => x.n === 21)
    expect(o21.candidates.some((c) => isOutOfRunoff(o21, c))).toBe(false)
  })

  test('rankOf: server rank for finalists and round 1; round-1 competition rank for non-finalists', () => {
    const o = runoffEliminatedPirate().obvody.find((x) => x.n === 30)
    const by = (no) => o.candidates.find((c) => c.no === no)
    expect(by(1).rank).toBeNull() // the server gives no round-2 rank to a non-finalist
    expect(rankOf(o, by(1))).toBe(3) // 5200, 4800, 4221 ...
    expect(rankOf(o, by(2))).toBe(by(2).rank)
    expect(rankOf(o, by(5))).toBe(4)
    // competition rank: equal votes share the rank, the next one skips
    const t = structuredClone(o)
    t.candidates.find((c) => c.no === 3).votes1 = 4221
    expect([3, 1, 5].map((no) => rankOf(t, t.candidates.find((c) => c.no === no)))).toEqual([3, 3, 5])
    // no round-1 votes -> no rank
    const n = structuredClone(o)
    n.candidates.find((c) => c.no === 1).votes1 = null
    expect(rankOf(n, n.candidates.find((c) => c.no === 1))).toBeNull()
    // round 1 obvod uses the server rank as is
    const w = waiting().obvody[0]
    expect(rankOf(w, w.candidates[0])).toBe(w.candidates[0].rank ?? null)
  })

  test('sortRows in a runoff obvod: finalists by round-2 votes, then the rest by round-1 votes', () => {
    const rows = sortRows(runoffEliminatedPirate().obvody.find((x) => x.n === 30))
    expect(rows.map((c) => c.no)).toEqual([2, 6, 1, 5, 4, 3])
  })

  test('progressOf', () => {
    expect(progressOf({ okrskyZprac: 50, okrskyCelkem: 200 })).toBe(25)
    expect(progressOf({ okrskyZprac: 0, okrskyCelkem: 0 })).toBe(0)
    expect(progressOf(undefined)).toBe(0)
  })
})
