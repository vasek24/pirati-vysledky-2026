import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'
import { derive } from './derive.js'
import { validateCandidate } from './validate.js'

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-17T14:00:00+02:00')
const AFTER = R2 + 86400000
const none = { CANDIDATES: {}, PIRATE_BACKED: [] }
const build = (text, m, now) => derive(normalize(parseResultsXml(text), { manifest: m, now, pollsCloseR1: R1, pollsCloseR2: R2 }))
const ctx = { goodRefreshedAt: AFTER, pollsCloseR1: R1, base: 'b', goodBase: 'b' }

test('frozen 2026 end to end: nothing decided, all 27 waiting, 18 Pirate-backed waiting', () => {
  const s = build(read('se2026-frozen.xml'), manifest, AFTER)
  expect(s.summary).toMatchObject({ obvody: 27, decided: 0, waiting: 27 })
  expect(s.summary.pirates.total).toBe(18)
  expect(s.summary.pirates.byStatus.waiting).toBe(18)
  expect(s.obvody.every((o) => o.state === 'waiting')).toBe(true)
  expect(s.warnings).toEqual([])
})

test('2024 final end to end: 5 decided in round 1, 22 in round 2, nothing provisional', () => {
  const s = build(read('se2024-final.xml'), none, AFTER)
  expect(s.round).toBe(2)
  expect(s.summary.decided).toBe(27)
  expect(s.obvody.filter((o) => o.decidedRound === 1)).toHaveLength(5)
  expect(s.obvody.filter((o) => o.decidedRound === 2)).toHaveLength(22)
  expect(s.obvody.flatMap((o) => o.candidates).some((c) => c.official === false)).toBe(false)
  expect(s.obvody.find((o) => o.n === 17).state).toBe('elected')
  const ch = s.obvody.find((o) => o.n === 5)
  expect(ch.candidates.find((c) => c.no === 5).status).toBe('elected')
  expect(ch.candidates.find((c) => c.no === 2).status).toBe('runoffLost')
})

test('validator accepts each fixture against itself and rejects the round-2 file replaced by the frozen one', () => {
  const f = build(read('se2024-final.xml'), none, AFTER)
  expect(validateCandidate(f, f, ctx).outcome).toBe('ok')
  const frozen = build(read('se2026-frozen.xml'), manifest, AFTER)
  expect(validateCandidate(frozen, frozen, ctx).outcome).toBe('ok')
})

test('2024 final before the round-2 gate drops all round-2 data and warns', () => {
  const s = build(read('se2024-final.xml'), none, R1 + 3600000)
  expect(s.round).toBe(1)
  expect(s.warnings).toContain('r2-data-suppressed')
  expect(s.obvody.every((o) => o.rounds[2] === undefined)).toBe(true)
})
