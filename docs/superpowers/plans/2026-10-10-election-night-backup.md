# Election-Night Backup Mirror — Phase 1 Implementation Plan (revision 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is implemented by a **Sonnet** subagent in its own git worktree/branch; every task diff gets an **Opus** review before merge to `main`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a backup mirror of the live election tracker at `https://volby.dg12.cz` that survives election-night load, never shows bad upstream data, and shows ČSÚ updates within ~35 s — a safe subset (1a) live by ~12:30, the full refresher (1b) by ~14:00 (results only start ~15:00).

**Architecture:** Per-feed Durable Object = sole upstream refresher; serves its persisted snapshot immediately, refreshes in the background when due, merges + validates before publishing; first-class feeds (Magistrát + 10 big districts + overview) are warmed by a once-a-minute cron; Worker fronts the DO with a 1–5 s Cache API TTL clamped to `nextRefreshAt` and a 10-minute last-resort copy; the browser polls only our Worker on a server schedule + random per-tab offset with clock-skew correction.

**Tech Stack:** React 19, Vite 7, Tailwind 4, Cloudflare Workers + Durable Objects (SQLite) + cron triggers, Wrangler 4, Vitest `~3.2` (added), Node ≥ 20 (CI 22).

**Spec:** `docs/superpowers/specs/2026-10-10-election-night-backup-design.md` (revision 2). Read it first; "§" refers to it. Opus review r1 findings are cited as C1…L16 (`docs/superpowers/reviews/2026-10-10-opus-spec-plan-review-r1.md`).

## Global Constraints

- Plain JS ESM (`"type": "module"`), no TypeScript migration. UI copy in Czech.
- Cloudflare only (Workers Paid active). No Supabase, SSE, WebSocket, new database.
- **No browser-side request to `volby.gov.cz`** (S1: import-graph test + `! grep -rl "appdata/kv2026" dist/assets` after build).
- Never push to or open PRs against `jsemfast/pirati-vysledky-2026`. Use `GH_TOKEN=$(gh auth token --user vasek24)` and `--repo vasek24/pirati-vysledky-2026` on every `gh` call. **Never run `gh auth switch`.** Never `git push` to `upstream`.
- No secrets in git. Do not set `GITHUB_TOKEN` on any Worker.
- `wrangler deploy` only from `cloudflare/` and only with `name` = `pirati-volby-zaloha` (or `-drill` for drills) and `account_id` `741febb7a315a409b83e5a9a1b62954d`. Before deploying, record the previous version id (`wrangler deployments list`).
- Time handling: ČSÚ `generated` is zone-less Prague time; **always** use `parseCsuTime` from `src/volby/format.js`; tests run with `TZ=UTC`.
- Constants (§3): first-class feeds = Magistrát `554782`, Praha 4 `500119`, 10 `500224`, 8 `500208`, 6 `500178`, 5 `500143`, 11 `547034`, 3 `500097`, 13 `539694`, 12 `547107`, 9 `500216`, plus `prehled`. Refresh floor 20 s; retry `20 s + random·(min(60 s, 20 s·2^(n−1)) − 20 s)`; phases: pre = `min(refreshedAt+5 min, 2026-10-10T14:00:00+02:00)`, waiting = `refreshedAt+60 s`, counting = `clamp(G+60 s, refreshedAt+20 s, refreshedAt+60 s)` (G null or > refreshedAt+120 s → +20 s), final = +10 min; deadline 12 s; overview `waitMs` 8000; per-file timeout 8 s; second-class bounded wait: snapshot older than 2 min → wait ≤ 3 s; edge TTL `clamp(ceil((next−now)/1000), 1, cap)`, `cap = stale?5 : final?600 : pre?300 : 5`; header `Cache-Control: public, max-age=0, s-maxage=<ttl>`; last-resort key `/__lastresort<path>` TTL 600 s; client offset uniform [0, 25 s] per tab; retry if `nextRefreshAt ≤ now`: `random(5,10) s`; min poll gap 5 s; client timeout 25 s; backoff `random(0, min(300 s, 5 s·2^n))` floored at 5 s; visibility/online delay `random(0, 5 s)`; quarantine = same reason on ≥ 3 distinct fetches spanning ≥ 2 min; size guard 1.5 MB UTF-8 bytes.
- Test/lint/build: `npm test`, `npm run lint`, `npm run build` must be green before any merge.
- Maintainer contact (§7): Václav Vislous, "manages this fork and its modifications" (never "author"), phone +420 777 954 389.
- Commits: imperative, one logical change each, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus (failure modes the tasks' tests must pin)

1. Zone-less `generated` parsed in a UTC runtime → refresh cadence 10 min (Task 8 test).
2. Newly counted precincts with `votes:null` in steady state must NOT freeze the snapshot (Task 8 merge test).
3. Pre-14:00 ČSÚ test data persisted, then real data resets counted to 0 (Task 8 baseline test).
4. Lagging replica returns an older `generated`: no stale flag, no backoff, no flapping (Task 8 test).
5. Client with a fast/slow clock must not poll every 5–10 s (Task 10 skew test).

## File Structure

| File | Responsibility |
|---|---|
| `cloudflare/feedClasses.js` (new) | `FIRST_CLASS` set, `isFirstClass(key)`, `FIRST_CLASS_KEYS` list. |
| `src/volby/validate.js` (new) | `mergeCandidate`, `validateCandidate`, `snapshotHash` (pure). |
| `src/volby/__fixtures__/*.json` (new) | Hand-written ČSÚ-shaped raw JSON. |
| `cloudflare/refresh.js` (new) | Pure refresher: `createRefresher(deps)` → `get()`; `computeNextRefreshAt`. |
| `src/volby/feed.js`, `overview.js` | `build()`, `invalidate()`, `fetchId`, `getJson.version/invalidate`; `waitMs` 8000. |
| `cloudflare/worker.js` | DO wiring, edge TTL, last-resort cache, `x-server-now`, `scheduled()`, 503 JSON, `CSU_BASE`. |
| `api/_http.js` | `edgeTtl(...)` helper + header builder. |
| `src/hooks/schedule.js`, `src/hooks/useLiveResults.js` | Client scheduler, skew, no direct fallback. |
| `src/lib/reload.js`, `src/components/UpdateManager.jsx`, `src/hooks/useUpdateCheck.js` | Deploy-safe reload. |
| `src/lib/freshness.js`, `src/components/ElectionHeader.jsx`, copy files | Freshness UI. |
| `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt`, `index.html`, `Landing.jsx`, `CouncilApp.jsx` | Maintainer contact. |
| `cloudflare/wrangler.jsonc`, `.github/workflows/*`, `docs/ops/runbook.md`, `CLAUDE.md`, `scripts/burst.mjs` | Infra, CI, docs. |

---

# PHASE 1a (target live ~12:30)

### Task 1: Guards and harness minimum (branch `p1/harness`)

**Files:** Create `CLAUDE.md`, `.nvmrc` (`22`), `vitest.config.js`, `.github/workflows/ci.yml`, `src/volby/sanity.test.js`. Modify `package.json`, `eslint.config.js`, `.github/workflows/deploy.yml`, `cloudflare/wrangler.jsonc`.

**Interfaces:** Produces `npm test` (`TZ=UTC vitest run`).

- [ ] **Step 0 (guards, reversible):**
  ```sh
  git remote set-url --push upstream DISABLED-never-push-upstream
  GH_TOKEN=$(gh auth token --user vasek24) gh repo set-default vasek24/pirati-vysledky-2026
  ```
- [ ] **Step 1:** Edit `cloudflare/wrangler.jsonc`: `account_id` → `741febb7a315a409b83e5a9a1b62954d`; `name` → `pirati-volby-zaloha`; add an `env.staging` block (`name: "pirati-volby-zaloha-staging"`, `workers_dev: true`, no routes, no crons, its own `HLASENI` KV binding with id `"CREATE-IN-TASK-5"`, its own Durable Object binding/migration for `Feed`) so production and staging never share Durable Object storage; and replace the author's KV namespace id in the top-level `HLASENI` binding with the literal string `"CREATE-IN-TASK-5"` and add a comment saying Task 5 creates the namespace. Because that value is invalid, an accidental `wrangler deploy` before Task 5 fails instead of touching anything. Do not run any deploy.
- [ ] **Step 2:** `npm i -D vitest@~3.2`; set `"test": "TZ=UTC vitest run"`. `vitest.config.js`:
  ```js
  import { defineConfig, configDefaults } from 'vitest/config';
  export default defineConfig({ test: { environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js', 'cloudflare/*.test.js'],
    exclude: [...configDefaults.exclude] } });
  ```
  Add `globals.node` for `**/*.test.js` in `eslint.config.js`.
- [ ] **Step 3:** `src/volby/sanity.test.js` (`expect(1 + 1).toBe(2)`); run `npm test`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 4:** `CLAUDE.md` (≤ 60 lines): purpose, the Global Constraints (guards, per-command GH_TOKEN, deploy rules, contact), commands, "read spec and plan first".
- [ ] **Step 5:** `ci.yml` (pull_request + push to non-main): Node 22, `npm ci`, lint, test, build, then `! grep -rl "appdata/kv2026" dist/assets`. `deploy.yml`: delete the `push` trigger (keep `workflow_dispatch`), replace the hard-coded author URL smoke test by `${{ vars.SMOKE_URL }}` (step skipped when unset).
- [ ] **Step 6:** Commit, merge to `main` fast-forward.

### Task 2: Remove browser fallback and visible-tab reload (branch `p1/client-safe`)

**Files:** Modify `src/hooks/useLiveResults.js` (remove both `direct` feed constructors at ~35-66 and every `goDirect` branch ~230-254; keep today's scheduler), `src/components/ElectionHeader.jsx` (~305 `live.source === 'direct'` + "přímo z ČSÚ" text), `src/components/UpdateManager.jsx` (~19-20, 83-114), `src/hooks/useUpdateCheck.js` (jitter), `src/pages/CouncilApp.jsx` / wherever `BugReportWidget` is rendered (stop rendering it). Create `src/lib/reload.js`, `src/lib/reload.test.js`, `src/no-direct-csu.test.js`.

**Interfaces:** Produces `shouldAutoReload({ hidden: boolean, electionNight: boolean }) -> boolean`, defined as `!electionNight || hidden`. `UpdateManager` shows a "Nová verze — obnovit" button on election night and reloads on `visibilitychange → hidden` when a new version is pending.

- [ ] **Step 1:** Failing tests: `reload.test.js` (visible+electionNight → false; hidden+electionNight → true; visible+!electionNight → true); `no-direct-csu.test.js` reads files: no file under `src/hooks|pages|components|lib` contains an import of `createKvFeed|createOverviewFeed|createJsonCache|KV_BASE_URL`, and `useLiveResults.js` does not contain `.direct(`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. On API failure keep the last snapshot (sessionStorage) marked stale and retry only the Worker with the existing 60 s ±15 % / backoff logic.
- [ ] **Step 4:** `npm test`, lint, build, and `! grep -rl "appdata/kv2026" dist/assets` → PASS. Commit.

### Task 3: Maintainer contact (branch `p1/contact`)

**Files:** Create `public/humans.txt`, `public/kontakt.txt`, `public/.well-known/security.txt`, `src/contact.test.js`. Modify `index.html`, `src/pages/Landing.jsx` (footer ~513-516, owns lines 494-516), `src/pages/CouncilApp.jsx` (next to the "Zdroj: ČSÚ" note ~419).

- [ ] **Step 1:** Failing test `src/contact.test.js`: each file contains `Václav Vislous` and the phone (`777 954 389`; security.txt `tel:+420777954389`); English files contain `manages this fork`, Czech `spravuje tuto kopii`; no file calls him `author`/`autor`; `index.html` contains the phone; both `Landing.jsx` and `CouncilApp.jsx` contain the string `správce kopie: Václav Vislous`.
- [ ] **Step 2:** FAIL. **Step 3:** Create content (`security.txt`: `Contact: tel:+420777954389`, `Expires: 2027-10-10T00:00:00Z`; footer text `Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous · 777 954 389`; low-contrast, small).
- [ ] **Step 4:** tests/lint/build → PASS. Commit.

### Task 4: Worker 1a — 503 JSON, feed classes, cron warm-up (branch `p1/worker-1a`)

**Files:** Create `cloudflare/feedClasses.js`, `cloudflare/feedClasses.test.js`. Modify `cloudflare/worker.js` (502 path ~150 → 503 JSON `{"error":"unavailable"}`; comment ~"klient po 502 přepne na přímé čtení" removed; add `scheduled(controller, env, ctx)`), `cloudflare/wrangler.jsonc` (`"triggers": { "crons": ["* * * * *"] }`).

**Interfaces:** Produces `FIRST_CLASS_KEYS: string[]` (the Global Constraints list of 11 zastup codes + `'prehled'`), `isFirstClass(key: string) -> boolean`.

- [ ] **Step 1:** Failing test: `FIRST_CLASS_KEYS` has 12 unique entries, includes `554782`, `500216`, `prehled`; `isFirstClass('500216') === true`, `isFirstClass('538531') === false`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Extract the existing HTTP route's DO call (`worker.js:121-149`: it derives the DO name `volby?z=<code>` / `prehled` and calls the RPC method `stub.run(name, path)` — the `Feed` class has **no `fetch()` handler**) into one shared helper `callFeed(env, key) -> Promise<{status, body, ...}>` used by **both** the HTTP route and `scheduled()`. `scheduled(controller, env, ctx)`: for each key in `FIRST_CLASS_KEYS`, with concurrency 4 and a 15 s timeout, `await callFeed(env, key)`; on a non-200 or throw, `console.warn('warmup-failed', key, reason)`; on success `console.log('warmup-ok', key, status)`. Task 9 must keep this helper as the single entry point when it changes the DO's internals.
- [ ] **Step 4:** `npm test`, lint, build, `cd cloudflare && npm ci && npx wrangler deploy --dry-run` → PASS. Commit.

### Task 5: Deploy 1a (maintainer: the orchestrator, not a Sonnet task)

- [ ] **Step 1:** After Tasks 1–4 are merged and Opus-reviewed: `cd cloudflare && npx wrangler kv namespace create HLASENI` and `npx wrangler kv namespace create HLASENI --env staging`; paste the two ids into `wrangler.jsonc`; commit.
- [ ] **Step 2:** `npm ci && npm ci --prefix cloudflare && (cd cloudflare && npm run build && npx wrangler deploy --env staging)` → staging Worker `pirati-volby-zaloha-staging` on workers.dev; run Step 3 against it. Only then deploy production `npx wrangler deploy` (no `--env`, workers.dev URL of `pirati-volby-zaloha`) and re-run the smoke. Record both version ids in `docs/ops/runbook.md`.
- [ ] **Step 3 (run on staging first, then production):** Smoke: `curl -fsS` `/version.json`, `/api/prehled`, Magistrát and Praha 9 council API URLs (take exact paths from the app's own requests), `/humans.txt`, `/kontakt.txt`, `/.well-known/security.txt`; confirm with `wrangler tail` that within 2 minutes the log shows `warmup-ok` for **all 12** first-class keys (an invocation alone is not enough — `warmup-failed` for any key blocks go-live).
- [ ] **Step 4:** Add `routes: [{ pattern: "volby.dg12.cz", custom_domain: true }]` to the **top-level (production) config only**, redeploy production, `curl -sI https://volby.dg12.cz/` and the endpoints. If the custom-domain step errors because a DNS record exists, **do not delete anything**; stop and report to the owner.
- [ ] **Step 5:** Write `docs/ops/runbook.md` (deploy, rollback `wrangler rollback <id>`, logs, contact). Merge. **Phase 1a is live.**

---

# PHASE 1b (target staged ~13:30, deployed ~14:00)

### Task 6: Merge and validate module (branch `p1/validate`)

**Files:** Create `src/volby/validate.js`, `src/volby/validate.test.js`, `src/volby/__fixtures__/` (hand-written raw ČSÚ JSON: results summary, turnout rows, one precinct file — layouts at `feed.js:47-53`, `:98-100`, `:116-117`; plus `{}`, `[]`, `"<html>"`, truncated `{"prehled":[`).

**Interfaces:**
- `mergeCandidate(candidate, good, kind: 'council'|'overview') -> { merged, complete: boolean }` — council: copy votes from `good` for precincts where `candidate` has `votes:null` and `good` has votes with equal `voters/envelopes/validVotes`; overview: copy councils missing from `candidate.councils` from `good`; `complete:false` only if a precinct/council that had data in `good` still has none after the merge.
- `validateCandidate(merged, good, ctx: { now: number, pollsClose: number, goodRefreshedAt: number, base: string, goodBase: string }) -> { outcome: 'ok'|'older'|'rejected', reason?: string }` implementing §3.2 exactly (baseline, structural rejects, older, content regression); uses `parseCsuTime(...).getTime()` for `generated`.
- `snapshotHash(snapshot) -> string` excluding `generated` at every level, `fetchedAt`, `phase`, `missing`, `fetchId`, all response meta.

- [ ] **Step 1:** Failing tests: build candidates by running `createKvFeed({ fetchImpl })` / `createOverviewFeed({ fetchImpl })` on fixtures (C3/H4). Cases: `{}`/`[]` → rejected `parties-empty`/`generated-null`; HTML/truncated → feed throws (not validate); new precinct with `votes:null` → merged complete and ok; lost precinct filled from good; cold (no good) partial → installable; pre-14:00 baseline counted=50 then post-14:00 counted=0 → ok; `generated` older → `older`; counted decreased with advancing `generated` → `rejected:counted-decreased`; party votes dropped to 0 → rejected; overview council `parties.length===0` → rejected; `snapshotHash` equal when only `generated`/`fetchedAt` differ.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** tests/lint → PASS. Commit.

### Task 7: Feed layer (branch `p1/feed`)

**Files:** Modify `src/volby/feed.js` (`createJsonCache` ~160-215, `createKvFeed` ~225-335, `build` ~286-317), `src/volby/overview.js` (~100-160; `waitMs` 20000 → 8000), tests `src/volby/feed.test.js`.

**Interfaces:**
- `getJson.invalidate(path)`, `getJson.version(path) -> number` (incremented on every HTTP 200).
- `createKvFeed({...}) -> { snapshot, build, invalidate }`, `createOverviewFeed({...}) -> { snapshot, build, invalidate }`; `build()` runs the inner build, **throws** on failure, does not set `last`, returns the snapshot with `fetchId`; `snapshot()` unchanged (Vercel still uses it).
- Both accept `baseUrl` (already) — the DO passes `env.CSU_BASE`.

- [ ] **Step 1:** Failing tests with fake `fetchImpl`: `build()` throws when the summary fetch fails (while `snapshot()` still returns old `last` stale); `fetchId` changes only when a new 200 arrives (304/cache replay keeps it); `invalidate()` forces the next call to refetch unconditionally; overview `waitMs` is 8000.
- [ ] **Step 2:** FAIL. **Step 3:** Implement minimal. **Step 4:** tests/lint/build → PASS. Commit.

### Task 8: Refresher (branch `p1/refresh`)

**Files:** Create `cloudflare/refresh.js`, `cloudflare/refresh.test.js`.

**Interfaces:**
- Consumes `mergeCandidate`, `validateCandidate`, `snapshotHash` (Task 6); feed `{ build, invalidate }` (Task 7); `parseCsuTime` (`src/volby/format.js`).
- Produces `createRefresher({ now, random, storage: { get(k), put(obj) }, feed, kind: 'council'|'overview', phaseOf, firstClass: boolean, base: string, log, waitMs? })` → `{ get(): Promise<{ status: 200|503, body: string, meta }> }` where `body` is the persisted JSON string with meta spliced in (`refreshedAt, nextRefreshAt, servedAt, stale, complete, refreshing`) and `computeNextRefreshAt({ phase, refreshedAt, generatedMs, now, failures, random }) -> ms`.
- `REFRESH` constants object with the Global Constraints values.

- [ ] **Step 1:** Failing tests (fake clock/timers/storage/feed; `TZ=UTC`):
  1. Cold, no snapshot: `get()` awaits one build, persists `{snapshot, meta}` in **one** `put`.
  2. 2 000 concurrent `get()` when due → exactly one `build`; all but a cold caller get the old snapshot immediately.
  3. Not due → no build. Due → old snapshot immediately, new one on the next `get()`.
  4. Zone-less `generated` `'2026-10-10T14:31:05'`, `refreshedAt = Date.parse('2026-10-10T14:31:20+02:00')` → `nextRefreshAt = Date.parse('2026-10-10T14:32:05+02:00')` (**C1**, run under TZ=UTC); `generated` hours in the future → `refreshedAt+20 s`; null → `+20 s`; waiting → `+60 s`; final → `+10 min`; pre at 13:58 → `14:00:00+02:00`.
  5. `build` throws / 12 s timeout / `rejected` → snapshot unchanged, `stale:true`, retry delays 20 s then 20–40 s then 20–60 s (assert with `random()=1` → 20/40/60 and `random()=0` → 20/20/20) and `feed.invalidate()` called on `rejected`.
  6. **Merge (C3):** new precinct with `votes:null` replaces the snapshot, not stale; lost precinct filled; cold DO with only a partial build installs it; `complete:false` never counted toward quarantine, retried at 20 s.
  7. **Baseline/older/regression (C4):** pre-14:00 baseline then post-14:00 `counted=0` → accepted; `older` → good kept, `stale:false`, no backoff, still not installed after 5 repeats; counted regression with advancing `generated` on 3 distinct `fetchId`s spanning ≥ 2 min → accepted (`quarantine-accepted` logged); same `fetchId` replays don't count.
  8. Rehydrate: new instance over same storage serves the snapshot with no build when not due; discards on `meta.base` or `meta.schema` mismatch; two concurrent `get()` on a fresh instance → one storage read (**L15**).
  9. Size guard: snapshot > 1.5 MB UTF-8 bytes (multi-byte Czech text) → no `put`, memory only, one log.
  10. **S2 simulated run:** 5 simulated minutes, ČSÚ publishes every 60 s (advancing `generated`), 50 `get()`/s → `build` count ∈ [5, 15]; ČSÚ unchanged → ≈ 1 per 20 s.
  11. **Second class bounded wait:** `firstClass:false`, snapshot older than 2 min → `get()` waits ≤ 3 s for the refresh then returns current (or old with `refreshing:true` when the wait expires); younger → immediate.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `refresh.js` per §3.1–3.2. **Step 4:** tests/lint → PASS. Commit.

### Task 9: Worker wiring 1b (branch `p1/worker-1b`)

**Files:** Modify `cloudflare/worker.js` (Feed DO ~83-103, edge handler ~105-172), `api/_http.js`; Create `api/_http.test.js`.

**Interfaces:**
- `edgeTtl({ nextRefreshAt, now, stale, phase }) -> integer seconds` per Global Constraints (floor 1, caps); `cacheControl(ttl) -> 'public, max-age=0, s-maxage=<ttl>'`.
- Consumes `createRefresher` (Task 8), feeds `build/invalidate` (Task 7), `isFirstClass` (Task 4).

- [ ] **Step 1:** Failing tests for `edgeTtl` (past → 1; 3 s → 3; 40 s → 5; stale with 40 s → 5; final with 400 s → 400; pre with 1000 s → 300) and `cacheControl`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement: each `Feed` DO builds its feed with `baseUrl: this.env.CSU_BASE || KV_BASE_URL`, creates the refresher (storage = `ctx.storage`, `firstClass = isFirstClass(key)`, `base = baseUrl`) in the constructor wrapped in `ctx.blockConcurrencyWhile` for rehydrate; request handler returns the refresher body with `Cache-Control` from `cacheControl(edgeTtl(...))`; Worker: after a DO 200 also `cache.put(lastResortKey, resp)` with key `new Request(new URL('/__lastresort' + path, origin))` and 600 s TTL; serve it (as `stale:true`) when the DO throws **or** `status >= 500`; `reply()` adds `x-server-now`; keep the `scheduled()` from Task 4.
- [ ] **Step 4:** `npm test`, lint, build, `cd cloudflare && npm ci && npx wrangler deploy --dry-run` → PASS. Commit.

### Task 10: Client scheduler, skew and freshness UI (branch `p1/client-1b`)

**Files:** Create `src/hooks/schedule.js`, `schedule.test.js`, `src/lib/freshness.js`, `freshness.test.js`. Modify `src/hooks/useLiveResults.js` (~23-27, 150-156, 195-206, 345-352), `src/components/ElectionHeader.jsx` (~16-44, 237-324), `src/pages/CouncilApp.jsx` (~122-123, 299), `src/components/WelcomeGuide.jsx` (~65), `src/changelog.js` (~85). Must not touch `Landing.jsx:494-516` or `CouncilApp.jsx:~419` (Task 3 owns them).

**Interfaces:**
- `pickOffset(random) -> ms in [0,25000]`; `nextPollDelay({ nextRefreshAt, now, offset, random }) -> ms` (≥ 5000; `nextRefreshAt ≤ now` → `5000 + random*5000`; undefined → `60000*(0.85+random*0.3)`); `backoffDelay(n, random) -> ms ≥ 5000`; `visibilityDelay(random) -> random*5000`; `computeSkew(serverNowHeader, clientNow) -> ms`.
- `ageSeconds(nowCorrected, generated) -> integer ≥ 0` (uses `parseCsuTime`); `formatAge(s)`; `nextCheckLabel(nextAt, nowCorrected) -> 'M:SS'`; `liveState({ snapshot, status, now, pollsClose, online }) -> 'live'|'pre'|'final'|'stale'|'offline'` (cold load after 14:00 with no snapshot → `live`).

- [ ] **Step 1:** Failing tests: min gap 5 s; past `nextRefreshAt` → 5–10 s; undefined → 60 s ±15 %; backoff cap 300 s and floor 5 s; `pickOffset(1) === 25000`; **client clock +120 s with the server's `x-server-now` → normal delay, not 5–10 s (Review Focus 5)**; `ageSeconds` clamps ≥ 0; `liveState` cold-load case; age/label boundaries (0, 59, 60, 3600 s).
- [ ] **Step 2:** FAIL. **Step 3:** Implement helpers; wire `useLiveResults.js` (read `x-server-now` from the response, per-tab offset in a ref created once, 25 s timeout, delayed `online`/`visibilitychange` retries, no separate `wakeDelay`). Header on desktop **and** mobile: `ŽIVĚ` pill, `ČSÚ data z HH:MM:SS · před N s`, `další kontrola za M:SS`, cadence sentence; stale banner with age; 503 + no snapshot → two plain links (original site; the ČSÚ link already present in the app); fix the three wrong "každou minutu" strings.
- [ ] **Step 4:** tests/lint/build + `! grep -rl "appdata/kv2026" dist/assets` → PASS. Commit.

### Task 11: Deploy 1b (orchestrator)

- [ ] **Step 1:** Merge Tasks 6–10 after each Opus diff review; run the full `npm test && npm run lint && npm run build` on `main`.
- [ ] **Step 2:** **Codex review of the whole diff** vs upstream base `98d6bc6` (`CODEX_REVIEW_MODEL=gpt-5.6-sol tools/codex-review.sh --scope code --base 98d6bc6 --spec docs/superpowers/specs/2026-10-10-election-night-backup-design.md`); fix CRITICAL/HIGH; one confirming round only if a CRITICAL/HIGH was fixed.
- [ ] **Step 3:** Local drills under `wrangler dev` with a mock ČSÚ (`counted > 0`, `generovano` advancing every 60 s): cadence ≈ 1 refresh/20–60 s under `scripts/burst.mjs` load (300 concurrent, 60 s); forced upstream failure → `stale:true`; empty body → unchanged; restart → snapshot survives. Failure drills **never** on `pirati-volby-zaloha`.
- [ ] **Step 4:** **Staging first:** `cd cloudflare && npm run build && npx wrangler deploy --env staging`; run the staging checks there (two consecutive `x-cache: HIT` responses never carry a `refreshedAt` > 65 s older than the preceding MISS; `x-server-now` present; 503 JSON when the DO is forced to fail; `wrangler tail` shows refreshes for Magistrát, Praha 9 and `prehled`). **Only after those pass:** record the production previous version id (`wrangler deployments list`), `npx wrangler deploy` (production), repeat the same checks against `volby.dg12.cz`. Failure drills with a fake `CSU_BASE` run on the staging env or `wrangler dev`, never production.
- [ ] **Step 5:** Update the runbook; merge. **Phase 1b is live.** Then Phase 2 (row flash, latency display, harness) in the quiet window.

---

## Merge order and parallelism

1 → (2, 3, 4 in parallel) → 5 [**1a live**]. In parallel with 1a: 6 and 7 (independent files), then 8 (needs 6 + 7 interfaces; may start as soon as their signatures are merged), then 9 (needs 8, after 4 because both edit `worker.js`), 10 (after 2 because both edit `useLiveResults.js`; independent of 8/9 via the response contract), then 11. Per task: Sonnet implements → `npm test && npm run lint && npm run build` → Opus diff review → merge. Codex runs once on the whole diff (Task 11 Step 2); spec+plan Codex review happens before Task 1 starts.

## Self-review notes

- Spec coverage: S1 → Tasks 2, 10 + CI grep; S2 → Task 8 test 10; S3 → Tasks 6, 8; S4 → Task 8 test 8; S5 → Tasks 8–10; S6 → Task 2; S7 → Task 10; S8 → Task 3 + Task 5 curl; S9 → Tasks 4, 8 (test 11), 9; last-resort/edge/`x-server-now` → Task 9; guards/wrangler swap → Task 1; domain → Task 5.
- Phase 2 intentionally absent: row flash, arrows, latency display, harness extras, README.
- Soft spots resolved by the implementer reading code (not placeholders): exact Magistrát/Praha 9 API paths and the DO naming helper in `worker.js:121-149`; the original site's live URL for the fallback links (read upstream README).

---

# PHASE 2 (client-only items; may ship in the quiet 14:00–15:00 window or later)

### Task P2-A: Change detection, row flash, arrows and live summary (branch `p2/flash`)

**Goal (owner request):** an immediately noticeable but not over-the-top cue when new data arrives and numbers move.

**Files:** Create `src/lib/changes.js`, `src/lib/changes.test.js`, `src/hooks/useChanges.js`; modify `src/components/PartyResults.jsx`, `src/components/Councilors.jsx`, `src/components/Coalition.jsx` (only if it shows per-party numbers), `src/components/Hemicycle.jsx` (seat count changes → existing aria-live at ~:153 must stay polite), `src/components/ElectionHeader.jsx` (a tiny "nová data" ping on the status pill/precinct counter), `src/index.css` (keyframes + reduced-motion), `src/pages/CouncilApp.jsx` (wire `useChanges`), `src/pages/Landing.jsx` (council cards already have a 4 s ring; reuse the same helper if trivial, otherwise leave).

**Interfaces:**
- `diffSnapshots(prev, next) -> { changed: boolean, precincts: { delta: number }, parties: Map<partyId, { votesDelta: number, seatsDelta: number, rankDelta: number }>, councilors: Set<candidateKey> }` — pure; `prev == null` (first load) or a change in election/council identity → `{ changed: false }` (NEVER flash on first load or on page reload from sessionStorage). Ignore `generated`/`fetchedAt`/meta-only changes (no flash when nothing numeric moved).
- `useChanges(snapshot) -> { changes, tick }`: keeps the previous snapshot in a ref, computes `diffSnapshots` when the snapshot's `generated`+counted signature changes, exposes `changes` for 4 s then clears (no per-second re-render of the tree; only set state at change and clear).
- Row marker: rows whose votes/seats/rank changed get the class `row-flash` for ~2.5 s (soft background pulse, one cycle, not looping) and show a compact arrow cue next to the number (`▲ +123` / `▼ −45` for votes; `▲ +1 místo` seats; rank up/down arrow) that stays for the 4 s window; the pill/precinct counter gets one gentle pulse. Colour is never the only cue (arrow + text). `prefers-reduced-motion: reduce` → no animation, static highlight + arrow only. No layout shift: reserve the arrow slot width (e.g. `min-w`) or use `position:absolute` within the cell.
- A visually hidden `aria-live="polite" aria-atomic="true"` region announces ONE summary per update, only when something changed: e.g. "Aktualizace: sečteno 31 z 43 okrsků (+2); Piráti 14,2 % (+0,3)". No announcements per tick/countdown.

**Steps (TDD):**
- [ ] Failing tests for `diffSnapshots`: first load → unchanged; identical → unchanged; only `fetchedAt` changed → unchanged; counted +2 and one party's votes up → `changed`, correct deltas; rank swap; seat gain; different council → unchanged; garbage input does not throw.
- [ ] Implement `changes.js` + `useChanges.js`; wire into CouncilApp and the components; add CSS in `index.css` (check the existing global reduced-motion rule at ~:155-169 and the `okrsek` highlight keyframes at ~:137-151 for conventions).
- [ ] `npm test`, `npm run lint`, `npm run build`, `! grep -rl "appdata/kv2026" dist/assets`; manual check in `npm run dev` with a mocked fetch that returns two successive snapshots (document how) and note observations.
- [ ] Commit.

### Task P2-B: Latency chain display (branch `p2/latency`)

**Goal (owner request):** show how long it takes from ČSÚ publishing to the table updating, clearly but unobtrusively.

**Files:** Create `src/lib/latency.js`, `src/lib/latency.test.js`; modify `src/components/ElectionHeader.jsx` (a small "Jak čerstvá jsou data?" disclosure) and `src/hooks/useLiveResults.js` (record `receivedAt` = skew-corrected client time when the response body arrived and `renderedAt` after state commit).

**Interfaces:** `latencyChain({ generated, refreshedAt, servedAt, receivedAt, renderedAt }) -> { csuToServer: sec|null, serverToClient: sec|null, receiveToRender: sec|null, total: sec|null }`; `generated` via `parseCsuTime`; all values clamp ≥ 0 and are null when an input is missing/invalid (old server without the new fields). UI: one line in a collapsed details element — "ČSÚ vygenerovalo 14:03:07 → náš server načetl 14:03:19 (+12 s) → váš prohlížeč zobrazil 14:03:31 (+12 s) · celkem 24 s" and the cadence tier "kontrola každou minutu / 20 s při opoždění".

**Steps (TDD):** failing tests for `latencyChain` (normal chain, missing fields, negative skew clamp, generated in the future) → implement → wire (read `servedAt`/`refreshedAt` from the response; `receivedAt`/`renderedAt` from the hook) → tests/lint/build/dist grep → commit.
