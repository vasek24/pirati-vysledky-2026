# Election-night backup mirror — design (Phase 1), revision 2

Date: 2026-10-10 · Status: revised after Opus review r1 (`docs/superpowers/reviews/2026-10-10-opus-spec-plan-review-r1.md`), pending Codex review · Maintainer: Václav Vislous (manages this fork)
Fork: `vasek24/pirati-vysledky-2026` (upstream `jsemfast/pirati-vysledky-2026`, no licence file; owner states the author knows).
Live target: `https://volby.dg12.cz` (Worker custom domain; `dg12.cz` zone is in the owner's Cloudflare account `vasek24@protonmail.com`, Workers Paid active).

## 1. Purpose, timing, success criteria

A **backup copy** of the live municipal-election results tracker that stays up if the original fails, copes with a very large number of concurrent viewers, and shows updates soon after ČSÚ publishes them.

**Timing (owner info, 2026-10-10):** polls close 14:00 CEST; **results start arriving only around 15:00 and then as a slow trickle**. Therefore:
- **Phase 1a — live by ~12:30:** safe subset on the existing coalescing DO (guards, account swap, contact files, direct-fallback removed, no visible-tab reload, 503 instead of 502). A working backup exists early.
- **Phase 1b — staged by ~13:30, deployed by ~14:00:** the refresher (§3), two feed classes, edge clamp, scheduler, freshness UI.
- **14:00–15:00 is a quiet deploy window** (nothing changes on screen): Phase 2 items (row flash, latency display) may ship then, each reviewed. After results flow, deploys are allowed when tested (owner: "deploy whenever tested") but are one-at-a-time with the previous version id recorded (§4).

Success criteria:
- **S1.** No browser ever contacts `volby.gov.cz`: (a) no module under `src/hooks|pages|components|lib` imports `createKvFeed`, `createOverviewFeed`, `createJsonCache`, `KV_BASE_URL`; `useLiveResults.js` has no `.direct(`; (b) CI step after build: `! grep -rl "appdata/kv2026" dist/assets`.
- **S2.** For any number of viewers the backend makes at most one upstream refresh per feed per window: ≤ 1 per 20 s while counting, ≤ 1 per 60 s while waiting, verified by a simulated 5-minute counting run in the refresher unit tests (§5).
- **S3.** A malformed/empty/regressing upstream reply never replaces the last good snapshot; viewers get the last good data marked `stale` only when a refresh actually failed.
- **S4.** A Worker restart/deploy loses no last-good snapshot (persisted in DO storage).
- **S5.** A new council-level ČSÚ file (published every 60 s) reaches an open tab within **~35 s typical, ~60 s worst case**, vs 2–4 min today. Tab requests are spread evenly (random per-tab offset).
- **S6.** A visible tab is never force-reloaded by a deployment on election night (pure predicate `shouldAutoReload`).
- **S7.** The header always shows LIVE state, "ČSÚ data z HH:MM:SS (před N s)", "další kontrola za M:SS" and the true cadence, using a server-skew-corrected clock.
- **S8.** The maintainer's contact is findable even if the SPA or Worker is broken (§7).
- **S9.** First-class feeds (§3.0) are refreshed continuously without any viewer; second-class feeds give their first viewer current data.

Non-goals (Phase 1): new data sources, SSE/WebSocket, Supabase/any new database, bug-report feature (disabled).

## 2. Facts this design rests on

Verified by Haiku exploration, Opus review and a live probe (2026-10-10):
- App reads **JSON** from `https://volby.gov.cz/appdata/kv2026/20261009/` (`vysled/1100/<zastup>.json`, `ucast/obec/1100/<zastup>.json`, `vysled/okrsek/1100/<zastup>_<id>.json`; `src/volby/feed.js:16-20`), not XML. Praha 9 = zastup `500216`, Magistrát = `554782` (`src/councils.js`).
- ČSÚ council-level files carry `Expires = Last-Modified + 60 s` and an ETag; the XML equivalent is documented as 60 s; precinct XML batches are 5 min. ČSÚ's `generovano` is **local Prague time with no zone marker** (`feed.js:59,307`); `src/volby/format.js:22-27` `parseCsuTime` reads it as +02:00 (correct until 25 Oct).
- `createJsonCache` stores a parsed body before any check (`feed.js:206`), `build()` sets `last` (`:317`), and `snapshot()` swallows build errors and returns the old `last` with `stale:true` (`feed.js:323-335`, `overview.js:147-159`). The DO today wraps `snapshot()`; per-feed state (file ETags, precinct votes, summaries) is in memory only.
- In steady state newly counted precincts have `votes:null` for up to `precinctWaitMs` 3 s (`feed.js:235,289,298`); the overview reports `missing>0` when any of its 58 files is slow (`overview.js:135-143`).
- Magistrát has `precinctFiles:false` (`councils.js:224-227`); the largest single council tree is Praha 4 with 132 precinct files.
- Cloudflare: Cache API is per-colo and ignores URL fragments in keys; no stale-while-revalidate there; the `Feed` DO is SQLite-backed (`wrangler.jsonc:19-22`); DO input gates stay open during `fetch`, so a single in-flight promise is safe.
- Codex ideation (`docs/superpowers/reviews/2026-10-10-codex-ideate-load.md`) recommended `demand-coalesced-do`; Opus architecture pass found it sound with five must-fixes, now folded in.

## 3. Architecture (decision: Cloudflare-only, DO as sole refresher)

```
browser ──GET /api/volby?z=…──▶ Worker ──Cache API (per-colo, ≤5 s)──▶ DO "volby?z=<code>"
                                   ▲ cron every minute warms first-class   │ persisted snapshot + nextRefreshAt
                                   └───────────────────────────────────────┘ (only if due) refresh ──▶ volby.gov.cz
```

### 3.0 Feed classes
- **First class (12 feeds, warmed):** the Magistrát `554782` and the ten largest districts by registered voters — Praha 4 `500119`, Praha 10 `500224`, Praha 8 `500208`, Praha 6 `500178`, Praha 5 `500143`, Praha 11 `547034`, Praha 3 `500097`, Praha 13 `539694`, Praha 12 `547107`, Praha 9 `500216` — plus the overview feed (`prehled`). A Cloudflare **cron trigger `* * * * *`** runs a `scheduled()` handler that, for each first-class key, calls its DO exactly like a viewer request would (so the DO's own "is it due?" logic decides whether to refresh; the cron adds no extra upstream calls). Max 4 DO calls concurrently; each call has a 15 s timeout; errors are logged and ignored.
- **Second class (the other 47 councils):** on demand only. If the stored snapshot is **older than 2 minutes**, the request **waits up to 3 s** for the refresh (bounded wait) and returns whatever is current at that point (the refreshed snapshot, or the old one marked `refreshing:true` if the wait expired). Younger snapshots are served at once while the refresh runs in the background.
- Class membership is a constant `FIRST_CLASS` in `cloudflare/feedClasses.js` (zastup codes + `'prehled'`), tested.

### 3.1 Durable Object = sole refresh authority
Per feed key (existing naming) the DO holds, persisted with **one** `storage.put({ snapshot, meta })` so they cannot diverge:
`snapshot` (JSON string of the published body), `meta` = `{ refreshedAt, generatedMs, nextRefreshAt, failures, quarantine, base, schema: 1 }`.
- **Request path.** Return the persisted snapshot immediately with spliced-in meta (`'{"refreshedAt":…,"nextRefreshAt":…,"servedAt":…,"stale":…,"complete":…,' + body.slice(1)` — no re-parse per request). If `now >= nextRefreshAt` and no refresh in flight, start one in the background (single `refreshPromise`; further requests only read the snapshot). Cold DO with no snapshot → await the refresh (deadline below). Second-class bounded wait per §3.0. Rehydration is single-flight (`ctx.blockConcurrencyWhile` or memoized `loadPromise`); a snapshot is **discarded on rehydrate if `meta.base !== env.CSU_BASE` or `meta.schema !== 1`** (prevents drill/test data poisoning production).
- **Background work.** The background refresh survives because the DO stays alive while fetches are pending (the existing code relies on this, `worker.js:8-9`); `ctx.waitUntil` is bound but documented as no-op — keep a comment so nobody "fixes" it.
- **Refresh = a throwing build.** Feeds expose a new `build()` (§3.6) that throws on any failure and does not touch `last`; the existing `snapshot()` stays for Vercel (`api/*.js`). The DO constructs feeds directly: `createKvFeed({ council, baseUrl: env.CSU_BASE || KV_BASE_URL, headers })` / `createOverviewFeed({...})`. Per-file timeout 8 s; overall deadline **12 s**; overview `waitMs` lowered to **8 000**.
- **Merge before validation (Opus C3).** The candidate is merged with the good snapshot first: **council** — for each precinct where the candidate has `votes:null` and the good snapshot has votes and equal `voters/envelopes/validVotes`, copy the votes (newly counted precincts with `votes:null` are normal and complete); **overview** — every council missing from the candidate is copied from the good snapshot. `complete:false` means exactly: after the merge, a precinct/council that had data in the good snapshot has none. Such a candidate is **not installed when a good snapshot exists** and **is installed when none exists**; it never counts toward quarantine, never sets `stale`, and is retried at the 20 s floor.
- **Validate** (§3.2), then persist and update memory, set `nextRefreshAt`. Validation lives **only** in `cloudflare/refresh.js` (not in feed.js). On `rejected` the refresher calls `feed.invalidate()` so a rejected file body is not replayed from the file cache.
- **On failure** (throw/timeout/rejected): keep serving the persisted snapshot, `stale:true`; `retry(n) = 20 s + random·(min(60 s, 20 s·2^(n−1)) − 20 s)` (20 s, then 20–40 s, then 20–60 s).
- **nextRefreshAt** (phase from the existing `phaseOf`):
  - `pre` (before 14:00 CEST): `min(refreshedAt + 5 min, 2026-10-10T14:00:00+02:00)`.
  - `waiting` (after 14:00, `counted == 0`): `refreshedAt + 60 s` (results start ~15:00, nothing changes meanwhile).
  - `counting`: let `G = parseCsuTime(generated)`; `nextRefreshAt = clamp(G + 60 s, refreshedAt + 20 s, refreshedAt + 60 s)`; if `G` is null or `> refreshedAt + 120 s` (junk/skew) use `refreshedAt + 20 s`. All comparisons of `generated` use `parseCsuTime(...).getTime()`, never string order or bare `Date.parse` (Worker runs in UTC; tests run with `TZ=UTC`).
  - `final`: `refreshedAt + 10 min`.
- **Size guard.** If the UTF-8 byte length of the snapshot exceeds **1.5 MB** the DO keeps it in memory only (skips the whole `put`) and logs once.
- Response meta: `refreshedAt`, `nextRefreshAt`, `servedAt`, `stale`, `complete`, `refreshing`; existing `generated` unchanged.

### 3.2 Validation (in `refresh.js`, using `src/volby/validate.js`)
Outcome object `{ outcome: 'ok'|'older'|'rejected', reason? }`:
- **Baseline.** Monotonic checks (counted, votes, generated) apply only when the good snapshot was refreshed at/after `POLLS_CLOSE` (14:00 CEST on the election day) **and** `meta.base === CSU_BASE`. Otherwise (pre-14:00 or ČSÚ test data) the first valid post-14:00 candidate replaces it.
- **Structural rejects** (candidates are produced by running the real feed with a fake `fetchImpl`, because upstream `{}`/`[]` normalizes to a plausible snapshot): `generated` null; `parties.length === 0`; `parties.length` below the good snapshot's; fewer precincts than the good snapshot; overview council with `parties.length === 0` or fewer parties than good; `counted < 0` or `> total`.
- **Older replica.** If `G(candidate) < G(good)`: outcome `older` — keep good, **not stale, no backoff** (retry at the 20 s floor), no file-cache invalidation, never counted toward quarantine; log info; error log if it persists 10 min.
- **Content regression.** If `G(candidate) >= G(good)` and `counted` or a party's votes **decrease**: outcome `rejected` with reason. **Quarantine** accepts when the same reason has been rejected on **≥ 3 distinct fetches spanning ≥ 2 min** (distinct = `fetchId` differs from `quarantine.lastFetchId`); hash equality is not required. `snapshotHash` (logs/replay detection only) excludes `generated` at every level, `fetchedAt`, `phase`, `missing`, `fetchId` and all response meta.

### 3.3 Worker edge
- `edgeTtl({ nextRefreshAt, now, stale, phase }) = clamp(ceil((nextRefreshAt − now)/1000), 1, cap)` with `cap = stale ? 5 : phase==='final' ? 600 : phase==='pre' ? 300 : 5` — floor **1 s** (a 0 TTL would route every request to the DO during each refresh). The DO computes the header: `Cache-Control: public, max-age=0, s-maxage=<ttl>` (no `stale-while-revalidate`/`stale-if-error`, and `max-age=0` so browsers don't hide the client's 5–10 s retry); the Worker keeps using `sMaxAge()`.
- **Last-resort copy.** On every 200 the Worker also stores the response under key `new Request(new URL('/__lastresort' + path, origin))` with a 600 s TTL (a URL fragment would collide with the main key). It serves that copy, marked `stale:true`, when the DO throws **or** returns `status >= 500`; if absent it returns 503 JSON `{ "error": "unavailable" }` (today: uncached 502 at `worker.js:150`).
- `reply()` (single exit for HIT and MISS) adds `x-server-now: <Date.now()>`.
- Responses that are `stale:true` are cached ≤ 5 s. Analytics writes are already wrapped (`worker.js:67-80`).
- `CSU_BASE` comes from the Worker **environment only**, never from a request.

### 3.4 Client (`src/hooks/useLiveResults.js` + pure `src/hooks/schedule.js`)
- **Delete both browser-side direct feed constructors and every `goDirect` path** (and leftovers: `ElectionHeader.jsx:305` "přímo z ČSÚ", the `worker.js:150` comment). On API failure keep the sessionStorage/last snapshot (stale) and retry **the Worker only**.
- **Clock skew.** Keep `skew = serverNow − Date.now()` from the last `x-server-now`; use `now = Date.now() + skew` for scheduling and for all age/countdown displays.
- Next poll = `nextRefreshAt + offset`, `offset` = per-tab random fixed for the session, uniform in [0, 25 s] (this also spreads the 14:00 wake — no separate `wakeDelay`). If `nextRefreshAt ≤ now` retry in `random(5,10) s`. If absent: `60 s ± 15 %`. Never more than once per 5 s.
- Error backoff: full jitter `random(0, min(300 s, 5 s·2^n))` but never below 5 s; `online`/`visibilitychange` retries delayed by `random(0, 5 s)`.
- Client timeout **25 s**. Hidden tabs do not poll; on becoming visible, poll if due.

### 3.5 Deploy-safe reload
`shouldAutoReload({ hidden, electionNight })` is a pure function (`src/lib/reload.js`). On election night (existing `isElectionNight()`): a **visible** tab never auto-reloads; it shows "Nová verze — obnovit"; a tab with a pending new version reloads on the `visibilitychange → hidden` transition (nobody is looking). Update-check interval `5 min × (0.8 + random·0.4)`. Outside election night existing behaviour stays.

### 3.6 Feed layer changes (`src/volby/feed.js`, `overview.js`)
- `createJsonCache`'s `getJson` gains `invalidate(path)` and `version(path)` (counter incremented per HTTP 200).
- `createKvFeed` / `createOverviewFeed` return `{ snapshot, build, invalidate }`; `build()` runs the inner build, **throws** on failure, does not set `last`, and sets `fetchId` (`${version(results)}.${version(turnout)}` for a council; summed versions for the overview). `snapshot()` unchanged.
- No validation inside feed.js; no precinct "seeding" (merge in §3.1 replaces it; accept the background re-download on cold start — worst case Praha 4's 132 files).

### 3.7 Freshness UI (Phase-1 minimum)
Header on desktop **and** mobile, readable contrast: `ŽIVĚ` pill (correct on a cold load after 14:00), `ČSÚ data z HH:MM:SS · před N s`, `další kontrola za M:SS`, cadence text "ČSÚ zveřejňuje data zhruba jednou za minutu; stránka se obnovuje sama". `stale` → orange banner with age. 503 + no local snapshot → two plain links (original site; the ČSÚ KV 2026 results page already linked in the app, reuse that URL). Copy fixes for the wrong "každou minutu" claims (`CouncilApp.jsx:122-123`, `WelcomeGuide.jsx:65`, `changelog.js:85`). The `BugReportWidget` is not rendered (endpoint stays fail-closed). `ageSeconds` uses `parseCsuTime` + skew, clamped ≥ 0. No row-flash in Phase 1 (Phase 2).

## 4. Hosting, configuration, safety

- Task 1 guards (all reversible): `git remote set-url --push upstream DISABLED-never-push-upstream`; `gh repo set-default vasek24/pirati-vysledky-2026`; every `gh` call also passes `--repo vasek24/pirati-vysledky-2026` and `GH_TOKEN=$(gh auth token --user vasek24)`; **never `gh auth switch`**. `wrangler.jsonc` text edits happen in Task 1 (before any deploy can reach the author's account): `account_id` → `741febb7a315a409b83e5a9a1b62954d`, `name` → `pirati-volby-zaloha`, author's KV id removed (new namespace created in Task 10).
- Worker `pirati-volby-zaloha`, `workers_dev: true` for staging; custom domain `volby.dg12.cz` attached after staging checks. Cron trigger `* * * * *`. Drills with a fake `CSU_BASE` run **only under `wrangler dev`** or on a separate Worker `pirati-volby-zaloha-drill`, never on `pirati-volby-zaloha`. A post-launch `env.staging` (separate script) is defined in `wrangler.jsonc`.
- Bug-report endpoint disabled: no `GITHUB_TOKEN`; UI hidden.
- `deploy.yml`: no `push` trigger, only `workflow_dispatch`; a new `ci.yml` runs lint, `npm test`, build, and the `dist` grep on PRs/branches.
- Deploy discipline: tests + lint + build green; record `wrangler deployments list` previous version id; one deploy at a time, watch the first refresh after each deploy; rollback `wrangler rollback <id>`; in `docs/ops/runbook.md`.
- Secrets never committed; upstream repo never pushed to.

## 5. Testing and verification

- Vitest (`vitest@~3.2`), script `"test": "TZ=UTC vitest run"`, config `include: ['src/**/*.test.js','api/**/*.test.js','cloudflare/*.test.js']`, `exclude: [...configDefaults.exclude]`.
- Fixtures: hand-written ČSÚ-shaped raw JSON under `src/volby/__fixtures__/` (layouts at `feed.js:47-53`, `:98-100`, `:116-117`); candidates are produced by `createKvFeed({ fetchImpl })` / `createOverviewFeed({ fetchImpl })`.
- Refresher (`cloudflare/refresh.js`) is a pure module with injected `now`, `random`, `storage`, `feed`, `phaseOf`, `log`. Tests (see plan Task 7) include zone-less `generated` under TZ=UTC, concurrent `get()` ×2 000, simulated 5-minute counting run (ČSÚ publishing every 60 s, 50 `get()`/s → refresh count within [5, ceil(300/20)]), failures/timeouts/empty bodies, merge (C3), baseline/older/regression/quarantine (C4), rehydrate (base/schema mismatch, single-flight), size guard.
- Worker is not unit-testable (`cloudflare:workers` import): its behaviour is verified by staging checks — two consecutive `x-cache: HIT` responses never carry a `refreshedAt` more than 65 s older than the preceding MISS (guards the last-resort key bug); `x-server-now` present; 503 JSON when the DO is forced to fail.
- Cadence/stampede drills run locally under `wrangler dev` with a mock ČSÚ whose `counted > 0` (so the phase is `counting` regardless of the clock) and `generovano` advancing every 60 s; staging burst (`scripts/burst.mjs`, 300 concurrent for 60 s) checks only status codes and latency before real data exists.
- S1 via the import-graph test + `dist` grep; S6 via `shouldAutoReload`; S7 via `freshness.js` tests with skew; S8 via `contact.test.js` plus a live `curl` of `/humans.txt`, `/kontakt.txt`, `/.well-known/security.txt` (confirm the dot-directory uploads).
- After counting starts: compare staging/production output to the original site for the same council.

## 6. Phases
- **1a (≈12:30):** Plan Tasks 1–4.  **1b (≈13:30–14:00):** Tasks 5–10.  **Phase 2 (14:00–15:00 window and after):** row flash with arrows/reduced-motion/aria, measured-latency display, full harness (typecheck, Codex wrappers vendored from zradlo commit `a3ec3db8`), README.
- Code freeze is not imposed (owner), but `cloudflare/` and `src/volby/` changes after 14:00 need Opus review of the diff and a recorded rollback id.

## 7. Maintainer contact (requirement)
Václav Vislous manages this fork and its modifications (**not** the author of the original). Phone **+420 777 954 389**. Findable even if the app or Worker is down, unobtrusive:
- Static files served by Cloudflare assets independent of Worker code: `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt` (`Contact: tel:+420777954389`, `Expires: 2027-10-10T00:00:00Z`).
- An HTML comment and `<noscript>`/pre-hydration block in `index.html` (name, role, phone, small text).
- A tiny low-contrast line in **both** places that already have footer-ish text: `Landing.jsx:513-516` footer and next to the "Zdroj: ČSÚ" note at `CouncilApp.jsx:419`: "Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous · 777 954 389".
- Wording says "manages this fork and its modifications" / "spravuje tuto kopii", never "author".

## 8. Risks and mitigations
- R1. A **second-class** feed with no viewers is stale until opened — bounded wait gives the first viewer current data; first class is warmed by cron. Kill criterion for the cron approach: a first-class feed misses ≥ 2 consecutive minutes → add DO alarms in Phase 2.
- R2. Validation blocks a real correction → quarantine (§3.2) + logs.
- R3. DO storage value limit (~2 MB) → size guard + memory-only fallback; measure sizes in staging.
- R4. Live behaviour untestable before ~15:00 → mock upstream, fixtures, local drills, comparison with the original once data flows.
- R5. Mid-count deploys → no visible-tab reload, DO persistence, merge-before-validate, one deploy at a time.
- R6. Per-colo Cache API lets each colo reach the DO at most once per `edgeTtl` (≥ 1 s floor) and the DO answers from its snapshot — measured in staging.
- R7. Licence/branding → owner states the author knows; credit line.
- R8. DO soft limit ~1 000 req/s per object — with the edge floor and few hot colos, expected far lower; measure.
- R9. Cold start after a deploy refetches ≤ 132 precinct files per council (Praha 4) and may build partial snapshots → handled by merge + `complete` semantics; deploys sequential.
- R10. Hard-coded dates (`KV_DATE`, `POLLS_CLOSE` +02:00) are correct until 25 Oct.
- R11. A lagging ČSÚ replica returning older bodies → `older` outcome, no flapping.
- R12. Cron triggers propagate with up to 15 min delay after config changes (deploy the cron in Phase 1a so it is live well before 14:00).
