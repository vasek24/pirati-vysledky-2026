#!/usr/bin/env node
// Election-night drill: walks the mock upstream through every stage and checks what the LOCAL Worker serves.
//
//   1. mock upstream (terminal A):
//        node cloudflare-senat/scripts/mock-upstream.mjs --port 8797
//   2. Worker on a FRESH persist dir (terminal B, from cloudflare-senat/; needs `npm run build:senat` first):
//        npx wrangler dev --local --port 8799 --persist-to "$(mktemp -d)" \
//          --var CSU_BASE:http://127.0.0.1:8797 --var POLLS_CLOSE_R2:2026-10-10T14:00:01+02:00
//   3. drill (terminal C, repo root):
//        node cloudflare-senat/scripts/drill.mjs [--base http://localhost:8799] [--mock http://127.0.0.1:8797]
//             [--stages frozen,counting-25,...] [--skip-faults] [--cadence-sec 130] [--r2-close <ISO with offset>]
//
// HARD LIMITS
//  - Only works AFTER 2026-10-10 14:00 Prague time: the Worker's close-of-polls gate uses the real clock
//    (R1 is a constant) and zeroes every number of a file generated or fetched before it. The mock stamps
//    files with "now", so run this after 14:00. POLLS_CLOSE_R2 must be an ISO string with offset, > R1,
//    < R1 + 30 days; 14:00:01 keeps the round-2 gate open right away and the idle poll cadence at 60 s.
//  - Refuses any base that is not localhost / 127.0.0.1 / [::1]. NEVER point it at production or staging:
//    it flips a fake upstream and injects faults. Needs a clean Worker (fresh --persist-to), because
//    going back to `frozen` after real counted data would be (correctly) rejected as a regression.
//  - Takes ~15-20 minutes: the Worker refreshes a counting snapshot every <= 60 s, and the drill measures that.
import { pathToFileURL } from 'node:url'
import { summarize, verify } from './verify-against-csu.mjs'

const VERIFY_UA = 'pirati-senat-drill-verify/0.1 (local drill)'
export const UA = 'pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)'
const R1 = Date.parse('2026-10-10T14:00:00+02:00')
const CAP = { counting: 5, waiting: 5, idle: 300, final: 600 } // s-maxage caps by phase (edge.js)
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

// ---- pure checks (unit-tested in drill.test.js) --------------------------------------------------------------
// One check = { name, expected, got, ok }
const chk = (name, expected, got, ok = JSON.stringify(expected) === JSON.stringify(got)) => ({ name, expected, got, ok })

// expect = mock /stage `expect`; api = parsed /api/senat body; headers = Headers-like (get)
export function checkStage(expect, api, headers, { prev = null, nowMs = Date.now() } = {}) {
  const out = []
  out.push(chk('v / kind', '1 / senat', `${api.v} / ${api.kind}`))
  out.push(chk('stale', false, api.stale))
  out.push(chk('phase', expect.phase, api.phase))
  out.push(chk('round', expect.round, api.round))
  out.push(chk('warnings', [], api.warnings))
  out.push(chk('obvody', 27, api.obvody?.length))
  for (const k of Object.keys(expect.summary)) out.push(chk(`summary.${k}`, expect.summary[k], api.summary?.[k]))
  const states = Object.fromEntries((api.obvody ?? []).map((o) => [o.n, o.state]))
  const wrong = Object.entries(expect.states).filter(([n, s]) => states[n] !== s).map(([n, s]) => `${n}: ${states[n]} (want ${s})`)
  out.push(chk('obvod states (27)', 'all as model', wrong.length ? wrong.join('; ') : 'all as model'))
  const p = api.summary?.pirates
  out.push(chk('pirates.total', expect.pirates.total, p?.total))
  const pirateSum = p ? Object.values(p.byStatus).reduce((a, b) => a + b, 0) : null
  out.push(chk('pirates Σ byStatus = total', expect.pirates.total, pirateSum))
  const official = ['elected', 'advancing', 'notAdvancing', 'runoffLost', 'runoffTie']
  out.push(chk('pirates official buckets', expect.pirates.official, p ? Object.fromEntries(official.map((k) => [k, p.byStatus[k]])) : null))
  out.push(chk('pirates provisional (rest)', expect.pirates.unofficial, p ? pirateSum - official.reduce((a, k) => a + p.byStatus[k], 0) : null))
  if (expect.tieObvod && expect.summary.ties) out.push(chk(`tie obvod ${expect.tieObvod}`, 'tie', states[expect.tieObvod]))
  // invariants a viewer would trip over
  const sumBad = []
  for (const o of api.obvody ?? []) {
    for (const r of [1, 2]) {
      if (!o.rounds?.[r]) continue
      const s = o.candidates.reduce((a, c) => a + (c[`votes${r}`] ?? 0), 0)
      if (s !== o.rounds[r].platneHlasy) sumBad.push(`${o.n}/r${r}: ${s} vs ${o.rounds[r].platneHlasy}`)
      if (o.rounds[r].okrskyZprac > o.rounds[r].okrskyCelkem) sumBad.push(`${o.n}/r${r}: precincts over total`)
    }
  }
  out.push(chk('Σ votes = PLATNE_HLASY, precincts <= total', 'none', sumBad.length ? sumBad.join('; ') : 'none'))
  if (prev) {
    const back = []
    for (const o of api.obvody ?? []) {
      const q = prev.obvody?.find((x) => x.n === o.n)
      if (!q) continue
      for (const r of [1, 2]) if ((o.rounds?.[r]?.okrskyZprac ?? 0) < (q.rounds?.[r]?.okrskyZprac ?? 0)) back.push(`${o.n}/r${r} precincts`)
      for (const c of o.candidates) {
        const d = q.candidates.find((x) => x.no === c.no)
        if (d && ((c.votes1 ?? 0) < (d.votes1 ?? 0) || (c.votes2 ?? 0) < (d.votes2 ?? 0))) back.push(`${o.n}#${c.no} votes`)
      }
    }
    out.push(chk('monotone vs previous stage', 'nothing decreased', back.length ? back.join('; ') : 'nothing decreased'))
  }
  // headers
  const sm = /s-maxage=(\d+)/.exec(headers.get('cache-control') ?? '')?.[1]
  out.push(chk('cache-control', `public, max-age=0, s-maxage<=${CAP[api.phase] ?? 5}`, headers.get('cache-control'), /^public, max-age=0, s-maxage=\d+$/.test(headers.get('cache-control') ?? '') && Number(sm) >= 1 && Number(sm) <= (CAP[api.phase] ?? 5)))
  const sn = Number(headers.get('x-server-now'))
  out.push(chk('x-server-now', `within 10 s of local clock`, headers.get('x-server-now'), Number.isFinite(sn) && Math.abs(sn - nowMs) < 10000))
  out.push(chk('x-cache', 'MISS | HIT', headers.get('x-cache'), ['MISS', 'HIT'].includes(headers.get('x-cache'))))
  return out
}

// consecutive gaps (s) between request timestamps
export const gaps = (times) => times.slice(1).map((t, i) => (t - times[i]) / 1000)

export function checkCadence(requests, { minGap = 18, maxGap = 75, expect304 = true, minRequests = 2 } = {}) {
  const g = gaps(requests.map((r) => r.t))
  const out = [chk('requests in window', `>= ${minRequests}`, requests.length, requests.length >= minRequests)]
  if (g.length) {
    out.push(chk('min gap between polls (s)', `>= ${minGap}`, Math.min(...g).toFixed(1), Math.min(...g) >= minGap))
    out.push(chk('max gap between polls (s)', `<= ${maxGap}`, Math.max(...g).toFixed(1), Math.max(...g) <= maxGap))
  }
  if (expect304) {
    const full = requests.filter((r) => r.status !== 304).length
    out.push(chk('unchanged file answered 304', '0 full downloads', `${full} full of ${requests.length}`, full === 0 && requests.every((r) => r.conditional)))
  }
  return out
}

export function checkBase(urlString) {
  const u = new URL(urlString)
  if (!LOCAL.has(u.hostname)) throw new Error(`refusing ${u.hostname}: the drill flips a fake upstream and injects faults; it only runs against localhost`)
  return u
}

// ---- runner ---------------------------------------------------------------------------------------------------------
class Report {
  constructor() { this.rows = [] }
  add(step, checks) {
    for (const c of checks) this.rows.push({ step, ...c })
    const bad = checks.filter((c) => !c.ok)
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${step}  (${checks.length - bad.length}/${checks.length})`)
    for (const c of bad) console.log(`       x ${c.name}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.got)}`)
  }
  one(step, name, expected, got, ok) { this.add(step, [chk(name, expected, got, ok)]) }
  table() {
    const cell = (v) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '-').slice(0, 44)
    const rows = [['step', 'check', 'expected', 'got', ''], ...this.rows.map((r) => [r.step, r.name, cell(r.expected), cell(r.got), r.ok ? 'PASS' : 'FAIL'])]
    const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)))
    return rows.map((r) => r.map((v, i) => String(v).padEnd(w[i])).join('  ')).join('\n')
  }
  get failed() { return this.rows.filter((r) => !r.ok).length }
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
  const base = checkBase(arg('base', 'http://localhost:8799')).origin
  const mock = checkBase(arg('mock', 'http://127.0.0.1:8797')).origin
  const r2Close = Date.parse(arg('r2-close', '2026-10-10T14:00:01+02:00'))
  const cadenceSec = Number(arg('cadence-sec', 130))
  const skipFaults = process.argv.includes('--skip-faults')
  const timeoutSec = Number(arg('timeout-sec', 150))
  if (!(Date.now() >= R1)) {
    console.error(`It is ${new Date().toLocaleTimeString('cs-CZ')} Prague time. The Worker zeroes every file before 14:00 (real clock), so the drill cannot work yet. Run it after 14:00.`)
    process.exit(2)
  }
  const get = async (url, init = {}) => {
    const t = Date.now()
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
    return { res, ms: Date.now() - t, text: await res.text() }
  }
  const mockJson = async (path, method = 'POST') => JSON.parse((await get(mock + path, { method })).text)
  const api = async () => {
    const { res, ms, text } = await get(`${base}/api/senat`)
    return { status: res.status, headers: res.headers, ms, body: res.status === 200 ? JSON.parse(text) : null }
  }
  const report = new Report()
  const stats = async () => mockJson('/stats', 'GET')
  let stages = (arg('stages', null) ?? (await mockJson('/stage', 'GET')).stages.join(',')).split(',')
  if (Date.now() < r2Close) { // the Worker would suppress round-2 data until then
    console.log(`round-2 gate (${new Date(r2Close).toISOString()}) is still closed: skipping the round-2 stages`)
    stages = stages.filter((x) => !['runoff-counting', 'runoff-counted', 'official-r2'].includes(x))
  }

  // preflight: both servers up, Worker really points at the mock, Worker is clean
  await mockJson('/stage/frozen')
  const first = await api()
  if (first.status !== 200) throw new Error(`Worker answered ${first.status} at ${base}/api/senat (is wrangler dev running with CSU_BASE:${mock}?)`)
  const seen = (await stats()).total
  report.one('preflight', 'Worker fetched the mock (CSU_BASE points at it)', '>= 1 request', seen, seen >= 1)
  if (first.body.summary.decided || first.body.obvody.some((o) => o.rounds[1].okrskyZprac > 0)) throw new Error('Worker already holds counted data from an earlier drill: restart wrangler dev with a fresh --persist-to dir')
  await mockJson('/stats/reset')
  report.one('preflight', 'target', 'localhost only', new URL(base).hostname, true)

  let prev = null
  for (const stage of stages) {
    const step = `stage ${stage}`
    const model = await mockJson(`/stage/${stage}`)
    const t0 = Date.now()
    let r
    for (;;) { // the Worker refreshes lazily on a request: keep polling like a viewer
      r = await api()
      if (r.body?.generated === model.generated) break
      if (Date.now() - t0 > timeoutSec * 1000) break
      await sleep(2000)
    }
    const pickup = (Date.now() - t0) / 1000
    if (r.body?.generated !== model.generated) {
      const why = r.body?.warnings?.find((w) => w.endsWith('suppressed')) ? ' (a close-of-polls gate suppressed it: check the time and POLLS_CLOSE_R2)' : r.body?.stale ? ' (stale: the Worker rejected or could not fetch the file)' : ''
      report.one(step, 'Worker adopts the new file', model.generated, r.body?.generated + why, false)
      break
    }
    report.one(step, 'pickup time (s)', '<= 90', pickup.toFixed(1), pickup <= 90)
    report.add(step, checkStage(model.expect, r.body, r.headers, { prev }))
    prev = r.body
    // rehearsal of the election-night truth check against the mock's ČSÚ files: must be clean (same stamps on both sides)
    const v = await verify({ ourUrl: `${base}/api/senat`, csuBase: mock, delayMs: 0, userAgent: VERIFY_UA })
    const vs = summarize(v)
    report.one(step, 'verify-against-csu, 27 obvody (fail / lag rows)', '0 / 0', `${vs.fail} / ${vs.lag}`, vs.fail === 0 && vs.lag === 0)
    for (const m of v.mismatches.filter((x) => x.sev !== 'note').slice(0, 5)) console.log(`       . ${m.obvod} ${m.group} ${m.field}: ours ${JSON.stringify(m.ours)} ČSÚ ${JSON.stringify(m.theirs)} (${m.sev})`)

    if (stage === 'counting-60') {
      // viewer fan-out must not reach ČSÚ: 150 requests (30 of them concurrent) -> at most one upstream fetch
      const before = (await stats()).total
      const res = []
      for (let i = 0; i < 120; i++) res.push(await api())
      res.push(...(await Promise.all(Array.from({ length: 30 }, api))))
      const delta = (await stats()).total - before
      report.one(step, 'viewer fan-out: 150 requests, upstream fetches', '<= 1', delta, delta <= 1)
      report.one(step, 'viewer fan-out: all 200, max latency (ms)', 'all 200, <= 2000', `${res.filter((x) => x.status === 200).length}/150, ${Math.max(...res.map((x) => x.ms))}`, res.every((x) => x.status === 200) && Math.max(...res.map((x) => x.ms)) <= 2000)
      const hits = res.filter((x) => x.headers.get('x-cache') === 'HIT').length
      report.one(step, 'viewer fan-out: edge cache HITs', '>= 100 of 150', hits, hits >= 100)
      if (!skipFaults) prev = await faults({ base, mock, api, mockJson, stats, report, timeoutSec, baseline: r.body })
    }

    if (stage === 'counted-awaiting-flags' || (stage === 'official-r2' && stages.includes('official-r2'))) {
      const s0 = (await stats()).requests.length
      const end = Date.now() + cadenceSec * 1000
      while (Date.now() < end) { await api(); await sleep(2000) }
      const window = (await stats()).requests.slice(s0)
      if (stage === 'official-r2') {
        report.one(`${step} (cadence)`, 'final phase polls rarely (10 min)', `<= 1 in ${cadenceSec}s`, window.length, window.length <= 1)
      } else report.add(`${step} (cadence)`, checkCadence(window, { minRequests: 2 }))
    }
  }

  const st = await stats()
  report.one('summary', 'Worker User-Agent', [UA], st.userAgents.filter((u) => u !== VERIFY_UA))
  report.one('summary', 'Worker requested only odata/vysledky.xml', [], [...st.otherPaths, ...st.sideRequests.filter((x) => x.ua === UA).map((x) => x.path)])
  console.log(`\n${report.table()}\n`)
  console.log(`${report.rows.length - report.failed} passed, ${report.failed} failed`)
  process.exit(report.failed ? 1 : 0)
}

// Fault scenarios on the current (good) snapshot: last-good served with stale:true within one refresh, recovery clears it.
async function faults({ api, mockJson, stats, report, timeoutSec, baseline }) {
  const until = async (pred, sec, onSample) => {
    const t0 = Date.now()
    for (;;) {
      const r = await api()
      onSample?.(r)
      if (pred(r)) return { r, sec: (Date.now() - t0) / 1000, ok: true }
      if (Date.now() - t0 > sec * 1000) return { r, sec: (Date.now() - t0) / 1000, ok: false }
      await sleep(2000)
    }
  }
  let last = baseline
  for (const [kind, path] of [['500', '/fault/500'], ['html', '/fault/html'], ['truncate', '/fault/truncate'], ['slow', '/fault/slow?ms=20000']]) {
    const step = `fault ${kind}`
    await mockJson('/stats/reset')
    await mockJson(path)
    const lat = []
    const bad = []
    const stale = await until((r) => r.body?.stale === true, timeoutSec, (r) => {
      lat.push(r.ms)
      if (r.status !== 200 || r.body?.generated !== baseline.generated || r.body?.summary?.decided !== baseline.summary.decided) bad.push(`status ${r.status} generated ${r.body?.generated}`)
    })
    report.one(step, 'stale:true within one refresh (s)', '<= 90', stale.ok ? stale.sec.toFixed(1) : 'never', stale.ok && stale.sec <= 90)
    report.one(step, 'last-good data served meanwhile (200, same generated/summary)', 'none deviating', bad.length ? bad.join('; ') : 'none deviating', bad.length === 0)
    report.one(step, 'response time while upstream is faulty (ms)', '<= 1500 max', Math.max(...lat), Math.max(...lat) <= 1500)
    if (stale.ok) report.one(step, 'stale cache-control', 's-maxage <= 5', stale.r.headers.get('cache-control'), Number(/s-maxage=(\d+)/.exec(stale.r.headers.get('cache-control'))?.[1]) <= 5)
    // keep polling like a viewer for 20 s (an idle Durable Object is evicted and its in-memory stale flag restarts at false,
    // which would make the recovery check below vacuous); one retry happens meanwhile, to measure the backoff spacing
    let flipped = 0
    for (const end = Date.now() + 20000; Date.now() < end; await sleep(2000)) if ((await api()).body?.stale === false) flipped++
    report.one(step, 'stale stays true while the upstream is still broken', '0 flips', flipped, flipped === 0)
    const times = (await stats()).requests.map((x) => x.t)
    if (times.length > 1) report.one(step, 'retry spacing (s)', '>= 18', Math.min(...gaps(times)).toFixed(1), Math.min(...gaps(times)) >= 18)
    await mockJson('/fault/off')
    const ok = await until((r) => r.body?.stale === false, timeoutSec)
    report.one(step, 'recovery clears stale (s)', '<= 90', ok.ok ? ok.sec.toFixed(1) : 'never', ok.ok && ok.sec <= 90)
    if (ok.ok) last = ok.r.body
  }
  return last
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`drill: ${e.message}`)
    process.exit(2)
  })
}
