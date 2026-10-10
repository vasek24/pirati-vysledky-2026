import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const frozenText = read('se2026-frozen.xml')
const finalText = read('se2024-final.xml')
const R1 = Date.UTC(2026, 9, 10, 12, 0)
const R2 = Date.UTC(2026, 9, 17, 12, 0)
const DAY = 86400000
const run = (text, now, m = manifest) => normalize(parseResultsXml(text), { manifest: m, now, pollsCloseR1: R1, pollsCloseR2: R2 })
const none = { CANDIDATES: {}, PIRATE_BACKED: [] } // the 2024 obvod/candidate set differs from the 2026 manifest
const cands = (s) => s.obvody.flatMap((o) => o.candidates)

test('frozen 2026, after the gates: 27 obvody, 154 candidates, round 1, zeros, no warnings', () => {
  const s = run(frozenText, R2 + DAY)
  expect(s).toMatchObject({ v: 1, kind: 'senat', generated: '2026-10-08T16:40:15', generatedMs: Date.UTC(2026, 9, 8, 14, 40, 15), round: 1, warnings: [] })
  expect(s.obvody).toHaveLength(27)
  expect(s.obvody.map((o) => o.n)).toEqual([...s.obvody.map((o) => o.n)].sort((a, b) => a - b))
  expect(cands(s)).toHaveLength(154)
  expect(cands(s).every((c) => c.votes1 === 0 && c.pct1 === 0 && c.st1 === null && c.votes2 === null && c.st2 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[1].okrskyZprac === 0 && o.rounds[2] === undefined)).toBe(true)
  expect(s.country).toEqual({ 1: { okrskyCelkem: 5021, okrskyZprac: 0, okrskyZpracProc: 0, ucastProc: 0, platneHlasy: 0 } })
})

test('frozen 2026: obvod names from the XML, 18 Pirate-backed with the right relation, registry fields joined', () => {
  const s = run(frozenText, R2 + DAY)
  expect(s.obvody.find((o) => o.n === 30).name).toBe('Kladno')
  const backed = s.obvody.flatMap((o) => o.candidates.filter((c) => c.pirate).map((c) => [`${o.n}:${c.no}`, c.pirate]))
  expect(backed).toHaveLength(18)
  expect(backed.filter(([, r]) => r === 'ticket').map(([k]) => k).sort()).toEqual(['18:5', '30:2', '75:2'])
  for (const p of manifest.PIRATE_BACKED) expect(backed).toContainEqual([`${p.obvod}:${p.no}`, p.relation])
  const sip = s.obvody.find((o) => o.n === 30).candidates.find((c) => c.no === 2)
  expect(sip).toMatchObject({ name: 'Adéla Sucharda Šípová', pre: 'Mgr.', pirate: 'ticket', party: 'Česká pirátská strana', ballotLabel: 'Adéla do Senátu' })
  expect(sip.age).toEqual(expect.any(Number))
  const plain = s.obvody.find((o) => o.n === 3).candidates.find((c) => c.no === 2)
  expect(plain).toMatchObject({ pirate: null, party: 'Naše Česko' })
})

test('no derived fields are produced', () => {
  const s = run(frozenText, R2 + DAY)
  expect(s.summary).toBeUndefined()
  expect(s.obvody[0].state).toBeUndefined()
  expect(s.obvody[0].candidates[0].status).toBeUndefined()
})

test('before pollsCloseR1 the same file is still all zeros; zero source data gives no warning', () => {
  const s = run(frozenText, R1 - 3600000)
  expect(s.warnings).toEqual([])
  expect(cands(s).every((c) => c.votes1 === 0 && c.st1 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[1].okrskyZprac === 0)).toBe(true)
})

test('before pollsCloseR1 counted source data is suppressed with a warning; round 2 too', () => {
  const s = run(finalText, R1 - 3600000, none)
  expect(s.warnings).toEqual(['pre-close-data-suppressed', 'r2-data-suppressed'])
  expect(s.round).toBe(1)
  expect(cands(s).every((c) => c.votes1 === 0 && c.pct1 === 0 && c.st1 === null && c.votes2 === null && c.st2 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[2] === undefined && o.rounds[1].platneHlasy === 0 && o.rounds[1].okrskyZprac === 0)).toBe(true)
  expect(s.obvody[0].rounds[1].okrskyCelkem).toBeGreaterThan(0)
  expect(s.country).toEqual({ 1: expect.objectContaining({ okrskyZprac: 0, platneHlasy: 0 }) })
})

test('2024 final after the gates: round 2 present', () => {
  const s = run(finalText, R2 + DAY, none)
  expect(s.round).toBe(2)
  expect(s.warnings).toEqual([])
  const o5 = s.obvody.find((o) => o.n === 5)
  expect(o5.rounds[2]).toMatchObject({ okrskyZprac: 118, platneHlasy: 12959 })
  expect(o5.candidates.filter((c) => c.st1 === '2.KOLO').map((c) => c.votes2)).toEqual([6097, 6862])
  expect(o5.candidates.find((c) => c.no === 5)).toMatchObject({ votes1: 4480, st1: '2.KOLO', votes2: 6862, pct2: 52.95, st2: 'ZVOLEN' })
  const o17 = s.obvody.find((o) => o.n === 17)
  expect(o17.rounds[2]).toBeUndefined()
  expect(o17.candidates.every((c) => c.votes2 === null && c.st2 === null)).toBe(true)
  expect(s.country[2].okrskyZprac).toBe(4154)
})

test('before pollsCloseR2 round-2 data is dropped with a warning, round-1 flags stay', () => {
  const s = run(finalText, R1 + 3600000, none)
  expect(s.warnings).toEqual(['r2-data-suppressed'])
  expect(s.round).toBe(1)
  expect(cands(s).every((c) => c.votes2 === null && c.pct2 === null && c.st2 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[2] === undefined)).toBe(true)
  expect(s.country[2]).toBeUndefined()
  const o5 = s.obvody.find((o) => o.n === 5)
  expect(o5.candidates.find((c) => c.no === 5)).toMatchObject({ votes1: 4480, st1: '2.KOLO' })
  expect(s.obvody.find((o) => o.n === 17).candidates.find((c) => c.no === 2).st1).toBe('ZVOLEN')
})

test('surname verification is diacritics- and case-insensitive; a mismatch drops the attribution', () => {
  const ok = run(frozenText.replace('PRIJMENI="Plevný"', 'PRIJMENI="PLEVNY"'), R2 + DAY)
  expect(ok.warnings).toEqual([])
  expect(ok.obvody[0].candidates[0]).toMatchObject({ pirate: 'endorsed', party: 'STAROSTOVÉ A NEZÁVISLÍ' })
  const bad = run(frozenText.replace('PRIJMENI="Plevný"', 'PRIJMENI="Novák"'), R2 + DAY)
  expect(bad.warnings).toEqual(['attribution-mismatch:3:1'])
  expect(bad.obvody[0].candidates[0]).toMatchObject({ name: 'Miroslav Novák', pirate: null, party: null, ballotLabel: null, member: null, age: null, job: null, residence: null })
})

test('unknown status strings map to null with a warning', () => {
  const s = run(finalText.replace('ZVOLEN_1KOLO="ZVOLEN"', 'ZVOLEN_1KOLO="NECO"').replace('ZVOLEN_2KOLO="ZVOLEN"', 'ZVOLEN_2KOLO="DIVNE"'), R2 + DAY, none)
  expect(s.warnings).toHaveLength(2)
  expect(s.warnings.every((w) => w.startsWith('unknown-status:'))).toBe(true)
  expect(s.warnings.join()).toMatch(/NECO/)
  expect(s.warnings.join()).toMatch(/DIVNE/)
  expect(cands(s).some((c) => c.st1 === 'NECO' || c.st2 === 'DIVNE')).toBe(false)
})

test('a candidate outside the manifest is shown without party info', () => {
  const s = run(frozenText, R2 + DAY, none)
  expect(s.warnings).toEqual([])
  expect(cands(s).every((c) => c.pirate === null && c.party === null && c.age === null)).toBe(true)
})
