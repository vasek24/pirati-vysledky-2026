#!/usr/bin/env node
// Mock ČSÚ upstream for Senate drills: serves a ČSÚ-shaped odata/vysledky.xml built from the REAL
// frozen fixture (fixtures/se2026-frozen.xml: structure, names, ballot numbers) by a scripted scenario.
// Local only (binds 127.0.0.1). Never point production or staging at it; see docs/ops/senat-qa-plan.md.
//
//   node cloudflare-senat/scripts/mock-upstream.mjs [--port 8797] [--stage frozen] [--seed 2026]
//        [--auto] [--step-sec 60] [--regen-sec 0]
//
// Control (GET or POST):  /stage            current stage + what the Worker must derive from it
//                         /stage/<name>     switch stage (new generated stamp, new ETag)
//                         /stats            request counters and timestamps   POST /stats/reset
//                         /vysled/obvod/<n>.json, /mapa_vitez.json, /navig/obvody.json  (ČSÚ side files, for verify-against-csu)
//                         /fault/500|html|slow|truncate|off   (?count=N clears itself after N hits;
//                                           slow: ?ms=15000)
import http from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseResultsXml } from '../src/xml.js'
import { PIRATE_BACKED } from '../src/manifest.js'

export const STAGES = [
  'frozen', 'counting-25', 'counting-60', 'counted-awaiting-flags', 'official-r1',
  'runoff-counting', 'runoff-counted', 'official-r2',
]
// f1/f2: share of precincts counted per obvod (jittered per obvod, 1 = all); flags1/flags2: official ČSÚ flags
const SPEC = {
  frozen: { f1: 0 },
  'counting-25': { f1: 0.25 },
  'counting-60': { f1: 0.6 },
  'counted-awaiting-flags': { f1: 1 },
  'official-r1': { f1: 1, flags1: true },
  'runoff-counting': { f1: 1, flags1: true, f2: 0.4 },
  'runoff-counted': { f1: 1, flags1: true, f2: 1 },
  'official-r2': { f1: 1, flags1: true, f2: 1, flags2: true },
}
const FIXTURE = fileURLToPath(new URL('../fixtures/se2026-frozen.xml', import.meta.url))
const DOMINANT_COUNT = 6 // obvody won outright in round 1 (> 50 %)

// ---- seeded RNG and integer helpers ---------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// integers summing exactly to `total`, proportional to weights (largest remainder)
export function apportion(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (total * w) / sum)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++
  return out
}

// ČSÚ truncates candidate percentages to 2 decimals (integer arithmetic, no float surprises)
export function truncPct(part, whole) {
  if (!whole) return '0.00'
  let q = Math.floor((part * 10000) / whole)
  if ((q + 1) * whole <= part * 10000) q++
  if (q * whole > part * 10000) q--
  return (q / 100).toFixed(2)
}
const roundPct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(2) : '0.00')

// Zone-less Prague local time, as ČSÚ writes DATUM_CAS_GENEROVANI
export function pragueLocal(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

// ---- scenario: per-precinct final numbers, generated once per seed ----------------------------
// One precinct = votes per candidate; envelopes and registered voters are derived from the votes,
// so every prefix of precincts is internally consistent (Σ votes = PLATNE_HLASY, issued >= returned >= valid).
function genPrecincts(rng, count, shares, avgValid, turnoutLo, turnoutHi) {
  const out = []
  for (let p = 0; p < count; p++) {
    const size = Math.max(20, Math.round(avgValid * (0.6 + 0.8 * rng())))
    const votes = apportion(size, shares.map((s) => s * (0.7 + 0.6 * rng())))
    const valid = votes.reduce((a, b) => a + b, 0)
    const returned = valid + Math.round(valid * 0.02) + (rng() < 0.5 ? 1 : 0)
    const issued = returned + (rng() < 0.3 ? 1 : 0)
    const registered = Math.round(issued / (turnoutLo + (turnoutHi - turnoutLo) * rng()))
    out.push({ votes, issued, returned, registered })
  }
  return out
}

// make the two finalists' totals equal by moving votes between precincts, last precinct first
function forceTie(precincts) {
  let d = add(precincts, (p) => p.votes[0] - p.votes[1])
  if (d % 2) {
    const last = precincts[precincts.length - 1]
    last.votes[d > 0 ? 1 : 0]++
    last.returned++
    last.issued++
    last.registered++
    d += d > 0 ? -1 : 1
  }
  let move = Math.abs(d) / 2
  const from = d > 0 ? 0 : 1
  for (let p = precincts.length - 1; p >= 0 && move > 0; p--) {
    const take = Math.min(move, precincts[p].votes[from] - 1)
    precincts[p].votes[from] -= take
    precincts[p].votes[1 - from] += take
    move -= take
  }
}

function buildObvod(po, seed, role) {
  const rng = mulberry32(seed ^ Math.imul(po.n, 2654435761))
  const cands = po.candidates
  const C = po.ucast[1].okrskyCelkem
  const k = cands.length
  const u1 = rng()
  const u2 = rng()
  const w = cands.map(() => 0.25 + rng())
  if (role === 'dominant') {
    const lead = Math.floor(rng() * k)
    const others = w.reduce((a, b) => a + b, 0) - w[lead]
    w[lead] = others * (1.3 + rng() * 0.8)
  }
  const norm = () => w.map((x) => x / w.reduce((a, b) => a + b, 0))
  if (role !== 'dominant') {
    for (let i = 0; i < 200; i++) {
      const s = norm()
      const m = s.indexOf(Math.max(...s))
      if (s[m] <= 0.45) break
      w[m] *= 0.9
    }
  }
  const shares1 = norm()
  const avg = 200 + Math.floor(rng() * 180)
  const r1 = genPrecincts(rng, C, shares1, avg, 0.25, 0.45)
  const total1 = cands.map((_, i) => add(r1, (p) => p.votes[i]))
  const order = total1.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1])
  let r2 = null
  let finalists = null
  let winner = null
  if (role !== 'dominant') {
    finalists = order.slice(0, 2)
    const share = role === 'tie' ? 0.5 : 0.52 + rng() * 0.1
    winner = role === 'tie' ? null : rng() < 0.6 ? finalists[0] : finalists[1]
    const s2 = winner === null || winner === finalists[0] ? [share, 1 - share] : [1 - share, share]
    r2 = genPrecincts(rng, C, s2, Math.round(avg * 0.55), 0.15, 0.3)
    if (role === 'tie') forceTie(r2)
  }
  return { n: po.n, name: po.name, cands, C, u1, u2, role, r1, r2, finalists, winner, leader: order[0] }
}

export function buildScenario(fixtureXml = readFileSync(FIXTURE, 'utf8'), seed = 2026) {
  const parsed = parseResultsXml(fixtureXml)
  const head = fixtureXml.slice(0, fixtureXml.indexOf('<OBVOD'))
  const draw = parsed.obvody.map((o) => [mulberry32(seed ^ Math.imul(o.n, 40503))(), o.n])
  draw.sort((a, b) => a[0] - b[0])
  const dominant = new Set(draw.slice(0, DOMINANT_COUNT).map((x) => x[1]))
  const tieN = draw.slice(DOMINANT_COUNT).find(([, n]) => parsed.obvody.find((o) => o.n === n).candidates.length > 2)[1]
  const obvody = parsed.obvody.map((po) => buildObvod(po, seed, dominant.has(po.n) || po.candidates.length <= 2 ? 'dominant' : po.n === tieN ? 'tie' : 'runoff'))
  return { seed, head, obvody, cache: new Map() }
}

// ---- stage model: what the file says at a stage -----------------------------------------------
const countedAt = (f, C, u) => (!f ? 0 : f >= 1 ? C : Math.min(C - 1, Math.max(1, Math.round(C * f * (0.6 + 0.8 * u)))))
const add = (rows, f) => rows.reduce((a, p) => a + f(p), 0)

function ucastOf(rows, z, C) {
  const part = rows.slice(0, z)
  return {
    okrskyCelkem: C,
    okrskyZprac: z,
    zapsani: add(part, (p) => p.registered),
    vydane: add(part, (p) => p.issued),
    odevzdane: add(part, (p) => p.returned),
    platne: add(part, (p) => p.votes.reduce((x, y) => x + y, 0)),
  }
}

export function stageModel(scenario, stage) {
  const spec = SPEC[stage]
  if (!spec) throw new Error(`unknown stage ${stage}`)
  const hit = scenario.cache.get(stage)
  if (hit) return hit
  const obvody = scenario.obvody.map((o) => {
    const z1 = countedAt(spec.f1, o.C, o.u1)
    const z2 = o.r2 && spec.f2 ? countedAt(spec.f2, o.C, o.u2) : null
    const u1 = ucastOf(o.r1, z1, o.C)
    const u2 = z2 === null ? null : ucastOf(o.r2, z2, o.C)
    const candidates = o.cands.map((c, i) => {
      const fi = o.finalists ? o.finalists.indexOf(i) : -1
      const votes1 = add(o.r1.slice(0, z1), (p) => p.votes[i])
      const votes2 = z2 !== null && fi >= 0 ? add(o.r2.slice(0, z2), (p) => p.votes[fi]) : null
      let st1 = null
      if (spec.flags1) st1 = o.role === 'dominant' ? (i === o.leader ? 'ZVOLEN' : 'NEZVOLEN') : fi >= 0 ? '2.KOLO' : 'NEZVOLEN'
      let st2 = null
      if (spec.flags2 && fi >= 0) st2 = o.role === 'tie' ? 'NEZVOLEN_SHODA_HLASU' : i === o.winner ? 'ZVOLEN' : 'NEZVOLEN'
      return { no: c.no, first: c.first, last: c.last, pre: c.pre, post: c.post, votes1, votes2, st1, st2 }
    })
    return { n: o.n, name: o.name, role: o.role, u1, u2, candidates }
  })
  const country = { 1: countryOf(obvody, 'u1') }
  const second = obvody.filter((o) => o.u2)
  if (second.length) country[2] = countryOf(second, 'u2')
  const model = { stage, obvody, country }
  scenario.cache.set(stage, model)
  return model
}

function countryOf(obvody, key) {
  const t = { okrskyCelkem: 0, okrskyZprac: 0, zapsani: 0, vydane: 0, odevzdane: 0, platne: 0 }
  for (const o of obvody) for (const k of Object.keys(t)) t[k] += o[key][k]
  return t
}

// ---- XML rendering (attribute order as in the real file) --------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function ucastXml(kolo, u) {
  const valid = u.platne
  return `<UCAST KOLO="${kolo}" OKRSKY_CELKEM="${u.okrskyCelkem}" OKRSKY_ZPRAC="${u.okrskyZprac}" `
    + `OKRSKY_ZPRAC_PROC="${roundPct(u.okrskyZprac, u.okrskyCelkem)}" ZAPSANI_VOLICI="${u.zapsani}" VYDANE_OBALKY="${u.vydane}" `
    + `UCAST_PROC="${roundPct(u.vydane, u.zapsani)}" VOLICSKE_PRUKAZY="0" ODEVZDANE_OBALKY="${u.odevzdane}" `
    + `PLATNE_HLASY="${valid}" PLATNE_HLASY_PROC="${roundPct(valid, u.odevzdane)}"/>`
}

export function renderXml(scenario, model, generated) {
  const lines = [scenario.head.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, `DATUM_CAS_GENEROVANI="${generated}"`).replace(/\n$/, '')]
  for (const o of model.obvody) {
    lines.push(`<OBVOD CISLO="${o.n}" NAZEV="${esc(o.name)}">`)
    for (const c of o.candidates) {
      let a = `<KANDIDAT PORADOVE_CISLO="${c.no}" JMENO="${esc(c.first)}" PRIJMENI="${esc(c.last)}" TITULPRED="${esc(c.pre)}" TITULZA="${esc(c.post)}" `
        + `HLASY_1KOLO="${c.votes1}" HLASY_PROC_1KOLO="${truncPct(c.votes1, o.u1.platne)}"`
      if (c.st1) a += ` ZVOLEN_1KOLO="${c.st1}"`
      if (c.votes2 !== null) a += ` HLASY_2KOLO="${c.votes2}" HLASY_PROC_2KOLO="${truncPct(c.votes2, o.u2.platne)}"`
      if (c.st2) a += ` ZVOLEN_2KOLO="${c.st2}"`
      lines.push(`${a}/>`)
    }
    lines.push(ucastXml(1, o.u1))
    if (o.u2) lines.push(ucastXml(2, o.u2))
    lines.push('</OBVOD>')
  }
  lines.push('<CELKEM>', ucastXml(1, model.country[1]))
  if (model.country[2]) lines.push(ucastXml(2, model.country[2]))
  lines.push('</CELKEM>', '</VYSLEDKY>', '')
  return lines.join('\n')
}

// ---- what the Worker must derive (independent restatement of spec §2, §3.1; no import of derive.js) ----
function stateOfObvod(o) {
  const flags = o.candidates.flatMap((c) => [c.st1, c.st2])
  if (flags.includes('ZVOLEN')) return 'elected'
  if (flags.includes('NEZVOLEN_SHODA_HLASU')) return 'tie'
  if (o.u2) return o.u2.okrskyZprac === o.u2.okrskyCelkem ? 'runoff-counted' : o.u2.okrskyZprac > 0 ? 'runoff-counting' : 'runoff'
  if (flags.includes('2.KOLO')) return 'runoff'
  if (o.u1.okrskyZprac === 0) return 'waiting'
  return o.u1.okrskyZprac < o.u1.okrskyCelkem ? 'counting' : 'counted'
}

function officialStatus(c, o) {
  if (c.st2 === 'ZVOLEN' || c.st1 === 'ZVOLEN') return 'elected'
  if (c.st2 === 'NEZVOLEN_SHODA_HLASU') return 'runoffTie'
  if (c.st2 === 'NEZVOLEN') return 'runoffLost'
  if (c.st1 === 'NEZVOLEN') return 'notAdvancing'
  if (o.u2 && o.u2.okrskyZprac > 0 && c.votes2 !== null) return null
  return c.st1 === '2.KOLO' ? 'advancing' : null
}

export function expectOf(model) {
  const states = Object.fromEntries(model.obvody.map((o) => [o.n, stateOfObvod(o)]))
  const count = (...s) => Object.values(states).filter((v) => s.includes(v)).length
  const terminal = (v) => v === 'elected' || v === 'tie'
  const all = Object.values(states)
  const phase = all.every(terminal) ? 'final'
    : all.every((v) => terminal(v) || v === 'runoff') ? 'idle'
      : all.every((v) => v === 'waiting') ? 'waiting' : 'counting'
  const official = { elected: 0, advancing: 0, notAdvancing: 0, runoffLost: 0, runoffTie: 0 }
  let unofficial = 0
  for (const p of PIRATE_BACKED) {
    const o = model.obvody.find((x) => x.n === p.obvod)
    const st = officialStatus(o.candidates.find((c) => c.no === p.no), o)
    if (st) official[st]++
    else unofficial++
  }
  return {
    round: model.obvody.some((o) => o.u2) ? 2 : 1,
    phase,
    states,
    summary: {
      obvody: model.obvody.length,
      decided: count('elected'),
      runoff: count('runoff', 'runoff-counting'),
      awaitingOfficial: count('counted', 'runoff-counted'),
      counting: count('counting'),
      waiting: count('waiting'),
      ties: count('tie'),
    },
    pirates: { total: PIRATE_BACKED.length, official, unofficial },
    tieObvod: model.obvody.find((o) => o.role === 'tie')?.n ?? null,
  }
}

// ---- ČSÚ JSON side files (vysled/obvod/<n>.json, mapa_vitez.json, navig/obvody.json), same numbers as the XML ----
const num2 = (part, whole) => Number(truncPct(part, whole))
const prehledRow = (kolo, u) => [kolo, u.okrskyCelkem, u.okrskyZprac, Number(roundPct(u.okrskyZprac, u.okrskyCelkem)), u.zapsani, u.vydane, Number(roundPct(u.vydane, u.zapsani)), 0, u.odevzdane, u.platne, Number(roundPct(u.platne, u.odevzdane))]

export function obvodJson(model, n, generated) {
  const o = model.obvody.find((x) => x.n === n)
  if (!o) return null
  const counted = o.u1.okrskyZprac > 0
  const head = { id: `20261009/vysled/obvod/${n}.json`, param: { typ: 'VYSL_OBVOD', datumvoleb: 20261009, obvod: n }, generovano: generated, popis: 'Výsledek za senátní obvod', obvodNazev: o.name }
  if (!counted) return { ...head, prehled: [], existujePdf: false, vysledky: [], postupuje: [], zvoleny: null } // as the real file before counting
  const elected = o.candidates.find((c) => c.st1 === 'ZVOLEN' || c.st2 === 'ZVOLEN')
  return {
    ...head,
    prehled: [prehledRow(1, o.u1), ...(o.u2 ? [prehledRow(2, o.u2)] : [])],
    existujePdf: false,
    vysledky: o.candidates.map((c) => [
      c.no, `${c.last} ${c.first}${c.pre ? ` ${c.pre}` : ''}${c.post ? ` ${c.post}` : ''}`, '-', '-', '-',
      c.votes1, num2(c.votes1, o.u1.platne),
      o.u2 ? (c.votes2 ?? 0) : null, o.u2 ? (c.votes2 === null ? 0 : num2(c.votes2, o.u2.platne)) : null, false, false,
    ]),
    postupuje: o.candidates.filter((c) => c.st1 === '2.KOLO').map((c) => c.no),
    zvoleny: elected ? elected.no : null,
  }
}

export function mapaJson(model, generated) {
  const obvody = {}
  for (const o of model.obvody) {
    const rd = o.u2 ? 2 : 1
    const u = rd === 2 ? o.u2 : o.u1
    const key = rd === 2 ? 'votes2' : 'votes1'
    const taking = o.candidates.filter((c) => c[key] !== null && (rd === 1 || c.st1 === '2.KOLO'))
    const best = Math.max(0, ...taking.map((c) => c[key]))
    const leaders = u.okrskyZprac > 0 && best > 0 ? taking.filter((c) => c[key] === best) : []
    const state = stateOfObvod(o)
    obvody[o.n] = {
      obvodNazev: o.name, pocetVitezu: leaders.length || null, kolo: rd, kandCislo: leaders.length === 1 ? leaders[0].no : null,
      kandJmeno: leaders.length === 1 ? `${leaders[0].last} ${leaders[0].first}` : null, stranaZkratka: null, stranaBarva: 'FFFFFF',
      hlasu: leaders.length ? best : 0, procHlasu: leaders.length === 1 ? num2(best, u.platne) : 0, procZprac: Number(roundPct(u.okrskyZprac, u.okrskyCelkem)),
      ukonceno: state === 'elected' || state === 'tie', stavZvolen: state === 'elected' ? 1 : 0,
    }
  }
  return { id: '20261009/mapa_vitez.json', param: { typ: 'STAV_MAPA_VITEZ', datumvoleb: 20261009 }, generovano: generated, popis: 'Data pro mapu - vítezný kandidát v senátním obvodu', obvody }
}

export function navigJson(model, generated) {
  return {
    id: '20261009/navig/obvody.json', param: { typ: 'NAVIG_OBVODY', datumvoleb: 20261009 }, generovano: generated, popis: 'Seznam senátních obvodů',
    obvody: model.obvody.map((o) => {
      const elected = stateOfObvod(o) === 'elected'
      return { obvod: o.n, nazevObvodu: o.name, odvolaniKandidati: false, zvoleno: elected, zvoleno_kolo: elected ? (o.candidates.some((c) => c.st2 === 'ZVOLEN') ? 2 : 1) : null, existujePDF_K1: false, existujePDF_K2: false }
    }),
  }
}

// ---- HTTP server ----------------------------------------------------------------------------------
const httpDate = (ms) => new Date(Math.floor(ms / 1000) * 1000).toUTCString()

export function createMock({ seed = 2026, stage = 'frozen', now = Date.now } = {}) {
  const scenario = buildScenario(undefined, seed)
  const st = {
    stage, generatedAt: 0, body: '', etag: '', fault: null, faultLeft: null, slowMs: 15000,
    requests: [], uaSeen: new Set(), otherPaths: [], sideRequests: [],
  }
  function generate() {
    st.generatedAt = now()
    st.body = renderXml(scenario, stageModel(scenario, st.stage), pragueLocal(st.generatedAt))
    st.etag = `"${createHash('sha1').update(st.body).digest('hex').slice(0, 8)}-${st.body.length.toString(16)}"`
  }
  generate()
  const json = (res, code, obj, extra = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra })
    res.end(JSON.stringify(obj, null, 2))
  }
  const view = () => ({
    stage: st.stage, stages: STAGES, generated: pragueLocal(st.generatedAt), etag: st.etag, bytes: st.body.length,
    fault: st.fault, expect: expectOf(stageModel(scenario, st.stage)),
  })
  function sideFile(path) {
    const model = stageModel(scenario, st.stage)
    const generated = pragueLocal(st.generatedAt)
    const m = /^\/vysled\/obvod\/(\d+)\.json$/.exec(path)
    if (m) {
      const body = obvodJson(model, Number(m[1]), generated)
      return body ? { code: 200, body } : { code: 404, body: { error: 'no such obvod' } }
    }
    if (path === '/mapa_vitez.json') return { code: 200, body: mapaJson(model, generated) }
    if (path === '/navig/obvody.json') return { code: 200, body: navigJson(model, generated) }
    return null
  }
  function stats() {
    const r = st.requests
    const by = (code) => r.filter((x) => x.status === code).length
    return {
      total: r.length, full200: by(200), notModified304: by(304), errors: r.filter((x) => x.status >= 500).length,
      conditional: r.filter((x) => x.conditional).length, userAgents: [...st.uaSeen], otherPaths: st.otherPaths, sideRequests: st.sideRequests, requests: r,
    }
  }
  function setFault(kind, count) {
    st.fault = kind === 'off' ? null : kind
    st.faultLeft = kind === 'off' || !count ? null : count
  }

  async function serveXml(req, res) {
    const t = now()
    const entry = { t, status: 0, conditional: Boolean(req.headers['if-none-match'] || req.headers['if-modified-since']), stage: st.stage, fault: st.fault }
    st.requests.push(entry)
    st.uaSeen.add(req.headers['user-agent'] || '(none)')
    const fault = st.fault
    if (fault && st.faultLeft !== null && --st.faultLeft <= 0) setFault('off')
    const base = { 'content-type': 'text/xml', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' }
    if (fault === 'slow') await new Promise((ok) => setTimeout(ok, st.slowMs))
    if (fault === '500') {
      entry.status = 500
      res.writeHead(500, { 'content-type': 'text/plain' })
      return res.end('Internal Server Error')
    }
    if (fault === 'html') { // a proxy / maintenance page served as 200
      entry.status = 200
      const html = '<!DOCTYPE html><html><head><title>Údržba</title></head><body>Stránka je dočasně nedostupná.</body></html>'
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache', 'content-length': Buffer.byteLength(html), etag: `"html-${st.generatedAt}"` })
      return res.end(html)
    }
    const hdr = { ...base, 'last-modified': httpDate(st.generatedAt), etag: st.etag, expires: httpDate(st.generatedAt + 60000) }
    const inm = req.headers['if-none-match']
    const ims = Date.parse(req.headers['if-modified-since'] ?? '')
    const unchanged = inm ? inm.split(',').map((s) => s.trim()).includes(st.etag) : Number.isFinite(ims) && ims >= Math.floor(st.generatedAt / 1000) * 1000
    if (unchanged && fault !== 'truncate') {
      entry.status = 304
      res.writeHead(304, hdr)
      return res.end()
    }
    let body = st.body
    if (fault === 'truncate') body = body.slice(0, Math.floor(body.length * 0.55))
    entry.status = 200
    res.writeHead(200, { ...hdr, 'content-length': Buffer.byteLength(body) })
    return res.end(req.method === 'HEAD' ? undefined : body)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock')
    const path = url.pathname.replace(/^\/appdata\/senat\/\d+/, '')
    const [, a, b] = path.split('/')
    if (path === '/odata/vysledky.xml' && (req.method === 'GET' || req.method === 'HEAD')) return void serveXml(req, res)
    if (path === '/stage' && !b) return json(res, 200, view())
    if (a === 'stage' && b) {
      if (!SPEC[b]) return json(res, 404, { error: `unknown stage ${b}`, stages: STAGES })
      st.stage = b
      generate()
      return json(res, 200, view())
    }
    if (a === 'fault' && b) {
      if (!['500', 'html', 'slow', 'truncate', 'off'].includes(b)) return json(res, 404, { error: `unknown fault ${b}` })
      if (url.searchParams.get('ms')) st.slowMs = Number(url.searchParams.get('ms'))
      setFault(b, Number(url.searchParams.get('count')) || null)
      return json(res, 200, { fault: st.fault, left: st.faultLeft, slowMs: st.slowMs })
    }
    const side = sideFile(path)
    if (side) {
      st.sideRequests.push({ path, ua: req.headers['user-agent'] ?? '(none)' })
      return json(res, side.code, side.body, { 'access-control-allow-origin': '*' })
    }
    if (a === 'regen') { // new generated stamp and ETag, same content
      generate()
      return json(res, 200, view())
    }
    if (path === '/stats') return json(res, 200, stats())
    if (path === '/stats/reset') {
      st.requests = []
      st.uaSeen = new Set()
      st.otherPaths = []
      st.sideRequests = []
      return json(res, 200, { reset: true })
    }
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('ok')
    }
    st.otherPaths.push(path) // the Worker must request nothing but odata/vysledky.xml
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('not found')
  })
  return { server, state: st, setStage: (s) => { st.stage = s; generate() }, regen: generate, view, scenario }
}

// ---- CLI ----------------------------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    process.exit(0)
  }
  const port = Number(arg('port', 8797))
  const mock = createMock({ seed: Number(arg('seed', 2026)), stage: arg('stage', 'frozen') })
  const stepSec = Number(arg('step-sec', 60))
  const regenSec = Number(arg('regen-sec', 0))
  mock.server.listen(port, '127.0.0.1', () => {
    console.log(`mock ČSÚ upstream on http://127.0.0.1:${port}  (stage ${mock.state.stage}; stages: ${STAGES.join(' > ')})`)
    console.log(`Worker: wrangler dev --local --port 8799 --var CSU_BASE:http://127.0.0.1:${port} --var POLLS_CLOSE_R2:2026-10-10T14:00:01+02:00`)
  })
  if (process.argv.includes('--auto')) {
    setInterval(() => {
      const i = STAGES.indexOf(mock.state.stage)
      if (i < STAGES.length - 1) {
        mock.setStage(STAGES[i + 1])
        console.log(`auto: stage -> ${mock.state.stage}`)
      }
    }, stepSec * 1000).unref()
  }
  if (regenSec > 0) setInterval(() => mock.regen(), regenSec * 1000).unref()
}
