import { T, STATE } from '../text.js'
import { currentRound, progressOf } from '../view.js'

export default function Strip({ obvody, selected, onSelect }) {
  return (
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
  )
}
