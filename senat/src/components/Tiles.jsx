import { T } from '../text.js'
import { pirateTally } from '../view.js'

// `main` = černá dlaždice se žlutým štítkem (jako hrdinské karty na praha.dg12.cz); ostatní bílé
function Tile({ value, label, main, of, head }) {
  return (
    <div className={`snt-tile${main ? ' snt-main' : ''}${value === 0 ? ' snt-zero' : ''}`}>
      {main && head && <div className="snt-tl">{head}</div>}
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
      <Tile main head={T.tileLabelOverview} value={summary.decided} of={summary.obvody} label={T.tileDecided} />
      <Tile value={summary.runoff} label={T.tileRunoff} />
      {summary.ties > 0 && <Tile value={summary.ties} label={T.tileTies} />}
      <Tile value={summary.awaitingOfficial} label={T.tileAwaiting} />
      <Tile value={summary.counting} label={T.tileCounting} />
      <Tile value={summary.waiting} label={T.tileWaiting} />
    </div>
  )
}

export function PirateTiles({ summary }) {
  const p = pirateTally(summary)
  return (
    <div className="snt-tiles snt-ptiles">
      <Tile main head={T.tileLabelPirates} value={p.elected} of={p.total} label={T.pTileElected} />
      <Tile value={p.advancing} label={T.pTileAdvancing} />
      <Tile value={p.top} label={T.pTileTop} />
      <Tile value={p.behind} label={T.pTileBehind} />
      <Tile value={p.out} label={T.pTileOut} />
      <Tile value={p.early} label={T.pTileEarly} />
      <Tile value={p.waiting} label={T.pTileWaiting} />
    </div>
  )
}
