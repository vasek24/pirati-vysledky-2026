# Senate results page — design (v1), `senat.dg12.cz`

Date: 2026-10-10 · Branch `senate/results` · Maintainer: Václav Vislous (manages this fork) · Research: `docs/analysis/senate-research.md` (read first; facts marked [M]/[D]/[I] there).

## 1. Goal and scope
A live page of the Senate 2026 election (round 1 on 9–10 Oct, runoff 16–17 Oct), built for the Pirate Party. **v1 deliverable:** a page listing the **18 Pirate-backed candidates** (3 on the Pirate ticket, 15 endorsed — owner-supplied list is the source of truth) by constituency with live round-1 results (votes, share, rank, official status), a headline count of **constituencies decided**, and a Pirate-backed tally; **v1.1:** runoff display (same feed). Out of scope: projections/"estimated seats" (never shipped, see research §4), chamber composition (phase 2), photos, maps, precinct data, the municipal tracker, anything touching the Prague Worker or `mesta`.

**Separation (hard).** New Worker script `pirati-senat-zaloha` in a new directory `cloudflare-senat/`; client in `senat/`. No file under `cloudflare/`, `src/`, `public/`, `api/`, or the Prague/`mesta` wrangler config is edited. Code is **copied, not imported** across the boundary (`refresh.js` state machine, `edge.js`, `schedule.js`, the freshness helpers) so a change to Prague/`mesta` cannot alter this Worker and vice-versa. Only repo-level shared files get a minimal additive edit: `vitest.config.js` (extra `include` globs) and `package.json` (`build:senat`, `lint` globs if needed). Own DO namespace (class `SenatFeed`, script-scoped by name), **no KV** (not needed), own staging env, no router Worker, no shared secrets, no `GITHUB_TOKEN`.

## 2. Architecture
```
browser ─GET /api/senat─▶ Worker ─Cache API (per colo, ≤5 s)─▶ DO "senat" (SenatFeed, SQLite-backed)
                           ▲ cron * * * * *                        │ persisted last-good snapshot + nextRefreshAt
                           └───────────────────────────────────────┘ if due: conditional GET ─▶ volby.gov.cz/appdata/senat/20261009/odata/vysledky.xml
```
- **One feed, one DO** (`idFromName('senat')`, `locationHint: 'weur'`). Static assets (Vite build of `senat/`) are served by the Workers `ASSETS` binding; `/api/senat` is the only dynamic route; everything else 404 except assets.
- **Refresher** = the proven state machine of the Prague Worker, copied and reduced: single-flight refresh, persisted `{snapshot, meta}` in **one** `storage.put`, last-good never replaced by a bad candidate, backoff with jitter, `older`/`rejected`/quarantine outcomes, deadline 12 s, size guard, base/schema rehydrate check. Differences: **no merge step and no "complete" notion** (one file, no precinct fan-out); **conditional GET** (`If-None-Match` / `If-Modified-Since` from the stored validators; `304` ⇒ keep snapshot, advance `refreshedAt`/`nextRefreshAt`, no re-parse; ČSÚ's `Expires = Last-Modified + 60 s`); own validator (§4).
- **Upstream**: `CSU_BASE` (env only, never from a request; default `https://volby.gov.cz/appdata/senat/20261009`). Own User-Agent `pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)`. The cookie header ČSÚ sets is ignored. Round 2 reuses the same URL (research §2.4) — there is **no round config**; round is derived from the data.
- **Schedule** (`nextRefreshAt`, with `G = parsePragueTime(DATUM_CAS_GENEROVANI)`): `waiting` (no precinct processed in any round, i.e. all `OKRSKY_ZPRAC = 0`) → `refreshedAt + 60 s`; `counting` (anything else, not all decided) → `clamp(G + 60 s, refreshedAt + 20 s, refreshedAt + 60 s)`, junk/skew (G null or > refreshedAt + 120 s) → `+20 s`; `final` (all 27 constituencies officially decided) → `+10 min`. Failure retry `20 s → 20–40 s → 20–60 s`. With a 304 the phase is unchanged. `parsePragueTime` implements Europe/Prague DST (CEST until the last Sunday of October 01:00 UTC) — tested at 25 Oct 2026.
- **Edge** (`edgeTtl` as in Prague): `Cache-Control: public, max-age=0, s-maxage=<ttl>`, ttl = `clamp(ceil((nextRefreshAt−now)/1000), 1, cap)`, `cap` 5 s in `waiting`/`counting`/stale, 600 s in `final`; last-resort copy under `/__lastresort/api/senat` (1200 s) served as `stale:true` when the DO errors/times out (13 s)/5xx, else `503 {"error":"unavailable"}`; `x-server-now` header on every reply. Cron `* * * * *` (production only) calls the DO like a viewer so the feed is warm without visitors.
- **Capacity**: one 28 KB file per minute upstream; viewers are served from the edge cache (≈1 refresh/min/colo). Not a throughput risk. Kill switch: the cron removal + `CSU_BASE`; rollback: `wrangler rollback`.

## 3. Snapshot contract (API body, `v: 1`)
Normalised from the XML + checked-in manifest; derived fields computed server-side by pure `derive.js`; the client only renders. Times: `generated` is ČSÚ's zone-less Prague string, `generatedMs` its UTC epoch.
```jsonc
{
  "v": 1, "kind": "senat",
  "generated": "2026-10-10T16:05:12", "generatedMs": 1760105112000,
  "round": 1,                       // 2 as soon as any HLASY_2KOLO or UCAST KOLO=2 exists
  "country": { "1": {okrskyCelkem, okrskyZprac, okrskyZpracProc, ucastProc, platneHlasy}, "2": {…}|absent },
  "summary": { "obvody": 27, "decided": 0, "runoff": 0, "awaitingOfficial": 0, "counting": 0, "waiting": 27, "ties": 0,
               "pirates": { "total": 18, "elected": 0, "advancing": 0, "notAdvancing": 0, "leading": 0, "second": 0, "behind": 0, "waiting": 18 } },
  "obvody": [ {                      // all 27, sorted by number
    "n": 30, "name": "Kladno",
    "state": "waiting|counting|counted|runoff|runoff-counting|elected|tie",   // §3.1
    "decidedRound": 0|1|2,           // round in which an official ZVOLEN appeared
    "rounds": { "1": {okrskyCelkem, okrskyZprac, okrskyZpracProc, ucastProc, platneHlasy, zapsaniVolici, odevzdaneObalky}, "2": {…}|absent },
    "hasPirate": true,
    "candidates": [ {
      "no": 2, "name": "Adéla Sucharda Šípová", "pre": "Mgr.", "post": "",
      "votes1": 0, "pct1": 0, "st1": null|"ZVOLEN"|"NEZVOLEN"|"2.KOLO",
      "votes2": null, "pct2": null, "st2": null|"ZVOLEN"|"NEZVOLEN"|"NEZVOLEN_SHODA_HLASU",
      "rank": 1,                     // competition rank in the *current* round of that constituency (ties share a rank)
      "status": "elected|advancing|notAdvancing|runoffLost|runoffTie|leading|second|behind|waiting",
      "official": true|false,        // status comes from an official ČSÚ flag (true) or from counted votes (false)
      "majority": false,             // pct > 50 of valid votes of the current round, only meaningful while !official
      "pirate": "ticket"|"endorsed"|null,
      "party": "Česká pirátská strana"|null,    // nominating party (registry NSTRANA)
      "member": "bez politické příslušnosti"|null, "age": 46|null, "job": "…"|null, "residence": "…"|null
    } ]
  } ],
  "warnings": []                     // e.g. "attribution-mismatch:30:2", "sum-mismatch:30:1"
}
```
Published body = this JSON with response meta spliced in (`refreshedAt, nextRefreshAt, servedAt, stale, phase`), exactly as the Prague API does, so the same client scheduling applies.

### 3.1 Derivation rules (pure, unit-tested, no projection)
Let `r = round`, `rd` = the obvod's current round (2 if it has a round-2 `UCAST` or any `HLASY_2KOLO`, else 1), `Z/C` = `OKRSKY_ZPRAC`/`OKRSKY_CELKEM` of that round.
- **Obvod `state`**: any `st2='ZVOLEN'` or `st1='ZVOLEN'` → `elected` (`decidedRound` accordingly); else any `st2='NEZVOLEN_SHODA_HLASU'` → `tie`; else any `st1='2.KOLO'` → `runoff` (or `runoff-counting` when round-2 votes/Z>0); else (no official flag) `Z=0`→`waiting`, `0<Z<C`→`counting`, `Z=C`→`counted` ("sečteno, čeká na potvrzení ČSÚ").
- **Candidate `status`**: official flags first — `ZVOLEN`→`elected`; round-1 `2.KOLO` and obvod not decided → `advancing`; round-1 `NEZVOLEN`→`notAdvancing`; round-2 `NEZVOLEN`→`runoffLost`; `NEZVOLEN_SHODA_HLASU`→`runoffTie`; (`official:true`). Without an official flag (`official:false`): by competition rank on the current round's votes — rank 1 → `leading`, rank 2 → `second`, else `behind`; `waiting` while `Z=0`. Ties share a rank (so two candidates can both be `leading`). A candidate with `st1='2.KOLO'` in a `runoff-counting` obvod ranks by `votes2`.
- `majority`: `pct > 50` in the current round; displayed only while `!official` and only with the caveat "čeká na potvrzení ČSÚ". **Never** call a candidate elected/advancing without the official flag.
- **Summary**: `decided` = obvody `elected`; `runoff` = `runoff` + `runoff-counting`; `awaitingOfficial` = `counted`; `counting`; `waiting`; `ties`. Pirate counts are over the 18 manifest entries whose attribution verified (§5), by candidate `status`.

## 4. Validation (`validate.js`, own — the Prague validator is list-based)
Outcome `{ outcome: 'ok'|'older'|'rejected', reason? }` on the **normalised candidate vs. last-good**:
- **Structural reject (always):** root not `VYSLEDKY` or `CHYBA` present; `generated` unparseable; not exactly the manifest's obvod set when no good snapshot exists, and with a good snapshot **fewer obvody** than good; an obvod with 0 candidates; a candidate count below good for any obvod; negative numbers; `OKRSKY_ZPRAC > OKRSKY_CELKEM`; unknown status values.
- **Older replica:** `generatedMs(candidate) < generatedMs(good)` → `older` (keep good, not stale, no backoff, retry at the 20 s floor).
- **Regression (only when the good snapshot was refreshed after `POLLS_CLOSE` = 2026-10-10T14:00+02:00 and has the same `base`):** `OKRSKY_ZPRAC` decreasing in any obvod/round; any candidate's `votes1`/`votes2` decreasing; an **official flag disappearing or changing** (`ZVOLEN`/`2.KOLO`/`NEZVOLEN`, `st2`) → `rejected`; quarantine accepts the same reason after ≥ 3 distinct fetches spanning ≥ 2 min.
- **Soft checks → `warnings`, never reject:** Σ`votes` ≠ `PLATNE_HLASY` of the round (verified equal on 2024 final data); manifest name mismatch (§5). To be tightened after real counted data is seen (verification step).
- `snapshotHash` (replay/log only) excludes `generated`, fetch meta, `warnings` order.

## 5. Manifest and Pirate attribution
- `cloudflare-senat/src/manifest.js` is **generated and checked in** (script `scripts/senat-build-manifest.mjs`, input = registry `serk.json` + code lists `cpp.json`/`cns.json` from `SE2026reg20261007_json.zip` / `SE2026ciselniky20260915_json.zip`, output deterministic, with source URL + date + SHA-256 in a header comment). Entries per `(obvod, no)`: `{name, pre, post, first, last, age, job, residence, party (NSTRANA name), partyCode, member (PSTRANA name)}` for all 154 candidates, plus `PIRATE_BACKED = [{obvod, no, relation}]` from the owner's list (relation `ticket` for the three with `NSTRANA = 720`, `endorsed` for the other 15). A test asserts exactly 18 entries, exactly 3 `ticket` and that every `ticket` has `partyCode 720`.
- The Worker joins by `(obvod, no)` and **verifies the XML surname contains the manifest surname** (case-insensitive, diacritics-normalised); a mismatch drops the Pirate label for that candidate and adds `attribution-mismatch:<obvod>:<no>` to `warnings` plus an error log. The 154-candidate set is allowed to differ from the XML (withdrawn candidates): unknown XML candidates are shown without party info.
- UI wording (Czech): ticket → "Kandidát za Piráty"; endorsed → "Podporovaný Piráty" + "navrhla: {nominating party}" always shown (public ČSÚ fact; hiding it would mislead).

## 6. Client (`senat/`, Vite + React, own build to `senat/dist`)
- One page `/`: header (LIVE pill, "ČSÚ data z HH:MM:SS · před N s", "další kontrola za M:SS", skew-corrected via `x-server-now`; stale banner), round badge, **headline tiles** (rozhodnuto X z 27 · v druhém kole N · čeká na potvrzení · sčítá se), **Pirate tally** (18: zvoleno · postupuje · nepostoupilo · vede/2. místo · čeká), then **18 cards sorted by constituency number** with status chip, large votes/%, rank, counted-precinct progress, official/provisional marker, relation + nominating party; each card expands to all candidates of the constituency with bars; link "Zdroj: ČSÚ" (volby.gov.cz public app URL, plain `<a>`, no fetch). Mobile-first, colour never the only cue (chip text + icon), `prefers-reduced-motion`, UI copy Czech.
- Polling: copy of `schedule.js` (`nextPollDelay` with random per-tab offset 0–25 s, 5 s min gap, full-jitter backoff, hidden tabs don't poll, skew); last snapshot kept in `sessionStorage`; **the browser never requests volby.gov.cz** (CI step: `! grep -rE "appdata/senat|volby.gov.cz/appdata" senat/dist/assets`).
- Maintainer contact (repo requirement): `senat/public/{humans.txt,kontakt.txt,.well-known/security.txt}`, an HTML comment + tiny footer line "Záložní kopie · správce: Václav Vislous · 777 954 389 · zdroj dat ČSÚ"; wording "spravuje tuto kopii", never "author".
- No analytics, no cookies, no bug-report endpoint.

## 7. Deploy, verification, safety
- `cloudflare-senat/wrangler.jsonc`: `name: pirati-senat-zaloha`, `account_id 741febb7a315a409b83e5a9a1b62954d`, `main: src/worker.js`, `compatibility_date 2026-10-01`, `assets: ../senat/dist`, DO `SENAT_FEED` → `SenatFeed` (`new_sqlite_classes`, tag v1), `triggers.crons ["* * * * *"]`, `routes: [{ "pattern": "senat.dg12.cz", "custom_domain": true }]`, `workers_dev: true`, `observability`. **`env.staging`** = script `pirati-senat-zaloha-staging`, `routes: []`, `triggers.crons: []`, own DO migrations + assets, workers.dev only. `wrangler deploy` is run from `cloudflare-senat/` only.
- Order: tests+lint+build green → `wrangler deployments list` (record previous id) → `wrangler deploy --env staging` → staging checks → **production + custom domain only on the owner's explicit confirmation in the session**. Drills with a fake `CSU_BASE` only under `wrangler dev` or on a `-drill` script.
- Verification (levels): (1) unit tests on **real fixtures** — the frozen 2026 file and the final 2024 file (round 2 included) plus synthetic mid-count/tie/withdrawn cases; (2) `wrangler dev --local` against the real frozen feed (page renders 18 cards at 0 %, API headers, 304 path); (3) mock-upstream drill with advancing counts and a round-2 transition; (4) staging; (5) **after ~15:00: compare numbers with the public app and `vysledky.xml` for several constituencies, run the Σ-votes and flag-timing checks, then tighten §4 soft checks**.
- Tests: Vitest, `npm test` = `TZ=UTC vitest run`; the Worker file (`cloudflare:workers` import) is only exercised via `wrangler dev`/staging.

## 8. Risks
| # | Risk | Mitigation |
|---|---|---|
| 1 | 2026 XML during counting differs from what the frozen file/2024 final suggest | parser tolerant of unknown attributes; verify after 15:00; keep last-good; `warnings` |
| 2 | Official flag lags the counting | explicit `counted` state and "čeká na potvrzení" wording; nobody called elected without the flag |
| 3 | Wrong political attribution | owner list + registry cross-check (3 tickets ↔ NSTRANA 720) + surname verification + visible nominating party |
| 4 | Projection/legal | none shipped; research §4 |
| 5 | Upstream throttling | one conditional GET/min, own UA with contact, backoff, kill switch |
| 6 | Runoff slips (withdrawn finalist) / ties of ≥3 finalists | status model is rank/flag based, never "exactly two"; round derived from data |
| 7 | Deploy touching Prague | separate dir/script/DO, no edits under `cloudflare/`, staging first |
| 8 | Copy drift from Prague refresher | documented copy, own tests; the copy is deliberately frozen |
