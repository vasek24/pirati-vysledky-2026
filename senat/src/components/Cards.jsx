import { T } from '../text.js'
import { fullName, nf, pc } from '../format.js'
import { isOutOfRunoff, pctOf, pirateCards, progressOf, rankOf, roundOf, votesOf } from '../view.js'
import { Chip, Relation, Why } from './Chip.jsx'

function Card({ o, c, selected, onSelect }) {
  const round = roundOf(o, c)
  const r = o.rounds[round]
  const v = votesOf(o, c)
  const show = v != null
  const counted = r.okrskyZprac > 0
  const pct = show ? pctOf(o, c) : 0
  const prog = Math.round(progressOf(r))
  const rank = rankOf(o, c)
  const rankText = !(show && counted && rank) ? T.noRank : isOutOfRunoff(o, c) ? T.rankRound1(rank) : T.rank(rank)
  const roundPrefix = round === 2 ? T.roundTwoPrefix : isOutOfRunoff(o, c) ? T.roundOnePrefix : ''
  return (
    <button
      type="button"
      className={`snt-card${selected ? ' snt-sel' : ''}`}
      onClick={() => onSelect(o.n, true)}
      title={T.cardAria(o.n, o.name)}
    >
      <div className="snt-ctop">
        <span className="snt-ob"><em>{o.n}</em>{o.name}</span>
        <Relation pirate={c.pirate} />
      </div>
      <div className="snt-cname">
        {fullName(c)}
        <small>{[c.party && T.party(c.party), T.cardMeta(c.no, c.age)].filter(Boolean).join(' · ')}</small>
      </div>
      {c.ballotLabel && <div className="snt-lbl" title={c.ballotLabel}>{T.ballot(c.ballotLabel)}</div>}
      <div className="snt-big">
        <b className="snt-num">{show ? nf(v) : '0'}</b>
        <span className="snt-num">{show && counted ? pc(pct) : '0,0 %'}</span>
        <span className="snt-rk">{rankText}</span>
      </div>
      <div className="snt-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div><Chip o={o} c={c} /></div>
      <Why o={o} c={c} />
      <div className="snt-prog snt-num">
        <span>{roundPrefix}{T.progress(nf(r.okrskyZprac), nf(r.okrskyCelkem), prog)}</span>
        <div className="snt-bar" aria-hidden="true"><i style={{ width: `${prog}%`, background: 'var(--adv)' }} /></div>
      </div>
    </button>
  )
}

export default function Cards({ snapshot, selected, onSelect }) {
  return (
    <div className="snt-cards">
      {pirateCards(snapshot).map(({ o, c }) => (
        <Card key={`${o.n}:${c.no}`} o={o} c={c} selected={o.n === selected} onSelect={onSelect} />
      ))}
    </div>
  )
}
