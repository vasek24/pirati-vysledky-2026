import { HOME_URL, T } from '../text.js'
import { headerModel } from '../freshness.js'
import { closingModel } from '../closing.js'

export default function Header({ snapshot, serverNow, nextAt }) {
  const { pill, live, fresh } = snapshot ? headerModel({ snapshot, serverNow, nextAt }) : { pill: T.pillWaiting, live: false, fresh: '' }
  // před zavřením místností věta s odpočtem (mezi koly do 2. kola), po 2. kole jen řádek čerstvosti
  const closing = closingModel(snapshot, serverNow)
  return (
    <>
      <header className="snt-band">
        <div className="snt-wrap">
          <div className="snt-brand">
            <img className="snt-logo" src="/brand/logo-full-white.svg" alt={T.logoAlt} width="144" height="40" />
            <a className="snt-back" href={HOME_URL} title={T.backHomeTitle}>{T.backHome}</a>
          </div>
          <div className="snt-title-row">
            <h1>{T.headlineName} <span className="snt-year">{T.headlineYear}</span></h1>
            <span className={`snt-pill${live ? ' snt-live' : ''}`}>
              {live && <i className="snt-dot" />}
              <span>{pill}</span>
            </span>
          </div>
          {closing && (
            <p className="snt-closes">
              {closing.round === 2 ? T.closesBeforeR2(closing.date) : T.closesBefore(closing.date)}
              <b className="snt-left">{closing.left}</b>
            </p>
          )}
          {fresh && <p className="snt-fresh">{fresh}</p>}
          <p className="snt-sub">{T.subtitle}</p>
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
