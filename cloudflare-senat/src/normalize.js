// Parsed ČSÚ XML + manifest -> spec §3 snapshot WITHOUT the derived fields
// (state/decidedRound/hasPirate, rank/status/official/majority, summary: those are derive.js).
// now / pollsCloseR1 / pollsCloseR2 are epoch ms (finite numbers, else normalize throws).
// Close-of-polls gates fail closed and look at BOTH the fetch time and ČSÚ's `generated`:
// a file generated before a close is test/frozen data however late it is fetched.
import { parsePragueTime } from './time.js'

const ST1 = new Set(['ZVOLEN', 'NEZVOLEN', '2.KOLO'])
const ST2 = new Set(['ZVOLEN', 'NEZVOLEN', 'NEZVOLEN_SHODA_HLASU'])
const KEYS = ['okrskyCelkem', 'okrskyZprac', 'okrskyZpracProc', 'ucastProc', 'platneHlasy', 'zapsaniVolici', 'odevzdaneObalky']
const COUNTRY_KEYS = KEYS.slice(0, 5)
// zeroed before the polls close: counts. Not okrskyCelkem / zapsaniVolici (registered voters
// are not a count of anything cast).
const COUNTED = KEYS.filter((k) => k !== 'okrskyCelkem' && k !== 'zapsaniVolici')

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function normalize(parsed, { manifest, now, pollsCloseR1, pollsCloseR2 }) {
  for (const [k, v] of Object.entries({ now, pollsCloseR1, pollsCloseR2 })) {
    if (!Number.isFinite(v)) throw new Error(`normalize: ${k} must be a finite number (got ${v})`)
  }
  const warnings = []
  const generatedMs = parsePragueTime(parsed.generated)
  const preR1 = !(now >= pollsCloseR1) || !(generatedMs >= pollsCloseR1)
  const preR2 = !(now >= pollsCloseR2) || !(generatedMs >= pollsCloseR2)
  let suppressedR1 = false // source carried counted data that the R1 gate removed
  let suppressedR2 = false
  const backed = new Map(manifest.PIRATE_BACKED.map((p) => [`${p.obvod}:${p.no}`, p.relation]))

  const round = (u, keys, n) => {
    const r = {}
    for (const k of keys) r[k] = u[k]
    if (n === 1 && preR1) {
      for (const k of keys) {
        if (!COUNTED.includes(k)) continue
        if (r[k]) suppressedR1 = true
        r[k] = 0
      }
    }
    return r
  }
  const rounds = (ucast, keys) => {
    const out = {}
    if (ucast[1]) out[1] = round(ucast[1], keys, 1)
    if (ucast[2]) {
      if (preR2) {
        if (COUNTED.some((k) => ucast[2][k])) suppressedR2 = true
      } else out[2] = round(ucast[2], keys, 2)
    }
    return out
  }
  const status = (v, allowed, n, no) => {
    if (v === null || allowed.has(v)) return v
    warnings.push(`unknown-status:${n}:${no}:${v}`)
    return null
  }

  const candidate = (c, n) => {
    const key = `${n}:${c.no}`
    let reg = manifest.CANDIDATES[key] ?? null
    if (reg && !fold(c.last).includes(fold(reg.last))) {
      warnings.push(`attribution-mismatch:${n}:${c.no}`)
      reg = null
    }
    let { votes1, pct1, st1, votes2, pct2, st2 } = c
    if (preR1) {
      if (votes1 || pct1 || st1) suppressedR1 = true
      votes1 = 0
      pct1 = 0
      st1 = null
    } else st1 = status(st1, ST1, n, c.no)
    if (preR2) {
      if (votes2 || pct2 || st2) suppressedR2 = true
      votes2 = null
      pct2 = null
      st2 = null
    } else st2 = status(st2, ST2, n, c.no)
    return {
      no: c.no, name: `${c.first} ${c.last}`.trim(), pre: c.pre, post: c.post,
      votes1, pct1, st1, votes2, pct2, st2,
      pirate: reg ? backed.get(key) ?? null : null,
      party: reg?.party ?? null, ballotLabel: reg?.ballotLabel ?? null, member: reg?.member ?? null,
      age: reg?.age ?? null, job: reg?.job ?? null, residence: reg?.residence ?? null,
    }
  }

  const obvody = parsed.obvody
    .map((o) => ({
      n: o.n,
      name: o.name,
      rounds: rounds(o.ucast, KEYS),
      candidates: o.candidates.map((c) => candidate(c, o.n)).sort((a, b) => a.no - b.no),
    }))
    .sort((a, b) => a.n - b.n)
  const country = rounds(parsed.country, COUNTRY_KEYS)

  // Soft checks (warnings only), after the gates so suppressed data cannot trip them.
  for (const o of obvody) {
    for (const r of [1, 2]) {
      const votes = o.candidates.map((c) => c[`votes${r}`]).filter((v) => v != null)
      const valid = o.rounds[r]?.platneHlasy ?? 0
      if ((valid > 0 || votes.some((v) => v > 0)) && votes.reduce((a, b) => a + b, 0) !== valid) {
        warnings.push(`sum-mismatch:${o.n}:${r}`)
      }
    }
  }
  const manifestObvody = new Set(manifest.OBVODY ?? Object.keys(manifest.CANDIDATES).map((k) => Number(k.split(':')[0])))
  const xmlObvody = new Set(obvody.map((o) => o.n))
  if (manifestObvody.size > 0 && (manifestObvody.size !== xmlObvody.size || [...manifestObvody].some((n) => !xmlObvody.has(n)))) {
    warnings.push('obvody-set-differs-from-manifest')
  }
  for (const p of manifest.PIRATE_BACKED) {
    if (!obvody.some((o) => o.n === p.obvod && o.candidates.some((c) => c.no === p.no))) {
      warnings.push(`pirate-backed-missing:${p.obvod}:${p.no}`)
    }
  }
  if (suppressedR1) warnings.push('pre-close-data-suppressed')
  if (suppressedR2) warnings.push('r2-data-suppressed')

  const snapshot = {
    v: 1,
    kind: 'senat',
    generated: parsed.generated,
    generatedMs,
    round: obvody.some((o) => o.rounds[2] || o.candidates.some((c) => c.votes2 !== null)) ? 2 : 1,
    country,
    obvody,
    warnings,
  }
  // A gate fired only because `now` is behind the close while ČSÚ's `generated` is already
  // after it (our clock is slow): the zeros are our doing, so the feed must not keep the
  // validators of this file. Non-enumerable: not part of the snapshot shape or its JSON.
  Object.defineProperty(snapshot, 'suppressedByClock', {
    value: (suppressedR1 && generatedMs >= pollsCloseR1) || (suppressedR2 && generatedMs >= pollsCloseR2),
  })
  return snapshot
}
