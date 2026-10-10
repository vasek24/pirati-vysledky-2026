# Opus adversarial review r1: election-night backup spec + plan (details pass)

Reviewed: `docs/superpowers/specs/2026-10-10-election-night-backup-design.md`, `docs/superpowers/plans/2026-10-10-election-night-backup.md`, against code at `4d69392` (branch `docs/phase1-spec`, base `98d6bc6`). Review time: 2026-10-10 09:36 CEST.
Scope: details only. I do not re-argue `demand-coalesced-do` or the five must-fixes from the earlier pass.

## Verdict: BLOCK

The blockers are four spec/plan text defects. Each one, implemented as written, breaks S5 or S3 in production while every planned test still passes:

- C1: time zone on `generated`.
- C2: `#lastresort` cache key.
- C3: what `complete` means.
- C4: monotonic validation plus quarantine against ČSÚ test data, replica lag and corrections.

All four can be fixed by editing the text, about 30 minutes. They do not need another architecture pass. Once C1–C4 and H1–H5 are written into the spec and plan, this becomes APPROVE-WITH-CHANGES. H8 (timeline) needs a decision from the owner now.

---

## CRITICAL

### C1. `generated` is local Prague time with no zone. Parsed in the Worker (UTC), the refresh interval becomes 10 minutes.
- **Where:** spec §3.1 "nextRefreshAt"; plan Global Constraints; plan Task 3 Interfaces (`computeNextRefreshAt({… generated …})`); plan Task 3 test 9 ("`generated` in the future by hours → clamped to `now+10 min`"); plan Review Focus 2.
- **What is wrong:**
  - ČSÚ `generovano` is a zone-less local string such as `"2026-10-10T14:31:05"`. The app takes it unchanged (`src/volby/feed.js:59`, `:113`, `:123`) and picks the newest one by string sort (`:307`).
  - `Date.parse` reads a zone-less date-time as **local** time. Workers run in UTC, so a value generated at 14:31 CEST becomes 14:31Z, which is 2 h in the future.
  - `generated + 60 s` then lands about 2 h ahead. Test 9 itself prescribes clamping that to `now + 10 min`, so the DO refreshes once every 10 minutes all night.
  - Vitest on the maintainer's laptop runs in TZ=Europe/Prague, where the bug does not show. Every test passes.
- **Evidence:** `src/volby/format.js:22-27`. `parseCsuTime` exists precisely because of this: it appends `+02:00` when no zone is present. Nothing in the plan tells the refresher or the validator to use it.
- **Fix (spec §3.1, replace the nextRefreshAt bullet):**
  > **nextRefreshAt** (counting/waiting): let `G = parseCsuTime(generated)` (`src/volby/format.js`; zone-less ČSÚ time is read as +02:00, correct until 25 Oct). `nextRefreshAt = clamp(G + 60 s, refreshedAt + 20 s, refreshedAt + 60 s)`. If `G` is null or later than `refreshedAt + 120 s` (clock skew or junk), use `refreshedAt + 20 s`. The 10-minute clamp applies **only** to `final`. All comparisons of `generated`, in validation and in the hash, use `parseCsuTime(...).getTime()`, never string order or bare `Date.parse`.
- **Fix (plan Task 3):** `computeNextRefreshAt` takes `generatedMs`. Replace test 9's future-generated case with:
  - "future by hours → `refreshedAt+20 s`";
  - "zone-less `'2026-10-10T14:31:05'` with refreshedAt = `Date.parse('2026-10-10T14:31:20+02:00')` → nextRefreshAt = `Date.parse('2026-10-10T14:32:05+02:00')`".
- **Fix (plan Task 1):** set `"test": "TZ=UTC vitest run"` so CI and laptops match the Worker.

### C2. The `…#lastresort` cache key is the same key as the main entry. The 600 s copy overwrites the 5 s one.
- **Where:** plan Task 4 Step 3 ("a second key `…#lastresort` with 600 s TTL").
- **What is wrong:**
  - The Cache API matches keys with the URL fragment excluded (Service Worker Cache spec, "exclude fragment"). An HTTP cache key cannot carry a fragment at all.
  - So `path` and `path#lastresort` are one entry. The plan puts the last-resort copy second, so its 600 s TTL wins.
  - The HIT path (`cloudflare/worker.js:136-142`) then serves snapshots up to 10 minutes old to every viewer in that colo. That defeats S5 and the edge clamp, and no unit test can catch it (`worker.js` imports `cloudflare:workers` and is untested).
- **Fix (Task 4 Step 3):** use a distinct path:
  ```js
  const lastResortKey = new Request(new URL(`/__lastresort${path}`, url.origin));
  ```
  Add to Task 8 Step 3: "two consecutive `x-cache: HIT` responses must never carry a `refreshedAt` more than 65 s apart from the MISS that preceded them."

### C3. If `complete:false` means "some precinct votes are missing", council updates freeze for the whole count.
- **Where:** spec §3.1 "Cold start"; plan Task 3 test 8; Task 4 ("expose … `complete` flag").
- **What is wrong:**
  - The spec defines `complete` only as "built with a cold/partial cache".
  - In **steady state**, every build that brings newly counted precincts waits only `precinctWaitMs = 3 s` (`feed.js:235`, `:289`), then emits `votes: null` for those precincts (`:298`). Spec §2 itself says precinct batches arrive every 5 min.
  - The overview build sets `missing > 0` whenever any one of 58 files misses `waitMs` (`overview.js:135-143`), which is likely on election night.
  - A Sonnet implementer will reasonably write `complete = every okrsek has votes` or `complete = missing === 0`. Then, during counting, the council or overview snapshot **never** replaces the first complete one. Test 8 would pass.
  - The case "no snapshot yet, and the first build is partial" is also unspecified. It must be installed, or a fresh DO serves 503 forever.
- **Fix (spec §3.1, replace the "Cold start" bullet's first two sentences):**
  > A candidate is **merged with the current good snapshot before validation**:
  > - **Council:** for each okrsek where the candidate has `votes:null` and the good snapshot has votes and the same `voters`/`envelopes`/`validVotes`, copy the votes. **Newly counted precincts with `votes:null` are normal and complete.**
  > - **Overview:** every council missing from `candidate.councils` is copied from the good snapshot.
  >
  > `complete:false` means exactly one thing: after the merge, a precinct or council that had data in the good snapshot still has none. Such a candidate is not installed when a good snapshot exists; it is **installed when none exists**. It is never counted toward quarantine, does not set `stale`, and is retried at the 20 s floor.
- **Fix (Task 3 tests):**
  - Replace test 8 with: (a) new precinct with `votes:null` replaces the snapshot; (b) a lost precinct is filled from the previous snapshot; (c) a cold DO with no snapshot installs a partial build.
- **Side effect:** this merge replaces the "seeding" in §3.1, which cannot work as written. See M4.

### C4. Monotonic validation plus hash-based quarantine can block the real count for the whole night. It can also install an older ČSÚ replica.
- **Where:** spec §3.2 (rules and quarantine); plan Task 2 Interfaces (`snapshotHash` ignores only `fetchedAt, servedAt, refreshedAt, nextRefreshAt, stale, complete`); plan Task 3 test 7.
- **Three concrete failures:**
  1. **ČSÚ test data before 14:00.** The codebase already handles ČSÚ test data published before polls close (`src/hooks/useLiveResults.js:270-277`).
     - If the DO persists a test snapshot with counted = N, then at 14:00 the real reset to 0 fails `counted-decreased`.
     - `generated` changes with every ČSÚ publication and is part of the hash, so the "same hash on 3 distinct fetches" condition never holds while ČSÚ keeps publishing.
     - Quarantine therefore never fires. The real results stay blocked until the real count exceeds N, which could be the whole night.
  2. **Replica lag.**
     - A conditional request with the stored ETag can land on a lagging ČSÚ replica and return 200 with an **older** body. That is `generated-backwards`, which counts as a rejection.
     - Each one sets `stale:true`, so every viewer sees an OFFLINE pill (`ElectionHeader.jsx:19`), and starts the 20→40→60 s backoff.
     - Worse, the lagging body hashes the same every time. Fetched 3 times, it is **quarantine-accepted**, which rolls viewers back. The next fresh replica rolls them forward again: flapping.
  3. **Genuine corrections during the count** (a precinct withdrawn). The hash changes every minute because `generated` and other precincts change, so quarantine never accepts.
- **Fix (spec §3.2, replace the rules and quarantine paragraphs):**
  > **Baseline.** Monotonic checks (counted, generated, votes) apply only when the good snapshot was refreshed at or after `POLLS_CLOSE` **and** `meta.base === CSU_BASE`. Otherwise the first valid post-14:00 candidate replaces it.
  >
  > **Older replica.** If `G(candidate) < G(good)`, the outcome is `older`:
  > - keep the good snapshot;
  > - do **not** set `stale`;
  > - do **not** back off (retry at the 20 s floor);
  > - do **not** invalidate the file cache;
  > - never count it toward quarantine.
  >
  > Log at info level. If `older` persists for 10 minutes, log at error level for a human.
  >
  > **Content regression.** If `G(candidate) ≥ G(good)` and `counted` or a party's votes decrease, the outcome is `rejected` with a reason. Quarantine accepts when the same reason has been rejected on ≥ 3 **distinct fetches** spanning ≥ 2 min. Hash equality is not required.
  >
  > `snapshotHash` (kept for logs and replay detection) excludes `generated` at every level, `fetchedAt`, `phase`, `missing`, `fetchId`, and all response meta.
- **Fix (Task 2/3 tests):**
  - a pre-14:00 baseline with counted = 50, then a post-14:00 candidate with counted = 0, is accepted;
  - an older `generated` gives `older` with `stale:false`, and after 5 repeats it is still not installed;
  - a counted regression repeated over 3 fetches spanning ≥ 2 min with advancing `generated` is accepted.

---

## HIGH

### H1. The refresher's `build` is undefined. Wrapping the existing feeds turns upstream failures into "fresh" successes.
- **Where:** plan Task 4 Step 3 (`build` = "existing handler body builder"); spec §3.1 and §3.2 order of operations.
- **What is wrong:**
  - `createKvFeed` and `createOverviewFeed` expose only `snapshot()`. That call **catches** build errors and returns the old `last` with `stale:true` (`feed.js:323-335`, `overview.js:147-159`, `api/_http.js:30-43`).
  - If the refresher's `build` calls `snapshot()` or `runHandler`, an upstream outage comes back as a valid, unchanged snapshot. The refresher records success: `stale:false`, a fresh `refreshedAt`, and a "data from N s ago" header that is false (S3, S7).
  - The plan also validates in two places: feed.js's `last` (Task 4) and the refresher (Task 3). After a cold start these diverge, because feed.js has `last = null` and accepts anything.
- **Fix (plan Task 4, replace the feed.js/overview.js bullet):**
  > Add `build()` to the object returned by `createKvFeed` and `createOverviewFeed`. It runs the inner build, **throws** on failure, and does not touch `last`. Keep `snapshot()` unchanged for Vercel (`api/*.js`).
  >
  > `createJsonCache` returns `getJson` with two extra functions:
  > - `getJson.invalidate(path)` deletes the `files` entry;
  > - `getJson.version(path)` returns a counter incremented on every HTTP 200.
  >
  > Feeds expose `invalidate()`, which invalidates their main files, and set `fetchId`: `${version(results)}.${version(turnout)}` for a council, or the sum of versions for the overview.
  >
  > The DO constructs feeds **directly**:
  > ```js
  > createKvFeed({ council, baseUrl: this.env.CSU_BASE || KV_BASE_URL, headers: { 'User-Agent': USER_AGENT } })
  > ```
  > It does not go through `runHandler`. The unknown-council 400 bypass (`worker.js:128`) stays as is.
  >
  > Validation lives **only** in `cloudflare/refresh.js`. On `rejected`, the refresher calls `feed.invalidate()`. Remove "validate-before-install inside feed.js".
- This also answers "how does `CSU_BASE` reach the feed". Today the handlers have no `env` (`api/volby.js:16-26`).

### H2. Edge TTL 0 while a refresh is in flight sends every request in every colo to the DO.
- **Where:** spec §3.3 (`clamp(nextRefreshAt − now, 0, 5 s)`); plan Task 4 test ("past `nextRefreshAt` → 0"); `cloudflare/worker.js:162` (`ttl > 0` gate, otherwise no `cache.put`).
- **What is wrong:**
  - During every refresh, which takes 1–12 s, the DO keeps answering with the old snapshot and a past `nextRefreshAt`. That gives TTL 0, so nothing is cached.
  - Every viewer request in every colo then reaches the DO. With thousands of req/s this is a DO stampede once per refresh cycle. The ~1,000 req/s soft limit (R8) gets hit, and the DO overloads exactly at publication time.
  - R6's claim that "each colo hits the DO every ≤5 s" is false during these windows.
- **Fix (spec §3.3 and plan Task 4 Interfaces):**
  > `edgeTtl({ nextRefreshAt, now, stale, phase }) = clamp(ceil((nextRefreshAt − now)/1000), 1, cap)`, where `cap = stale ? 5 : phase === 'final' ? 600 : phase === 'pre' ? 300 : 5`. The floor is **1 s**, not 0.
- **Test:** past → 1, 3 s → 3, 40 s → 5, stale with 40 s → 5, final with 400 s → 400. The plan's signature also lacks `phase` (see M1).

### H3. Client scheduling uses the client's clock against the server's absolute `nextRefreshAt`.
- **Where:** spec §3.4; plan Task 5 `nextPollDelay({ nextRefreshAt, now, … })`.
- **What is wrong:**
  - A desktop clock that runs 1–3 min fast sees every `nextRefreshAt` as already past. It then polls every 5–10 s forever, 6–12× the normal rate.
  - A clock that runs slow polls minutes late, which breaks S5 for that viewer.
  - With tens of thousands of viewers, a few percent with skewed clocks dominate the load.
  - The "před N s" age (S7) is wrong for the same reason.
- **Fix:** `reply()` is the single exit for both HIT and MISS (`worker.js:107-112`). Add the header `'x-server-now': String(Date.now())` there. The client keeps `skew = serverNow − Date.now()` from the last response, and passes `now = Date.now() + skew` to `nextPollDelay` and to the freshness helpers. Task 5 gets a test: "client clock +120 s with serverNow given → normal delay, not 5–10 s".

### H4. The validator is tested at the wrong layer. An upstream `{}` or `[]` becomes a plausible snapshot.
- **Where:** plan Task 2 Step 1 ("rejects `{}`, `[]`, `null`, string"); plan Review Focus 3; spec §3.2 ("missing required top-level collections").
- **What is wrong:**
  - The refresher validates the **normalized** snapshot, not the upstream body.
  - `normalizeResults` defaults everything (`json.prehled || []`, `json.vysledky || []`, `feed.js:55-57`, `:71`, `:103`). An upstream `{}` therefore yields `parties: []`, `generated: null`, `counted` from the turnout file, and `total` from config.
  - Before the count starts (all votes 0), the "votes drop to 0" rule cannot trip, so an empty party list is published.
  - In the overview, one council's `{}` empties that council's summary (`overview.js:118`).
  - HTML or truncated bodies already throw in `res.json()` (`feed.js:205`), so those cases are fine.
- **Fix (spec §3.2, add to the reject list):**
  > `generated` null; `parties.length === 0`; `parties.length < good.parties.length`; `Object.keys(okrsky).length < good` (council); for the overview, any council summary with `parties.length === 0` or fewer parties than in the good snapshot.
- **Fix (Task 2 tests):** produce candidates by running `createKvFeed` and `createOverviewFeed` with a fake `fetchImpl` that returns `{}`, `[]`, `"<html>"` and a truncated `'{"prehled":['`, then assert the outcome.

### H5. The S1 grep test (Task 5 Step 4) cannot be implemented as described, and it conflicts with Task 6.
- **Where:** plan Task 5 Step 4; plan Task 6 Step 3 (link `https://www.volby.cz/`); spec S1.
- **What is wrong:**
  - "References `volby.gov.cz` … in a runtime fetch path" is not something grep can check.
  - The string appears legitimately in seven `src/` files: comments and attribution text in `feed.js:1`, `:9`, `:29`, `:126`, `:157`, `:177`, `:322`; `ElectionHeader.jsx:208`, `:214`; `Landing.jsx:494`, `:514`; `CouncilApp.jsx:419`; `changelog.js:85`.
  - Task 6, running in parallel, adds `volby.cz` to `ElectionHeader.jsx`, so the merge breaks `npm test`.
  - A Sonnet implementer will either strip the attribution text (scope creep) or write a test that checks nothing.
- **Fix (replace Task 5 Step 4):**
  > `src/no-direct-csu.test.js` asserts, by reading files:
  > 1. No file under `src/hooks`, `src/pages`, `src/components` or `src/lib` imports `createKvFeed`, `createOverviewFeed`, `createJsonCache` or `KV_BASE_URL`.
  > 2. `useLiveResults.js` contains no `.direct(`.
  >
  > Add a CI step after `npm run build`: `! grep -rl "appdata/kv2026" dist/assets`. This is the actual S1 check on the shipped bundle.

### H6. Staging and drills run on the production-named Worker and can poison its persisted DO snapshot.
- **Where:** plan Task 8 Steps 2, 4, 5; spec §4 "Test hook".
- **What is wrong:**
  - Staging is the same script, `pirati-volby-zaloha`, and therefore the same DO namespace and storage that becomes production at Step 6.
  - A drill or mock that returns **data** (for example counted > 0 to exercise the counting path) persists that snapshot.
  - Under monotonic validation, the real post-14:00 data is then rejected as `counted-decreased`. Viewers see fake numbers.
  - Step 5's `wrangler deploy` with an overridden `CSU_BASE` on that script also risks a forgotten restore.
- **Fix:**
  - Spec §3.1: persist `meta.base = CSU_BASE` and `meta.schema = 1`. On rehydrate, discard the snapshot if either differs. The C4 baseline rule then also drops pre-14:00 baselines.
  - Plan Task 8 Step 5, replace with: "Failure and cadence drills run **only** under `wrangler dev` (local DO storage in `.wrangler/`) or on a separate `--name pirati-volby-zaloha-drill` Worker; never `wrangler deploy` with an overridden `CSU_BASE` on `pirati-volby-zaloha`."

### H7. Two cheap guards against the upstream repo and the author's Cloudflare account are missing.
- **Where:** plan Global Constraints; Task 1; Task 8 Step 1.
- **What is wrong:**
  - **Upstream remote can be pushed.** `git remote -v` shows `upstream … jsemfast/pirati-vysledky-2026.git (push)`.
  - **`gh pr create` can target the author.** In a fork, `gh pr create` defaults the base to the **parent** repo unless a default repo is set. The new CI workflow encourages PRs.
  - **Wrangler still points at the author's account.** Until Task 8, `cloudflare/wrangler.jsonc:6-7`, `:15` still carry the author's `account_id 9650f76e…`, Worker name `pirati-vysledky-2026` and KV id.
  - Any accidental `wrangler deploy` before Task 8, made with credentials that can reach that account, would overwrite the **author's production**.
- **Fix (new Task 1 Step 0, all reversible):**
  ```sh
  git remote set-url --push upstream DISABLED-never-push-upstream
  GH_TOKEN=$(gh auth token --user vasek24) gh repo set-default vasek24/pirati-vysledky-2026
  ```
  - Every `gh` command also passes `--repo vasek24/pirati-vysledky-2026`.
  - Move Task 8 Step 1's **text edits** (`account_id` → `741febb7a315a409b83e5a9a1b62954d`, `name` → `pirati-volby-zaloha`, remove the author's KV id) into Task 1. Leave the `kv namespace create` in Task 8.

### H8. The timeline does not fit 12:30.
- **Where:** plan "Merge order and parallelism".
- **What is wrong:**
  - The critical path is Task 1 → 2 → 3 → 4 → Codex pass → Task 8 (staging, burst, drill, domain).
  - Each task needs a fresh worktree plus `npm ci` (with `sharp`, a native module), a Sonnet implementation, an Opus review and a merge.
  - At 09:36 that is optimistically about 4 h to production, and it lands the DO rewrite close to 14:00. A late deploy is exactly the cold-start risk of R5/R9.
- **Fix (add a "12:30 cut" to the plan):**
  - **Phase 1a, live by 12:30:**
    - H7 guards;
    - deploy.yml `push` trigger removed;
    - wrangler account/name swap plus KV create;
    - Task 7 contact files;
    - Task 6 Step 4 only (no visible-tab reload);
    - Task 5 limited to removing `direct`/`goDirect` (keep today's 60 s ± 15 % scheduler);
    - `worker.js:150` 502 path → 503 JSON.

    The existing code already coalesces upstream in one DO per feed. Deploy it, attach the domain, smoke-test.
  - **Phase 1b:** Tasks 2–5 (refresher, edge clamp, scheduler, freshness UI).
    - If it is not reviewed and staged by **13:30**, it waits for a quiet window after the count peaks.
    - Code freeze for `cloudflare/` and `src/volby/` from 13:30 to about 18:00, except critical fixes.
  - Task 1's CLAUDE.md and CI workflow are not on the critical path. Do them in parallel or after.

---

## MEDIUM

**M1. `edgeTtl` signature lacks `phase`, and the client gets browser caching.** Plan Task 4 says `edgeTtl(nextRefreshAt, now, stale)` should "return the existing longer TTLs outside counting", which is impossible without `phase`. It also changes the client header to `public, max-age=<ttl>`. Today it is `max-age=0` (`api/_http.js:22-24`). With a browser `max-age`, the client's 5–10 s retry can be answered from the browser cache.
- **Fix:** the H2 signature, plus `Cache-Control: public, max-age=0, s-maxage=<ttl>`. Drop `stale-while-revalidate` and `stale-if-error`.
- The DO computes this header. The Worker keeps using `sMaxAge()` (`worker.js:105`, `:161`) and never has to parse the body.
- Use the refresher's phase, not `body.phase`. After 14:00, `cdnMaxAge('pre')` returns its 10 s minimum (`_http.js:10`).

**M2. "Full jitter" retry can be about 0 s and hammer a failing ČSÚ.** This contradicts spec §3.1 "not hammered". Test 5 only pins `random()=1`.
- **Fix:** `retry(n) = 20 s + random · (min(60 s, 20 s·2^(n−1)) − 20 s)`. That is 20 s, then 20–40 s, then 20–60 s; with `random=1` it is 20/40/60, so test 5 still holds.

**M3. `fetchId`, distinct-fetch and invalidate have no interface.** Task 3 test 7 assumes `snapshot.fetchId`, but no task says how feed.js produces it.
- **Fix:** see H1 (`getJson.version`, `invalidate`). Define a distinct fetch as `fetchId !== quarantine.lastFetchId`.

**M4. The "seed precinct votes from the persisted snapshot" step cannot work as written.** The feed's precinct map is keyed by `sig`, a hash of `r.slice(1,9)` of the turnout row (`feed.js:106`, `:287`). The snapshot does not carry it (`:293-299`). Seeding votes with any other `sig` triggers a re-fetch. A seeded entry whose votes match the file is treated as "probably still the old version" for 5 attempts (`:259-263`).
- **Fix:** drop the seeding and use the C3 merge in the refresher. Accept the background re-download on cold start.
- Correct the scale (see L1): the largest single tree is Praha 4 with 132 files.

**M5. Re-serializing the whole snapshot per DO request costs CPU.** The Magistrát snapshot has candidates for every list, about 1,400 rows, so a JSON parse and stringify per request is milliseconds of single-threaded DO CPU.
- **Fix:** keep the persisted body as a string and splice in meta:
  ```js
  '{"refreshedAt":…,"nextRefreshAt":…,"servedAt":…,"stale":…,"complete":…,' + body.slice(1)
  ```

**M6. The Vitest config in Task 1 Step 2 can pick up foreign tests.** `exclude: ['node_modules','dist','cloudflare/node_modules']` replaces Vitest's default `**/node_modules/**`, and bare names do not match nested files.
- **Fix:**
  ```js
  import { defineConfig, configDefaults } from 'vitest/config';
  export default defineConfig({ test: { environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js', 'cloudflare/*.test.js'],
    exclude: [...configDefaults.exclude] } });
  ```
- Use `vitest@~3.2` (first line with a Vite 7 peer) and the script `"test": "TZ=UTC vitest run"`.

**M7. The Task 2 fixture source does not exist.** `scripts/` has no fixtures (`build-data.js`, `verify-2022.js`, `lib/util.js`), and a "test run" snapshot is not available.
- **Fix:** hand-write minimal ČSÚ-shaped raw JSON using the layouts documented at `feed.js:47-53` (results), `:98-100` (turnout) and `:116-117` (precinct). Commit them under `src/volby/__fixtures__/`. Produce candidates via `createKvFeed({ fetchImpl })`. This also serves H4.

**M8. Task 6 and Task 7 collide on `Landing.jsx`, and council pages have no footer.**
- The only `<footer>` is in `Landing.jsx:513-516`. Task 6 edits the "contrast of last-updated text" in the same block (`:514`), and Task 7 adds the credit line there.
- `CouncilApp.jsx` has no footer, so §7's footer line would never appear on council pages.
- **Fix:** Task 7 owns `Landing.jsx:494-516` and adds the same line next to `CouncilApp.jsx:419` (the "Zdroj: ČSÚ" note). Task 6 must not touch those lines.

**M9. The overview `waitMs` equals the 12 s deadline,** so the refresher's deadline races the overview's own wait. Spec §3.1 says "≤ 12 s".
- **Fix:** "`waitMs = 8000` (deadline − 4 s)".

**M10. The Task 8 burst and staging checks before 14:00 exercise only edge hits.** In the `pre` phase the edge TTL is up to 300 s and the DO refreshes every 5 min. A 60 s burst never touches the counting path, the refresh cadence or H2.
- **Fix:** run the cadence and stampede check locally with `wrangler dev` and a local mock. The mock returns `counted > 0`, so the phase is `counting` regardless of the clock, and advances `generovano` every 60 s. Keep the staging burst only for status codes and latency.

**M11. The Worker serves the last-resort copy only when the DO throws** (Task 4 Step 3). A DO answer of 503 (cold, no snapshot, upstream down) or any 5xx should also fall back to the last-resort copy.
- **Fix:** "if DO throws **or** `out.status >= 500`".

**M12. Deploy-safe reload has two holes** (spec §3.5).
- **Hidden tabs never reload.** "Hidden tabs keep today's reload … spread by each tab's own 5-minute check" is wrong: `useUpdateCheck.js:31-33` only checks while the tab is visible.
- **A tab that shows the button is never reloaded later.** If it then goes hidden, the reload effect does not re-run, because its deps are `[newVersion, reloadedFor]` (`UpdateManager.jsx:86-114`).
- **Fix:** on election night, if `newVersion` is pending, reload on the `visibilitychange` → hidden transition. Extract `shouldAutoReload({ hidden, electionNight })` as a pure function so S6 is testable without jsdom.

---

## LOW

- **L1.** Spec §3.1 says "up to ~1,100 precinct files for the Magistrát tree". That is wrong. Magistrát has `precinctFiles: false` (`src/councils.js:224-227`) and fetches none. About 1,100 is the sum across all 57 district DOs; the largest single tree is Praha 4 with 132 (`councils.js:32`).
- **L2.** Spec §3.3 says to wrap the Analytics writes, but `track()` is already wrapped in try/catch (`worker.js:67-80`). The Task 4 item is a no-op; drop it.
- **L3.** Spec §3.1 lists `etag` among the persisted keys and two bullets later says "store no single `etag`". Remove it from the list.
- **L4.** Spec §3.2's "council identity (`zastup`) differs" check can never fail. `zastup` is copied from config (`feed.js:305`), not read from upstream. Drop it, or read it from the upstream JSON if ČSÚ includes it.
- **L5.** The "non-finite numbers" check can never trip either. `num()` coerces to 0 (`feed.js:22-25`). The real hazard is zeros and empties, which H4 covers.
- **L6.** The 1.5 MB size guard must measure UTF-8 bytes (`new TextEncoder().encode(s).length`), because Czech names are multi-byte. Persist snapshot and meta in one `storage.put({ snapshot, meta })` so they cannot diverge. The size-skip path must skip both.
- **L7.** Stale leftovers after Task 5:
  - `ElectionHeader.jsx:305` `live.source === 'direct'` and its "přímo z ČSÚ" text;
  - the `worker.js:150` comment "klient po 502 přepne na přímé čtení".
- **L8.** The Task 6 ČSÚ link `https://www.volby.cz/` points at the legacy site. The app's data source is `volby.gov.cz`; link its KV 2026 results page instead. It is a plain `<a>`, so it is allowed under S1 once H5 is applied.
- **L9.** There are two 14:00 spread mechanisms: the DO caps `pre` at 14:00 and the client adds its 0–25 s offset, while §3.4 adds `wakeDelay` 0–60 s. Pick one. Recommended: offset only, and drop `wakeDelay`.
- **L10.** S2 still says "verified by a load test against a mock upstream", but §5 replaced that with the pure-module test. Align the wording.
- **L11.** Spec §4 says the bug-report UI is hidden, but no plan task does it.
  - The endpoint already fails closed: it returns 503 before any KV write (`api/bug.js:113-115` precede `storeScreenshot` at `:133`).
  - `BugReportWidget` still renders.
  - Add one line to Task 6.
- **L12.** Task 8 Step 3 should also `curl -fsS <staging>/.well-known/security.txt /humans.txt /kontakt.txt`. Confirm that the dot-directory is uploaded as an asset.
- **L13.** Task 4 Step 4 in a fresh worktree needs `npm ci --prefix cloudflare` before `npx wrangler deploy --dry-run`. Otherwise `npx` fetches an unpinned wrangler.
- **L14.** In `DurableObjectState`, `ctx.waitUntil` exists but is documented as having no effect. Binding it is harmless. The background refresh survives because the DO stays alive with pending I/O, which the current code already relies on (`worker.js:8-9`). Add a comment saying so, so no one "fixes" it.
- **L15.** Rehydration must be single-flight: memoize a `loadPromise`, or use `ctx.blockConcurrencyWhile` in the constructor. Add a test: "two concurrent `get()` on a fresh instance with a persisted snapshot → one storage read, no build".
- **L16.** Freshness: `ageSeconds` must use `parseCsuTime` plus the H3 skew, and clamp at ≥ 0.

---

## 1. Spec vs code: verified claims

| Claim (spec/plan) | Code | Status |
|---|---|---|
| JSON paths `vysled/1100/<z>.json`, `ucast/obec/…`, `vysled/okrsek/…` at `feed.js:16-20` | `feed.js:16-20` | OK |
| Praha 9 = 500216, Magistrát = 554782 | `councils.js:37`, `:28` | OK |
| `Feed` DO is SQLite-backed, `wrangler.jsonc:19-22` | `:19-22` | OK |
| Worker routes one DO per normalized feed, `worker.js:121-149` | `:121-148`; DO name = `path.slice(5)` → `volby?z=<z>` / `prehled` | OK |
| `createJsonCache` stores the parsed body before any check (`feed.js:206`); `build()` sets `last` (`:317`); overview `:140` | yes | OK |
| Per-file ETag/Last-Modified kept in `createJsonCache` | `feed.js:189-191`, `:206-211` | OK |
| 8 s per-file timeout; `minIntervalMs` 20 s | `feed.js:165`, `:164`; `api/volby.js:21` | OK |
| Overview `waitMs` 20 s | `overview.js:105` | OK |
| `generated` = max of ČSÚ `generovano` | `feed.js:307` (string sort), `overview.js:81` | OK, but zone-less local time (C1) |
| `precincts.counted` / `total` | `feed.js:61`, `:310-314`; `overview.js:84` | OK |
| `zastup` in the council snapshot | `feed.js:305`, a **Number** from config, absent in the overview | OK (L4) |
| Cold build can be partial (`votes:null`, partial overview) | `feed.js:289`, `:298`; `overview.js:135-143` | OK, but also the **steady state** (C3) |
| "~1,100 precinct files for the Magistrát tree" | Magistrát `precinctFiles:false` (`councils.js:227`) | **WRONG** (L1) |
| Analytics writes need wrapping | already wrapped (`worker.js:67-80`) | **Stale claim** (L2) |
| `isElectionNight()` at `UpdateManager.jsx:19-20` | yes, module-local (not exported); window 12:00 Sat to 24:00 Sun | OK |
| Hidden tabs reload at `:99-101`, "spread by 5-min check" | the reload exists, but hidden tabs never check (`useUpdateCheck.js:31-33`) | **WRONG** (M12) |
| `POLLS_CLOSE` +02:00, `KV_DATE` at `councils.js:11-14` | `:11`, `:14` | OK |
| `format.js` hard-codes +02:00 | `format.js:25` | OK; must be reused server-side (C1) |
| Copy fixes at `CouncilApp.jsx:123`, `WelcomeGuide.jsx:65`, `changelog.js:85` | `CouncilApp.jsx:122-123`, `WelcomeGuide.jsx:65`, `changelog.js:85` | OK |
| Two browser direct constructors | `useLiveResults.js:44`, `:59-65`; `goDirect` `:230-254` | OK |
| Plan line refs (Task 4: `worker.js` 83-172; Task 5: 35-66, 150-156, 195-206, 345-352, 27; Task 6: `UpdateManager` 19-20, 83-114; `ElectionHeader` 16-44, 237-324) | match | OK |
| Bug endpoint fail-closed without `GITHUB_TOKEN` | `api/bug.js:113-115` | OK |
| "app footer component (grep footer)" | only `Landing.jsx:513` | Partial (M8) |

## 2. Plan executability by task

- **Task 1:** executable. Fix M6 (Vitest config) and H7 (guards). The ESLint part already covers `cloudflare/**` via `**/*.{js,jsx}`; only test files need `globals.node`.
- **Task 2:** blocked on the fixture source (M7) and the wrong layer (H4). C4 changes the interface: the outcome becomes `{ ok, outcome: 'ok'|'older'|'rejected', reason }`.
- **Task 3:** executable with fake timers. Needs the C1, C3 and C4 test rewrites, M2, and L15. The `storage` interface maps 1:1 to SQLite-DO `ctx.storage.get/put` (KV API supported on SQLite-backed DOs).
- **Task 4:** the riskiest. As written, a Sonnet agent must invent `build`, `fetchId`, `invalidate`, `CSU_BASE` plumbing and `edgeTtl`'s phase. H1 and M1 give the missing interfaces. The Worker is not unit-testable (`cloudflare:workers` import), so C2 and H2 need explicit staging checks.
- **Task 5:** executable. Needs H3 (skew) and the H5 test rewrite. With Task 4 absent, the `nextRefreshAt`-absent fallback of 60 s ± 15 % is a safe default, so it really is parallelizable.
- **Task 6:** executable. Needs M8 (Landing ownership), M12 (pure reload predicate), L7 and L11.
- **Task 7:** executable after M8.
- **Task 8:** needs H6, H7 (move the text edits earlier), M10 and L12.

**Merge conflicts:**
- Task 4 changes feed.js/overview.js while Task 5 removes their browser imports. There is no textual overlap, as long as Task 4 keeps `snapshot()` and exports (H1).
- Task 6 and Task 7 overlap on `Landing.jsx` (M8).
- Task 5 and Task 6 conflict through the grep test (H5).

## 3. Correctness under the stated scenarios

| Scenario | Findings |
|---|---|
| Stall | C3 (complete), C4 (quarantine never fires), C1 (10-min cadence) |
| Starvation / stampede | H2 (TTL 0) |
| Double refresh | single-flight is fine; rehydrate race L15 |
| Wrong-phase TTL | M1 (use refresher phase, not `body.phase`) |
| Wrong body cached | C2 |
| Stale-flag leak | C4 (older replica → OFFLINE) and H1 (opposite: failure shown as fresh) |
| Overview | M9, H4 (per-council emptiness), C3 (`missing`) |

The 58 subrequests per refresh are well within the paid per-invocation limit, and concurrency is limited by the 6-connection cap.

**Time and the 14:00 boundary:**
- C1 covers `generated` parsing.
- The 14:00 cap combined with the client offset is enough; see L9.
- C4(1) covers test data before 14:00.

## 4. Safety

- **Upstream repo and author's account:** H7.
- **Production DO poisoning:** H6.
- **Order of checks before production:** Task 8 deploys to the production-named script before the checks, but it is only reachable on workers.dev until Step 6, which is acceptable.
  - After Step 6, every deploy is a production deploy.
  - Preview URLs are not available for Workers that use Durable Objects, so add a `env.staging` (separate script name) in `wrangler.jsonc` for post-launch changes.
  - Keep "tests + lint + build green, previous version id recorded" as a hard gate in the runbook.
- **Secrets:** no secret is committed or exposed. `GH_TOKEN` is per-command. `GITHUB_TOKEN` is never set. The phone number is intentionally public.
- **Destructive commands:** none in the plan. Step 6's "do not delete an existing DNS record; stop and report" is correct.
- **Rollback:** a rollback across a storage-schema change should be tolerated. The H6 `meta.schema` check handles that.

## 5. Test gaps against S1–S8

| Criterion | Gap and missing test |
|---|---|
| **S1** | Task 5's test does not check the shipped bundle. Add the `dist/assets` grep (H5). |
| **S2** | Task 3 test 2 is a single instant. Add: simulated 5-minute counting run, ČSÚ publishing every 60 s, 50 `get()`/s → `build` calls ≤ ceil(300/20) and ≥ 5; ČSÚ unchanged → about 1 per 20 s. |
| **S3** | Add an upstream `{}`/`[]` normalized through the real feed (H4). Add "failure is reported as `stale:true`" through the real feed's `build()` (H1). |
| **S4** | Add: rehydrate rejects on `meta.base` or `meta.schema` mismatch (H6); concurrent cold `get()` (L15). |
| **S5** | Add: `nextRefreshAt` from a zone-less `generated` under TZ=UTC (C1); `edgeTtl` floor 1 s (H2); client skew (H3). |
| **S6** | No test at all. Add a pure `shouldAutoReload` test (M12). |
| **S7** | Add: freshness with skew; `ageSeconds` clamp ≥ 0 (L16). |
| **S8** | Covered (Task 7). Add the live asset curl (L12). |
