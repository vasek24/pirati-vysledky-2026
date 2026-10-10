# Senate — Opus code review of 4977c54..5c63846 (Tasks 3b, 4, 5)

Scope: `cloudflare-senat/src/{feed,refresh,worker}.js` + tests, `wrangler.jsonc`, `README.md`, the xml/normalize/derive/validate fixes, and the client `senat/`. Gates I ran: `TZ=UTC npm run test:senat` 354/354, root `npm test` 337/337, `npx eslint .` clean, `npm run build:senat` OK, `wrangler deploy --dry-run` OK for both production and `--env staging`. Probes live in `$SCRATCH/rev/` (`probe1.mjs`, `size.mjs`) plus one temporary render test, since deleted.

**Checked and holding when wired together:** the earlier H1/H2 fixes hold. `normalize` throws on a non-finite `now`/close. Both gates need `now ≥ close` and `generated ≥ close`. `feed.build` passes the fetch-time `now()`. The refresher passes `ctx.now = t`, and `generated-in-future` is a hard reject even on a cold start (refresh.test.js:502). `CODE_REV` hashes xml/time/normalize/derive/manifest; I recomputed it as `385ece9c3207`, which matches `rev.js`. `meta.schema`/`meta.base` mismatches discard the snapshot on rehydrate (refresh.js:125), and M2, M3 and M5 are fixed. Everything else I checked also held:
- **Concurrency:** single-flight load and refresh.
- **Cache TTL:** stale responses are capped at 5 s. The idle and final caps are bounded by `nextRefreshAt`.
- **Wiring:** `markStale` falls within the 300-char window. HEAD returns no body. Staging overrides `routes`, `triggers` and `assets` and declares its own DO binding. The production name never touches `pirati-volby-zaloha`.
- **Assets:** `.well-known/security.txt` reaches `dist`.
- **Bundle and copy:** the bundle makes no `appdata` request. No `innerHTML` anywhere. The UI copy has no gendered forms.
- **Repo:** nothing changed outside the allowed paths.
- **Size:** the snapshot is about 75 KB in UTF-8 and about 145 KB as V8-serialised, far under the DO 2 MB value limit.

## HIGH

**H1 — In round 2, a Pirate candidacy that missed the runoff shows "0 · 0,0 % · bez pořadí" for the whole runoff night.**
- *Where:* `senat/src/view.js:3-5` (`currentRound` is per obvod), `components/Cards.jsx:10,31-33`, `components/Detail.jsx:10,38-39`.
- *Evidence:* I rendered `finalR2()` with obvod 5, candidate 1 (`notAdvancing`, `votes1 4221`) set to `pirate:'ticket'`. The card reads `0 | 0,0 % | bez pořadí | Nepostupuje | … | 2. kolo: sečteno 118 z 118 okrsků`, and the 4 221 round-1 votes appear nowhere on the card. The detail row likewise shows `0` / `0,00 % ve 2. kole`. In 2026 this hits every Pirate-backed candidacy eliminated in an obvod that goes to a runoff (for example the `counting()` scenario, obvod 33). That is the headline number on the card, and it is wrong.
- *Fix:* choose the round per candidate: `roundOf = (o,c) => currentRound(o) === 2 && c.votes2 != null ? 2 : 1`. Use it for votes, pct, rank and the progress label. Label the card with "1. kolo:" in that case, and in the detail show "–" instead of `0` for round 2. Add a render test with a non-finalist Pirate in `runoff()`.

## MEDIUM

**M1 — A failed `storage.put` can pair a newer snapshot's ETag with an older stored snapshot. After an eviction, 304s then serve old numbers as `stale:false` indefinitely.**
- *Where:* `refresh.js:207` (`install` puts `{snapshot, meta}`) and `refresh.js:222` (`touch` puts `{meta}` alone).
- *Evidence (`probe1.mjs`):*
  1. A is installed with ETag `"A"`.
  2. B (votes 120, ETag `"B"`) is installed, but the put rejects.
  3. A 304 then persists meta with ETag `"B"` while storage still holds A.
  4. A new refresher (eviction) rehydrates A, sends `If-None-Match: "B"` and gets a 304. It serves `stale:false` with `votes1 100` while upstream has 120.
- Between rounds the file stays the same for days, so nothing ever corrects this.
- *Fix:* put the snapshot and meta together on every write, or store `meta.snapshotHash` in `install` and drop the validators on rehydrate when it differs. Alternatively, after any put failure set `unconditional = true` and skip meta-only puts until a full put succeeds.

**M2 — The `POLLS_CLOSE_R2` override fails open on natural inputs, and the deploy wipes it.**
- *Where:* `worker.js:104-110`, README line 20 ("ISO date").
- *Evidence:* `Date.parse('2026-10-24')` is 24 Oct 00:00 UTC, which is 02:00 CEST. The round-2 gate would open 12 h before the polls close, and any ČSÚ test data generated after 02:00 would publish. A value without an offset, `2026-10-24T14:00`, is read as UTC: that fails safe, but 2 h late.
- Nothing checks that R2 is later than R1.
- The config has no `vars`, so a value set in the dashboard is removed by the next `wrangler deploy` (no `keep_vars`). The gate then silently reverts to 17 Oct.
- *Fix:* accept only `/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?[+-]\d\d:\d\d$/`, and require `R1 < R2 < R1 + 30 d`; otherwise throw. Document the override as a `vars` entry in the env block of `wrangler.jsonc`, never as a dashboard setting.

**M3 — From 14:00 on runoff Saturday until the first counted precinct, the header says "SČÍTÁNÍ UKONČENO · 2. KOLO".**
- *Where:* `freshness.js:16`, `refresh.js:51` (every obvod `runoff` with Z2 = 0 counts as `idle`).
- *Evidence:* I rendered a round-2 snapshot with every `rounds[2].okrskyZprac = 0` and `phase:'idle'`. The pill reads `SČÍTÁNÍ UKONČENO · 2. KOLO` at exactly the moment the most viewers arrive.
- *Fix:* in `headerModel`, when `phase === 'idle'`, `snapshot.round === 2` and some `rounds[2]` has `okrskyZprac === 0`, use `pillWaiting`/`agoWaiting`. Or have the server report `waiting` in that case; that also keeps the 60 s cadence.

**M4 — The runbook's staging checks cannot pass, so the Cache API and last-resort paths go untested before production.**
- *Where:* README:39-48, `wrangler.jsonc` (`workers_dev` only on staging).
- *Evidence (to confirm on the first staging deploy):* Cloudflare documents that Cache API operations have no effect on `*.workers.dev`. If so:
  - `x-cache: HIT` never appears on staging, and `LASTRESORT` can never be produced.
  - Step 4, "fix and repeat until they pass", loops forever.
  - The production `workers.dev` URL also skips the edge cache, so every request there goes to the DO.
- *Fix:* say in the README that HIT and LASTRESORT can only be verified on `senat.dg12.cz` (or a drill Worker with a route), and make the staging check `MISS` on every request. Consider `workers_dev: false` for production.

## LOW

- **L1 — The README claims a CI guard that does not exist.** README:69 says "CI greps `senat/dist/assets` for `appdata`". `.github/workflows/ci.yml:38` greps only `dist/assets` for `appdata/kv2026` and never runs `build:senat`. *Fix:* add `npm run build:senat && ! grep -rl 'appdata' senat/dist/assets` to CI, or correct the sentence.
- **L2 — Wrong wrangler comment, and the production deploy command triggers a warning.** The comment at `wrangler.jsonc:30` says assets and migrations are not inherited. In wrangler 4.149 both are inheritable (`normalizeAndValidateAssets`, `migrations: inheritable(...)`). This is harmless because staging restates them, but the comment is wrong. README step 5, `npx wrangler deploy`, prints the multiple-environments warning; use `npx wrangler deploy --env=""`.
- **L3 — The README omits what a rollback does to the stored snapshot.** A rollback to a version with another `CODE_REV` discards the stored snapshot. That means a cold start (up to 12 s, then 503 or the last-resort copy if ČSÚ is slow) and no regression baseline for the next file. README "Rollback" should say so.
- **L4 — `feed.js:27-28` has no body-size cap.** `res.text()` reads any 200 body in full; a huge or looping error page goes into DO memory. Non-200 bodies are never cancelled. *Fix:* reject when `content-length` > 5 MB or the streamed length exceeds it, and call `res.body?.cancel()` on non-200 responses.
- **L5 — A permanent `older` response never turns `stale` on.** `refresh.js:266-279` only logs `older-persistent`. The header age does show it, but the stale banner never appears. *Fix:* set `stale = true` once `t − olderSince ≥ OLDER_ERROR_MS`.
- **L6 — 304s can keep a snapshot zeroed by our own clock.** This happens when our clock is behind ČSÚ's at a close, i.e. `now < close ≤ generatedMs`: the gate zeroes the counts, the snapshot is installed with validators, and 304s keep the zeros until the file changes. *Fix:* install with null validators whenever a `*-data-suppressed` warning was caused by `now` and not by `generated`.
- **L7 — The obvod-set check against the manifest is still only a warning on a cold start.** The earlier M1 is only partly fixed: `normalize.js:107-111` warns but does not reject. A cold start (after any `CODE_REV` deploy) publishes a file with an obvod missing. *Fix:* hard-reject `obvody-set-differs-from-manifest` when there is no good snapshot.
- **L8 — Tile labels are wrong in round 2.**
  - `Tiles.jsx:20` adds `ties` (repeat election) to "jde do 2. kola nebo v něm rozhoduje".
  - `pTileBehind` "předběžně mimo postupové pozice" counts `runoffBehind`, a finalist trailing in the runoff.
  - *Fix:* give ties their own tile, or add them to "decided"; label the behind tile "předběžně za/mimo postup" in round 2.

VERDICT: 0 CRITICAL, 1 HIGH
