import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CANDIDATES, PIRATE_BACKED } from './manifest.js'
import { parseResultsXml } from './xml.js'

const frozen = parseResultsXml(readFileSync(new URL('../fixtures/se2026-frozen.xml', import.meta.url), 'utf8'))
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

test('registry covers all 154 candidates', () => {
  expect(Object.keys(CANDIDATES)).toHaveLength(154)
})

test('18 Pirate-backed entries: 3 tickets (all Česká pirátská strana, code 720), 15 endorsed', () => {
  expect(PIRATE_BACKED).toHaveLength(18)
  expect(new Set(PIRATE_BACKED.map((p) => `${p.obvod}:${p.no}`)).size).toBe(18)
  const tickets = PIRATE_BACKED.filter((p) => p.relation === 'ticket')
  expect(tickets.map((p) => `${p.obvod}:${p.no}`).sort()).toEqual(['18:5', '30:2', '75:2'])
  for (const t of tickets) {
    expect(CANDIDATES[`${t.obvod}:${t.no}`]).toMatchObject({ partyCode: 720, party: 'Česká pirátská strana' })
  }
  expect(PIRATE_BACKED.filter((p) => p.relation === 'endorsed')).toHaveLength(15)
  expect(Object.values(CANDIDATES).filter((c) => c.partyCode === 720)).toHaveLength(3)
})

test('every manifest key exists in the frozen XML with a matching surname', () => {
  const xml = new Map(frozen.obvody.flatMap((o) => o.candidates.map((c) => [`${o.n}:${c.no}`, c])))
  expect([...xml.keys()].sort()).toEqual(Object.keys(CANDIDATES).sort())
  for (const [key, reg] of Object.entries(CANDIDATES)) {
    expect(fold(xml.get(key).last), key).toContain(fold(reg.last))
  }
  for (const p of PIRATE_BACKED) expect(xml.has(`${p.obvod}:${p.no}`)).toBe(true)
})

test('ballot label of 27:7 names the Pirates', () => {
  expect(CANDIDATES['27:7'].ballotLabel).toMatch(/pirátské/i)
  expect(CANDIDATES['27:7']).toMatchObject({ last: 'Padevět', party: 'STAROSTOVÉ A NEZÁVISLÍ' })
})
