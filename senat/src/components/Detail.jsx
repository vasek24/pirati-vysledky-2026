import { T, STATE } from '../text.js'
import { fullName, nf, pc } from '../format.js'
import { currentRound, isCounted, isOutOfRunoff, pctOf, progressOf, rankOf, roundOf, sortRows, votesOf } from '../view.js'
import { Chip, Relation, Why } from './Chip.jsx'

function Row({ o, c }) {
  const round = roundOf(o, c)
  const out = isOutOfRunoff(o, c)
  const rank = rankOf(o, c)
  const v = votesOf(o, c)
  const has = v != null
  const counted = isCounted(o, c)
  const pct = has ? pctOf(o, c) : 0
  const bio = [c.age != null && `${c.age} let`, c.job || (c.age != null ? T.noJob : null), c.residence].filter(Boolean)
  return (
    <div className={`snt-row${c.pirate ? ' snt-pir' : ''}`}>
      <div className="snt-rk2" title={out && rank ? T.rankRound1(rank) : undefined}>{has && counted && rank ? `${rank}.` : '–'}</div>
      <div>
        <div className="snt-nm">
          <span className="snt-bn" title={T.ballotNoTitle}>{c.no}</span>
          {fullName(c)}
        </div>
        {c.party && (
          <div className="snt-pt">
            {T.party(c.party)}
            {c.member && c.member !== 'Bez politické příslušnosti' ? T.membership(c.member) : ''}
          </div>
        )}
        {c.ballotLabel && <div className="snt-pt" style={{ fontSize: 13 }}>{T.ballot(c.ballotLabel)}</div>}
        {bio.length > 0 && <div className="snt-bio">{bio.join(' · ')}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <Relation pirate={c.pirate} />
          <Chip o={o} c={c} />
          {c.majority && !c.official && counted && <span className="snt-pt">{T.majority}</span>}
        </div>
        <Why o={o} c={c} style={{ marginTop: 6 }} />
      </div>
      <div className="snt-v snt-num">
        <b>{has ? nf(v) : '0'}</b>
        <span>{has && counted ? pc(pct, 2) : '0,00 %'}{round === 2 ? T.inRound2 : out ? T.inRound1 : ''}</span>
        {round === 2 && c.votes1 != null && <span className="snt-r2">{T.round1Votes(nf(c.votes1), pc(c.pct1, 2))}</span>}
        {out && <span className="snt-r2">{T.round2None}</span>}
      </div>
      <div className="snt-bar snt-rbar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, pct)}%`, ...(c.pirate ? { background: 'var(--ink)' } : {}) }} />
      </div>
    </div>
  )
}

export default function Detail({ snapshot, selected, onSelect }) {
  const o = snapshot.obvody.find((x) => x.n === selected)
  if (!o) return null
  const r1 = o.rounds[1]
  const r2 = o.rounds[2]
  const prog = (r) => pc(progressOf(r), 0)
  return (
    <div className="snt-detail">
      <div className="snt-dhead">
        <div>
          <div className="snt-eyebrow" style={{ margin: '0 0 4px' }}>{T.districtNo(o.n)}</div>
          <h2>{o.name}</h2>
        </div>
        <div className="snt-meta snt-num">
          <span>{STATE[o.state]}{o.decidedRound ? T.decidedIn(o.decidedRound) : ''}</span>
          <span>{T.round1Progress(nf(r1.okrskyZprac), nf(r1.okrskyCelkem), prog(r1))}</span>
          {r2 ? <span>{T.round2Progress(nf(r2.okrskyZprac), nf(r2.okrskyCelkem), prog(r2))}</span> : currentRound(o) === 2 && <span>{T.round2ProgressNone}</span>}
        </div>
        <label style={{ fontSize: 13, color: 'var(--ink-2)', display: 'grid', gap: 4 }}>
          {T.otherDistrict}
          <select value={o.n} onChange={(e) => onSelect(Number(e.target.value), false)}>
            {snapshot.obvody.map((x) => (
              <option key={x.n} value={x.n}>{x.n} · {x.name}{x.hasPirate ? ' ●' : ''}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="snt-rows">
        {sortRows(o).map((c) => <Row key={c.no} o={o} c={c} />)}
      </div>
      <div className="snt-note">
        <span>{T.note1}</span>
        <span>{T.note2}</span>
      </div>
    </div>
  )
}
