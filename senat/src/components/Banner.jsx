import { T } from '../text.js'

const TEXT = { stale: T.bannerStale, offline: T.bannerOffline }

// Pruh nad obsahem: zastaralá data ČSÚ / výpadek spojení s naším serverem
export default function Banner({ notice }) {
  if (!TEXT[notice]) return null
  return (
    <div className="snt-banner" role="status">
      <div className="snt-wrap">{TEXT[notice]}</div>
    </div>
  )
}
