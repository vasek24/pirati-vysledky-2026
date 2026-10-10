#!/usr/bin/env node
// Polite load burst for STAGING only: N concurrent clients for T seconds against /api/senat.
//
//   node cloudflare-senat/scripts/burst.mjs https://pirati-senat-zaloha-staging.<subdomain>.workers.dev \
//        [--concurrency 20] [--seconds 20] [--max-rps 100] [--p95-ms 1500] [--max-error-rate 0.01] [--i-know]
//
// Guards: refuses any host that does not end in .workers.dev unless --i-know; never volby.gov.cz;
// hard cap 200 requests/s overall (also with --i-know); at most 200 concurrent clients; at most 120 s.
// Staging (workers.dev) has no Cache API: every request reaches the Durable Object, so this measures the
// uncached path, the worst case. Exit 1 when p95 or the error rate exceed the limits.
import { pathToFileURL } from 'node:url'

export const HARD_CAP_RPS = 200

export function checkTarget(urlString, { iKnow = false } = {}) {
  const u = new URL(urlString)
  if (/(^|\.)volby\.gov\.cz$/.test(u.hostname)) throw new Error('refusing volby.gov.cz: never load the upstream')
  if (!u.hostname.endsWith('.workers.dev') && !iKnow) throw new Error(`refusing ${u.hostname}: only *.workers.dev (staging); pass --i-know to override`)
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/api/senat'
  return u
}

// nearest-rank percentile of an array of numbers (p in 0..100)
export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}

export function summarize(samples, seconds) {
  const lat = samples.filter((s) => s.status !== 'ERR').map((s) => s.ms)
  const count = (key) => samples.reduce((m, s) => { const k = String(s[key] ?? '-'); m[k] = (m[k] ?? 0) + 1; return m }, {})
  const errors = samples.filter((s) => s.status === 'ERR' || s.status >= 500).length
  return {
    requests: samples.length,
    rps: Number((samples.length / seconds).toFixed(1)),
    status: count('status'),
    xCache: count('xcache'),
    errorRate: samples.length ? errors / samples.length : 0,
    ms: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), max: lat.length ? Math.max(...lat) : null },
  }
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

export async function burst({ url, concurrency, seconds, maxRps, fetchImpl = fetch }) {
  const rps = Math.min(maxRps, HARD_CAP_RPS)
  const clients = Math.min(concurrency, 200, rps)
  const spacing = (clients / rps) * 1000 // each client waits so that the total stays under rps
  const samples = []
  const end = Date.now() + seconds * 1000
  await Promise.all(Array.from({ length: clients }, async (_, i) => {
    await sleep((spacing / clients) * i) // stagger the starts
    while (Date.now() < end) {
      const t0 = performance.now()
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': 'pirati-senat-zaloha-burst/0.1 (staging load test; Vaclav Vislous +420777954389)' }, signal: AbortSignal.timeout(20000) })
        await res.arrayBuffer()
        samples.push({ status: res.status, ms: performance.now() - t0, xcache: res.headers.get('x-cache') })
      } catch {
        samples.push({ status: 'ERR', ms: performance.now() - t0 })
      }
      await sleep(Math.max(0, spacing - (performance.now() - t0)))
    }
  }))
  return { samples, clients, rps }
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
  const target = process.argv[2]
  if (!target || target.startsWith('--')) {
    console.error('usage: burst.mjs <https://....workers.dev> [--concurrency N] [--seconds T] [--max-rps R] [--p95-ms M] [--max-error-rate F] [--i-know]')
    process.exit(2)
  }
  const url = checkTarget(target, { iKnow: process.argv.includes('--i-know') })
  const seconds = Math.min(Number(arg('seconds', 20)), 120)
  const { samples, clients, rps } = await burst({ url: url.toString(), concurrency: Number(arg('concurrency', 20)), seconds, maxRps: Number(arg('max-rps', 100)) })
  const s = summarize(samples, seconds)
  console.log(`burst ${url}  ${clients} clients, <= ${rps} req/s, ${seconds} s`)
  console.log(`requests ${s.requests} (${s.rps}/s)  status ${JSON.stringify(s.status)}  x-cache ${JSON.stringify(s.xCache)}`)
  console.log(`latency ms  p50 ${s.ms.p50?.toFixed(0)}  p95 ${s.ms.p95?.toFixed(0)}  p99 ${s.ms.p99?.toFixed(0)}  max ${s.ms.max?.toFixed(0)}  error rate ${(s.errorRate * 100).toFixed(2)} %`)
  const p95Limit = Number(arg('p95-ms', 1500))
  const errLimit = Number(arg('max-error-rate', 0.01))
  const ok = s.ms.p95 !== null && s.ms.p95 <= p95Limit && s.errorRate <= errLimit
  console.log(ok ? `PASS (p95 <= ${p95Limit} ms, errors <= ${errLimit * 100} %)` : `FAIL (limits: p95 <= ${p95Limit} ms, errors <= ${errLimit * 100} %)`)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`burst: ${e.message}`)
    process.exit(2)
  })
}
