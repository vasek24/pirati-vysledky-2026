#!/usr/bin/env node
// Election-night truth check (read-only). Compares OUR /api/senat with ČSÚ's independent sources:
//   odata/vysledky.xml (what the Worker consumes, parsed with the project parser)
//   vysled/obvod/<n>.json (separately produced, positional arrays), mapa_vitez.json, navig/obvody.json
// and recomputes state/rank/status/outlook with rules written here (derive.js is NOT imported).
//
//   node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz [--obvod 30] [--json] [--strict]
//        [--max-lag-sec 120] [--fail-lag-sec 900] [--no-cache] [--delay-ms 250] [--csu-base <url>]
//
// Politeness: own User-Agent, one request per ČSÚ file per run (31 for a full run), conditional GET
// (ETag/Last-Modified kept in a temp cache), 250 ms between requests, 15 s timeout, no retries.
// Run it at most every ~10 minutes. Exit 1 when any 'fail' mismatch exists (--strict: 'lag' too).
//
// Severities: fail = real difference (same generation stamp on both sides, or a broken invariant);
// lag = the two sides carry different generation stamps, so the difference may just be timing
// (re-run; it must vanish); note = compared but semantics not fully verified (never fails).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseResultsXml } from '../src/xml.js'
import { parsePragueTime } from '../src/time.js'

export const USER_AGENT = 'pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)'
export const CSU_BASE = 'https://volby.gov.cz/appdata/senat/20261009'
const PCT_TOL = 0.0051 // ČSÚ rounds/truncates ratios differently per field; the candidate percentages are exact
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const same = (a, b, tol = 0) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol)

// ---- mismatch collection -------------------------------------------------------------------------------------
export function collector() {
  const items = []
  return {
    items,
    // sev: 'fail' | 'lag' | 'note'; a and b are the two compared values
    add: (obvod, group, field, ours, theirs, sev, note = '') => items.push({ obvod, group, field, ours, theirs, sev, note }),
    eq(obvod, group, field, ours, theirs, sev, tol = 0) {
      if (!same(ours, theirs, tol)) items.push({ obvod, group, field, ours, theirs, sev, note: '' })
    },
  }
}
// same generation stamp on both sides -> a difference is a real failure, else it may be timing
export const sevFor = (stampA, stampB) => (stampA && stampA === stampB ? 'fail' : 'lag')

const ROUND_KEYS = ['okrskyCelkem', 'okrskyZprac', 'platneHlasy', 'zapsaniVolici', 'odevzdaneObalky']
const ROUND_PCT = ['okrskyZpracProc', 'ucastProc']

// ---- G1: our snapshot vs ČSÚ XML (same file we consume: did our pipeline keep every number?) -------------------
export function compareOursToXml(ours, xml, only = null) {
  const c = collector()
  const sev = sevFor(ours.generated, xml.generated)
  const xmlBy = new Map(xml.obvody.map((o) => [o.n, o]))
  const ourBy = new Map(ours.obvody.map((o) => [o.n, o]))
  c.eq('*', 'ours-vs-xml', 'generated', ours.generated, xml.generated, 'note')
  if (!only) c.eq('*', 'ours-vs-xml', 'obvody count', ours.obvody.length, xml.obvody.length, 'fail')
  for (const [n, x] of xmlBy) {
    if (only && n !== only) continue
    const o = ourBy.get(n)
    if (!o) { c.add(n, 'ours-vs-xml', 'obvod', 'missing', 'present', 'fail'); continue }
    c.eq(n, 'ours-vs-xml', 'name', o.name, x.name, 'fail')
    for (const r of [1, 2]) {
      const a = o.rounds?.[r]
      const b = x.ucast?.[r]
      if (!a && !b) continue
      if (!a || !b) { c.add(n, 'ours-vs-xml', `round ${r}`, a ? 'present' : 'absent', b ? 'present' : 'absent', sev); continue }
      for (const k of ROUND_KEYS) if (b[k] != null || a[k] != null) c.eq(n, 'ours-vs-xml', `round ${r} ${k}`, a[k], b[k], sev)
      for (const k of ROUND_PCT) if (b[k] != null || a[k] != null) c.eq(n, 'ours-vs-xml', `round ${r} ${k}`, a[k], b[k], sev, PCT_TOL)
    }
    const theirs = new Map(x.candidates.map((k) => [k.no, k]))
    for (const k of o.candidates) {
      const t = theirs.get(k.no)
      if (!t) { c.add(n, 'ours-vs-xml', `candidate ${k.no}`, 'present', 'missing', sev); continue }
      const f = `#${k.no} ${k.name}`
      if (!fold(k.name).includes(fold(t.last)) || !fold(k.name).includes(fold(t.first))) c.add(n, 'ours-vs-xml', `${f} name`, k.name, `${t.first} ${t.last}`, 'fail')
      c.eq(n, 'ours-vs-xml', `${f} votes1`, k.votes1, t.votes1, sev)
      c.eq(n, 'ours-vs-xml', `${f} pct1`, k.pct1, t.pct1, sev)
      c.eq(n, 'ours-vs-xml', `${f} st1`, k.st1, t.st1, sev)
      if (t.votes2 !== null || k.votes2 !== null) {
        c.eq(n, 'ours-vs-xml', `${f} votes2`, k.votes2, t.votes2, sev)
        c.eq(n, 'ours-vs-xml', `${f} pct2`, k.pct2, t.pct2, sev)
      }
      c.eq(n, 'ours-vs-xml', `${f} st2`, k.st2, t.st2, sev)
    }
    for (const k of x.candidates) if (!o.candidates.some((m) => m.no === k.no)) c.add(n, 'ours-vs-xml', `candidate ${k.no}`, 'missing', 'present', sev)
  }
  for (const n of ourBy.keys()) if (!xmlBy.has(n) && (!only || n === only)) c.add(n, 'ours-vs-xml', 'obvod', 'present', 'missing', 'fail')
  return c.items
}

// ---- G2: ČSÚ XML vs ČSÚ obvod JSON (positional arrays) ------------------------------------------------------------
// prehled row  = [kolo, okrskyCelkem, okrskyZprac, zpracProc, zapsani, vydane, ucastProc, vp, odevzdane, platne, platneProc]
// vysledky row = [cislo, "Příjmení Jméno Tituly", navrhujici, strana, prislusnost, hlasy1, proc1, hlasy2, proc2, bool, bool]
// postupuje    = ballot numbers (2.KOLO); zvoleny = ballot number | -1 | null
export function compareXmlToJson(xmlObvod, json) {
  const c = collector()
  const n = xmlObvod.n
  const sev = sevFor(xmlObvod.generated, json.generovano)
  const g = 'xml-vs-json'
  // before counting ČSÚ publishes prehled [] / vysledky []: consistent with an XML obvod without a counted precinct
  if (!(json.prehled ?? []).length && !(json.vysledky ?? []).length && !xmlObvod.ucast?.[1]?.okrskyZprac && !xmlObvod.ucast?.[2]?.okrskyZprac) {
    c.eq(n, g, 'postupuje (pre-count)', (json.postupuje ?? []).length, 0, sev)
    return c.items
  }
  for (const row of json.prehled ?? []) {
    const [kolo, celkem, zprac, zprocProc, zapsani, , ucastProc, , odevzdane, platne] = row
    const u = xmlObvod.ucast?.[kolo]
    if (!u) { c.add(n, g, `prehled round ${kolo}`, 'present', 'absent in XML', sev); continue }
    c.eq(n, g, `round ${kolo} okrskyCelkem`, celkem, u.okrskyCelkem, sev)
    c.eq(n, g, `round ${kolo} okrskyZprac`, zprac, u.okrskyZprac, sev)
    c.eq(n, g, `round ${kolo} zapsani`, zapsani, u.zapsaniVolici, sev)
    c.eq(n, g, `round ${kolo} odevzdane`, odevzdane, u.odevzdaneObalky, sev)
    c.eq(n, g, `round ${kolo} platneHlasy`, platne, u.platneHlasy, sev)
    c.eq(n, g, `round ${kolo} zpracProc`, zprocProc, u.okrskyZpracProc, sev, PCT_TOL)
    c.eq(n, g, `round ${kolo} ucastProc`, ucastProc, u.ucastProc, sev, PCT_TOL)
  }
  for (const r of [1, 2]) {
    if (xmlObvod.ucast?.[r] && !(json.prehled ?? []).some((row) => row[0] === r)) c.add(n, g, `prehled round ${r}`, 'absent', 'present in XML', sev)
  }
  const byNo = new Map(xmlObvod.candidates.map((k) => [k.no, k]))
  const rows = json.vysledky ?? []
  let sum1 = 0
  for (const row of rows) {
    const [no, name, , , , h1, p1, h2, p2] = row
    const k = byNo.get(no)
    if (!k) { c.add(n, g, `candidate ${no}`, 'in JSON only', '-', sev); continue }
    const f = `#${no}`
    if (!fold(name).includes(fold(k.last)) || !fold(name).includes(fold(k.first))) c.add(n, g, `${f} name`, name, `${k.first} ${k.last}`, 'fail')
    c.eq(n, g, `${f} votes1`, h1, k.votes1, sev)
    c.eq(n, g, `${f} pct1`, p1, k.pct1, sev, 0.0001)
    if (k.votes2 !== null) {
      c.eq(n, g, `${f} votes2`, h2, k.votes2, sev)
      c.eq(n, g, `${f} pct2`, p2, k.pct2, sev, 0.0001)
    } else if (h2) c.add(n, g, `${f} votes2`, h2, null, sev)
    sum1 += h1 ?? 0
  }
  if (rows.length !== xmlObvod.candidates.length) c.add(n, g, 'candidate count', rows.length, xmlObvod.candidates.length, sev)
  const u1 = xmlObvod.ucast?.[1]
  if (u1 && rows.length && u1.platneHlasy !== sum1) c.add(n, g, 'JSON Σ votes1 vs XML PLATNE_HLASY', sum1, u1.platneHlasy, sev)
  // official flags: JSON `postupuje` / `zvoleny` against the XML flags
  const flagged = (st) => xmlObvod.candidates.filter((k) => k.st1 === st || k.st2 === st).map((k) => k.no).sort((a, b) => a - b)
  const advancing = flagged('2.KOLO')
  const post = [...(json.postupuje ?? [])].sort((a, b) => a - b)
  c.eq(n, g, 'postupuje', post.join(','), advancing.join(','), sev)
  const elected = flagged('ZVOLEN')
  const zv = json.zvoleny == null || json.zvoleny === -1 ? '' : String(json.zvoleny)
  c.eq(n, g, 'zvoleny', zv, elected.join(','), sev)
  return c.items
}

// ---- G3: independent rule recomputation (spec §3.1; written from the spec, not from derive.js) --------------------
// input = raw ČSÚ values for one obvod: candidates [{no, votes1, votes2, st1, st2}], ucast {1, 2?}
export function recompute(o) {
  const cs = o.candidates
  const u1 = o.ucast?.[1] ?? {}
  const u2 = o.ucast?.[2]
  const secondRound = Boolean(u2) || cs.some((k) => k.votes2 != null)
  const U = secondRound ? u2 ?? {} : u1
  const Z = U.okrskyZprac ?? 0
  const C = U.okrskyCelkem ?? 0
  const valid = U.platneHlasy ?? 0
  const key = secondRound ? 'votes2' : 'votes1'
  const any = (f) => cs.some(f)

  let state
  if (any((k) => k.st2 === 'ZVOLEN' || k.st1 === 'ZVOLEN')) state = 'elected'
  else if (any((k) => k.st2 === 'NEZVOLEN_SHODA_HLASU')) state = 'tie'
  else if (secondRound && u2) state = Z > 0 && Z === C ? 'runoff-counted' : Z > 0 ? 'runoff-counting' : 'runoff'
  else if (any((k) => k.st1 === '2.KOLO')) state = 'runoff'
  else state = (u1.okrskyZprac ?? 0) === 0 ? 'waiting' : u1.okrskyZprac < u1.okrskyCelkem ? 'counting' : 'counted'
  const decidedRound = state === 'elected' ? (any((k) => k.st2 === 'ZVOLEN') ? 2 : 1) : 0

  const onlyFlagged = key === 'votes2' && any((k) => k.st1 === '2.KOLO')
  const taking = cs.filter((k) => k[key] != null && (!onlyFlagged || k.st1 === '2.KOLO'))
  const rankOf = (k) => (taking.includes(k) ? 1 + taking.filter((m) => m[key] > k[key]).length : null)

  const votes = cs.map((k) => k.votes1)
  const top = Math.max(...votes)
  const nTop = votes.filter((v) => v === top).length
  const sumVotes = votes.reduce((a, b) => a + b, 0)
  const second = nTop > 1 ? top : Math.max(0, ...votes.filter((v) => v < top))
  const bestR2 = (k) => Math.max(...taking.filter((m) => m !== k).map((m) => m.votes2))

  // too few precincts counted (< 25 % of the current round): no claim for unofficial candidates
  const early = Z > 0 && Z / C < 0.25
  const out = {}
  for (const k of cs) {
    const rank = rankOf(k)
    let status
    let official = true
    if (k.st2 === 'ZVOLEN' || k.st1 === 'ZVOLEN') status = 'elected'
    else if (k.st2 === 'NEZVOLEN_SHODA_HLASU') status = 'runoffTie'
    else if (k.st2 === 'NEZVOLEN') status = 'runoffLost'
    else if (k.st1 === 'NEZVOLEN') status = 'notAdvancing'
    else {
      official = false
      if (secondRound && rank != null && Z > 0) status = rank === 1 ? 'runoffLeading' : 'runoffBehind'
      else if (k.st1 === '2.KOLO') { status = 'advancing'; official = true }
      else if (Z === 0) status = 'waiting'
      else status = rank === 1 ? 'leading' : rank === 2 ? 'second' : 'behind'
    }
    if (!official && early && status !== 'waiting') status = 'early'
    const majority = !official && !early && Z > 0 && Z === C && rank != null && 2 * k[key] > valid
    let outlook = null
    let gap = null
    if (!official && Z > 0 && !early) {
      if (secondRound) {
        if (rank != null) {
          if (rank === 1) [outlook, gap] = taking.filter((m) => rankOf(m) === 1).length > 1 ? ['tie', 0] : ['lead', k.votes2 - Math.max(0, ...taking.filter((m) => m !== k).map((m) => m.votes2))]
          else [outlook, gap] = ['trail', bestR2(k) - k.votes2]
        }
      } else if (nTop === 1 && 2 * top > sumVotes) {
        [outlook, gap] = k.votes1 === top ? ['mandate', null] : ['out', top - k.votes1]
      } else if (rank === 1) [outlook, gap] = ['advance', nTop === 1 ? k.votes1 - second : 0]
      else if (rank === 2 && nTop === 1) [outlook, gap] = ['advance', top - k.votes1]
      else [outlook, gap] = ['out', second - k.votes1]
    }
    out[k.no] = { rank, status, official, majority, outlook, gap }
  }
  return { state, decidedRound, candidates: out }
}

// ours (derived) vs recompute() from ČSÚ raw numbers
export function compareDerived(ours, xml, only = null) {
  const c = collector()
  const g = 'derived'
  const sev = sevFor(ours.generated, xml.generated)
  const ourBy = new Map(ours.obvody.map((o) => [o.n, o]))
  const tally = { decided: 0, runoff: 0, awaitingOfficial: 0, counting: 0, waiting: 0, ties: 0 }
  const states = []
  for (const x of xml.obvody) {
    const exp = recompute(x)
    states.push(exp.state)
    const t = { elected: 'decided', runoff: 'runoff', 'runoff-counting': 'runoff', counted: 'awaitingOfficial', 'runoff-counted': 'awaitingOfficial', counting: 'counting', waiting: 'waiting', tie: 'ties' }[exp.state]
    tally[t]++
    const o = ourBy.get(x.n)
    if (!o || (only && x.n !== only)) continue
    c.eq(x.n, g, 'state', o.state, exp.state, sev)
    c.eq(x.n, g, 'decidedRound', o.decidedRound, exp.decidedRound, sev)
    for (const k of o.candidates) {
      const e = exp.candidates[k.no]
      if (!e) continue
      const f = `#${k.no} ${k.name}`
      for (const field of ['rank', 'status', 'official', 'majority', 'outlook', 'gap']) c.eq(x.n, g, `${f} ${field}`, k[field], e[field], sev)
    }
  }
  if (!only) {
    for (const [k, v] of Object.entries(tally)) c.eq('*', g, `summary.${k}`, ours.summary?.[k], v, sev)
    const terminal = (s) => s === 'elected' || s === 'tie'
    const phase = states.every(terminal) ? 'final' : states.every((s) => terminal(s) || s === 'runoff') ? 'idle' : states.every((s) => s === 'waiting') ? 'waiting' : 'counting'
    c.eq('*', g, 'phase', ours.phase, phase, sev)
    const pir = ours.summary?.pirates
    if (pir) c.eq('*', g, 'pirates Σ byStatus = total', Object.values(pir.byStatus).reduce((a, b) => a + b, 0), pir.total, 'fail')
  }
  return c.items
}

// ---- G4: Σ votes = valid votes, ours + ČSÚ XML --------------------------------------------------------------------------
export function checkSums(ours, xml, only = null) {
  const c = collector()
  for (const [label, obvody] of [['ours', ours.obvody.map((o) => ({ n: o.n, cs: o.candidates, u: o.rounds }))], ['xml', xml.obvody.map((o) => ({ n: o.n, cs: o.candidates, u: o.ucast }))]]) {
    for (const o of obvody) {
      if (only && o.n !== only) continue
      for (const r of [1, 2]) {
        if (!o.u?.[r]) continue
        const s = o.cs.reduce((a, k) => a + (k[`votes${r}`] ?? 0), 0)
        if (o.u[r].platneHlasy > 0 || s > 0) c.eq(o.n, 'sums', `${label} round ${r} Σ votes vs PLATNE_HLASY`, s, o.u[r].platneHlasy, 'fail')
      }
    }
  }
  if (ours.stale === true) c.add('*', 'sums', 'stale', true, false, 'fail', 'our API reports stale:true')
  return c.items
}

// ---- G5: mapa_vitez.json and navig/obvody.json against our snapshot ---------------------------------------------------
export function compareMapa(ours, mapa, only = null) {
  const c = collector()
  const g = 'mapa_vitez'
  const sev = 'lag' // a different file with its own stamp: timing may explain a difference
  for (const o of ours.obvody) {
    if (only && o.n !== only) continue
    const m = mapa.obvody?.[String(o.n)]
    if (!m) { c.add(o.n, g, 'entry', 'present', 'missing', sev); continue }
    const rd = o.rounds?.[2] || o.candidates.some((k) => k.votes2 != null) ? 2 : 1
    const R = o.rounds?.[rd] ?? {}
    const key = rd === 2 ? 'votes2' : 'votes1'
    const pct = rd === 2 ? 'pct2' : 'pct1'
    const taking = o.candidates.filter((k) => k[key] != null && (rd === 1 || !o.candidates.some((m2) => m2.st1 === '2.KOLO') || k.st1 === '2.KOLO'))
    const best = Math.max(0, ...taking.map((k) => k[key]))
    const leaders = taking.filter((k) => k[key] === best)
    c.eq(o.n, g, 'kolo', m.kolo, rd, sev)
    c.eq(o.n, g, 'procZprac', m.procZprac, R.okrskyZpracProc ?? 0, sev, PCT_TOL)
    if ((R.okrskyZprac ?? 0) > 0 && best > 0) {
      c.eq(o.n, g, 'pocetVitezu', m.pocetVitezu, leaders.length, sev)
      c.eq(o.n, g, 'hlasu', m.hlasu, best, sev)
      if (leaders.length === 1) {
        c.eq(o.n, g, 'kandCislo', m.kandCislo, leaders[0].no, sev)
        c.eq(o.n, g, 'procHlasu', m.procHlasu, leaders[0][pct], sev, PCT_TOL)
      }
    } else if (m.kandCislo != null) c.add(o.n, g, 'kandCislo', m.kandCislo, null, sev)
    // semantics of these two are inferred (2024 final: both true/1 once decided): reported, never fatal
    c.eq(o.n, g, 'stavZvolen (1 = elected)', m.stavZvolen === 1, o.state === 'elected', 'note')
    c.eq(o.n, g, 'ukonceno (official result)', Boolean(m.ukonceno), o.state === 'elected' || o.state === 'tie', 'note')
  }
  return c.items
}

export function compareNavig(ours, navig, only = null) {
  const c = collector()
  const g = 'navig'
  const sev = 'lag'
  const by = new Map((navig.obvody ?? []).map((o) => [o.obvod, o]))
  for (const o of ours.obvody) {
    if (only && o.n !== only) continue
    const m = by.get(o.n)
    if (!m) { c.add(o.n, g, 'entry', 'present', 'missing', sev); continue }
    c.eq(o.n, g, 'zvoleno', Boolean(m.zvoleno), o.state === 'elected', sev)
    if (m.zvoleno) c.eq(o.n, g, 'zvoleno_kolo', m.zvoleno_kolo, o.decidedRound, sev)
    if (m.odvolaniKandidati) c.add(o.n, g, 'odvolaniKandidati', true, '-', 'note', 'a candidacy was withdrawn: expect changed flags')
  }
  return c.items
}

// ---- G6: timing -------------------------------------------------------------------------------------------------------------
export function timing(ours, xml, nowMs, { maxLagSec = 120, failLagSec = 900 } = {}) {
  const ourMs = ours.generatedMs ?? parsePragueTime(ours.generated)
  const csuMs = parsePragueTime(xml.generated)
  const lagSec = Number.isFinite(ourMs) && Number.isFinite(csuMs) ? (csuMs - ourMs) / 1000 : null
  const out = { ourGenerated: ours.generated, csuGenerated: xml.generated, lagSec, ageOfOurRefreshSec: ours.refreshedAt ? Math.round((nowMs - ours.refreshedAt) / 1000) : null, csuAgeSec: Number.isFinite(csuMs) ? Math.round((nowMs - csuMs) / 1000) : null, items: [] }
  const c = collector()
  if (lagSec === null) c.add('*', 'timing', 'generated', ours.generated, xml.generated, 'fail', 'unparsable')
  else if (lagSec > failLagSec) c.add('*', 'timing', 'our lag (s)', lagSec, `<= ${failLagSec}`, 'fail')
  else if (lagSec > maxLagSec) c.add('*', 'timing', 'our lag (s)', lagSec, `<= ${maxLagSec}`, 'lag')
  else if (lagSec < -maxLagSec) c.add('*', 'timing', 'our copy newer than ČSÚ by (s)', -lagSec, `<= ${maxLagSec}`, 'lag', 'ČSÚ replica older than our snapshot?')
  out.items = c.items
  return out
}

// ---- fetching ---------------------------------------------------------------------------------------------------------------
export async function politeGet(url, { cacheDir, fetchImpl = fetch, userAgent = USER_AGENT, timeoutMs = 15000 } = {}) {
  const file = cacheDir ? join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`) : null
  let cached = null
  if (file && existsSync(file)) {
    try { cached = JSON.parse(readFileSync(file, 'utf8')) } catch { cached = null }
  }
  const headers = { 'User-Agent': userAgent, Accept: '*/*' }
  if (cached?.etag) headers['If-None-Match'] = cached.etag
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (res.status === 304 && cached) return { status: 304, body: cached.body, headers: res.headers, fromCache: true }
  const body = res.status === 200 ? await res.text() : null
  if (file && res.status === 200 && (res.headers.get('etag') || res.headers.get('last-modified'))) {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(file, JSON.stringify({ etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), body }))
  }
  return { status: res.status, body, headers: res.headers, fromCache: false }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

export async function verify({ ourUrl, csuBase = CSU_BASE, only = null, cacheDir = null, delayMs = 250, maxLagSec = 120, failLagSec = 900, fetchImpl = fetch, now = Date.now, userAgent = USER_AGENT } = {}) {
  const mism = []
  const fetched = { requests: 0, notModified: 0, failed: [] }
  // a required independent ČSÚ source that cannot be fetched or parsed is a FAIL (nothing was verified)
  const note = (what, e, sev = 'fail') => { fetched.failed.push(what); mism.push({ obvod: '*', group: 'fetch', field: what, ours: '-', theirs: String(e?.message ?? e), sev, note: '' }) }
  const getCsu = async (path) => {
    if (fetched.requests) await sleep(delayMs)
    fetched.requests++
    const r = await politeGet(`${csuBase}/${path}`, { cacheDir, fetchImpl, userAgent })
    if (r.status === 304) fetched.notModified++
    if (r.status !== 200 && r.status !== 304) throw new Error(`HTTP ${r.status}`)
    return r
  }
  const ourRes = await fetchImpl(ourUrl, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) })
  if (ourRes.status !== 200) throw new Error(`our API answered ${ourRes.status}`)
  const ours = JSON.parse(await ourRes.text())
  const serverNow = Number(ourRes.headers.get('x-server-now'))
  let xml
  try {
    xml = parseResultsXml((await getCsu('odata/vysledky.xml')).body)
  } catch (e) {
    note('odata/vysledky.xml', e)
    return { obvodyCompared: 0, timing: { ourGenerated: ours.generated, csuGenerated: null, lagSec: null }, fetched, mismatches: mism, ourPhase: ours.phase, ourServerNow: serverNow || null, localClockSkewSec: null }
  }
  mism.push(...compareOursToXml(ours, xml, only), ...compareDerived(ours, xml, only), ...checkSums(ours, xml, only))
  const t = timing(ours, xml, Number.isFinite(serverNow) && serverNow > 0 ? serverNow : now(), { maxLagSec, failLagSec })
  mism.push(...t.items)
  const wanted = xml.obvody.filter((o) => !only || o.n === only)
  for (const o of wanted) {
    try {
      const json = JSON.parse((await getCsu(`vysled/obvod/${o.n}.json`)).body)
      mism.push(...compareXmlToJson({ ...o, generated: xml.generated }, json))
    } catch (e) { note(`vysled/obvod/${o.n}.json`, e) }
  }
  try { mism.push(...compareMapa(ours, JSON.parse((await getCsu('mapa_vitez.json')).body), only)) } catch (e) { note('mapa_vitez.json', e) }
  try { mism.push(...compareNavig(ours, JSON.parse((await getCsu('navig/obvody.json')).body), only)) } catch (e) { note('navig/obvody.json', e) }
  return { obvodyCompared: wanted.length, timing: { ...t, items: undefined }, fetched, mismatches: mism, ourPhase: ours.phase, ourServerNow: serverNow || null, localClockSkewSec: serverNow ? Math.round((now() - serverNow) / 1000) : null }
}

// ---- output ---------------------------------------------------------------------------------------------------------------------
export function summarize(result, { strict = false } = {}) {
  const by = (s) => result.mismatches.filter((m) => m.sev === s).length
  return { fail: by('fail'), lag: by('lag'), note: by('note'), ok: by('fail') === 0 && (!strict || by('lag') === 0) }
}

export function formatTable(mismatches) {
  if (!mismatches.length) return '(no mismatches)'
  const cell = (v) => String(v ?? '-').slice(0, 38)
  const rows = [['obvod', 'check', 'field', 'ours', 'ČSÚ', 'sev'], ...mismatches.map((m) => [m.obvod, m.group, m.field, cell(m.ours), cell(m.theirs), m.sev])]
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => cell(r[i]).length)))
  return rows.map((r) => r.map((v, i) => cell(v).padEnd(w[i])).join('  ')).join('\n')
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

async function main() {
  let target = process.argv[2]
  if (!target || target.startsWith('--')) {
    console.error('usage: verify-against-csu.mjs <https://senat.dg12.cz[/api/senat]> [--obvod N] [--json] [--strict] [--max-lag-sec S] [--fail-lag-sec S] [--no-cache] [--delay-ms M] [--csu-base URL]')
    process.exit(2)
  }
  const u = new URL(target)
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/api/senat'
  target = u.toString()
  const only = arg('obvod') ? Number(arg('obvod')) : null
  const strict = process.argv.includes('--strict')
  const result = await verify({
    ourUrl: target,
    csuBase: arg('csu-base') ?? CSU_BASE,
    only,
    cacheDir: process.argv.includes('--no-cache') ? null : join(tmpdir(), 'pirati-senat-verify-cache'),
    delayMs: Number(arg('delay-ms') ?? 250),
    maxLagSec: Number(arg('max-lag-sec') ?? 120),
    failLagSec: Number(arg('fail-lag-sec') ?? 900),
  })
  const s = summarize(result, { strict })
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...s, ...result }, null, 2))
  else {
    console.log(`verify-against-csu  ${new Date().toISOString()}  ${target}${only ? `  obvod ${only}` : ''}`)
    console.log(`ours generated ${result.timing.ourGenerated} | ČSÚ XML generated ${result.timing.csuGenerated} | our lag ${result.timing.lagSec}s | phase ${result.ourPhase}`)
    console.log(`ČSÚ requests ${result.fetched.requests} (304: ${result.fetched.notModified}), failed: ${result.fetched.failed.join(', ') || 'none'}\n`)
    console.log(formatTable(result.mismatches.filter((m) => m.sev !== 'note')))
    const notes = result.mismatches.filter((m) => m.sev === 'note')
    if (notes.length) console.log(`\n${notes.length} note(s) (semantics unverified, never fatal):\n${formatTable(notes)}`)
    if (result.fetched.failed.length) console.log(`\nFAIL: required ČSÚ source(s) could not be fetched or parsed (nothing verified for them): ${result.fetched.failed.join(', ')}`)
    console.log(`\n${result.obvodyCompared} obvody compared: ${s.fail} fail, ${s.lag} lag, ${s.note} note  ->  ${s.ok ? 'OK' : 'MISMATCH'}`)
    if (s.lag && !s.fail) console.log('Only lag-class rows (different generation stamps, or our snapshot older than ČSÚ): re-run in a minute; they must vanish.')
  }
  process.exit(s.ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`verify-against-csu: ${e.message}`)
    process.exit(2)
  })
}
