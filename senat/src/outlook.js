// Čip „kam to směřuje“ + jedna věta důvodu pro kandidaturu (náhled v4). Nic se tu nepočítá:
// `outlook` a `gap` (rozdíl hlasů) dodává server (spec §3.1); klient jen vybírá text.
// Jediné, co se formátuje z dat, je podíl `c.pct` a počet hlasů.
import { CHIP, T } from './text.js'
import { nf, pc } from './format.js'
import { currentRound } from './view.js'

// „1 hlas“, „2 hlasy“, „5 hlasů“ (22 → hlasy, 12 → hlasů)
export function votesText(n) {
  const a = Math.abs(n)
  const word = a === 1 ? 'hlas' : a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 12 || a % 100 > 14) ? 'hlasy' : 'hlasů'
  return `${nf(a)} ${word}`
}

const officialWhy = (o, c) =>
  ({
    elected: o.decidedRound === 2 ? T.whyElectedR2 : T.whyElectedR1,
    advancing: T.whyAdvancing,
    notAdvancing: o.state === 'elected' ? T.whyNotAdvancingDecided : T.whyNotAdvancing,
    runoffLost: T.whyRunoffLost,
    runoffTie: T.whyRunoffTie,
  })[c.status] ?? ''

// -> { cls, chip, why } (cls = třída čipu bez prefixu: leading = plný okraj čárkovaně, second, behind, …)
export function outlookView(o, c) {
  if (c.official) return { cls: c.status, chip: CHIP[c.status], why: officialWhy(o, c) }
  const kind = c.outlook
  if (kind === undefined) return { cls: c.status, chip: CHIP[c.status] + T.provisional, why: '' } // starší snapshot
  if (kind === null) {
    const waiting = c.status === 'waiting'
    return { cls: c.status, chip: CHIP[c.status] + (waiting ? '' : T.provisional), why: waiting ? T.whyWaiting : '' }
  }
  const r = o.rounds[currentRound(o)]
  const pre = r.okrskyZprac < r.okrskyCelkem ? T.prelim : T.counted
  const gap = votesText(c.gap ?? 0)
  switch (kind) {
    case 'lead':
      return { cls: 'leading', chip: pre + T.outLead, why: T.whyLead(gap) }
    case 'trail':
      return { cls: 'behind', chip: pre + T.outTrail, why: T.whyTrail(gap) }
    case 'tie':
      return { cls: 'second', chip: pre + T.outTie, why: '' }
    case 'mandate':
      return { cls: 'leading', chip: pre + T.outMandate, why: T.whyMandate(pc(c.pct1)) }
    case 'advance': {
      const tieFirst = o.candidates.filter((x) => x.rank === 1).length > 1
      const why = c.rank !== 1 ? T.whyAdvSecond(gap) : tieFirst ? T.whyAdvTie : T.whyAdvLead(pc(c.pct1), gap)
      return { cls: 'second', chip: pre + T.outAdvance, why }
    }
    case 'out': {
      const otherMajority = o.candidates.some((x) => x.outlook === 'mandate')
      const tieFirst = o.candidates.filter((x) => x.rank === 1).length > 1
      return { cls: 'behind', chip: pre + T.outOut, why: otherMajority ? T.whyOtherMajority : T.whyOut(tieFirst, gap) }
    }
    default:
      return { cls: c.status, chip: CHIP[c.status] + T.provisional, why: '' }
  }
}
