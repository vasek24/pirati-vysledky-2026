// Pure derivation of state/status/rank/majority/summary from a normalised
// Senate snapshot (spec §3, §3.1). No I/O, no clock, no projection.

export const STATUSES = [
  'elected', 'advancing', 'notAdvancing', 'runoffLost', 'runoffTie',
  'leading', 'second', 'behind', 'waiting', 'runoffLeading', 'runoffBehind',
]

// Competition rank (1 + number of strictly higher) among candidates that have
// votes in the given round; the others get null.
function rankOf(candidates, key) {
  return candidates.map((c) => {
    if (c[key] == null) return null
    return 1 + candidates.filter((o) => o[key] != null && o[key] > c[key]).length
  })
}

function stateOf(o, rd) {
  const cs = o.candidates
  if (cs.some((c) => c.st2 === 'ZVOLEN' || c.st1 === 'ZVOLEN')) return 'elected'
  if (cs.some((c) => c.st2 === 'NEZVOLEN_SHODA_HLASU')) return 'tie'
  if (rd === 2 && !cs.some((c) => c.st2 != null)) {
    const { okrskyZprac: z, okrskyCelkem: c } = o.rounds[2]
    if (z > 0 && z === c) return 'runoff-counted'
    return z > 0 ? 'runoff-counting' : 'runoff'
  }
  if (cs.some((c) => c.st1 === '2.KOLO')) return 'runoff'
  const { okrskyZprac: z, okrskyCelkem: c } = o.rounds[rd]
  if (z === 0) return 'waiting'
  return z < c ? 'counting' : 'counted'
}

function statusOf(c, rank, rd, z) {
  if (c.st2 === 'ZVOLEN' || c.st1 === 'ZVOLEN') return ['elected', true]
  if (c.st2 === 'NEZVOLEN_SHODA_HLASU') return ['runoffTie', true]
  if (c.st2 === 'NEZVOLEN') return ['runoffLost', true]
  if (c.st1 === 'NEZVOLEN') return ['notAdvancing', true]
  if (rd === 2 && c.votes2 != null && z > 0) {
    return [rank === 1 ? 'runoffLeading' : 'runoffBehind', false]
  }
  // A '2.KOLO' candidate without round-2 votes (withdrawn finalist) keeps the
  // official flag: it must never fall through to the round-1 rank statuses.
  if (c.st1 === '2.KOLO') return ['advancing', true]
  if (z === 0) return ['waiting', false]
  if (rank === 1) return ['leading', false]
  return [rank === 2 ? 'second' : 'behind', false]
}

function deriveObvod(o) {
  const rd = o.rounds[2] ? 2 : 1
  const key = rd === 2 ? 'votes2' : 'votes1'
  const { okrskyZprac: z, okrskyCelkem: c, platneHlasy: valid } = o.rounds[rd]
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
    k.majority = !official && z > 0 && z === c && k[key] != null && 2 * k[key] > valid
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
