import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyBatch, candsOf, emptyRound, parseBatchXml, rowsFor, wantedOf } from './okrsky.js'
import * as realManifest from './manifest.js'

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const B1 = fixture('okrsky-2024-b1.xml')
const B2 = fixture('okrsky-2024-b2.xml')

const okrsek = ({ obec = 100, okrsek: n = 1, obvod = 17, seq = 1, valid = 100, voters = 500, votes = { 1: 60, 2: 40 }, extra = '' } = {}) =>
  `<OKRSEK CIS_OBEC="${obec}" CIS_OKRSEK="${n}" CIS_OBVOD="${obvod}" PORADI_ZPRAC="${seq}" DATUM_CAS_ZPRAC="2026-10-10T14:30:00" OPAKOVANE="0"${extra}>`
  + `<UCAST_OKRSEK ZAPSANI_VOLICI="${voters}" VYDANE_OBALKY="${valid}" ODEVZDANE_OBALKY="${valid}" PLATNE_HLASY="${valid}"/>`
  + Object.entries(votes).map(([no, h]) => `<HLASY_OKRSEK PORADOVE_CISLO="${no}" HLASY="${h}"/>`).join('')
  + '</OKRSEK>'

const batch = ({ kolo = 1, n = 1, generated = '2026-10-10T14:30:00', body = okrsek() } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<VYSLEDKY_OKRSKY xmlns="http://www.volby.cz/senat/" DATUM_CAS_GENEROVANI="${generated}">`
  + `<DAVKA DATUMVOLEB="20261009" KOLO="${kolo}" PORADI_DAVKY="${n}" OKRSKY_DAVKA="1" OKRSKY_CELKEM="4718" OKRSKY_ZPRAC="1"/>${body}</VYSLEDKY_OKRSKY>`

describe('parseBatchXml: real 2024 batches', () => {
  it('batch 1: 13 precincts, header and counts', () => {
    const p = parseBatchXml(B1)
    expect(p).toMatchObject({ generated: '2024-09-21T14:30:00', kolo: 1, batch: 1, okrskyDavka: 13, okrskyCelkem: 4718, okrskyZprac: 13 })
    expect(p.precincts).toHaveLength(13)
    expect(p.precincts[0]).toEqual({
      obec: 539601, okrsek: 16005, obvod: 17, seq: 1, repeated: false, voters: 1124, valid: 355,
      votes: { 1: 2, 2: 237, 3: 29, 4: 10, 5: 5, 6: 72 },
    })
  })

  it('batch 2: 19 precincts; candidates with 0 votes are simply absent', () => {
    const p = parseBatchXml(B2)
    expect(p.precincts).toHaveLength(19)
    expect(p.batch).toBe(2)
    const b1 = parseBatchXml(B1).precincts.find((x) => x.obec === 539791)
    expect(Object.keys(b1.votes)).toEqual(['2', '3', '4', '5', '6']) // number 1 had 0 votes
  })

  it('obvody filter: other obvody are checked but not materialised', () => {
    const p = parseBatchXml(B1, { obvody: new Set([17, 23]) })
    expect(p.precincts).toHaveLength(11) // 13 minus obvod 14 and 20
    expect(new Set(p.precincts.map((x) => x.obvod))).toEqual(new Set([17, 23]))
  })
})

describe('parseBatchXml: hand-made and hostile input', () => {
  it('accepts single quotes, comments and a BOM', () => {
    const xml = `\uFEFF<!-- c -->${batch().replace(/"/g, "'")}`
    expect(parseBatchXml(xml).precincts).toHaveLength(1)
  })

  it('OPAKOVANE=1 is flagged', () => {
    const xml = batch({ body: okrsek().replace('OPAKOVANE="0"', 'OPAKOVANE="1"') })
    expect(parseBatchXml(xml).precincts[0].repeated).toBe(true)
  })

  it('CHYBA batch → { chyba }', () => {
    const xml = '<VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI="2026-10-10T14:30:00"><CHYBA KOD_CHYBY="1">neexistujici davka</CHYBA></VYSLEDKY_OKRSKY>'
    expect(parseBatchXml(xml)).toEqual({ chyba: 1, generated: '2026-10-10T14:30:00' })
  })

  it.each([
    ['the HTML 404 page', '\uFEFF<!DOCTYPE html>\n<html><head><title>Chyba 404</title></head><body><h1>404</h1></body></html>', /root element is html/],
    ['garbage', 'hello world', /no VYSLEDKY_OKRSKY root/],
    ['an empty body', '', /no VYSLEDKY_OKRSKY root/],
    ['a wrong root', '<VYSLEDKY DATUM_CAS_GENEROVANI="2026-10-10T14:30:00"></VYSLEDKY>', /root element is VYSLEDKY/],
    ['a truncated document', batch().replace('</VYSLEDKY_OKRSKY>', ''), /truncated/],
    ['a document cut inside an OKRSEK', batch().slice(0, 400), /truncated/],
    ['no generated stamp', batch().replace(' DATUM_CAS_GENEROVANI="2026-10-10T14:30:00"', ''), /DATUM_CAS_GENEROVANI/],
    ['no DAVKA', '<VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI="2026-10-10T14:30:00"></VYSLEDKY_OKRSKY>', /no DAVKA/],
    ['a bad KOLO', batch({ kolo: 3 }), /bad KOLO/],
    ['no OKRSEK at all', batch({ body: '' }), /no OKRSEK/],
    ['a non-numeric CIS_OBEC', batch({ body: okrsek().replace('CIS_OBEC="100"', 'CIS_OBEC="abc"') }), /non-numeric CIS_OBEC/],
    ['a missing PORADI_ZPRAC', batch({ body: okrsek().replace(' PORADI_ZPRAC="1"', '') }), /missing PORADI_ZPRAC/],
    ['an obvod out of 1..81', batch({ body: okrsek({ obvod: 82 }) }), /bad CIS_OBVOD/],
    ['an OKRSEK without UCAST_OKRSEK', batch({ body: okrsek().replace(/<UCAST_OKRSEK[^>]*\/>/, '') }), /missing UCAST_OKRSEK/],
    ['a duplicate HLASY number', batch({ body: okrsek().replace('</OKRSEK>', '<HLASY_OKRSEK PORADOVE_CISLO="1" HLASY="3"/></OKRSEK>') }), /duplicate PORADOVE_CISLO/],
    ['a negative vote count', batch({ body: okrsek({ votes: { 1: -4 } }) }), /non-numeric HLASY/],
    ['content after the root', `${batch()}<x/>`, /content after/],
  ])('throws on %s', (_name, xml, re) => {
    expect(() => parseBatchXml(xml)).toThrow(re)
  })

  it('an OKRSEK the tag regexp cannot read is not silently dropped', () => {
    const bad = batch({ body: okrsek() + '<OKRSEK CIS_OBEC=7 CIS_OKRSEK="1"/>' })
    expect(() => parseBatchXml(bad)).toThrow(/unparsed elements/)
  })
})

describe('manifest helpers', () => {
  it('wantedOf: only relation ticket, from the real manifest (never hard-coded)', () => {
    const w = wantedOf(realManifest)
    expect([...w.entries()].sort((a, b) => a[0] - b[0])).toEqual([[18, 5], [30, 2], [75, 2]])
  })

  it('wantedOf throws when a ticket candidate is not in CANDIDATES', () => {
    expect(() => wantedOf({ PIRATE_BACKED: [{ obvod: 9, no: 9, relation: 'ticket' }], CANDIDATES: {} })).toThrow(/not in CANDIDATES/)
  })

  it('candsOf: ballot numbers of one obvod ascending', () => {
    expect(candsOf(realManifest, 30)).toEqual([1, 2, 3, 4, 5, 6])
    expect(candsOf(realManifest, 18)).toEqual([1, 2, 3, 4, 5, 6])
    expect(candsOf(realManifest, 75)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('accumulator', () => {
  const wanted = new Map([[17, 2]])
  const apply = (round, xml) => applyBatch(round, parseBatchXml(xml), wanted)

  it('keeps only the wanted obvody and counts added / ignored', () => {
    const round = emptyRound()
    const r = apply(round, B1)
    expect(r).toEqual({ added: 5, replaced: 0, ignored: 8 })
    expect(Object.keys(round.precincts)).toHaveLength(5)
    expect(round).toMatchObject({ applied: 1, generated: '2024-09-21T14:30:00' })
    expect(round.precincts['539601:16005']).toEqual([17, 1, 1124, 355, { 1: 2, 2: 237, 3: 29, 4: 10, 5: 5, 6: 72 }])
  })

  it('a precinct re-sent with a higher PORADI_ZPRAC replaces it', () => {
    const round = emptyRound()
    apply(round, batch({ body: okrsek({ seq: 5, valid: 100, votes: { 1: 60, 2: 40 } }) }))
    const r = apply(round, batch({ n: 2, body: okrsek({ seq: 9, valid: 120, votes: { 1: 70, 2: 50 } }) }))
    expect(r).toEqual({ added: 0, replaced: 1, ignored: 0 })
    expect(round.precincts['100:1']).toEqual([17, 9, 500, 120, { 1: 70, 2: 50 }])
  })

  it('an equal or lower PORADI_ZPRAC never overwrites (late re-delivery, re-applied batch)', () => {
    const round = emptyRound()
    apply(round, batch({ body: okrsek({ seq: 9, valid: 120 }) }))
    expect(apply(round, batch({ n: 2, body: okrsek({ seq: 4, valid: 999 }) }))).toEqual({ added: 0, replaced: 0, ignored: 1 })
    expect(apply(round, batch({ n: 3, body: okrsek({ seq: 9, valid: 888 }) }))).toEqual({ added: 0, replaced: 0, ignored: 1 })
    expect(round.precincts['100:1'][3]).toBe(120)
  })

  it('the same precinct number in two obce stays two precincts', () => {
    const round = emptyRound()
    apply(round, batch({ body: okrsek({ obec: 1, seq: 1 }) + okrsek({ obec: 2, seq: 2 }) }))
    expect(Object.keys(round.precincts).sort()).toEqual(['1:1', '2:1'])
  })

  it('an out-of-set obvod is ignored', () => {
    const round = emptyRound()
    expect(apply(round, batch({ body: okrsek({ obvod: 30 }) }))).toEqual({ added: 0, replaced: 0, ignored: 1 })
    expect(round.precincts).toEqual({})
  })

  it('round state survives a JSON round trip (it is persisted as is)', () => {
    const round = emptyRound()
    apply(round, B1)
    expect(JSON.parse(JSON.stringify(round))).toEqual(round)
  })
})

describe('rowsFor', () => {
  it('rows [obec, okrsek, voters, valid, ...votes by cands], sorted; absent votes are 0', () => {
    const round = emptyRound()
    applyBatch(round, parseBatchXml(batch({ body: okrsek({ obec: 9, okrsek: 2, seq: 2, votes: { 2: 7 } }) + okrsek({ obec: 3, okrsek: 1, seq: 1, votes: { 1: 5, 3: 2 } }) })), new Map([[17, 2]]))
    expect(rowsFor(round, 17, [1, 2, 3])).toEqual([
      [3, 1, 500, 100, 5, 0, 2],
      [9, 2, 500, 100, 0, 7, 0],
    ])
    expect(rowsFor(round, 30, [1, 2, 3])).toEqual([])
  })
})
