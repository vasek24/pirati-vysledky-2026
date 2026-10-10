# Election-Night Backup Mirror — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each implementer is a **Sonnet** subagent in its own git worktree; each task's diff gets an **Opus** review before merge.

**Goal:** Ship a backup mirror of the live election tracker at `https://volby.dg12.cz` that survives election-night load, never shows bad upstream data, and refreshes within ~35 s of ČSÚ publishing — live by ~12:30 CEST on 2026-10-10.

**Architecture:** The per-feed Durable Object (`Feed`) becomes the sole upstream refresher: it serves its persisted snapshot immediately, refreshes in the background when due, validates before publishing, and persists. The Worker fronts it with a short Cache API TTL clamped to `nextRefreshAt` and a 10-minute last-resort cache. The browser polls only our Worker on a server-provided schedule plus a random per-tab offset, with no direct-to-ČSÚ fallback.

**Tech Stack:** React 19, Vite 7, Tailwind 4, Cloudflare Workers + Durable Objects (SQLite), Wrangler 4, Vitest (added), Node ≥ 20.

**Spec:** `docs/superpowers/specs/2026-10-10-election-night-backup-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Language: plain JS (ESM, `"type": "module"`), no TypeScript migration. UI copy in Czech.
- No new database/service: Cloudflare only (Workers Paid is active). No Supabase, no SSE/WebSocket.
- **No browser-side request to `volby.gov.cz` or `volby.cz`** anywhere in `src/` at runtime.
- Never push to or open PRs against `jsemfast/pirati-vysledky-2026`. Work on `vasek24/pirati-vysledky-2026` only. GitHub commands use `GH_TOKEN=$(gh auth token --user vasek24)` per command; **never** run `gh auth switch`.
- No secrets in git. Do **not** set `GITHUB_TOKEN` on the Worker (bug-report endpoint stays fail-closed 503).
- Constants (from spec §3): refresh floor 20 s; `nextRefreshAt = max(refreshedAt+20 s, generated+60 s)` while counting/waiting; final +10 min; pre +5 min capped at 14:00:00 CEST (`2026-10-10T14:00:00+02:00`); failure retry 20 s doubling to 60 s with full jitter; overall refresh deadline 12 s; Cache API TTL `clamp(nextRefreshAt−now, 0, 5 s)`, stale responses cached ≤ 5 s; last-resort cache 10 min; client offset uniform [0, 25 s] fixed per tab; client timeout 25 s; client retry when `nextRefreshAt` already past: `random(5,10) s`; min poll gap 5 s; error backoff full jitter `random(0, min(300 s, 5 s·2^n))`; 14:00 wake spread `random(0, 60 s)`; quarantine = same hash rejected on 3 distinct fetches; snapshot size guard 1.5 MB.
- Test command: `npm test` (Vitest, added in Task 1). Lint: `npm run lint`. Build: `npm run build`. All three must pass before any merge.
- Maintainer contact (spec §7): name Václav Vislous, role "manages this fork and its modifications" (never "author"), phone +420 777 954 389.
- Commit style: Czech or English imperative, one logical change per commit; end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Deploys: `wrangler deploy` from `cloudflare/` after merge to `main`; record previous version id first (`wrangler deployments list`). One deploy at a time.

## Review Focus

1. **Cold DO after eviction/deploy** returns a partial build (`votes:null`, partial overview) — must never replace a complete persisted snapshot (Task 3 test).
2. **`generated` timestamp in the future/clock skew or missing** — `nextRefreshAt` must stay within [now+5 s, now+10 min] (Task 2 test).
3. **Upstream returns HTTP 200 with `{}`, `[]`, HTML, or a truncated body** — snapshot unchanged, `stale:true` served (Task 2/3 tests).
4. **Two tabs/hidden-visible switches and `online` events** must not burst-poll (Task 5 test: min gap 5 s, delayed retries).
5. **`nextRefreshAt` in the past in the response** (edge copy behind) — client retries in 5–10 s, not 60 s (Task 5 test).

---

## File Structure

| File | Responsibility |
|---|---|
| `cloudflare/refresh.js` (new) | Pure refresh state machine: `createRefresher({now, storage, build, validate, random})` → `get()`; no Workers imports. |
| `src/volby/validate.js` (new) | `validateSnapshot(candidate, last)`, `snapshotHash(candidate)`; pure. |
| `src/hooks/schedule.js` (new) | Pure client scheduling helpers: `pickOffset`, `nextPollDelay`, `backoffDelay`, `wakeDelay`. |
| `cloudflare/worker.js` | Wire refresher into `Feed` DO; edge TTL clamp; last-resort cache; safe analytics; `CSU_BASE` env. |
| `api/_http.js` | TTL helpers: `edgeTtl(nextRefreshAt, now, stale)`. |
| `src/hooks/useLiveResults.js` | Remove direct fallback; use `schedule.js`; consume `nextRefreshAt`. |
| `src/components/UpdateManager.jsx`, `src/hooks/useUpdateCheck.js` | No visible-tab reload on election night; jitter. |
| `src/components/ElectionHeader.jsx`, `src/pages/CouncilApp.jsx`, `src/components/WelcomeGuide.jsx`, `src/changelog.js` | Freshness UI + copy. |
| `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt`, `index.html`, footer component | Maintainer contact (§7). |
| `cloudflare/wrangler.jsonc`, `.github/workflows/*`, `docs/ops/runbook.md`, `CLAUDE.md` | Infra, CI, runbook, agent rules. |

---

### Task 1: Repo harness minimum (branch `p1/harness`)

**Files:**
- Create: `CLAUDE.md`, `.nvmrc`, `vitest.config.js`, `.github/workflows/ci.yml`
- Modify: `package.json` (scripts `test`, devDependency `vitest`), `eslint.config.js` (cover `cloudflare/**` and tests), `.github/workflows/deploy.yml` (remove `push` trigger; keep `workflow_dispatch`)

**Interfaces:** Produces `npm test` (Vitest, `include: ['**/*.test.js']`, node environment); every later task adds `*.test.js` beside its module.

- [ ] **Step 1:** `npm i -D vitest@^3` (pin the version that resolves; commit the lockfile). Add `"test": "vitest run"` to root `package.json`.
- [ ] **Step 2:** Create `vitest.config.js` exporting `defineConfig({ test: { environment: 'node', include: ['**/*.test.js'], exclude: ['node_modules', 'dist', 'cloudflare/node_modules'] } })`.
- [ ] **Step 3:** Add a trivial passing test `src/volby/sanity.test.js` (`expect(1+1).toBe(2)`), run `npm test` → PASS. Run `npm run lint` and `npm run build` → PASS (fix only what Task 1 itself breaks).
- [ ] **Step 4:** Write `CLAUDE.md` (≤ 60 lines): purpose (backup mirror), the Global Constraints above (GH_TOKEN per command, never touch upstream, no secrets, deploy procedure, contact requirement), commands (`npm test`, `npm run lint`, `npm run build`), and "read the spec and plan before editing".
- [ ] **Step 5:** `.github/workflows/ci.yml`: on `pull_request` and push to non-main branches: `npm ci`, lint, test, build, Node 22. Edit `deploy.yml` to only `workflow_dispatch` and replace the hard-coded author URL smoke test with `${{ vars.SMOKE_URL }}` (skip step if unset).
- [ ] **Step 6:** Commit and merge to `main` (fast-forward) with the three checks green.

### Task 2: Snapshot validator (branch `p1/validate`)

**Files:**
- Create: `src/volby/validate.js`, `src/volby/validate.test.js`

**Interfaces:**
- Produces: `validateSnapshot(candidate, last) -> { ok: boolean, reason?: string }` and `snapshotHash(candidate) -> string` (stable hash that ignores `fetchedAt`, `servedAt`, `refreshedAt`, `nextRefreshAt`, `stale`, `complete`).
- Consumes: the council snapshot shape from `src/volby/feed.js:302-314` (`zastup`, `generated`, `precincts.{total,counted}`, parties/results collections) and overview shape from `src/volby/overview.js:84` (`precincts.counted`, no `zastup`). The implementer MUST read those two places and write fixtures from the real shapes (a recorded council snapshot goes in `src/volby/__fixtures__/council.json` — build it by running the app's model builder against `scripts/` fixtures or hand-copy a snapshot from a test run).

- [ ] **Step 1:** Write failing tests: rejects `{}`, `[]`, `null`, string; rejects non-finite numbers; rejects `counted<0` or `counted>total`; rejects `counted` decreasing vs `last`; rejects `generated` earlier than `last.generated`; rejects party votes dropping to 0 when `last` had >0; rejects `zastup` mismatch (council only); accepts first snapshot when `last` is null; accepts equal-or-higher counted; `snapshotHash` equal for two objects differing only in `fetchedAt`, different when votes differ.
- [ ] **Step 2:** Run `npx vitest run src/volby/validate.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `validate.js` (pure; no imports beyond a tiny stable-stringify helper written inline). Return reason strings like `counted-decreased`.
- [ ] **Step 4:** Run tests → PASS; run lint.
- [ ] **Step 5:** Commit.

### Task 3: Refresh state machine (branch `p1/refresh`)

**Files:**
- Create: `cloudflare/refresh.js`, `cloudflare/refresh.test.js`
- Test fixtures: inline in the test file

**Interfaces:**
- Consumes: `validateSnapshot`, `snapshotHash` from Task 2 (`import from '../src/volby/validate.js'`).
- Produces: `createRefresher({ now: () => ms, random: () => 0..1, storage: { get(key), put(key, value) }, build: async ({ signal }) => snapshot, phaseOf: (snapshot|null, nowMs) => 'pre'|'waiting'|'counting'|'final', waitUntil: (promise) => void, log: (event, data) => void })` returning `{ get(): Promise<Response-shaped object> }` where the returned object is `{ body: snapshotWithMeta, status: 200|503 }` and `snapshotWithMeta` = persisted snapshot plus `{ refreshedAt, nextRefreshAt, servedAt, stale, complete }`.
- Also exports pure `computeNextRefreshAt({ phase, refreshedAt, generated, now, failures, random })` and constants object `REFRESH` with the Global Constraints values.

- [ ] **Step 1:** Write failing tests with a fake clock/storage/build:
  1. Cold, no snapshot: `get()` awaits the build once, returns `complete` snapshot, persists.
  2. 2 000 concurrent `get()` calls when due → `build` called exactly once; all callers receive the old snapshot immediately (no awaiting) except when cold.
  3. Not due → no build call.
  4. Due → returns persisted snapshot immediately with `stale:false`; background refresh publishes the new one for the next `get()`.
  5. `build` throws / times out (12 s deadline via fake timers) → snapshot unchanged, `stale:true`, `nextRefreshAt = now + 20 s` then 40 s, 60 s cap (with `random()=1`).
  6. `build` returns invalid (`validateSnapshot` fails) → snapshot unchanged, `stale:true`, reason logged.
  7. Quarantine: the same candidate hash rejected on 3 distinct fetches → accepted on the 3rd, logged `quarantine-accepted`; a cache replay (build returning the identical object without a new fetch marker) does not count — the builder signals a distinct fetch with `snapshot.fetchId`.
  8. `complete:false` candidate never replaces a complete snapshot and is not counted toward quarantine; refresh retried at 20 s floor.
  9. `computeNextRefreshAt`: counting → `max(refreshedAt+20 s, generated+60 s)`; `generated` in the future by hours → clamped to `now+10 min`; missing `generated` → `refreshedAt+60 s`; `final` → +10 min; `pre` before 14:00 → `min(now+5 min, 14:00:00+02:00)`.
  10. Storage rehydrate: new refresher instance over the same storage serves the persisted snapshot without calling `build` when not due.
  11. Snapshot larger than 1.5 MB is kept in memory only (storage `put` not called for it), logged once.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `refresh.js` per spec §3.1: in-flight `refreshPromise` single-flight; `waitUntil(refreshPromise)`; deadline via `AbortController` + timer; persisted keys `snapshot`, `meta` (`refreshedAt`, `generated`, `nextRefreshAt`, `failures`, `quarantine: {hash, count}`); serve-stale-while-refreshing; cold path awaits.
- [ ] **Step 4:** Run tests → PASS; lint.
- [ ] **Step 5:** Commit.

### Task 4: Wire the Worker and Durable Object (branch `p1/worker`)

**Files:**
- Modify: `cloudflare/worker.js` (DO `Feed` class and the edge handler around lines 83-172 as of upstream commit 98d6bc6), `api/_http.js` (cache header helpers), `src/volby/feed.js` and `src/volby/overview.js` (minimal: expose `fetchId` per build, `complete` flag, validate-before-install ordering and delete-offending-cache-entry on rejection; lower overview `waitMs` to ≤ 12 000)
- Create/extend tests: `api/_http.test.js`, `src/volby/feed.test.js` (only for the ordering change)

**Interfaces:**
- Consumes: `createRefresher` (Task 3), `validateSnapshot`/`snapshotHash` (Task 2).
- Produces: HTTP behaviour used by Task 5 — JSON bodies gain `refreshedAt`, `nextRefreshAt`, `servedAt`, `stale`, `complete`; `Cache-Control: public, max-age=<ttl>, s-maxage=<ttl>` where `ttl = edgeTtl(nextRefreshAt, now, stale)`; helper `edgeTtl(nextRefreshAt, now, stale) -> seconds` (integer, `clamp(floor((nextRefreshAt−now)/1000), 0, 5)`, ≤ 5 when stale; outside counting phase returns the existing longer TTLs).
- `CSU_BASE` env var read **only** from `env`, default = `https://volby.gov.cz/appdata/kv2026/20261009`.

- [ ] **Step 1:** Write failing tests for `edgeTtl` (past `nextRefreshAt` → 0, 3 s → 3, 40 s → 5, stale → ≤ 5) and for the validate-before-install ordering in `feed.js` (a rejected body is not stored as `last` and its file-cache entry is removed).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: DO `Feed` creates one refresher per feed key, `storage` = `ctx.storage`, `waitUntil` = `ctx.waitUntil.bind(ctx)`; `build` = existing handler body builder; response includes meta. Worker: after DO call, `cache.put` main key with clamped TTL and a second key `…#lastresort` with 600 s TTL; on DO throw/overload serve `#lastresort` (marked `stale:true`), else 503 JSON `{error:'unavailable'}`. Wrap `track()` Analytics writes in `try/catch`. Add `CSU_BASE` plumbing from `env` into the feed constructors.
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run build`, then `cd cloudflare && npx wrangler deploy --dry-run` → all pass.
- [ ] **Step 5:** Commit.

### Task 5: Client scheduling and fallback removal (branch `p1/client`)

**Files:**
- Create: `src/hooks/schedule.js`, `src/hooks/schedule.test.js`
- Modify: `src/hooks/useLiveResults.js` (remove both `direct` feed constructors and every `goDirect` branch at about lines 35-66, 230-254; replace scheduling at about 150-156, 195-206, 345-352; timeout constant at 27)

**Interfaces:**
- Produces (`schedule.js`): `pickOffset(random) -> ms in [0, 25000]`; `nextPollDelay({ nextRefreshAt, now, offset, random }) -> ms` (≥ 5000; if `nextRefreshAt ≤ now` → `5000 + random*5000`; if undefined → `60000*(0.85+random*0.3)`); `backoffDelay(n, random) -> ms = random*min(300000, 5000*2**n)`; `wakeDelay(random) -> ms = random*60000`; `visibilityDelay(random) -> random*5000`.
- Consumes: response meta from Task 4 (`nextRefreshAt`, `stale`).

- [ ] **Step 1:** Write failing tests for each helper (use fixed `random` stubs: 0, 0.5, 1) including: min gap 5 s; past `nextRefreshAt`; undefined `nextRefreshAt`; backoff caps at 300 s; `pickOffset(1) === 25000`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `schedule.js`. Then modify `useLiveResults.js`: keep the snapshot cached in sessionStorage/state on failure (mark stale), retry the Worker only, schedule via helpers, per-tab offset created once per mount and kept in a ref, 25 s timeout, `online`/`visibilitychange` retries delayed by `visibilityDelay`, 14:00 pre-election wake uses `wakeDelay`.
- [ ] **Step 4:** Add a grep-style test `src/no-direct-csu.test.js` that reads `src/**` (via `fs`) and fails if any file other than `src/councils.js`/`scripts`-only code references `volby.gov.cz` or `volby.cz` in a runtime fetch path (document the allowed file list in the test).
- [ ] **Step 5:** `npm test`, lint, build → PASS. Commit.

### Task 6: Deploy-safe reload and freshness UI (branch `p1/ui`)

**Files:**
- Modify: `src/components/UpdateManager.jsx` (gate at lines ~19-20, 83-114), `src/hooks/useUpdateCheck.js` (jittered interval), `src/components/ElectionHeader.jsx` (status area lines ~16-44, 237-324), `src/pages/CouncilApp.jsx` (~123, 299), `src/components/WelcomeGuide.jsx` (~65), `src/changelog.js` (~85), `src/pages/Landing.jsx` (contrast of last-updated text)
- Create: `src/lib/freshness.js` + `src/lib/freshness.test.js` (pure formatting: `ageSeconds(now, generated)`, `formatAge(seconds) -> 'před 12 s'|'před 2 min'`, `nextCheckLabel(nextAt, now) -> 'M:SS'`, `liveState({snapshot, status, now, pollsClose}) -> 'live'|'pre'|'final'|'stale'|'offline'`)

**Interfaces:** Consumes `snapshot.generated`, `snapshot.refreshedAt`, `nextRefreshAt`, `stale` from Task 4/5.

- [ ] **Step 1:** Failing tests for `freshness.js`: age formatting boundaries (0 s, 59 s, 60 s, 3600 s); `liveState` returns `live` when clock is after `POLLS_CLOSE` and no snapshot yet (cold-load fix), `stale` when `snapshot.stale`, `offline` when `navigator.onLine === false` passed in.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Header shows on desktop and mobile: `ŽIVĚ` pill, `ČSÚ data z HH:MM:SS · před N s`, `další kontrola za M:SS`, one-line cadence text "ČSÚ zveřejňuje data zhruba jednou za minutu; stránka se obnovuje sama". Stale banner includes age. 503/no data: two plain `<a>` links (original: `https://github.com/jsemfast/pirati-vysledky-2026` README live link — implementer must read upstream README for the real site URL; ČSÚ: `https://www.volby.cz/`).
- [ ] **Step 4:** `UpdateManager`: when `isElectionNight()` is true, visible tabs show a small "Nová verze — obnovit" button instead of auto-reload; hidden-tab reload unchanged; update-check interval `5 min × (0.8 + random*0.4)`.
- [ ] **Step 5:** Fix wrong "každou minutu" copy at the three places. Tests/lint/build → PASS. Commit.

### Task 7: Maintainer contact and mirror credit (branch `p1/contact`)

**Files:**
- Create: `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt`
- Modify: `index.html` (HTML comment + `<noscript>`/pre-hydration block with name, role and phone in small text), the app footer component (find via `grep -rn "footer" src/`) with one tiny low-contrast line
- Test: `src/contact.test.js`

- [ ] **Step 1:** Failing test: reads those files and asserts each contains `Václav Vislous`, `777 954 389` (or `+420777954389` in security.txt), the phrase `manages this fork` (English files) / `spravuje tuto kopii` (Czech files), and does **not** contain the word `author`/`autor` describing him; asserts `index.html` contains the phone; asserts the footer string exists in `src/`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Create content. `security.txt` needs `Contact: tel:+420777954389` and `Expires: 2027-10-10T00:00:00Z`. Footer text: `Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous · 777 954 389`.
- [ ] **Step 4:** Tests/lint/build → PASS. Commit.

### Task 8: Infrastructure, staging, burst check, production (sequential; maintainer-agent, not a Sonnet worktree task)

**Files:** `cloudflare/wrangler.jsonc`, `docs/ops/runbook.md`, `scripts/burst.mjs`

- [ ] **Step 1:** Edit `wrangler.jsonc`: `account_id` → `741febb7a315a409b83e5a9a1b62954d`; `name` → `pirati-volby-zaloha`; run `npx wrangler kv namespace create HLASENI` and put the new id; keep `workers_dev: true`; do not set `GITHUB_TOKEN`.
- [ ] **Step 2:** `cd cloudflare && npm ci && npm run build && npx wrangler deploy` → staging URL `https://pirati-volby-zaloha.<subdomain>.workers.dev`. Record `wrangler deployments list` version id in the runbook.
- [ ] **Step 3:** Smoke: `curl -s <staging>/api/prehled | head`, Magistrát and Praha 9 council API URLs (take the exact paths from the app's network calls), `/version.json`; check JSON includes `nextRefreshAt`, `stale:false`, `complete:true`.
- [ ] **Step 4:** `scripts/burst.mjs` (Node fetch loop, 300 concurrent for 60 s against the three priority endpoints, prints status histogram, p50/p95, distinct `refreshedAt` values). Run it; expect ≤ ~3 distinct refreshes per feed per minute; read `wrangler tail` for the refresh logs.
- [ ] **Step 5:** Failure drill on staging: temporarily deploy with `CSU_BASE` pointing at a closed port (a second throwaway Worker env or `wrangler dev --var CSU_BASE:…` locally), confirm `stale:true` is served and recovery works; then restore.
- [ ] **Step 6:** Attach `volby.dg12.cz` as a Worker custom domain (`routes: [{ pattern: "volby.dg12.cz", custom_domain: true }]` in `wrangler.jsonc`), redeploy, verify `curl -sI https://volby.dg12.cz/` and the three endpoints. If the custom-domain step errors because a DNS record already exists, **do not delete it**: stop and report to the owner.
- [ ] **Step 7:** Write `docs/ops/runbook.md` (deploy, rollback `wrangler rollback <id>`, where logs are, kill switches, contact). Commit and merge.

---

## Merge order and parallelism

Task 1 first (everything depends on `npm test`). Then Tasks 2, 5 (schedule/UI parts that don't need Task 4's code), 6, 7 can run in parallel worktrees; Task 3 after 2; Task 4 after 3; Task 5's integration with real responses after 4. Each task: Sonnet implements → `npm test && npm run lint && npm run build` → Opus reviews the diff → merge to `main`. After Tasks 1–7 merge: one Codex pass over the whole diff (`main` vs upstream commit `98d6bc6`), fix CRITICAL/HIGH, then Task 8.

## Self-review notes

- Spec coverage: S1→Task 5 step 4; S2/S3/S4→Tasks 2–4; S5→Tasks 3,5; S6→Task 6; S7→Task 6; S8→Task 7; deploy/domain/rollback→Task 8; §3.3 edge TTL + last-resort→Task 4; §3.2 order of operations→Task 4; quarantine→Task 3.
- Phase 2 items intentionally absent: Codex wrapper vendoring, typecheck, row flash, latency display, bug-endpoint hardening.
- Known soft spot to resolve by reading code (not a placeholder): exact Magistrát/Praha 9 council API paths and the original site's live URL are discovered by the implementer from the app's existing code/README.
