# Spike report: point the app at other cities (branch spike/other-cities, worktree pirati-elec-tracker-c)

Status: DONE. Throwaway, one commit on the branch, not pushed/deployed. Prague data files untouched (git status showed only new dirs for brno/ostrava/plzen).

## Timings (wall-clock from `date`; machine clock)
| Step | Start | End | Elapsed |
|---|---|---|---|
| 0. read brief/CLAUDE.md, `npm ci`, code scan | 11:23:00 | 11:23:28 | ~0.5 min (npm ci 4 s) |
| 1+2. per-council okres + registry rows (done as one edit; facts from registry zip) | 11:23:28 | 11:23:51 | ~0.4 min (+ tests green: 337/337) |
| 3. data build for 3 towns (incl. build-data.js subset flag, 1 fix + re-run) | 11:24:03 | 11:25:13 | ~1.2 min (first run 46 s with downloads, re-run 12 s) |
| 4. SPA/Worker/vercel routing | 11:25:19 | 11:25:32 | ~0.2 min (+ lint/test green) |
| 5. build + `wrangler dev --local` + browser verify (3 pages, 3 APIs, Landing) | 11:25:35 | 11:26:32 | ~1 min |
| 6. commit | | 11:26:41 | |
Total ~3.7 min wall-clock of tool time. Caveat: this excludes model reading/thinking latency that the `date` stamps do not clearly capture; treat as "machine/tool time", not a human-supervised figure.

## Files changed: 122 vs main; only 4 are code
cloudflare/worker.js (+4/-3), scripts/build-data.js (+3/-2), src/councils.js (+42/-13), vercel.json (1 line). The other 118 are generated data/media: public/data/{brno,ostrava,plzen}/ (~830 KB) and public/media/... (~790 KB).

## What was truly copy-paste vs real work
- `okres` was ALREADY plumbed through `pathsFor`, build-data `jmsez`, api/volby.js and the Worker via `council.okres`; only councils.js hard-coded 1100. No server/feed code needed changing (step 1 was one line + a table split).
- Copy-paste: three rows in a new MESTA table [slug, okres, zastup, name, seats, precincts, pirates]. Values came from the ČSÚ registry (kvrzcoco.csv: seats = MANDATY, precincts = sum of MIN/MAXOKRSEK ranges; kvros.csv: Pirate list = SLOZENI contains 720). Verified the method reproduces Prague (1120 precincts, list 7, Praha 3 list 1).
  Brno 6202/582786 55 seats 353 precincts list 15; Ostrava 8106/554821 55/246/list 12; Plzeň 3203/554791 47/174/list 11.
- Real (small) work: (a) `--no-overview` flag so build does not rewrite public/data/prehled.json; (b) okrsky geojson filter: city precincts match on `kod_obec` (as the Magistrát does) not `kod_mco`, else 0 polygons - added `wholeObec: true`; (c) Worker `APP_ROUTE` now derived from COUNCILS slugs (vercel.json is still a hand-kept regex); (d) council `title` "Zastupitelstvo města".
- main.jsx needed NO change (router already uses councilBySlug).

## Results of local verification
- `wrangler dev --local`: /brno /ostrava /plzen return 200 HTML; /foo 404. /api/volby?z=582786|554821|554791 return 200 with real (frozen, phase "pre", 0 counted) feeds; correct seats/precinct totals. /api/prehled 200, now includes the 3 towns.
- Browser pane: all three pages render, console empty, 0 requests to volby.gov.cz, Plzeň draws 184 precinct polygons on the Leaflet map. Brno: 16 lists, Pirates list 15 detected.
- npm test 337/337, lint clean, build OK.

## What broke / looks wrong (not fixed, spike)
- Initial build: 0 map polygons (kod_mco vs kod_obec, fixed).
- Precinct count mismatch between 2025 boundary file/KV2022 and 2026 registry: Brno 352 vs 353, Ostrava 268 vs 246, Plzeň 184 vs 174. Ostrava/Plzeň polygons include precincts that no longer exist; precinct-number join with live per-precinct results is unverified (feeds are frozen at 0%, so precinct files and the live map colouring could NOT be tested).
- Data quality needing human eyes: Ostrava list 13 colour came out #FFFFFF (white, invisible); Brno Pirates list has no 2022 baseline ("Bez srovnatelného výsledku": split of Pirates + Zelení + Fakt Brno); only 17 candidate photos per city; Plzeň 3 lists "rozdělené" from the SPOLU coalition. No `coalition` / short names (DETAIL) entered, so no coalition view.
- Pre-election "phase pre" only; counting, final, preference-vote, and demo paths untested for non-Prague.

## Landing / overview page: Prague assumptions (not fixed)
- Hard-coded copy: "Komunální volby 2026 v Praze", "Piráti Praha" title, "MČ" everywhere, WelcomeGuide "v Praze", index.html description, document.title.
- `name.replace(/^Praha-/, '')` in Landing and ElectionHeader (selector lists).
- It assumes exactly one Magistrát (`COUNCILS.find(c => c.magistrat)`) as the hero card; there is none for another city.
- Brno/Ostrava/Plzeň fall into OURS and show as extra "Městské části s Piráty" tiles with "bez srovnání s 2022" (no entry in public/data/prehled.json, which I deliberately did not regenerate); totals "Kandidujeme v X z Y MČ", seats2022 sums, precinct totals and "official = all councils final" mix MČ with cities. composeOverview excludes only magistrat from totals.
- /api/prehled + Overview feed fan out over ALL COUNCILS (concurrency 8): +90 big councils would grow it ~2-3x; cloudflare/feedClasses.js FIRST_CLASS_KEYS (warm-up list) is a hard-coded Prague list.
- ElectionHeader council dropdown lists every council (would be 150+ entries unsorted by city).

## Scales automatically (registry-driven) vs needs a human
Automatic: registry rows (generator from kvrzcoco/kvros: slug, okres, zastup, seats, precincts, Pirate list code), data build per slug (46 s for 3 cold, ~4 s/town warm; ~15 s/town if programydovoleb.cz is rate-limited at 150 ms per request), Worker/API/feed paths, router, Worker slug route.
Needs human/new work: Landing/overview redesign (grouping by city, no single Magistrát), copy de-Pragueing, vercel.json regex (or generate it), feed warm-up classes, precinct geometry vs 2026 registry reconciliation, per-town colours/short names/coalition, handling towns with no geojson/precinct polygons or no programydovoleb data, multi-district councils (OBVODY>0) which build-data does not model, load planning for ~90 more DO feeds + cron.

## Honest estimate for ~90 towns (AI-assisted, from what was measured)
- Registry generator + wiring for all towns: ~1-1.5 h (measured: 3 towns' wiring took minutes; generator is a straightforward script, plus testing against Prague).
- Data build for 90 towns, fix breakages (colours, missing geo/pdv data, multi-obvod, count mismatches): ~2-3 h (machine time ~20-30 min; the rest is triage of per-town warnings).
- Landing/overview/header/copy rework to be city-aware: ~3-5 h (the largest unmeasured-by-spike item; pure listing, no logic proven).
- Verification of live counting/precinct results for non-Prague: ~1-2 h, and cannot be properly tested until feeds start moving.
- Total: ~8-12 h AI-assisted for "pages work for 90 towns", +~2-4 h if the overview/landing must be good. Versus the earlier 15-25 developer-days scan: the per-city plumbing really is close to copy-paste (3 towns in ~4 min tool time), so the owner's claim holds for the council pages themselves; it does NOT hold for the Landing/overview, precinct reconciliation and data-quality review.
