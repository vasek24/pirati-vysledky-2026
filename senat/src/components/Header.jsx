import { T } from '../text.js'
import { headerModel } from '../freshness.js'

export default function Header({ snapshot, serverNow, nextAt }) {
  const { pill, live, fresh } = snapshot ? headerModel({ snapshot, serverNow, nextAt }) : { pill: T.pillWaiting, live: false, fresh: '' }
  return (
    <header className="snt-band">
      <div className="snt-wrap">
        <div className="snt-band-top">
          <span className={`snt-pill${live ? ' snt-live' : ''}`}>
            <i className="snt-dot" />
            <span>{pill}</span>
          </span>
          <span className="snt-num">{fresh}</span>
        </div>
        <div className="snt-title-row">
          <div>
            <h1>{T.pageTitle}</h1>
          </div>
          <p className="snt-sub" style={{ margin: 0 }}>{T.subtitle}</p>
        </div>
      </div>
    </header>
  )
}
