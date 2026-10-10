import { describe, it, expect } from 'vitest'
import { derive, STATUSES } from './derive.js'

const STATES = [
  'waiting', 'counting', 'counted', 'runoff', 'runoff-counting', 'runoff-counted', 'elected', 'tie',
]

// --- synthetic snapshot helpers (normalised shape, spec §3, no derived fields) ---
const round = (z, c, valid = 0) => ({
  okrskyCelkem: c, okrskyZprac: z, okrskyZpracProc: c ? (z / c) * 100 : 0,
  ucastProc: 0, platneHlasy: valid, zapsaniVolici: 0, odevzdaneObalky: 0,
})

const cand = (no, votes1, extra = {}) => ({
  no, name: `Kandidatura ${no}`, pre: '', post: '',
  votes1, pct1: 0, st1: null, votes2: null, pct2: null, st2: null,
  pirate: null, party: null, ballotLabel: null, member: null, age: null, job: null, residence: null,
  ...extra,
})

// r1/r2 = [Z, C, valid]; cands = [candidate, ...]
const obvod = (n, { r1, r2, cands }) => ({
  n, name: `Obvod ${n}`,
  rounds: { 1: round(...r1), ...(r2 ? { 2: round(...r2) } : {}) },
  candidates: cands,
})

const mk = (...obvody) => ({
  v: 1, kind: 'senat', generated: '2026-10-10T16:05:12', generatedMs: 1791641112000,
  round: obvody.some((o) => o.rounds[2]) ? 2 : 1,
  country: { 1: round(0, 0) },
  obvody, warnings: [],
})

const one = (spec) => derive(mk(obvod(1, spec))).obvody[0]
const statuses = (o) => o.candidates.map((c) => c.status)
const ranks = (o) => o.candidates.map((c) => c.rank)

const P = { pirate: 'ticket' }

describe('derive: purity', () => {
  it('returns a new object and never mutates the input', () => {
    const input = mk(obvod(1, { r1: [5, 10, 100], cands: [cand(1, 60, P), cand(2, 40)] }))
    const copy = structuredClone(input)
    const out = derive(input)
    expect(input).toEqual(copy)
    expect(out).not.toBe(input)
    expect(out.obvody[0]).not.toBe(input.obvody[0])
    expect(out.obvody[0].candidates[0]).not.toBe(input.obvody[0].candidates[0])
    expect(out.obvody[0].rounds).not.toBe(input.obvody[0].rounds)
    expect(input.obvody[0].state).toBeUndefined()
    expect(input.summary).toBeUndefined()
  })

  it('is idempotent and keeps non-derived fields', () => {
    const input = mk(obvod(1, { r1: [10, 10, 100], cands: [cand(1, 60, P), cand(2, 40)] }))
    const once = derive(input)
    expect(derive(once)).toEqual(once)
    expect(once.warnings).toEqual([])
    expect(once.generatedMs).toBe(input.generatedMs)
    expect(once.obvody[0].candidates[0].pirate).toBe('ticket')
  })
})

describe('derive: round 1 without official flags', () => {
  it('waiting: Z = 0, all candidates waiting, not official', () => {
    const o = one({ r1: [0, 10, 0], cands: [cand(1, 0, P), cand(2, 0), cand(3, 0)] })
    expect(o.state).toBe('waiting')
    expect(o.decidedRound).toBe(0)
    expect(statuses(o)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(o.candidates.every((c) => c.official === false && c.majority === false)).toBe(true)
  })

  it('counting: leading / second / behind by rank, even with 2v > valid (Z < C)', () => {
    const o = one({ r1: [4, 10, 100], cands: [cand(1, 20), cand(2, 70), cand(3, 10)] })
    expect(o.state).toBe('counting')
    expect(ranks(o)).toEqual([2, 1, 3])
    expect(statuses(o)).toEqual(['second', 'leading', 'behind'])
    expect(o.candidates.map((c) => c.majority)).toEqual([false, false, false])
    expect(o.candidates.every((c) => c.official === false)).toBe(true)
  })

  it('counted: Z = C without a flag; majority only for 2v > valid', () => {
    const o = one({ r1: [10, 10, 1000], cands: [cand(1, 600), cand(2, 300), cand(3, 100)] })
    expect(o.state).toBe('counted')
    expect(statuses(o)).toEqual(['leading', 'second', 'behind'])
    expect(o.candidates.map((c) => c.majority)).toEqual([true, false, false])
    expect(o.candidates.every((c) => c.official === false)).toBe(true)
  })

  it('counted: exactly 50 % is not a majority', () => {
    const o = one({ r1: [10, 10, 1000], cands: [cand(1, 500), cand(2, 500)] })
    expect(o.candidates.map((c) => c.majority)).toEqual([false, false])
  })

  it('majority is exact: 50.004 % reads "50.00" but is a majority; 50.000 % is not', () => {
    const win = one({
      r1: [10, 10, 100000],
      cands: [cand(1, 50004, { pct1: 50.0 }), cand(2, 49996, { pct1: 49.99 })],
    })
    expect(win.candidates[0].pct1).toBe(50)
    expect(win.candidates[0].majority).toBe(true)
    const half = one({
      r1: [10, 10, 100000],
      cands: [cand(1, 50000, { pct1: 50.0 }), cand(2, 50000, { pct1: 50.0 })],
    })
    expect(half.candidates.map((c) => c.majority)).toEqual([false, false])
  })

  it('majority needs Z = C (also never when Z = 0 and valid = 0)', () => {
    const partial = one({ r1: [9, 10, 100], cands: [cand(1, 90), cand(2, 10)] })
    expect(partial.candidates[0].majority).toBe(false)
    const none = one({ r1: [0, 10, 0], cands: [cand(1, 0), cand(2, 0)] })
    expect(none.candidates.map((c) => c.majority)).toEqual([false, false])
  })

  it('tie for first place: both leading (rank 1), the next has rank 3', () => {
    const o = one({ r1: [5, 10, 1000], cands: [cand(1, 300), cand(2, 300), cand(3, 200), cand(4, 100)] })
    expect(ranks(o)).toEqual([1, 1, 3, 4])
    expect(statuses(o)).toEqual(['leading', 'leading', 'behind', 'behind'])
  })

  it('tie for second place: leading + two second', () => {
    const o = one({ r1: [5, 10, 1000], cands: [cand(1, 400), cand(2, 200), cand(3, 200), cand(4, 100)] })
    expect(ranks(o)).toEqual([1, 2, 2, 4])
    expect(statuses(o)).toEqual(['leading', 'second', 'second', 'behind'])
  })
})

describe('derive: official flags in round 1', () => {
  it('elected in round 1: official, decidedRound 1, no majority flag', () => {
    const o = one({
      r1: [10, 10, 1000],
      cands: [
        cand(1, 600, { st1: 'ZVOLEN', pirate: 'endorsed' }),
        cand(2, 300, { st1: 'NEZVOLEN' }),
        cand(3, 100, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('elected')
    expect(o.decidedRound).toBe(1)
    expect(statuses(o)).toEqual(['elected', 'notAdvancing', 'notAdvancing'])
    expect(o.candidates.every((c) => c.official === true && c.majority === false)).toBe(true)
  })

  it('runoff announced (round 2 not started): two advancing, others not', () => {
    const o = one({
      r1: [10, 10, 1000],
      cands: [
        cand(1, 400, { st1: '2.KOLO', pirate: 'ticket' }),
        cand(2, 300, { st1: '2.KOLO' }),
        cand(3, 200, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('runoff')
    expect(o.decidedRound).toBe(0)
    expect(statuses(o)).toEqual(['advancing', 'advancing', 'notAdvancing'])
    expect(o.candidates.every((c) => c.official === true)).toBe(true)
    expect(ranks(o)).toEqual([1, 2, 3])
  })

  it('runoff with a round-2 UCAST at Z2 = 0: still runoff / advancing, round-2 rank among finalists', () => {
    const o = one({
      r1: [10, 10, 1000],
      r2: [0, 10, 0],
      cands: [
        cand(1, 400, { st1: '2.KOLO', votes2: 0 }),
        cand(2, 300, { st1: '2.KOLO', votes2: 0 }),
        cand(3, 200, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('runoff')
    expect(statuses(o)).toEqual(['advancing', 'advancing', 'notAdvancing'])
    expect(o.candidates.every((c) => c.official === true)).toBe(true)
    expect(ranks(o)).toEqual([1, 1, null])
  })
})

describe('derive: round 2', () => {
  const finalists = (v2a, v2b, extra = {}) => [
    cand(1, 400, { st1: '2.KOLO', votes2: v2a, ...extra, pirate: 'ticket' }),
    cand(2, 300, { st1: '2.KOLO', votes2: v2b }),
    cand(3, 200, { st1: 'NEZVOLEN' }),
  ]

  it('runoff-counting: provisional runoffLeading / runoffBehind, official false, no majority', () => {
    const o = one({ r1: [10, 10, 1000], r2: [3, 10, 1000], cands: finalists(350, 650) })
    expect(o.state).toBe('runoff-counting')
    expect(statuses(o)).toEqual(['runoffBehind', 'runoffLeading', 'notAdvancing'])
    expect(ranks(o)).toEqual([2, 1, null])
    expect(o.candidates.map((c) => c.official)).toEqual([false, false, true])
    expect(o.candidates.map((c) => c.majority)).toEqual([false, false, false])
  })

  it('runoff-counting: a round-2 tie gives both runoffLeading', () => {
    const o = one({ r1: [10, 10, 1000], r2: [3, 10, 1000], cands: finalists(500, 500) })
    expect(statuses(o)).toEqual(['runoffLeading', 'runoffLeading', 'notAdvancing'])
    expect(ranks(o)).toEqual([1, 1, null])
  })

  it('runoff-counted: Z2 = C2 without st2 flag; exact majority of round-2 valid votes', () => {
    const o = one({ r1: [10, 10, 1000], r2: [10, 10, 1000], cands: finalists(350, 650) })
    expect(o.state).toBe('runoff-counted')
    expect(statuses(o)).toEqual(['runoffBehind', 'runoffLeading', 'notAdvancing'])
    expect(o.candidates.map((c) => c.official)).toEqual([false, false, true])
    expect(o.candidates.map((c) => c.majority)).toEqual([false, true, false])
  })

  it('runoff-counted: round-1 percentages do not leak into the round-2 majority', () => {
    const o = one({ r1: [10, 10, 1000], r2: [10, 10, 1000], cands: finalists(500, 500) })
    expect(o.candidates.map((c) => c.majority)).toEqual([false, false, false])
  })

  it('elected in round 2: st2 flags win over everything, decidedRound 2', () => {
    const o = one({
      r1: [10, 10, 1000],
      r2: [10, 10, 1000],
      cands: [
        cand(1, 400, { st1: '2.KOLO', votes2: 350, st2: 'NEZVOLEN', pirate: 'endorsed' }),
        cand(2, 300, { st1: '2.KOLO', votes2: 650, st2: 'ZVOLEN' }),
        cand(3, 200, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('elected')
    expect(o.decidedRound).toBe(2)
    expect(statuses(o)).toEqual(['runoffLost', 'elected', 'notAdvancing'])
    expect(ranks(o)).toEqual([2, 1, null])
    expect(o.candidates.every((c) => c.official === true && c.majority === false)).toBe(true)
  })

  it('tie in round 2: NEZVOLEN_SHODA_HLASU for both, obvod tie, nobody elected', () => {
    const o = one({
      r1: [10, 10, 1000],
      r2: [10, 10, 1000],
      cands: [
        cand(1, 400, { st1: '2.KOLO', votes2: 500, st2: 'NEZVOLEN_SHODA_HLASU' }),
        cand(2, 300, { st1: '2.KOLO', votes2: 500, st2: 'NEZVOLEN_SHODA_HLASU' }),
        cand(3, 200, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('tie')
    expect(o.decidedRound).toBe(0)
    expect(statuses(o)).toEqual(['runoffTie', 'runoffTie', 'notAdvancing'])
    expect(ranks(o)).toEqual([1, 1, null])
    expect(o.candidates.every((c) => c.official === true && c.majority === false)).toBe(true)
  })

  it('three 2.KOLO but only two carry votes2: the third has rank null and keeps the official flag', () => {
    const o = one({
      r1: [10, 10, 1000],
      r2: [4, 10, 800],
      cands: [
        cand(1, 300, { st1: '2.KOLO', votes2: 300 }),
        cand(2, 300, { st1: '2.KOLO', votes2: 500 }),
        cand(3, 300, { st1: '2.KOLO' }),
        cand(4, 100, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('runoff-counting')
    expect(ranks(o)).toEqual([2, 1, null, null])
    expect(statuses(o)).toEqual(['runoffBehind', 'runoffLeading', 'advancing', 'notAdvancing'])
    expect(o.candidates[2].official).toBe(true)
    expect(o.candidates[2].majority).toBe(false)
  })

  it('round-2 ranking ignores round-1 votes', () => {
    const o = one({ r1: [10, 10, 1000], r2: [5, 10, 100], cands: finalists(10, 90) })
    expect(o.candidates[0].votes1).toBeGreaterThan(o.candidates[1].votes1)
    expect(ranks(o)).toEqual([2, 1, null])
  })
})

describe('derive: round 2 edge cases (review L1-L3)', () => {
  it('L1: a partly published st2 (loser NEZVOLEN, no ZVOLEN yet) keeps the round-2 count state', () => {
    const cands = () => [
      cand(1, 400, { st1: '2.KOLO', votes2: 350, st2: 'NEZVOLEN' }),
      cand(2, 300, { st1: '2.KOLO', votes2: 650 }),
      cand(3, 200, { st1: 'NEZVOLEN' }),
    ]
    const done = one({ r1: [10, 10, 1000], r2: [10, 10, 1000], cands: cands() })
    expect(done.state).toBe('runoff-counted')
    expect(statuses(done)).toEqual(['runoffLost', 'runoffLeading', 'notAdvancing'])
    const part = one({ r1: [10, 10, 1000], r2: [6, 10, 1000], cands: cands() })
    expect(part.state).toBe('runoff-counting')
    const out = derive(mk(obvod(1, { r1: [10, 10, 1000], r2: [10, 10, 1000], cands: cands() })))
    expect(out.summary).toMatchObject({ awaitingOfficial: 1, runoff: 0, decided: 0 })
  })

  it('L2: round-2 votes without a round-2 UCAST: round 2, finalists ranked, no crash, Z2 unknown -> advancing', () => {
    const o = one({
      r1: [10, 10, 1000],
      cands: [
        cand(1, 400, { st1: '2.KOLO', votes2: 0 }),
        cand(2, 300, { st1: '2.KOLO', votes2: 0 }),
        cand(3, 200, { st1: 'NEZVOLEN' }),
      ],
    })
    expect(o.state).toBe('runoff')
    expect(ranks(o)).toEqual([1, 1, null])
    expect(statuses(o)).toEqual(['advancing', 'advancing', 'notAdvancing'])
    expect(o.candidates.map((c) => c.outlook)).toEqual([null, null, null])
  })

  it('L3: a non-finalist carrying HLASY_2KOLO="0" gets no round-2 rank', () => {
    const o = one({
      r1: [10, 10, 1000], r2: [5, 10, 100],
      cands: [
        cand(1, 400, { st1: '2.KOLO', votes2: 30 }),
        cand(2, 300, { st1: '2.KOLO', votes2: 70 }),
        cand(3, 200, { st1: 'NEZVOLEN', votes2: 0 }),
      ],
    })
    expect(ranks(o)).toEqual([2, 1, null])
    expect(statuses(o)).toEqual(['runoffBehind', 'runoffLeading', 'notAdvancing'])
    expect(o.candidates[2].majority).toBe(false)
  })

  it('round-2 rank is only among candidates with votes2 (no flags at all)', () => {
    const o = one({ r1: [10, 10, 1000], r2: [5, 10, 100], cands: [cand(1, 900), cand(2, 50, { votes2: 20 }), cand(3, 40, { votes2: 80 })] })
    expect(ranks(o)).toEqual([null, 2, 1])
  })
})

describe('derive: outlook and gap (unofficial candidates only)', () => {
  const view = (o) => o.candidates.map((c) => [c.outlook, c.gap])

  it('majority winner: mandate (no gap), the others out with the deficit to the winner', () => {
    const o = one({ r1: [5, 10, 100], cands: [cand(1, 30), cand(2, 60), cand(3, 10)] })
    expect(o.state).toBe('counting')
    expect(view(o)).toEqual([['out', 30], ['mandate', null], ['out', 50]])
  })

  it('50.004 % is a mandate even though the rounded percentage reads 50.00; exactly 50 % is not', () => {
    const win = one({ r1: [5, 10, 100000], cands: [cand(1, 50004, { pct1: 50.0 }), cand(2, 49996)] })
    expect(view(win)).toEqual([['mandate', null], ['out', 8]])
    const half = one({ r1: [5, 10, 100000], cands: [cand(1, 50000), cand(2, 30000), cand(3, 20000)] })
    expect(view(half)).toEqual([['advance', 20000], ['advance', 20000], ['out', 10000]])
  })

  it('no majority: rank 1 lead, rank 2 deficit to 1st, rank 3/4 deficit to 2nd', () => {
    const o = one({ r1: [5, 10, 100], cands: [cand(1, 10), cand(2, 40), cand(3, 30), cand(4, 20)] })
    expect(ranks(o)).toEqual([4, 1, 2, 3])
    expect(view(o)).toEqual([['out', 20], ['advance', 10], ['advance', 10], ['out', 10]])
  })

  it('tie for 1st: both advance with gap 0; the rest are out against the tied votes', () => {
    const o = one({ r1: [5, 10, 1000], cands: [cand(1, 300), cand(2, 300), cand(3, 200), cand(4, 100)] })
    expect(ranks(o)).toEqual([1, 1, 3, 4])
    expect(view(o)).toEqual([['advance', 0], ['advance', 0], ['out', 100], ['out', 200]])
  })

  it('tie for 2nd: leader leads by the 2nd place, both second-placed advance, the rest out', () => {
    const o = one({ r1: [5, 10, 1000], cands: [cand(1, 400), cand(2, 200), cand(3, 200), cand(4, 100)] })
    expect(ranks(o)).toEqual([1, 2, 2, 4])
    expect(view(o)).toEqual([['advance', 200], ['advance', 200], ['advance', 200], ['out', 100]])
  })

  it('waiting (Z = 0) and official candidates have no outlook', () => {
    const w = one({ r1: [0, 10, 0], cands: [cand(1, 0), cand(2, 0)] })
    expect(view(w)).toEqual([[null, null], [null, null]])
    const e = one({ r1: [10, 10, 100], cands: [cand(1, 60, { st1: 'ZVOLEN' }), cand(2, 40, { st1: 'NEZVOLEN' })] })
    expect(view(e)).toEqual([[null, null], [null, null]])
    const r = one({ r1: [10, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO' }), cand(2, 35, { st1: '2.KOLO' }), cand(3, 25, { st1: 'NEZVOLEN' })] })
    expect(view(r)).toEqual([[null, null], [null, null], [null, null]])
  })

  it('an unflagged candidate next to official ones is still judged by the votes', () => {
    const o = one({ r1: [10, 10, 100], cands: [cand(1, 60, { st1: 'ZVOLEN' }), cand(2, 40)] })
    expect(view(o)).toEqual([[null, null], ['out', 20]])
  })

  const fin = (a, b, z = 5) => ({
    r1: [10, 10, 1000], r2: [z, 10, 1000],
    cands: [cand(1, 400, { st1: '2.KOLO', votes2: a }), cand(2, 300, { st1: '2.KOLO', votes2: b }), cand(3, 200, { st1: 'NEZVOLEN' })],
  })

  it('round 2: lead / trail with the gap to the other finalist', () => {
    expect(view(one(fin(650, 350)))).toEqual([['lead', 300], ['trail', 300], [null, null]])
  })

  it('round 2: equal votes -> tie, gap 0', () => {
    expect(view(one(fin(500, 500)))).toEqual([['tie', 0], ['tie', 0], [null, null]])
  })

  it('round 2: Z2 = 0 or any st2 flag -> no outlook', () => {
    expect(view(one(fin(0, 0, 0))).every(([o, g]) => o === null && g === null)).toBe(true)
    const flagged = one({ ...fin(650, 350, 10), cands: [cand(1, 400, { st1: '2.KOLO', votes2: 650 }), cand(2, 300, { st1: '2.KOLO', votes2: 350, st2: 'NEZVOLEN' }), cand(3, 200, { st1: 'NEZVOLEN' })] })
    expect(view(flagged)).toEqual([[null, null], [null, null], [null, null]])
    const done = one({ ...fin(650, 350, 10), cands: [cand(1, 400, { st1: '2.KOLO', votes2: 650, st2: 'ZVOLEN' }), cand(2, 300, { st1: '2.KOLO', votes2: 350, st2: 'NEZVOLEN' }), cand(3, 200, { st1: 'NEZVOLEN' })] })
    expect(view(done)).toEqual([[null, null], [null, null], [null, null]])
  })

  it('every derived candidate carries outlook and gap (null by default)', () => {
    const out = derive(mk(obvod(1, { r1: [0, 10, 0], cands: [cand(1, 0), cand(2, 0)] })))
    expect(out.obvody[0].candidates.every((c) => c.outlook === null && c.gap === null)).toBe(true)
  })
})

describe('derive: Pirates and summary', () => {
  it('hasPirate is false for an obvod without Pirate-backed candidates', () => {
    const o = one({ r1: [3, 10, 100], cands: [cand(1, 60), cand(2, 40)] })
    expect(o.hasPirate).toBe(false)
  })

  it('hasPirate is true when any candidate is pirate-backed', () => {
    const o = one({ r1: [3, 10, 100], cands: [cand(1, 60), cand(2, 40, { pirate: 'endorsed' })] })
    expect(o.hasPirate).toBe(true)
  })

  it('counts Pirates only over candidates with `pirate`; Σ byStatus = total', () => {
    const out = derive(mk(
      obvod(1, { r1: [5, 10, 100], cands: [cand(1, 60, { pirate: 'ticket' }), cand(2, 40, { pirate: 'endorsed' }), cand(3, 0)] }),
      obvod(2, { r1: [0, 10, 0], cands: [cand(1, 0, { pirate: 'endorsed' }), cand(2, 0)] }),
      obvod(3, { r1: [5, 10, 100], cands: [cand(1, 60), cand(2, 40)] }),
    ))
    const { pirates } = out.summary
    expect(pirates.total).toBe(3)
    expect(Object.keys(pirates.byStatus)).toEqual(STATUSES)
    expect(Object.values(pirates.byStatus).reduce((a, b) => a + b, 0)).toBe(pirates.total)
    expect(pirates.byStatus.leading).toBe(1)
    expect(pirates.byStatus.second).toBe(1)
    expect(pirates.byStatus.waiting).toBe(1)
  })

  // One synthetic snapshot reaching every state and every candidate status.
  const everything = () => {
    const nz = (extra) => cand(9, 10, { st1: 'NEZVOLEN', ...extra })
    return mk(
      obvod(1, { r1: [0, 10, 0], cands: [cand(1, 0, P), cand(2, 0)] }), // waiting
      obvod(2, { r1: [4, 10, 100], cands: [cand(1, 50, P), cand(2, 30, P), cand(3, 20, P)] }), // counting
      obvod(3, { r1: [10, 10, 100], cands: [cand(1, 60, P), cand(2, 40)] }), // counted
      obvod(4, { r1: [10, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO', pirate: 'endorsed' }), cand(2, 35, { st1: '2.KOLO' }), nz()] }), // runoff
      obvod(5, { r1: [10, 10, 100], r2: [2, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO', votes2: 60, pirate: 'endorsed' }), cand(2, 35, { st1: '2.KOLO', votes2: 40, pirate: 'endorsed' }), nz()] }), // runoff-counting
      obvod(6, { r1: [10, 10, 100], r2: [10, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO', votes2: 60 }), cand(2, 35, { st1: '2.KOLO', votes2: 40 }), nz()] }), // runoff-counted
      obvod(7, { r1: [10, 10, 100], cands: [cand(1, 60, { st1: 'ZVOLEN', pirate: 'ticket' }), cand(2, 40, { st1: 'NEZVOLEN', pirate: 'endorsed' })] }), // elected r1
      obvod(8, { r1: [10, 10, 100], r2: [10, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO', votes2: 60, st2: 'ZVOLEN', pirate: 'ticket' }), cand(2, 35, { st1: '2.KOLO', votes2: 40, st2: 'NEZVOLEN', pirate: 'endorsed' }), nz()] }), // elected r2
      obvod(9, { r1: [10, 10, 100], r2: [10, 10, 100], cands: [cand(1, 40, { st1: '2.KOLO', votes2: 50, st2: 'NEZVOLEN_SHODA_HLASU', pirate: 'ticket' }), cand(2, 35, { st1: '2.KOLO', votes2: 50, st2: 'NEZVOLEN_SHODA_HLASU' }), nz({ pirate: 'endorsed' })] }), // tie
    )
  }

  it('every state and every status is reachable', () => {
    const out = derive(everything())
    expect(out.obvody.map((o) => o.state)).toEqual(STATES.slice(0, 7).concat('elected', 'tie'))
    expect(new Set(out.obvody.map((o) => o.state))).toEqual(new Set(STATES))
    const seen = new Set(out.obvody.flatMap((o) => o.candidates.map((c) => c.status)))
    expect(seen).toEqual(new Set(STATUSES))
  })

  it('summary: one bucket per obvod state group, Σ = obvody; Pirate buckets Σ = total', () => {
    const out = derive(everything())
    const s = out.summary
    expect(s).toMatchObject({
      obvody: 9, decided: 2, runoff: 2, awaitingOfficial: 2, counting: 1, waiting: 1, ties: 1,
    })
    expect(s.decided + s.runoff + s.awaitingOfficial + s.counting + s.waiting + s.ties).toBe(s.obvody)
    expect(s.pirates.total).toBe(out.obvody.flatMap((o) => o.candidates).filter((c) => c.pirate).length)
    expect(Object.values(s.pirates.byStatus).reduce((a, b) => a + b, 0)).toBe(s.pirates.total)
    expect(s.pirates.byStatus).toMatchObject({
      elected: 2, runoffLost: 1, runoffTie: 1, notAdvancing: 2, advancing: 1,
      leading: 2, second: 1, behind: 1, waiting: 1, runoffLeading: 1, runoffBehind: 1,
    })
  })

  it('summary of an empty-count snapshot: everything waiting', () => {
    const out = derive(mk(
      obvod(1, { r1: [0, 10, 0], cands: [cand(1, 0, P), cand(2, 0)] }),
      obvod(2, { r1: [0, 10, 0], cands: [cand(1, 0), cand(2, 0, { pirate: 'endorsed' })] }),
    ))
    expect(out.summary).toMatchObject({ obvody: 2, decided: 0, waiting: 2 })
    expect(out.summary.pirates).toMatchObject({ total: 2, byStatus: { waiting: 2 } })
  })
})
