# Senate precinct map: geometry report (2026-10-10)

Scope: the three constituencies with a direct Pirate ticket (derived from `manifest.js` `PIRATE_BACKED`, relation `ticket`): **30 Kladno** (ballot no 2), **18 Příbram** (no 5), **75 Karviná** (no 2). Built by `cloudflare-senat/scripts/build-okrsky-geo.mjs`; output `cloudflare-senat/geo/okrsky-<obvod>.geojson` (not under `senat/public`, so nothing ships until the map is wired, see `cloudflare-senat/WIRING-okrsky.md`).

## Source and method

- One request (cached in `/tmp/senat-geo-cache`, not in the repo): `https://static.programydovoleb.cz/2025/vol_okrsky_2025_g100_20250701.geojson`, 19 097 174 bytes, 14 711 polygons (14 359 Polygon, 352 MultiPolygon), EPSG:5514. Same file as `scripts/build-data.js` of the Prague tracker.
- Reprojection with proj4 (S-JTSK to WGS84, 5 decimals), `@turf/simplify` `highQuality`, tolerance 0.00003 first, then coarser until the file is at most 150 KB.
- Obec set of an obvod: `secoco.json` (`OBEC` to `OBVOD`). A polygon belongs to an obvod when its **voting-place code** is in that set. The voting-place code is `kod_mco` when the polygon has one (Prague and other cities with městské části / obvody), else `kod_obec`. This matters: `CIS_OBEC` of the batches is "obec, městská část or městský obvod where one votes" (secoco schema), e.g. Prague precinct `539864/56010` is Zbraslav, not `554782` Praha. The output property `obec` holds this joined code, `okrsek` is `cislo`, `name` is the (MČ or obec) name. None of the three obvody has městské části, so for them the code equals `kod_obec`; the rule is still applied because the same script and join serve any later obvod.
- Join key of a batch precinct: `(CIS_OBEC, CIS_OKRSEK)` = `(obec, okrsek)` of the polygon.

## Result

| obvod | polygons | secoco ranges (expected) | `OKRSKY_CELKEM` 2026 (frozen results) | obce (secoco / with polygons) | polygon without secoco number | secoco number without polygon | file | gzip |
|---|---|---|---|---|---|---|---|---|
| 30 Kladno | 151 | 150 | 150 | 66 / 66 | 1 (`571326:2` Lichoceves) | 0 | 83 825 B | 17 244 B |
| 18 Příbram | 275 | 268 | 268 | 147 / 147 | 7 (`530573:9`, `530573:10` Sedlec-Prčice; `540129:2..5` Dolní Hbity; `540374:2` Jablonná) | 0 | 144 750 B | 31 420 B |
| 75 Karviná | 105 | 105 | 105 | 9 / 9 | 0 | 0 | 38 088 B | 6 063 B |

- Every number in the secoco ranges has a polygon (no gaps), every obec has polygons. No duplicate `(obec, okrsek)` keys.
- The secoco range sums equal the frozen 2026 `OKRSKY_CELKEM` for **all 27 obvody**, so the content is the 2026 numbering although its header says validity 2024-09-20..21 (the same header is on `cpp.json`: a copy-paste in the published codelists).
- The 8 extra polygons are 2025 subdivisions that the 2026 Senate election does not use (secoco: Dolní Hbity 1 precinct, the polygons have 5; their `platiod` is October 2024 to March 2025). They will never report. They stay in the files so the report stays honest (they show as "not counted"). Options for the wiring commit: drop them in the script (a one-line filter on `expected`) or leave them. Either way the client should show "x of N counted" with N = 150 / 268 / 105 (secoco and `OKRSKY_CELKEM`), not N = `features.length`.
- Příbram (275 polygons, 6 159 vertices): the source is already generalised to about 100 m, so simplification hardly reduces anything until 0.001 degrees (size at tolerance 0.00003: 211 717 B with 5 decimals, 193 841 B with 4 decimals; 0.001: 182 547 B; 0.0013: 165 613 B; **0.0016: 144 749 B** chosen). 0.0016 degrees is about 115 to 180 m: borders between neighbouring precincts are simplified independently, so at high zoom thin gaps or overlaps between neighbours can appear (Kladno and Karviná use the Prague tolerance, no such effect). If a bigger file is acceptable for Příbram, `--max-kb 200` gives the fine version (193 841 B raw, about 45 KB gzip); static assets are served compressed (31 KB gzip as built).
- All rings closed, at least 4 positions, no collapsed polygon; bounding boxes are plausible (Kladno 13.871..14.404 E, 50.032..50.264 N; Příbram 13.737..14.682 E, 49.501..49.959 N; Karviná 18.393..18.606 E, 49.718..49.926 N).

## Join key and numbering checked against real batches

The two real 2024 batches (`fixtures/okrsky-2024-b1.xml`, `b2.xml`, 32 precincts, obvody 14, 17, 20, 23, 26) were matched against the **whole** 2025 polygon file by `(kod_mco or kod_obec, cislo)`: **32 of 32 match** (31 through `kod_mco`, 1 through `kod_obec`); with `kod_obec` alone only the one non-MČ precinct would match. So (a) the join key and the MČ rule are right, (b) the precinct numbering of the 2024 Senate batches equals the 2025 polygon numbering for these 32 precincts (obvody 14, 17, 20, 23, 26). That is evidence for stable numbering between elections, not proof for 2026.

## Validate after the first real batch (before the map is shown)

1. Download a real batch once: `curl -sA 'pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)' -o /tmp/b1.xml https://volby.gov.cz/appdata/senat/20261009/odata/okrsky/K1/vysledky_okrsky_00001.xml` (404 HTML until it exists).
2. `node cloudflare-senat/scripts/build-okrsky-geo.mjs <secoco.json> --check-only --check-batch /tmp/b1.xml` (repeat `--check-batch` for later batches). It prints, per obvod, matched and **UNMATCHED** `(obec, okrsek)` keys and how many polygons are not yet reported. Any UNMATCHED key in obvod 30, 18 or 75 means a numbering difference: that precinct would be counted by the backend but never drawn.
3. When most precincts have reported, the list of polygons "not yet reported" should shrink to the known never-reporting extras above (8). Anything else left over late in the night is a polygon-vs-2026 mismatch.
4. Cross-check the backend: `/api/senat-okrsky?obvod=30` `counted` against `OKRSKY_ZPRAC` of obvod 30 in `/api/senat` (they must be equal in round 1; the batches and the snapshot come from different files, so a difference of one batch is normal while counting).

## Not verified

- **2026 numbering and boundaries vs the 2025 polygons.** The polygons are the July 2025 state; no 2026 batch with these obvody existed when this was written (`K1/vysledky_okrsky_00001.xml` was still the HTML 404 page). The Prague tracker saw count mismatches for large cities (Ostrava 268 vs 246), so a mismatch cannot be excluded for any obec. The three obvody match the 2026 counts except for the 8 extra polygons, which is the best static evidence available.
- Boundary changes of obce or precincts after 2025-07-01 (the file date) are not visible.
- The 8 extra polygons are assumed to be unused 2025 precincts; if the 2026 numbering reuses one of them (for example renumbering in Dolní Hbity), the secoco ranges would be wrong rather than the polygons. The first batch tells.
- Whether `PLATNE_HLASY` equals the sum of the `HLASY_OKRSEK` values (not needed: the share uses `PLATNE_HLASY`).
- Round 2: whether K2 batches carry only runoff obvody and only the two runoff candidates (assumed from the 2024 K1 pattern that zero-vote candidates are omitted; K2 files were not available).
