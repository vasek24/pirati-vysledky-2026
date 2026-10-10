import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseResultsXml } from './xml.js'

const fixture = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const U1 = 'KOLO="1" OKRSKY_CELKEM="10" OKRSKY_ZPRAC="2" OKRSKY_ZPRAC_PROC="20.00" ZAPSANI_VOLICI="900" VYDANE_OBALKY="5" UCAST_PROC="1.0" VOLICSKE_PRUKAZY="0" ODEVZDANE_OBALKY="5" PLATNE_HLASY="4" PLATNE_HLASY_PROC="80.0"'
const K = 'PORADOVE_CISLO="1" JMENO="Jan" PRIJMENI="Novák" HLASY_1KOLO="3" HLASY_PROC_1KOLO="75.00"'
const doc = (obvody, root = '<VYSLEDKY DATUM_CAS_GENEROVANI="2026-10-10T15:00:00">', tail = '</VYSLEDKY>') => `<?xml version="1.0"?>\n${root}\n${obvody}\n${tail}`
const obvod = (cand = `<KANDIDAT ${K}/>`, ucast = `<UCAST ${U1}/>`) => `<OBVOD CISLO="7" NAZEV="Test">${cand}${ucast}</OBVOD>`

test('frozen 2026 file', () => {
  const p = parseResultsXml(fixture('se2026-frozen.xml'))
  expect(p.generated).toBe('2026-10-08T16:40:15')
  expect(p.obvody).toHaveLength(27)
  expect(p.obvody.reduce((s, o) => s + o.candidates.length, 0)).toBe(154)
  const cheb = p.obvody[0]
  expect(cheb).toMatchObject({ n: 3, name: 'Cheb' })
  expect(cheb.candidates[0]).toEqual({
    no: 1, first: 'Miroslav', last: 'Plevný', pre: 'prof. Dr. Ing.', post: '',
    votes1: 0, pct1: 0, st1: null, votes2: null, pct2: null, st2: null,
  })
  expect(cheb.ucast[1]).toMatchObject({ okrskyCelkem: 172, okrskyZprac: 0, platneHlasy: 0, zapsaniVolici: 0, odevzdaneObalky: 0 })
  expect(cheb.ucast[2]).toBeUndefined()
  expect(p.country[1].okrskyCelkem).toBe(5021)
  expect(p.country[2]).toBeUndefined()
})

test('final 2024 file: round 2, flags, round-1-only constituency', () => {
  const p = parseResultsXml(fixture('se2024-final.xml'))
  expect(p.obvody).toHaveLength(27)
  const o5 = p.obvody.find((o) => o.n === 5)
  expect(o5.name).toBe('Chomutov')
  expect(o5.candidates.filter((c) => c.st1 === '2.KOLO').map((c) => [c.no, c.votes2])).toEqual([[2, 6097], [5, 6862]])
  expect(o5.candidates.find((c) => c.no === 5)).toMatchObject({ st1: '2.KOLO', st2: 'ZVOLEN', pct2: 52.95 })
  expect(o5.ucast[2]).toMatchObject({ kolo: 2, platneHlasy: 12959 })
  const o17 = p.obvody.find((o) => o.n === 17)
  expect(o17.ucast[2]).toBeUndefined()
  expect(o17.candidates.every((c) => c.votes2 === null && c.st2 === null)).toBe(true)
  expect(o17.candidates.find((c) => c.no === 2).st1).toBe('ZVOLEN')
  expect(p.country[2].okrskyZprac).toBe(4154)
})

test('entities are decoded once', () => {
  const k = 'PORADOVE_CISLO="1" JMENO="A &amp; B &#269;" PRIJMENI="&lt;x&gt; &quot;q&quot; &apos;s&apos; &#x10D; &amp;amp;" HLASY_1KOLO="3" HLASY_PROC_1KOLO="75.00"'
  const c = parseResultsXml(doc(obvod(`<KANDIDAT ${k}/>`))).obvody[0].candidates[0]
  expect(c.first).toBe('A & B č')
  expect(c.last).toBe('<x> "q" \'s\' č &amp;')
})

test('absent optional attributes -> null; unknown attributes ignored; unknown status kept verbatim', () => {
  const k = `${K} NOVY_ATRIBUT="1" ZVOLEN_1KOLO="PREKVAPENI"`
  const u = 'KOLO="1" OKRSKY_CELKEM="10" OKRSKY_ZPRAC="2" PLATNE_HLASY="4" EXTRA="x"'
  const p = parseResultsXml(doc(obvod(`<KANDIDAT ${k}/>`, `<UCAST ${u}/>`)))
  expect(p.obvody[0].candidates[0]).toMatchObject({ pre: '', post: '', st1: 'PREKVAPENI', votes2: null, pct2: null, st2: null })
  expect(p.obvody[0].ucast[1]).toMatchObject({ okrskyZpracProc: null, ucastProc: null, zapsaniVolici: null, odevzdaneObalky: null })
  expect(p.country).toEqual({})
})

test('throws on unusable input', () => {
  const bad = {
    empty: '',
    garbage: 'not xml at all <<<',
    html: '<html><body>502</body></html>',
    chyba: doc('<CHYBA POPIS="x"/>'),
    chybaRoot: '<CHYBA/>',
    zeroObvod: doc(''),
    noCandidates: doc(obvod('')),
    selfClosingObvod: doc('<OBVOD CISLO="7" NAZEV="T"/>'),
    noUcast: doc(obvod(undefined, '')),
    onlyRound2: doc(obvod(undefined, `<UCAST ${U1.replace('KOLO="1"', 'KOLO="2"')}/>`)),
    missingVotes: doc(obvod('<KANDIDAT PORADOVE_CISLO="1" PRIJMENI="X" HLASY_PROC_1KOLO="1.0"/>')),
    nonNumericVotes: doc(obvod(`<KANDIDAT ${K.replace('HLASY_1KOLO="3"', 'HLASY_1KOLO="abc"')}/>`)),
    nonNumericUcast: doc(obvod(undefined, `<UCAST ${U1.replace('PLATNE_HLASY="4"', 'PLATNE_HLASY="4x"')}/>`)),
    nonNumericObvod: doc(obvod().replace('CISLO="7"', 'CISLO="x"')),
    badKolo: doc(obvod(undefined, `<UCAST ${U1.replace('KOLO="1"', 'KOLO="3"')}/>`)),
    truncated: doc(obvod(), undefined, ''),
  }
  for (const [name, text] of Object.entries(bad)) expect(() => parseResultsXml(text), name).toThrow()
})

test('a minimal valid document parses', () => {
  const p = parseResultsXml(doc(obvod()))
  expect(p.generated).toBe('2026-10-10T15:00:00')
  expect(p.obvody[0].ucast[1]).toMatchObject({ okrskyCelkem: 10, okrskyZprac: 2, okrskyZpracProc: 20, platneHlasy: 4 })
})
