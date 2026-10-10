import { CONTACT_TEL, HOME_URL, SOURCE_URL, T } from '../text.js'

export default function Footer() {
  return (
    <footer>
      <div className="snt-wrap">
        <span><a href={HOME_URL}>{T.backHome}</a></span>
        <span>{T.footSourceBefore}<a href={SOURCE_URL}>{T.footSourceLink}</a>{T.footSourceAfter}</span>
        <span>{T.footContactBefore}<a href={`tel:${CONTACT_TEL}`}>{T.footContactPhone}</a>{T.footContactAfter}</span>
      </div>
    </footer>
  )
}
