// Testovací snapshoty všech stavů (obvod/kandidatura) — jen pro testy, do buildu se nedostanou.
// Vychází ze zmrazeného snapshotu 2026 (fixtures/snapshot-waiting.json); odvozená pole
// (state/status/rank/official/majority/summary) dopočítává derive.js Workeru.
import { readFileSync } from 'node:fs'
import { derive } from '../../../cloudflare-senat/src/derive.js'

const read = (n) => JSON.parse(readFileSync(new URL(n, import.meta.url), 'utf8'))
export const waiting = () => read('./snapshot-waiting.json')
export const finalR2 = () => read('./snapshot-r2.json')

const roundOf = (c, z, valid) => ({
  okrskyCelkem: c, okrskyZprac: z, okrskyZpracProc: Math.round((1000 * z) / c) / 10, ucastProc: z ? 61.2 : 0,
  platneHlasy: valid, zapsaniVolici: z * 900, odevzdaneObalky: z * 560,
})

// Nastaví kolo `r` obvodu: `z` sečtených okrsků, `votes` = { <číslo na lístku>: hlasy }, `st` = { <číslo>: příznak }
function setRound(o, r, z, votes, st = {}) {
  const valid = Object.values(votes).reduce((a, b) => a + b, 0)
  o.rounds[r] = roundOf(o.rounds[1].okrskyCelkem, z, valid)
  const [vk, pk, sk] = r === 1 ? ['votes1', 'pct1', 'st1'] : ['votes2', 'pct2', 'st2']
  for (const c of o.candidates) {
    if (r === 2 && !(c.no in votes)) continue
    c[vk] = votes[c.no] ?? 0
    c[pk] = valid ? Math.floor((10000 * c[vk]) / valid) / 100 : 0
    c[sk] = st[c.no] ?? null
  }
}

const obvod = (s, n) => s.obvody.find((o) => o.n === n)
const finish = (s, phase, round) => ({ ...derive(s), phase, round })

// 1. kolo: sčítá se / sečteno bez příznaku / oficiální stavy
export function counting() {
  const s = waiting()
  setRound(obvod(s, 30), 1, 96, { 1: 700, 2: 3600, 3: 500, 4: 1000, 5: 2200, 6: 2000 }) // Šípová vede, Paták druhý
  setRound(obvod(s, 18), 1, 100, { 1: 2500, 2: 2000, 3: 300, 4: 200, 5: 2300, 6: 600 }) // Luftová druhá
  setRound(obvod(s, 21), 1, 70, { 1: 3000, 2: 800, 3: 2800, 4: 500, 5: 700, 6: 2900, 7: 300 }) // Šarapatka mimo
  const c3 = obvod(s, 3)
  setRound(c3, 1, c3.rounds[1].okrskyCelkem, { 1: 9000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000 }) // sečteno, většina
  const c6 = obvod(s, 6)
  setRound(c6, 1, c6.rounds[1].okrskyCelkem, { 1: 2000, 2: 2000, 3: 2000, 4: 3000, 5: 3000, 6: 2000 }) // sečteno, bez většiny
  setRound(obvod(s, 9), 1, 140, { 1: 100, 2: 9000, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 }, { 2: 'ZVOLEN', 1: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN', 6: 'NEZVOLEN', 7: 'NEZVOLEN', 8: 'NEZVOLEN' })
  setRound(obvod(s, 24), 1, 101, { 1: 400, 2: 5000, 3: 300, 4: 200, 5: 100 }, { 2: 'ZVOLEN', 1: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN' }) // mandát Pirátů
  setRound(obvod(s, 27), 1, 92, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 2000, 8: 1900, 9: 100 }, { 7: '2.KOLO', 8: '2.KOLO', 1: 'NEZVOLEN', 2: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN', 6: 'NEZVOLEN', 9: 'NEZVOLEN' }) // Padevět postupuje
  setRound(obvod(s, 33), 1, 143, { 1: 500, 2: 100, 3: 3000, 4: 3200, 5: 200 }, { 3: '2.KOLO', 4: '2.KOLO', 1: 'NEZVOLEN', 2: 'NEZVOLEN', 5: 'NEZVOLEN' }) // Štross nepostupuje
  return finish(s, 'counting', 1)
}

// 2. kolo: průběh, tabulka, shoda hlasů, rozhodnuto
export function runoff() {
  const s = counting()
  // 30: obě finalistky v 2. kole, sčítá se
  const k = obvod(s, 30)
  setRound(k, 1, 150, { 1: 700, 2: 3600, 3: 500, 4: 1000, 5: 2200, 6: 2000 }, { 2: '2.KOLO', 6: '2.KOLO', 1: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN' })
  setRound(k, 2, 50, { 2: 2000, 6: 1900 })
  // 18: sečteno bez příznaku, většina
  const p = obvod(s, 18)
  setRound(p, 1, 268, { 1: 2500, 2: 2000, 3: 300, 4: 200, 5: 2300, 6: 600 }, { 1: '2.KOLO', 5: '2.KOLO', 2: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 6: 'NEZVOLEN' })
  setRound(p, 2, p.rounds[1].okrskyCelkem, { 1: 2900, 5: 3000 })
  // 21: 2. kolo ještě nezačalo (bez rounds[2])
  setRound(obvod(s, 21), 1, 139, { 1: 3000, 2: 2900, 3: 800, 4: 500, 5: 700, 6: 300, 7: 200 }, { 1: '2.KOLO', 2: '2.KOLO', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN', 6: 'NEZVOLEN', 7: 'NEZVOLEN' })
  // 48: Grulich prohrál 2. kolo
  const g = obvod(s, 48)
  setRound(g, 1, 242, { 1: 4000, 2: 3900 }, { 1: '2.KOLO', 2: '2.KOLO' })
  setRound(g, 2, 242, { 1: 5200, 2: 4600 }, { 1: 'ZVOLEN', 2: 'NEZVOLEN' })
  // 57: shoda hlasů ve 2. kole (Grolich)
  const v = obvod(s, 57)
  setRound(v, 1, 166, { 1: 2100, 2: 2200, 3: 1500 }, { 1: '2.KOLO', 2: '2.KOLO', 3: 'NEZVOLEN' })
  setRound(v, 2, 166, { 1: 3000, 2: 3000 }, { 1: 'NEZVOLEN_SHODA_HLASU', 2: 'NEZVOLEN_SHODA_HLASU' })
  // 60: 2. kolo bez hlasů (z = 0, příznak z 1. kola)
  const b = obvod(s, 60)
  setRound(b, 1, 123, { 1: 3000, 2: 200, 3: 200, 4: 2900, 5: 200, 6: 200 }, { 1: '2.KOLO', 4: '2.KOLO', 2: 'NEZVOLEN', 3: 'NEZVOLEN', 5: 'NEZVOLEN', 6: 'NEZVOLEN' })
  setRound(b, 2, 0, { 1: 0, 4: 0 })
  return finish(s, 'counting', 2)
}

// Mezi koly: 1. kolo skončilo, 2. kolo ještě nezačalo. Server do zavření místností 2. kola žádná data
// 2. kola neposílá, takže snapshot má round 1, phase idle a obvody míří do 2. kola (state 'runoff').
export function betweenRounds() {
  const s = counting()
  const flags = (win) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, win.includes(n) ? '2.KOLO' : 'NEZVOLEN']))
  for (const [n, win] of [[30, [2, 6]], [18, [1, 5]]]) {
    const o = obvod(s, n)
    const votes = n === 30 ? { 1: 700, 2: 3600, 3: 500, 4: 1000, 5: 2200, 6: 2000 } : { 1: 2500, 2: 2000, 3: 300, 4: 200, 5: 2300, 6: 600 }
    setRound(o, 1, o.rounds[1].okrskyCelkem, votes, flags(win))
  }
  return { ...derive(s), phase: 'idle', round: 1 }
}

// 2. kolo v obvodu 30, kde navíc kandidatura č. 1 (Piráti, 4 221 hlasů v 1. kole) do 2. kola nepostoupila
export function runoffEliminatedPirate() {
  const s = runoff()
  const k = obvod(s, 30)
  k.candidates.find((c) => c.no === 1).pirate = 'ticket'
  setRound(k, 1, 150, { 1: 4221, 2: 5200, 3: 500, 4: 1000, 5: 2200, 6: 4800 }, { 2: '2.KOLO', 6: '2.KOLO', 1: 'NEZVOLEN', 3: 'NEZVOLEN', 4: 'NEZVOLEN', 5: 'NEZVOLEN' })
  return finish(s, 'counting', 2)
}

// Kopie snapshotu s přepsanými hlasy kola `r` obvodu `n` (`celkem` = počet okrsků obvodu), znovu odvozená
export function withVotes(s, n, r, z, votes, st = {}, celkem) {
  const x = structuredClone(s)
  const o = obvod(x, n)
  if (celkem) for (const k of [1, 2]) if (o.rounds[k]) o.rounds[k].okrskyCelkem = celkem
  setRound(o, r, z, votes, st)
  return finish(x, s.phase, s.round)
}

// Jen vybrané pole se v testu zbaví registrových textů (jména, strany, povolání, obvody)
export function scrubRegistry(s) {
  const x = structuredClone(s)
  for (const o of x.obvody) {
    o.name = 'Obvod'
    for (const c of o.candidates) {
      for (const k of ['name', 'pre', 'post', 'party', 'member', 'ballotLabel', 'job', 'residence']) if (c[k]) c[k] = 'X'
    }
  }
  return x
}
