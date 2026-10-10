import { T } from '../text.js'
import { pirateTally } from '../view.js'

function Tile({ value, label, main, of }) {
  return (
    <div className={`snt-tile${main ? ' snt-main' : ''}`}>
      <b className="snt-num">
        {value}
        {of != null && <small>{T.ofTotal(of)}</small>}
      </b>
      <span>{label}</span>
    </div>
  )
}

export function OverviewTiles({ summary }) {
  return (
    <div className="snt-tiles">
      <Tile main value={summary.decided} of={summary.obvody} label={T.tileDecided} />
      <Tile value={summary.runoff + summary.ties} label={T.tileRunoff} />
      <Tile value={summary.awaitingOfficial} label={T.tileAwaiting} />
      <Tile value={summary.counting} label={T.tileCounting} />
      <Tile value={summary.waiting} label={T.tileWaiting} />
    </div>
  )
}

export function PirateTiles({ summary }) {
  const p = pirateTally(summary)
  return (
    <div className="snt-tiles" style={{ marginBottom: 14 }}>
      <Tile main value={p.elected} of={p.total} label={T.pTileElected} />
      <Tile value={p.advancing} label={T.pTileAdvancing} />
      <Tile value={p.top} label={T.pTileTop} />
      <Tile value={p.behind} label={T.pTileBehind} />
      <Tile value={p.out} label={T.pTileOut} />
      <Tile value={p.waiting} label={T.pTileWaiting} />
    </div>
  )
}
