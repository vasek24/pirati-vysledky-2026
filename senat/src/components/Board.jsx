import { REL, T } from '../text.js'
import Cards from './Cards.jsx'
import Detail from './Detail.jsx'
import Guide from './Guide.jsx'
import Strip from './Strip.jsx'
import { OverviewTiles, PirateTiles } from './Tiles.jsx'

const LEGEND_SW = { background: 'var(--hatch)' }

// Obsah stránky nad hotovým snapshotem (čistě prezentační, bez hooků a času)
export default function Board({ snapshot, selected, onSelect }) {
  const { summary } = snapshot
  return (
    <>
      <section aria-labelledby="h-over" className="snt-s-over">
        <div className="snt-eyebrow" id="h-over">{T.eyebrowOverview}</div>
        <OverviewTiles summary={summary} />
      </section>

      <section aria-labelledby="h-strip" className="snt-s-strip" style={{ paddingTop: 0 }}>
        <div className="snt-eyebrow" id="h-strip">{T.eyebrowStrip}</div>
        <Strip obvody={snapshot.obvody} selected={selected} onSelect={onSelect} />
        <div className="snt-legend">
          <span><i className="snt-sw snt-ok" />{T.legendElected}</span>
          <span><i className="snt-sw snt-ad" />{T.legendRunoff}</span>
          <span><i className="snt-sw snt-cn" />{T.legendCounted}</span>
          <span><i className="snt-sw" style={LEGEND_SW} />{T.legendProgress}</span>
          <span><i className="snt-sw snt-pi" />{T.legendPirate}</span>
        </div>
      </section>

      <section aria-labelledby="h-pir" className="snt-s-pir" style={{ paddingTop: 0 }}>
        <div className="snt-eyebrow" id="h-pir">{T.eyebrowPirates(summary.pirates.total)}</div>
        <PirateTiles summary={summary} />
        <Cards snapshot={snapshot} selected={selected} onSelect={onSelect} />
        <div className="snt-legend" style={{ marginTop: 14 }}>
          <span><span className="snt-chip snt-elected">{T.legendSolid}</span>{T.legendSolidNote}</span>
          <span><span className="snt-chip snt-leading">{T.legendDashed}</span>{T.legendDashedNote}</span>
          <span><span className="snt-rel snt-ticket">{REL.ticket}</span></span>
          <span><span className="snt-rel snt-endorsed">{REL.endorsed}</span>{T.legendRelNote}</span>
        </div>
      </section>

      <section aria-labelledby="h-det" className="snt-s-det">
        <div className="snt-eyebrow" id="h-det">{T.eyebrowDetail}</div>
        <Detail snapshot={snapshot} selected={selected} onSelect={onSelect} />
      </section>

      <section aria-labelledby="h-how" className="snt-s-how" style={{ paddingTop: 0 }}>
        <div className="snt-eyebrow" id="h-how">{T.eyebrowGuide}</div>
        <Guide />
      </section>
    </>
  )
}
