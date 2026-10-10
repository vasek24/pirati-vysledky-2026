# Senate precinct map — add-on (after the production launch of the Senate page)

Status: **parked by the owner** (2026-10-10 ~13:30): "the maps are later addon". Nothing of this is in the production Worker.
Do it on a separate branch (`senate/okrsky-map`) cut from `senate/results` after prod, with its own staging deploy and the same review pipeline.

## Owner requirements
- Precinct (okrsek) map **only for constituencies with a direct Pirate-ticket candidate**: Kladno (30, ballot no 2), Příbram (18, no 5), Karviná (75, no 2) — derive from `PIRATE_BACKED` relation `ticket`, never hard-code.
- **No 2020/2022 baseline.** Show (a) which precincts have reported, (b) a heat map of the Pirate candidate's share of valid votes per precinct (Pirate yellow→black ramp as in Prague `src/volby/colors.js` `PIRATE_RAMP`; uncounted = `#D4D4D0` with dashed stroke).
- **Detached from the 1-minute overall snapshot**: own Durable Object (`OkrskyFeed`), own endpoint (`/api/senat-okrsky?obvod=30`), own cadence; a map failure must never affect `/api/senat`.

## Facts gathered (verified 2026-10-10)
- Batches: `https://volby.gov.cz/appdata/senat/20261009/odata/okrsky/K{1|2}/vysledky_okrsky_NNNNN.xml`, 404 until created, incremental (~5 min); `OKRSEK@CIS_OBEC,CIS_OKRSEK,CIS_OBVOD,PORADI_ZPRAC` + `UCAST_OKRSEK` + `HLASY_OKRSEK@PORADOVE_CISLO,HLASY`; keep the highest `PORADI_ZPRAC`. The 2024 batches (same schema) are available as test fixtures: `appdata/senat/20240920/odata/okrsky/K1/vysledky_okrsky_00001.xml`.
- Geometry: no official polygon URL for Senate. Source used by the Prague tracker: `https://static.programydovoleb.cz/2025/vol_okrsky_2025_g100_20250701.geojson` (19 MB, EPSG:5514, properties `kod_obec`, `cislo`, `naz_obec`, `kod_mco`…); reproject with proj4, simplify with `@turf/simplify` (see `scripts/build-data.js`). Obvod → obec set from `secoco.json` (`SE2026ciselniky20260915_json.zip`). Join key `(kod_obec, cislo)` = `(CIS_OBEC, CIS_OKRSEK)`. **Unverified:** 2026 precinct numbering vs the 2025 boundaries (Prague spike saw count mismatches: Ostrava 268 vs 246) — validate with the first real batch (`--check-batch`).
- Senate app's own map is an inline SVG cartogram (not geographic, licence unclear) — not used.
- Prague map stack to copy: Leaflet + react-leaflet + `@maplibre/maplibre-gl-leaflet`, OpenFreeMap positron style, lazy-loaded chunk (keep mobile weight low), desktop tooltip, legend, `ResultsMap.jsx`.

## Design sketch
- Worker: second DO class `OkrskyFeed` + migration `v2` (new_sqlite_classes) in both top level and `env.staging`; refresh loop fetches batch `lastBatch+1…` until 404 (cap 40/run), persists per-round `{lastBatch, precincts}` for the wanted obvody only; gates: ignore batches generated before the round's polls close; K2 probed only after round-2 close; schedule +60 s while waiting/counting, +10 min when idle; `/api/senat-okrsky` through the same Cache API/last-resort/`x-server-now` helpers as `/api/senat`.
- Client: `PrecinctMap.jsx` lazy-loaded on the detail panel of the three obvody; its own poller (same `schedule.js`), reads only `/api/senat-okrsky` and static `data/okrsky-<obvod>.geojson`.
- Geometry build script `cloudflare-senat/scripts/build-okrsky-geo.mjs` (cached download in /tmp, outputs ≤150 KB per obvod) + report of polygon-vs-expected-precinct counts.
