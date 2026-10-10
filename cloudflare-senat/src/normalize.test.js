import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as manifest from './manifest.js'
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'

const read = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const frozenText = read('se2026-frozen.xml')
const rawFinal = read('se2024-final.xml')
// The 2024 file is stamped 2026-09-14, i.e. before both closes, so the gates would (rightly) suppress it.
const stamp = (text, g) => text.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, `DATUM_CAS_GENEROVANI="${g}"`)
const finalText = stamp(rawFinal, '2026-10-18T10:00:00') // generated after R2 (2026-10-17 14:00 Prague)
const finalBetween = stamp(rawFinal, '2026-10-11T10:00:00') // generated between the closes
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
  const s = run(finalBetween, R1 + 3600000, none)
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

test('H1: a file generated before pollsCloseR1 is suppressed even when fetched long after both closes', () => {
  const s = run(rawFinal, R2 + DAY, none) // generated 2026-09-14
  expect(s.warnings).toEqual(['pre-close-data-suppressed', 'r2-data-suppressed'])
  expect(s.round).toBe(1)
  expect(cands(s).every((c) => c.votes1 === 0 && c.pct1 === 0 && c.st1 === null && c.votes2 === null && c.st2 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[2] === undefined && o.rounds[1].okrskyZprac === 0 && o.rounds[1].platneHlasy === 0)).toBe(true)
  expect(s.country[2]).toBeUndefined()
})

test('H1: a file generated between the closes keeps round 1 (flags included), drops round 2, even fetched after R2', () => {
  const s = run(finalBetween, R2 + DAY, none)
  expect(s.warnings).toEqual(['r2-data-suppressed'])
  expect(s.round).toBe(1)
  expect(cands(s).every((c) => c.votes2 === null && c.pct2 === null && c.st2 === null)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[2] === undefined)).toBe(true)
  expect(s.obvody.find((o) => o.n === 5).candidates.find((c) => c.no === 5)).toMatchObject({ votes1: 4480, st1: '2.KOLO' })
  expect(s.obvody.find((o) => o.n === 5).rounds[1].okrskyZprac).toBeGreaterThan(0)
})

test('H1: a file generated after R2 but fetched before R2 (clock skew / config) is still round-2-gated', () => {
  const s = run(finalText, R1 + 3600000, none)
  expect(s.warnings).toEqual(['r2-data-suppressed'])
  expect(s.round).toBe(1)
  expect(s.obvody.find((o) => o.n === 5).candidates.find((c) => c.no === 5)).toMatchObject({ votes1: 4480, st1: '2.KOLO', votes2: null })
})

test('L4: pre-close zapsaniVolici (registered voters) is kept and does not raise the warning', () => {
  const text = frozenText.replace(/ZAPSANI_VOLICI="\d+"/, 'ZAPSANI_VOLICI="1234"')
  const s = run(text, R1 - 3600000)
  expect(s.warnings).toEqual([])
  expect(s.obvody.some((o) => o.rounds[1].zapsaniVolici === 1234)).toBe(true)
  expect(s.obvody.every((o) => o.rounds[1].okrskyZprac === 0 && o.rounds[1].platneHlasy === 0)).toBe(true)
})

test('a round-2 UCAST with all-zero counts before the R2 gate is dropped silently', () => {
  const u2 = '<UCAST KOLO="2" OKRSKY_CELKEM="10" OKRSKY_ZPRAC="0" OKRSKY_ZPRAC_PROC="0" ZAPSANI_VOLICI="900" UCAST_PROC="0" ODEVZDANE_OBALKY="0" PLATNE_HLASY="0"/>'
  const text = frozenText.replace('</OBVOD>', `${u2}</OBVOD>`) // first obvod only
  const s = run(stamp(text, '2026-10-11T10:00:00'), R1 + 3600000)
  expect(s.warnings).toEqual([])
  expect(s.obvody.every((o) => o.rounds[2] === undefined)).toBe(true)
})

test('H2: the gates fail closed — an invalid now / pollsCloseR1 / pollsCloseR2 throws', () => {
  const parsed = parseResultsXml(finalText)
  const base = { manifest: none, now: R2 + DAY, pollsCloseR1: R1, pollsCloseR2: R2 }
  expect(() => normalize(parsed, base)).not.toThrow()
  for (const k of ['now', 'pollsCloseR1', 'pollsCloseR2']) {
    for (const bad of [undefined, NaN, null, '2026-10-17', Infinity]) {
      expect(() => normalize(parsed, { ...base, [k]: bad }), `${k}=${String(bad)}`).toThrow(/finite number/)
    }
  }
})

test('H2: an unparseable generated suppresses everything (fail closed)', () => {
  const s = run(stamp(rawFinal, 'garbage'), R2 + DAY, none)
  expect(s.generatedMs).toBeNull()
  expect(s.warnings).toEqual(['pre-close-data-suppressed', 'r2-data-suppressed'])
  expect(cands(s).every((c) => c.votes1 === 0 && c.votes2 === null)).toBe(true)
})

test('M3: sum-mismatch is silent on both fixtures and fires per obvod/round on a doctored vote', () => {
  expect(run(frozenText, R2 + DAY).warnings).toEqual([])
  expect(run(finalText, R2 + DAY, none).warnings).toEqual([])
  const r1 = run(finalText.replace('HLASY_1KOLO="4480"', 'HLASY_1KOLO="4481"'), R2 + DAY, none)
  expect(r1.warnings).toEqual(['sum-mismatch:5:1'])
  const r2 = run(finalText.replace('HLASY_2KOLO="6862"', 'HLASY_2KOLO="6863"'), R2 + DAY, none)
  expect(r2.warnings).toEqual(['sum-mismatch:5:2'])
})

test('M3: votes without any valid-vote total are a mismatch; all-zero rounds are not', () => {
  const o = frozenText.replace(/HLASY_1KOLO="0"/, 'HLASY_1KOLO="5"') // platneHlasy stays 0
  expect(run(o, R2 + DAY).warnings).toEqual(['pre-close-data-suppressed']) // generated before R1 -> gated to zero first, no sum check
  expect(run(stamp(o, '2026-10-10T15:00:00'), R2 + DAY).warnings).toEqual(['sum-mismatch:3:1'])
})

test('M1: warns when the XML obvod set differs from the manifest', () => {
  expect(run(frozenText, R2 + DAY).warnings).toEqual([]) // same 27
  const renamed = frozenText.replace('<OBVOD CISLO="3" NAZEV="Cheb">', '<OBVOD CISLO="4" NAZEV="Cheb">')
  expect(run(renamed, R2 + DAY).warnings).toContain('obvody-set-differs-from-manifest')
  expect(run(frozenText, R2 + DAY, none).warnings).toEqual([]) // empty manifest: nothing to compare
})

test('M1/L6: a Pirate-backed entry absent from the XML warns pirate-backed-missing', () => {
  const m = { ...manifest, PIRATE_BACKED: [...manifest.PIRATE_BACKED, { obvod: 3, no: 99, relation: 'endorsed' }, { obvod: 999, no: 1, relation: 'endorsed' }] }
  const s = run(frozenText, R2 + DAY, m)
  expect(s.warnings).toEqual(['pirate-backed-missing:3:99', 'pirate-backed-missing:999:1'])
  const gone = frozenText.replace(/<KANDIDAT PORADOVE_CISLO="1" [^>]*Plevn[^>]*\/>/, '')
  expect(run(gone, R2 + DAY).warnings).toContain('pirate-backed-missing:3:1')
})

test('L6: suppressedByClock is true only when `now` alone zeroed counted data (file generated after the close), and is not part of the snapshot', () => {
  const clockR2 = run(finalText, R1 + 3600000) // generated after R2, our clock before it
  expect(clockR2.warnings).toContain('r2-data-suppressed')
  expect(clockR2.suppressedByClock).toBe(true)
  expect(Object.keys(clockR2)).not.toContain('suppressedByClock')
  expect(JSON.stringify(clockR2)).not.toContain('suppressedByClock')
  // the file itself is pre-close (generated before R1), whatever our clock says: not our clock's doing
  expect(run(rawFinal, R2 + DAY).suppressedByClock).toBe(false)
  expect(run(rawFinal, R1 - 3600000).suppressedByClock).toBe(false)
  // nothing suppressed, or nothing counted to suppress
  expect(run(finalText, R2 + DAY).suppressedByClock).toBe(false)
  expect(run(frozenText, R1 - 3600000).suppressedByClock).toBe(false)
  // generated between the closes, clock before R1 -> R1 gate by clock (the file carries round-1 data)
  expect(run(finalBetween, R1 - 3600000).suppressedByClock).toBe(true)
})
