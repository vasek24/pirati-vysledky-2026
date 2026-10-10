import { T, STATE } from '../text.js'
import { currentRound, progressOf } from '../view.js'

// Popisek vybraného obvodu (viditelný jen na mobilu, kde buňky ukazují jen číslo)
function Caption({ o }) {
  const counting = o.state === 'counting' || o.state === 'runoff-counting'
  const pct = counting ? Math.round(progressOf(o.rounds[currentRound(o)])) : null
  return <p className="snt-cap" aria-live="polite">{T.cellCaption(o.n, o.name, STATE[o.state], pct, o.hasPirate)}</p>
}

export default function Strip({ obvody, selected, onSelect }) {
  const sel = obvody.find((o) => o.n === selected)
  return (
    <>
      <div className="snt-strip">
        {obvody.map((o) => {
          const state = STATE[o.state]
          const pr = o.state === 'elected' || o.state === 'runoff' ? 0 : progressOf(o.rounds[currentRound(o)])
          const cls = ['snt-cell', `snt-${o.state}`, o.hasPirate && 'snt-pir', o.n === selected && 'snt-sel']
          return (
            <button
              type="button"
              key={o.n}
              className={cls.filter(Boolean).join(' ')}
              onClick={() => onSelect(o.n, true)}
              title={T.cellTitle(o.n, o.name, state)}
              aria-label={T.cellAria(o.n, o.name, state, o.hasPirate)}
            >
              <div className="snt-p" style={{ height: `${pr}%` }} />
              <b>{o.n}</b>
              <i>{o.name}</i>
            </button>
          )
        })}
      </div>
      {sel && <Caption o={sel} />}
    </>
  )
}
