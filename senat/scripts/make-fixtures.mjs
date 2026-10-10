// Vygeneruje fixtury snapshotu pro testy klienta (spec §3) ze stejných modulů jako Worker:
//   node senat/scripts/make-fixtures.mjs
// snapshot-waiting.json  zmrazený soubor ČSÚ 2026 (před sčítáním), 18 kandidatur Pirátů
// snapshot-r2.json       finální data 2024 (obě kola) s prázdným manifestem
// Meta (refreshedAt…phase) doplňuje Worker při odpovědi; tady jen ruční hodnoty.
import { readFileSync, writeFileSync } from 'node:fs'
import * as manifest from '../../cloudflare-senat/src/manifest.js'
import { parseResultsXml } from '../../cloudflare-senat/src/xml.js'
import { normalize } from '../../cloudflare-senat/src/normalize.js'
import { derive } from '../../cloudflare-senat/src/derive.js'

const read = (n) => readFileSync(new URL(`../../cloudflare-senat/fixtures/${n}`, import.meta.url), 'utf8')
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const R2 = Date.parse('2026-10-17T14:00:00+02:00')
const AFTER = R2 + 86400000 // po obou uzávěrkách: nic se nepotlačuje
const NONE = { CANDIDATES: {}, PIRATE_BACKED: [] }

const build = (text, m) => derive(normalize(parseResultsXml(text), { manifest: m, now: AFTER, pollsCloseR1: R1, pollsCloseR2: R2 }))
const write = (name, snap, phase) => {
  const at = snap.generatedMs + 20000
  const body = { ...snap, refreshedAt: at, nextRefreshAt: at + 60000, servedAt: at, stale: false, phase }
  writeFileSync(new URL(`../src/fixtures/${name}`, import.meta.url), JSON.stringify(body) + '\n')
}

write('snapshot-waiting.json', build(read('se2026-frozen.xml'), manifest), 'waiting')
write('snapshot-r2.json', build(read('se2024-final.xml'), NONE), 'final')
