import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'
import { derive } from './derive.js'
import { validateCandidate, baselineApplies } from './validate.js'

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-17T14:00:00+02:00')
const AFTER = R2 + 86400000
const none = { CANDIDATES: {}, PIRATE_BACKED: [] }
// The fixtures are stamped before the closes (2024: 2026-09-14, frozen: 2026-10-08), where the H1
// gate (rightly) suppresses them and the validator's baseline never applies. Re-stamp them.
const stamp = (text, g) => text.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, `DATUM_CAS_GENEROVANI="${g}"`)
const FINAL = stamp(read('se2024-final.xml'), '2026-10-18T10:00:00') // after R2
const FROZEN = stamp(read('se2026-frozen.xml'), '2026-10-10T14:05:00') // after R1
const build = (text, m, now) => derive(normalize(parseResultsXml(text), { manifest: m, now, pollsCloseR1: R1, pollsCloseR2: R2 }))
const ctx = { goodRefreshedAt: AFTER, pollsCloseR1: R1, base: 'b', goodBase: 'b' }

test('frozen 2026 end to end: nothing decided, all 27 waiting, 18 Pirate-backed waiting', () => {
  const s = build(FROZEN, manifest, AFTER)
  expect(s.summary).toMatchObject({ obvody: 27, decided: 0, waiting: 27 })
  expect(s.summary.pirates.total).toBe(18)
  expect(s.summary.pirates.byStatus.waiting).toBe(18)
  expect(s.obvody.every((o) => o.state === 'waiting')).toBe(true)
  expect(s.warnings).toEqual([])
})

test('2024 final end to end: 5 decided in round 1, 22 in round 2, nothing provisional', () => {
  const s = build(FINAL, none, AFTER)
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

test('validator: each fixture is ok against itself, and the baseline really applies (not vacuous)', () => {
  const f = build(FINAL, none, AFTER)
  const z = build(FROZEN, manifest, AFTER)
  expect(baselineApplies(f, ctx)).toBe(true)
  expect(baselineApplies(z, ctx)).toBe(true)
  expect(validateCandidate(f, f, ctx)).toEqual({ outcome: 'ok', quarantinable: false })
  expect(validateCandidate(z, z, ctx)).toEqual({ outcome: 'ok', quarantinable: false })
})

test('validator: a later snapshot with a lower vote count is rejected, quarantinable', () => {
  const good = build(FINAL, none, AFTER)
  const next = structuredClone(good)
  next.generatedMs += 60000
  next.obvody.find((o) => o.n === 5).candidates.find((c) => c.no === 5).votes1 -= 1
  expect(validateCandidate(next, good, ctx)).toEqual({ outcome: 'rejected', reason: 'votes-decreased', quarantinable: true })
})

test('validator: the frozen file replacing the final one is rejected (newer) or older (stamped earlier), never ok', () => {
  const good = build(FINAL, none, AFTER)
  const later = build(stamp(read('se2026-frozen.xml'), '2026-10-19T10:00:00'), manifest, AFTER + 86400000)
  const r = validateCandidate(later, good, ctx)
  expect(r.outcome).toBe('rejected')
  expect(r.quarantinable).toBe(true)
  expect(['obvody-changed', 'counted-decreased', 'votes-decreased', 'official-flag-changed']).toContain(r.reason)
  const earlier = build(FROZEN, manifest, AFTER)
  expect(validateCandidate(earlier, good, ctx)).toEqual({ outcome: 'older', quarantinable: false })
})

test('a file generated between the closes: round 2 dropped, the 5 + 22 round-1 outcomes survive', () => {
  const s = build(stamp(read('se2024-final.xml'), '2026-10-11T10:00:00'), none, R2 + 86400000)
  expect(s.round).toBe(1)
  expect(s.warnings).toEqual(['r2-data-suppressed'])
  expect(s.obvody.every((o) => o.rounds[2] === undefined)).toBe(true)
  expect(s.summary).toMatchObject({ obvody: 27, decided: 5, runoff: 22 })
})

test('H1 end to end: a pre-close test file fetched long after both closes publishes as all waiting', () => {
  const s = build(read('se2024-final.xml'), none, AFTER)
  expect(s.warnings).toEqual(['pre-close-data-suppressed', 'r2-data-suppressed'])
  expect(s.summary).toMatchObject({ obvody: 27, decided: 0, runoff: 0, waiting: 27 })
})

test('L7: a cold start with an obvod missing from the XML is a hard reject only when the set is required; an empty manifest never rejects', () => {
  const renamed = FROZEN.replace('<OBVOD CISLO="3" NAZEV="Cheb">', '<OBVOD CISLO="4" NAZEV="Cheb">')
  const s = build(renamed, manifest, AFTER)
  expect(s.warnings).toContain('obvody-set-differs-from-manifest')
  expect(validateCandidate(s, null, { now: AFTER })).toEqual({ outcome: 'ok', quarantinable: false })
  expect(validateCandidate(s, null, { now: AFTER, requireManifestSet: true })).toMatchObject({ outcome: 'rejected', reason: 'obvody-set-differs-from-manifest', quarantinable: false })
  const none27 = build(renamed, none, AFTER)
  expect(validateCandidate(none27, null, { now: AFTER, requireManifestSet: true }).outcome).toBe('ok')
})
