// Parsed ČSÚ XML + manifest -> spec §3 snapshot WITHOUT the derived fields
// (state/decidedRound/hasPirate, rank/status/official/majority, summary: those are derive.js).
// now / pollsCloseR1 / pollsCloseR2 are epoch ms.
import { parsePragueTime } from './time.js'

const ST1 = new Set(['ZVOLEN', 'NEZVOLEN', '2.KOLO'])
const ST2 = new Set(['ZVOLEN', 'NEZVOLEN', 'NEZVOLEN_SHODA_HLASU'])
const KEYS = ['okrskyCelkem', 'okrskyZprac', 'okrskyZpracProc', 'ucastProc', 'platneHlasy', 'zapsaniVolici', 'odevzdaneObalky']
const COUNTRY_KEYS = KEYS.slice(0, 5)

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function normalize(parsed, { manifest, now, pollsCloseR1, pollsCloseR2 }) {
  const warnings = []
  const preR1 = now < pollsCloseR1
  const preR2 = now < pollsCloseR2
  let suppressedR1 = false // source carried counted data that the R1 gate removed
  let suppressedR2 = false
  const backed = new Map(manifest.PIRATE_BACKED.map((p) => [`${p.obvod}:${p.no}`, p.relation]))

  const round = (u, keys, n) => {
    const r = {}
    for (const k of keys) r[k] = u[k]
    if (n === 1 && preR1) {
      for (const k of keys.slice(1)) { // all but okrskyCelkem: forced to 0 before the polls close
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
      if (preR2) suppressedR2 = true
      else out[2] = round(ucast[2], keys, 2)
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
      if (votes2 !== null || pct2 !== null || st2 !== null) suppressedR2 = true
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
  if (suppressedR1) warnings.push('pre-close-data-suppressed')
  if (suppressedR2) warnings.push('r2-data-suppressed')

  return {
    v: 1,
    kind: 'senat',
    generated: parsed.generated,
    generatedMs: parsePragueTime(parsed.generated),
    round: obvody.some((o) => o.rounds[2] || o.candidates.some((c) => c.votes2 !== null)) ? 2 : 1,
    country,
    obvody,
    warnings,
  }
}
