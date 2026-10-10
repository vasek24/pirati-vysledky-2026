# Election-night backup mirror — design (Phase 1)

Date: 2026-10-10 · Status: draft for adversarial review · Owner: Václav Vislous (manages this fork)
Fork: `vasek24/pirati-vysledky-2026` (upstream: `jsemfast/pirati-vysledky-2026`, no licence file; author has been informed/OK'd by the owner)
Live target: `https://volby.dg12.cz` (Cloudflare Worker custom domain, account `vasek24@protonmail.com`, Workers Paid already active).

## 1. Purpose

A **backup copy** of the live municipal-election results tracker that stays up if the original fails, handles a very large number of concurrent viewers, and shows updates as soon as ČSÚ publishes them. It must be live **before ~12:30 CEST on 2026-10-10** (polls close 14:00; counting starts then) even if only part of the work is finished. Everything else follows in later phases.

Success criteria (observable):
- S1. **No browser ever contacts `volby.gov.cz`.** Only our own Worker. (Grep of `src/` finds no ČSÚ base URL used at runtime.)
- S2. For any number of viewers, the backend makes **at most one upstream refresh per feed per window** (target ≤ 1 per 60 s steady state; ≤ 1 per 15 s while polling an expected-but-not-yet-published update) — verified by a load test against a mock upstream.
- S3. A malformed, empty, or regressing upstream reply **never replaces** the last good snapshot; viewers get the last good data marked `stale`.
- S4. A Worker restart/deploy loses **no** last-good snapshot (persisted in Durable Object storage).
- S5. A new council-level ČSÚ file (published every 60 s) reaches an open tab within **~35 s** typical, **~60 s** worst case (excluding ČSÚ's own cache), vs 2–4 minutes today. Requests from tabs are **spread evenly** (random per-tab offset), not bursty.
- S6. An open tab is **never force-reloaded** during an election phase by a deployment.
- S7. The header always shows: LIVE state, "ČSÚ data z HH:MM:SS (před N s)", "další kontrola za M:SS", and the true cadence.
- S8. The maintainer's contact is findable even if the SPA or Worker is broken (§7).

Non-goals (Phase 1): new data sources, SSE/WebSocket, Supabase/any new database, per-row change flashes, test/CI harness beyond what Phase 1 needs, bug-report feature (disabled).

## 2. Facts this design rests on

Verified by Haiku exploration + live probe (2026-10-10) unless marked *(unverified)*:
- App reads **JSON** from `https://volby.gov.cz/appdata/kv2026/20261009/` (`vysled/1100/<zastup>.json`, `ucast/obec/1100/<zastup>.json`, `vysled/okrsek/1100/<zastup>_<id>.json`), not XML (`src/volby/feed.js:16-20`). Praha 9 = zastup `500216`, Magistrát = `554782` (`src/councils.js`).
- ČSÚ council-level files carry `Expires = Last-Modified + 60 s` and an ETag; the XML equivalent `odata/zastup/vysledky_obec_<zastup>.xml` is documented as 60 s; precinct XML batches are 5 min. Currently the feed is frozen at a pre-election 0%-counted snapshot (generated 2026-10-08).
- Cloudflare: Cache API is per-colo with no stale-while-revalidate; KV 1 write/s/key; Durable Object `Feed` is already declared SQLite-backed (`cloudflare/wrangler.jsonc:19-22`); Worker routes feed requests to one DO per normalized feed (`cloudflare/worker.js:121-149`).
- Today's chain of delay: ČSÚ 60 s + feed cache 20–45 s + CDN s-maxage 30 s (300–600 s outside counting) + client poll 60 s ±15 %.
- Codex ideation (`docs/superpowers/reviews/2026-10-10-codex-ideate-load.md`) recommended `demand-coalesced-do` and rejected Supabase, SSE/WebSocket, one global DO.

## 3. Architecture (decision: `demand-coalesced-do`, Cloudflare-only)

```
browser ──GET /api/volby?z=…──▶ Worker ──Cache API (per-colo, 5 s TTL in counting)──▶ DO "volby?z=<code>"
                                                                               │ persisted snapshot + nextRefreshAt
                                                                               └─ (only if due) one conditional fetch ──▶ volby.gov.cz
```

### 3.1 Durable Object = sole refresh authority
Per feed key (existing naming) the DO owns, in DO storage (`ctx.storage`):
`snapshot` (validated response body as JSON string), `refreshedAt`, `upstreamGenerated`, `etag`, `nextRefreshAt`, `consecutiveRejects`, `quarantine` (candidate + count).
- **Serve stale while refreshing (Opus must-fix 1).** A request returns the persisted snapshot **immediately**, never waiting on upstream. If `now >= nextRefreshAt` and no refresh is in flight, the DO starts one in the background (`ctx.waitUntil(refreshPromise)`); further requests see it in flight and just return the snapshot. Only a **cold DO with no snapshot at all** waits for the refresh (bounded by the deadline below).
- A refresh = existing `createKvFeed`/overview build, using the existing per-file conditional requests (the file cache already keeps per-file ETag/Last-Modified inside `createJsonCache`) with the existing 8 s per-file timeout and an overall **12 s** deadline. The overview `waitMs` (20 s today) is lowered to ≤ 12 s so no layer outlives the deadline.
- On success + valid (§3.2): persist, update memory, set `nextRefreshAt`.
- On timeout / network error / invalid / rejected: keep serving the persisted snapshot with `stale: true`; set `nextRefreshAt = now + retryDelay` (20 s, doubling to max 60 s, full jitter) so a failing upstream is not hammered.
- **nextRefreshAt (Opus must-fix 3):** `max(refreshedAt + 20 s, upstreamGenerated + 60 s)` in counting/waiting phase — where `upstreamGenerated` is the snapshot's existing `generated` field (the max of ČSÚ `generovano`). The 20 s floor equals the existing `minIntervalMs` in `createKvFeed`, so a late ČSÚ is re-checked at most every 20 s. We do **not** read `Expires` (it never reaches the DO layer) and store **no** single `etag` (the feed has 2+N files, each with its own). `final` phase: +10 min. `pre` phase: +5 min, but never later than 14:00:00 CEST on election day.
- **Cold start (Opus must-fix 5).** After a DO eviction/deploy the in-memory file ETags, precinct votes and overview summaries are gone and a cold build can be *partial* (`votes: null` after `precinctWaitMs`, partial overview). A result built with a cold/partial cache is flagged `complete:false`; it **never replaces a complete persisted snapshot** (it is dropped, refresh is retried at the 20 s floor so caches warm up). Precinct votes and overview summaries are seeded from the persisted snapshot when rehydrating. Expect the first refresh after a deploy to re-download many precinct files from ČSÚ (up to ~1,100 for the Magistrát tree; the council trees are far smaller): deploys are therefore done one after another with no overlap and are noted in the runbook.
- The snapshot is stored as one JSON string; if it exceeds **1.5 MB** the DO keeps it in memory only and logs once (storage value limit risk, see §8 R3).
- Response adds fields: `refreshedAt`, `nextRefreshAt` (epoch ms), `servedAt`, `stale`, `complete`, existing `generated` unchanged.
- **Worker last-resort copy (Opus must-fix 5b).** If the DO throws or is overloaded the Worker serves a second Cache API entry for the same key (suffix key, ~10 min TTL, written on every successful 200) instead of today's uncached 502. If that is also empty it returns 503 and the client shows the manual "otevřít originál / ČSÚ" links (§3.6).

### 3.2 Snapshot validation (before publication)
Reject (keep last good) when any holds, for councils and overview:
- body not parseable, missing required top-level collections, council identity (`zastup`) differs, non-finite numbers, `counted < 0` or `counted > total`;
- `counted` precincts **decrease** vs last good, or `generated` goes backwards, or party/vote totals drop to 0 after being non-zero.
**Order of operations (Opus must-fix 4):** validate **before** the snapshot is installed as `last` and before it is persisted. Today `createJsonCache` stores a parsed body and `build()` sets `last` before any check (`src/volby/feed.js:206,317`; overview `:140`). The change: on rejection, delete the offending file-cache entry (so its stored ETag/body is not re-served), keep the old `last`, and record the rejection.
**Quarantine rule** (so legitimate ČSÚ corrections are not blocked forever): count a rejection only for a **distinct upstream 200** — identity = a hash of the candidate that **excludes `fetchedAt`** and other per-build fields. If the same candidate hash is rejected on **3 distinct fetches** (not 3 cache replays inside the 20 s file cache or 304s), accept it and log `quarantine-accepted`. Rejections log at warn with reason. `complete:false` results (§3.1 cold start) are never counted toward quarantine.

### 3.3 Edge cache
Cache API TTL while counting/waiting: `clamp(nextRefreshAt − now, 0, 5 s)` (Opus must-fix 2) — the edge copy can never outlive the moment a newer snapshot is due. Because the DO answers from its snapshot without waiting (§3.1), cache misses at the colo are cheap. Outside counting keep longer TTLs. Stale responses (`stale:true`) are cached for at most 5 s (today 15 s). Remove the CDN `stale-while-revalidate` claims that don't apply to the Cache API. Analytics Engine writes are wrapped so they can never throw.

### 3.4 Client (`src/hooks/useLiveResults.js` and a new pure `src/hooks/schedule.js`)
- **Delete both browser-side direct feed constructors and every `goDirect` path.** On API failure keep showing the sessionStorage/last snapshot (mark stale) and retry **the Worker only**.
- Next poll time = `nextRefreshAt + offset`, where `offset` is a **per-tab random value fixed for the session, uniform in [0, 25 s]**. If the response's `nextRefreshAt` is already in the past (the edge or DO is behind), retry in `random(5, 10) s` — not a full minute. If `nextRefreshAt` is absent (old/failed response), `now + 60 s ± 15 %`. Never poll more than once per 5 s.
- Error backoff: full jitter `random(0, min(300 s, 5 s·2^n))`; `online` and `visibilitychange` retries are delayed by `random(0, 5 s)`.
- Pre-election wake at 14:00 is spread: `14:00:00 + random(0, 60 s)`.
- Client timeout **25 s** (> server 12 s deadline) so a slow-but-successful refresh does not look like a failure.
- Hidden tabs do not poll; on becoming visible, poll if due (with the 0–5 s delay).

### 3.5 Deploy-safe reload policy
`UpdateManager`/`useUpdateCheck`: gate on the existing `isElectionNight()` (`UpdateManager.jsx:19-20`) — when true, **never auto-reload a visible tab**; show a small "Nová verze — obnovit" button. Hidden tabs keep today's reload (`:99-101`; harmless, spread by each tab's own 5-minute check). Version check interval gets ±20 % jitter. Outside election night the existing behaviour stays.

### 3.6 Freshness UI (Phase-1 minimum)
In the header (desktop **and** mobile, readable contrast): `ŽIVĚ` badge (correct on cold load after 14:00 — do not default to "před volbami" when phase is unknown but clock says counting), `ČSÚ data z HH:MM:SS · před N s` (N ticks), `další kontrola za M:SS`, and a cadence text such as "ČSÚ publikuje každou minutu; stránka se obnoví sama". `stale` shows the orange banner with age. When the Worker returns nothing usable (503) and no local snapshot exists, show two plain links the viewer clicks (never an automatic fetch): the original site `jsemfast` deployment and the official ČSÚ results page. Copy fixes: remove "každou minutu" claims that are wrong (`CouncilApp.jsx:123`, `WelcomeGuide.jsx:65`, `changelog.js:85`). No row-flash in Phase 1.

## 4. Hosting and configuration

- Worker name `pirati-volby-zaloha` (subdomain only), `workers_dev: true` for staging, custom domain `volby.dg12.cz` attached **only after** staging checks pass. `account_id` and KV namespace ids in `wrangler.jsonc` are replaced with the owner's (`wrangler kv namespace create HLASENI`).
- **Bug-report endpoint disabled**: no `GITHUB_TOKEN` secret is set (endpoint returns 503, already fail-closed); the UI entry point for it is hidden.
- `.github/workflows/deploy.yml` no longer deploys on `push`; replaced by a PR workflow (lint + tests + build). Deploys run from the CLI by the maintainer's agents (`wrangler deploy`), per the owner's "deploy whenever tested" instruction.
- Secrets never committed. Upstream repo is never pushed to.
- Test hook: upstream base URL overridable via Worker env var `CSU_BASE` (default = current constant) so a local mock can stand in. It comes from the environment **only**, never from a request parameter.
- **Rollback:** before each production deploy record the previous `wrangler` version id (`wrangler deployments list`); rollback = `wrangler rollback <id>`. Recorded in `docs/ops/runbook.md`.

## 5. Testing and verification (Phase 1)

- Vitest unit tests for pure logic: snapshot validator, nextRefreshAt calculation, scheduler offset/backoff, quarantine rule.
- DO logic written as a pure module (`cloudflare/refresh.js`) with injected `now`, `storage`, `fetchUpstream`, so it is testable without Workers runtime.
- **Refresh-module concurrency test** (pure module, simulated clock and upstream, Opus-reviewed cut of the original `wrangler dev` load test, which cannot model per-colo Cache API or production DOs): 2 000 concurrent `get()` calls across a simulated 5-minute counting run assert upstream refreshes ≤ budget (S2), stale served on forced failure/timeout/empty body (S3), cold-start partial results never replace a complete snapshot, quarantine counts distinct fetches only. S1 is a static grep/lint check on `src/`.
- Staging verification on `workers.dev`: a burst (e.g. 300 concurrent requests for 60 s via a small `scripts/burst.mjs`) against the three priority endpoints (`/api/prehled`, Magistrát, Praha 9) with the DO log showing exactly one upstream refresh per window; deliberate-failure check via `CSU_BASE` pointing at a failing mock.
- Before production attach: compare staging output to the author's live site for the same council (shape and numbers) once counting begins.

## 6. Phases

- **Phase 1 (now, live by ~12:30):** §3, §4, §7 and tests in §5.
- **Phase 2 (after Phase 1 is live):** harness (CLAUDE.md hooks, Codex wrappers, typecheck), row-change flash with arrows and reduced-motion/aria, measured end-to-end latency display, per-colo stampede review, bug-endpoint hardening (or removal), README/runbook, optional alarm-based publisher if the "no request for 60 s" kill criterion trips.

## 7. Maintainer contact (requirement)

Václav Vislous manages this fork and its modifications (not the author of the original). Contact for people to call: **+420 777 954 389**. Must be findable **even if the app or Worker is down**, but unobtrusive:
- Static files in `public/` served by Cloudflare assets independent of Worker code: `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt` (Contact: `tel:+420777954389`, Expires set).
- An HTML comment and a `<noscript>`/pre-hydration fallback block in `index.html` showing name, role and phone in small text.
- A tiny, low-contrast footer line in the app: "Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous · 777 954 389".
- The wording always says "manages this fork and its modifications", never "author".

## 8. Risks and mitigations

- R1. **Demand-driven refresh stalls** if a feed gets no request for >60 s. Mitigation: priority feeds are continuously viewed; kill criterion → Phase 2 alarm publisher.
- R2. **Validation blocks a real correction.** Mitigation: quarantine-accept after 3 identical rejects; logs.
- R3. **DO storage value limit** (~2 MB). Mitigation: size guard + memory-only fallback; measure real sizes in staging.
- R4. **Live behaviour untestable before 14:00** (feed frozen). Mitigation: mock upstream + recorded 2022 fixtures; staged rollout; compare with author's site once counting starts.
- R5. **Mid-count deploys.** Mitigation: no auto-reload (S6); DO persistence (S4); deploy only after tests + Opus review of diff.
- R6. **Per-colo Cache API still lets each colo hit the DO every ≤5 s.** Acceptable because the DO answers from its snapshot without waiting on upstream (§3.1); measured in the staging burst. Czech traffic concentrates in 1–2 colos, so "≤ 300 colos" is an upper bound, not the expected case.
- R7. **Upstream licence/branding.** Owner states the author knows; credit line added.
- R8. Workers Paid `Feed` DO soft limit ~1 000 req/s per object: with 1–2 hot colos × 1 miss per ≤5 s the DO sees far fewer *(unverified; measure in staging)*.
- R9. **Cold start after a deploy** refetches many ČSÚ files and returns partial builds; handled by `complete:false` (never replaces a complete snapshot) and persisted-snapshot seeding (§3.1). Deploys happen one at a time, never overlapping, and the first refresh after a deploy is watched in the log.
- R10. **Hard-coded election dates.** `KV_DATE` (`src/councils.js:11-14`) and `POLLS_CLOSE` +02:00 are correct for 2026-10-09/10 (DST ends 25 Oct) and stay as they are.
