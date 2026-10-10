// Pure derivation of state/status/rank/majority/summary from a normalised
// Senate snapshot (spec §3, §3.1). No I/O, no clock, no projection.

export const STATUSES = [
  'elected', 'advancing', 'notAdvancing', 'runoffLost', 'runoffTie',
  'leading', 'second', 'behind', 'waiting', 'runoffLeading', 'runoffBehind',
]

// Competition rank (1 + number of strictly higher) among the candidates that take part
// in the given round; the others get null. Round 2: finalists only - candidates carrying
// round-2 votes and, when any '2.KOLO' flag exists, only those flagged.
function rankOf(candidates, key) {
  const flagged = key === 'votes2' && candidates.some((c) => c.st1 === '2.KOLO')
  const takes = (c) => c[key] != null && (!flagged || c.st1 === '2.KOLO')
  return candidates.map((c) => {
    if (!takes(c)) return null
    return 1 + candidates.filter((o) => takes(o) && o[key] > c[key]).length
  })
}

function stateOf(o, rd) {
  const cs = o.candidates
  if (cs.some((c) => c.st2 === 'ZVOLEN' || c.st1 === 'ZVOLEN')) return 'elected'
  if (cs.some((c) => c.st2 === 'NEZVOLEN_SHODA_HLASU')) return 'tie'
  const r2 = rd === 2 ? o.rounds[2] : null // round 2 without a UCAST: Z2 unknown, fall through to the flags
  if (r2) { // also with a partly published st2: the obvod is not decided until ZVOLEN/SHODA
    const { okrskyZprac: z, okrskyCelkem: c } = r2
    if (z > 0 && z === c) return 'runoff-counted'
    return z > 0 ? 'runoff-counting' : 'runoff'
  }
  if (cs.some((c) => c.st1 === '2.KOLO')) return 'runoff'
  const { okrskyZprac: z, okrskyCelkem: c } = o.rounds[1]
  if (z === 0) return 'waiting'
  return z < c ? 'counting' : 'counted'
}

function statusOf(c, rank, rd, z) {
  if (c.st2 === 'ZVOLEN' || c.st1 === 'ZVOLEN') return ['elected', true]
  if (c.st2 === 'NEZVOLEN_SHODA_HLASU') return ['runoffTie', true]
  if (c.st2 === 'NEZVOLEN') return ['runoffLost', true]
  if (c.st1 === 'NEZVOLEN') return ['notAdvancing', true]
  if (rd === 2 && rank != null && z > 0) {
    return [rank === 1 ? 'runoffLeading' : 'runoffBehind', false]
  }
  // A '2.KOLO' candidate without round-2 votes (withdrawn finalist) keeps the
  // official flag: it must never fall through to the round-1 rank statuses.
  if (c.st1 === '2.KOLO') return ['advancing', true]
  if (z === 0) return ['waiting', false]
  if (rank === 1) return ['leading', false]
  return [rank === 2 ? 'second' : 'behind', false]
}

// Unofficial outlook + gap (votes) for one candidate; [null, null] when there is nothing to say.
// Round 1: 'mandate' (sole top with > 50 % of the summed votes) | 'advance' | 'out'.
// Round 2: 'lead' | 'tie' | 'trail' (by counted votes; a rival's official flag does not suppress it).
// Never set for the candidate's own official flag.
function outlookOf(o, rd, key, ranks, i, z) {
  const cs = o.candidates
  const k = cs[i]
  if (k.official || z <= 0) return [null, null]
  if (rd === 2) {
    if (ranks[i] == null) return [null, null]
    const others = cs.filter((c, j) => j !== i && ranks[j] != null).map((c) => c.votes2)
    if (ranks[i] === 1) {
      if (ranks.filter((r) => r === 1).length > 1) return ['tie', 0]
      return ['lead', k.votes2 - Math.max(0, ...others)]
    }
    return ['trail', Math.max(...others) - k.votes2]
  }
  const votes = cs.map((c) => c.votes1)
  const top = Math.max(...votes)
  const n1 = votes.filter((v) => v === top).length
  const valid = votes.reduce((a, b) => a + b, 0)
  const sec = n1 > 1 ? top : Math.max(0, ...votes.filter((v) => v < top))
  if (n1 === 1 && 2 * top > valid) return k.votes1 === top ? ['mandate', null] : ['out', top - k.votes1]
  const r = ranks[i]
  if (r === 1) return ['advance', n1 === 1 ? k.votes1 - sec : 0]
  if (r === 2 && n1 === 1) return ['advance', top - k.votes1]
  return ['out', sec - k.votes1]
}

function deriveObvod(o) {
  const rd = o.rounds[2] || o.candidates.some((c) => c.votes2 != null) ? 2 : 1
  const key = rd === 2 ? 'votes2' : 'votes1'
  const { okrskyZprac: z = 0, okrskyCelkem: c = 0, platneHlasy: valid = 0 } = o.rounds[rd] ?? {}
  const ranks = rankOf(o.candidates, key)

  o.state = stateOf(o, rd)
  o.decidedRound = 0
  if (o.state === 'elected') {
    o.decidedRound = o.candidates.some((k) => k.st2 === 'ZVOLEN') ? 2 : 1
  }
  o.hasPirate = o.candidates.some((k) => k.pirate)

  o.candidates.forEach((k, i) => {
    const [status, official] = statusOf(k, ranks[i], rd, z)
    k.rank = ranks[i]
    k.status = status
    k.official = official
    k.majority = !official && z > 0 && z === c && ranks[i] != null && 2 * k[key] > valid
  })
  o.candidates.forEach((k, i) => {
    ;[k.outlook, k.gap] = outlookOf(o, rd, key, ranks, i, z)
  })
}

export function derive(normalized) {
  const snap = structuredClone(normalized)
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  const summary = {
    obvody: snap.obvody.length,
    decided: 0,
    runoff: 0,
    awaitingOfficial: 0,
    counting: 0,
    waiting: 0,
    ties: 0,
    pirates: { total: 0, byStatus },
  }

  for (const o of snap.obvody) {
    deriveObvod(o)
    if (o.state === 'elected') summary.decided++
    else if (o.state === 'tie') summary.ties++
    else if (o.state === 'runoff' || o.state === 'runoff-counting') summary.runoff++
    else if (o.state === 'counted' || o.state === 'runoff-counted') summary.awaitingOfficial++
    else if (o.state === 'counting') summary.counting++
    else summary.waiting++
    for (const k of o.candidates) {
      if (!k.pirate) continue
      summary.pirates.total++
      byStatus[k.status]++
    }
  }

  snap.summary = summary
  return snap
}
