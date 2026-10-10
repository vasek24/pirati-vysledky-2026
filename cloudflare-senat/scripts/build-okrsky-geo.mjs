// Builds the precinct polygons for the Senate precinct map (add-on, not wired yet): one GeoJSON per
// constituency with a DIRECT Pirate ticket (manifest.js PIRATE_BACKED relation 'ticket'), written to
// cloudflare-senat/geo/okrsky-<obvod>.geojson (deliberately NOT under senat/public until the map is wired).
//
// Usage: node scripts/build-okrsky-geo.mjs <secoco.json> [--obvody 30,18,75] [--out-dir DIR]
//                                          [--check-batch batch.xml ...] [--check-only] [--max-kb 150]
//   secoco.json    ČSÚ číselník SECOCO (SE2026ciselniky…_json.zip): OBEC → OBVOD + precinct number ranges
//   --check-batch  report matched / unmatched (obec, okrsek) keys of a real batch vs the polygons (repeatable)
//   --check-only   do not rebuild, read the existing files of --out-dir
//
// Source (one request, cached): https://static.programydovoleb.cz/2025/vol_okrsky_2025_g100_20250701.geojson
// (~19 MB, EPSG:5514), the same file scripts/build-data.js of the Prague tracker uses. Cache: /tmp/senat-geo-cache.
// Join key of a batch precinct: (CIS_OBEC, CIS_OKRSEK) = (kod_mco if the polygon has one, else kod_obec; cislo):
// ČSÚ's OBEC is "the obec, městská část or městský obvod where one votes" (so Prague 539864/56010 is Zbraslav,
// not 554782 Praha). The output property `obec` carries that joined code.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import proj4 from 'proj4'
import simplify from '@turf/simplify'
import * as manifest from '../src/manifest.js'
import { parseBatchXml, wantedOf } from '../src/okrsky.js'

const URL_GEO = 'https://static.programydovoleb.cz/2025/vol_okrsky_2025_g100_20250701.geojson'
const UA = 'pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)'
const CACHE_DIR = '/tmp/senat-geo-cache'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FROZEN = path.join(HERE, '../fixtures/se2026-frozen.xml')
// [simplify tolerance in degrees, coordinate decimals]: the first step that fits the size budget wins.
// 0.00003 / 5 decimals is the Prague tracker's setting; the source is already generalised to ~100 m, so 4 decimals
// (≈ 8 m) lose nothing visible and are tried before any stronger simplification.
const STEPS = [[0.00003, 5], [0.00003, 4], [0.0001, 4], [0.0002, 4], [0.0005, 4], [0.001, 4], [0.0013, 4], [0.0016, 4], [0.002, 4]]

proj4.defs('EPSG:5514', '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs')
const toWgs = proj4('EPSG:5514', 'WGS84')

// ---- args --------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const values = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []))
const secocoPath = args.find((a, i) => !a.startsWith('--') && !['--obvody', '--out-dir', '--check-batch', '--max-kb'].includes(args[i - 1]))
if (!secocoPath) {
  console.error('usage: node scripts/build-okrsky-geo.mjs <secoco.json> [--obvody 30,18,75] [--out-dir DIR] [--check-batch batch.xml ...] [--check-only] [--max-kb 150]')
  process.exit(2)
}
const outDir = path.resolve(value('--out-dir') ?? path.join(HERE, '../geo'))
const maxBytes = Number(value('--max-kb') ?? 150) * 1024
const obvody = value('--obvody') ? value('--obvody').split(',').map(Number) : [...wantedOf(manifest).keys()].sort((a, b) => a - b)

// ---- secoco: obec set and expected precinct numbers per obvod -------------------------------------------------
const secoco = JSON.parse(readFileSync(secocoPath, 'utf8'))
const items = secoco['položky']
if (!Array.isArray(items)) throw new Error('secoco.json: no "položky"')
const rangesOf = (it) => {
  const out = []
  for (let i = 1; i <= 10; i++) {
    const min = it[i === 10 ? 'MINOKRSE10' : `MINOKRSEK${i}`]
    const max = it[i === 10 ? 'MAXOKRSE10' : `MAXOKRSEK${i}`]
    if (Number.isInteger(min) && Number.isInteger(max) && max > 0 && max >= min) out.push([min, max])
  }
  return out
}
const expectedOf = (obvod) => {
  const keys = new Set() // `${obec}:${okrsek}`
  const obce = new Map()
  for (const it of items.filter((x) => x.OBVOD === obvod)) {
    obce.set(String(it.OBEC), it.NAZEVOBCE)
    for (const [min, max] of rangesOf(it)) for (let n = min; n <= max; n++) keys.add(`${it.OBEC}:${n}`)
  }
  return { keys, obce }
}

// ---- download (once, cached) ------------------------------------------------------------------------------------
async function loadGeo() {
  mkdirSync(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, path.basename(URL_GEO))
  if (!existsSync(file)) {
    console.error(`downloading ${URL_GEO} (one request, ~19 MB) → ${file}`)
    const res = await fetch(URL_GEO, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`${res.status} ${URL_GEO}`)
    writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()))
    renameSync(`${file}.part`, file)
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

// ---- geometry ---------------------------------------------------------------------------------------------------------
const ring = (coords) => coords.map(([x, y]) => toWgs.forward([x, y]).map((v) => Math.round(v * 1e5) / 1e5))
function reproject(g) {
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(ring) }
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) }
  throw new Error(`unknown geometry ${g.type}`)
}

// fewer decimals: round again and drop consecutive duplicate positions
function roundTo(g, decimals) {
  if (decimals >= 5) return g
  const k = 10 ** decimals
  const ringOf = (r) => r.map(([x, y]) => [Math.round(x * k) / k, Math.round(y * k) / k]).filter((c, i, a) => i === 0 || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1])
  return g.type === 'Polygon' ? { ...g, coordinates: g.coordinates.map(ringOf) } : { ...g, coordinates: g.coordinates.map((p) => p.map(ringOf)) }
}

// simplification can collapse a tiny ring: drop rings under 4 positions, polygons without an outer ring
function clean(g) {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
    .map((p) => (p[0]?.length >= 4 ? p.filter((r, i) => i === 0 || r.length >= 4) : null))
    .filter(Boolean)
  if (!polys.length) return null
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

const featuresOf = (selected, [tolerance, decimals]) => selected.map((f) => {
  const g = clean(roundTo(simplify({ type: 'Feature', properties: {}, geometry: f.wgs }, { tolerance, highQuality: true }).geometry, decimals))
  return g && { type: 'Feature', properties: f.props, geometry: g }
}).filter(Boolean)

const fileOf = (obvod) => path.join(outDir, `okrsky-${obvod}.geojson`)
const cellKey = (p) => `${p.obec}:${p.okrsek}`

// ---- build ---------------------------------------------------------------------------------------------------------------
const summary = {}
if (!flag('--check-only')) {
  const geo = await loadGeo()
  mkdirSync(outDir, { recursive: true })
  for (const obvod of obvody) {
    const { keys: expected, obce } = expectedOf(obvod)
    if (!obce.size) throw new Error(`obvod ${obvod}: no obec in secoco`)
    const selected = []
    for (const f of geo.features) {
      const p = f.properties
      const mco = String(p.kod_mco ?? '').trim()
      const obec = mco || String(p.kod_obec)
      if (!obce.has(obec)) continue
      selected.push({
        props: { obec: Number(obec), okrsek: Number(p.cislo), name: (mco ? String(p.naz_mco).trim() : '') || String(p.naz_obec).trim() },
        wgs: reproject(f.geometry),
      })
    }
    let step = STEPS[0]
    let features
    let text
    for (const next of STEPS) {
      step = next
      features = featuresOf(selected, step)
      text = JSON.stringify({ type: 'FeatureCollection', features })
      console.error(`obvod ${obvod}: tolerance ${step[0]}, ${step[1]} decimals → ${Buffer.byteLength(text)} bytes`)
      if (Buffer.byteLength(text) <= maxBytes) break
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > maxBytes) throw new Error(`obvod ${obvod}: ${bytes} bytes at tolerance ${step[0]}/${step[1]} decimals exceeds ${maxBytes}`)
    writeFileSync(fileOf(obvod), `${text}\n`)
    const have = new Set(features.map((f) => cellKey(f.properties)))
    const dupes = features.length - have.size
    const sample = (set, n = 12) => [...set].sort().slice(0, n)
    summary[obvod] = {
      file: path.relative(process.cwd(), fileOf(obvod)),
      bytes,
      tolerance: step[0],
      decimals: step[1],
      polygons: features.length,
      duplicateKeys: dupes,
      expectedFromSecocoRanges: expected.size,
      polygonsNotInSecocoRanges: sample(new Set([...have].filter((k) => !expected.has(k)))),
      secocoNumbersWithoutPolygon: sample(new Set([...expected].filter((k) => !have.has(k)))),
      polygonsNotInRangesCount: [...have].filter((k) => !expected.has(k)).length,
      withoutPolygonCount: [...expected].filter((k) => !have.has(k)).length,
      obceInSecoco: obce.size,
      obceWithPolygons: new Set(features.map((f) => f.properties.obec)).size,
    }
  }
  // OKRSKY_CELKEM per obvod from the frozen 2026 results (round 1)
  if (existsSync(FROZEN)) {
    const xml = readFileSync(FROZEN, 'utf8')
    for (const m of xml.matchAll(/<OBVOD CISLO="(\d+)"[^>]*>[\s\S]*?<\/OBVOD>/g)) {
      const o = Number(m[1])
      const celkem = /<UCAST KOLO="1" OKRSKY_CELKEM="(\d+)"/.exec(m[0])?.[1]
      if (summary[o] && celkem) summary[o].okrskyCelkem2026 = Number(celkem)
    }
  }
  console.log(JSON.stringify(summary, null, 2))
}

// ---- check a real batch against the polygons ---------------------------------------------------------------------------------
const batches = values('--check-batch')
if (batches.length) {
  const polys = new Map() // obvod → Set of keys
  for (const obvod of obvody) {
    if (!existsSync(fileOf(obvod))) continue
    const fc = JSON.parse(readFileSync(fileOf(obvod), 'utf8'))
    polys.set(obvod, new Set(fc.features.map((f) => cellKey(f.properties))))
  }
  if (!polys.size) console.error(`no okrsky-*.geojson in ${outDir} for obvody ${obvody.join(',')}`)
  const seen = new Map() // obvod → Set of batch keys
  for (const file of batches) {
    const parsed = parseBatchXml(readFileSync(file, 'utf8'), { obvody: new Set(polys.keys()) })
    if ('chyba' in parsed) throw new Error(`${file}: CHYBA batch`)
    for (const p of parsed.precincts) {
      if (!seen.has(p.obvod)) seen.set(p.obvod, new Set())
      seen.get(p.obvod).add(`${p.obec}:${p.okrsek}`)
    }
    console.log(`${file}: batch ${parsed.batch} of round ${parsed.kolo}, generated ${parsed.generated}, ${parsed.precincts.length} precincts in the requested obvody`)
  }
  for (const [obvod, set] of polys) {
    const batchKeys = seen.get(obvod) ?? new Set()
    const matched = [...batchKeys].filter((k) => set.has(k))
    const unmatched = [...batchKeys].filter((k) => !set.has(k))
    console.log(`obvod ${obvod}: ${batchKeys.size} precincts in the batch(es): ${matched.length} matched, ${unmatched.length} UNMATCHED${unmatched.length ? ` (${unmatched.slice(0, 30).join(' ')})` : ''}; polygons not (yet) reported: ${set.size - matched.length} of ${set.size}`)
  }
  const other = [...seen.keys()].filter((o) => !polys.has(o))
  if (other.length) console.log(`(batch also holds obvody without a polygon file here: ${other.join(', ')})`)
}
if (!flag('--check-only') && !batches.length && existsSync(outDir)) {
  const files = readdirSync(outDir).filter((f) => f.startsWith('okrsky-'))
  console.error(`wrote ${files.length} file(s) in ${outDir}`)
}
