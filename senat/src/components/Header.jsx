import { HOME_URL, T } from '../text.js'
import { headerModel } from '../freshness.js'

export default function Header({ snapshot, serverNow, nextAt }) {
  const { pill, live, fresh } = snapshot ? headerModel({ snapshot, serverNow, nextAt }) : { pill: T.pillWaiting, live: false, fresh: '' }
  return (
    <>
      <header className="snt-band">
        <div className="snt-wrap">
          <a className="snt-back" href={HOME_URL} title={T.backHomeTitle}>{T.backHome}</a>
          <div className="snt-band-top">
            <span className={`snt-pill${live ? ' snt-live' : ''}`}>
              <i className="snt-dot" />
              <span>{pill}</span>
            </span>
            <span>{fresh}</span>
          </div>
          <div className="snt-title-row">
            <div>
              <h1>{T.pageTitle}</h1>
            </div>
            <p className="snt-sub" style={{ margin: 0 }}>{T.subtitle}</p>
          </div>
        </div>
      </header>
      {/* mimo <header>: sticky drží jen uvnitř rodiče, tady je to celá stránka */}
      {snapshot && (
        <nav className="snt-jump" aria-label={T.jumpLabel}>
          <a href="#h-pir">{T.jumpCandidacies}</a>
          <a href="#h-strip">{T.jumpDistricts}</a>
          <a href="#h-det">{T.jumpDetail}</a>
        </nav>
      )}
    </>
  )
}
