# mesta spec + plan — adversarial review r1 (Opus)

Reviewed: `docs/superpowers/specs/2026-10-10-mesta-design.md` and `docs/superpowers/plans/2026-10-10-mesta.md`
at `b309e34` (branch `mesta/design`), against the code in the same worktree. Every claim below was
checked against the files cited; claims marked **(verified)** were reproduced in a throw-away clone
in the scratchpad (`git clone` of this worktree + symlinked `node_modules`, `npx vite build`, nothing
deployed, no network).

## Verdict: APPROVE-WITH-CHANGES

The architecture holds up: no Prague source file needs editing, the Vite module swap catches every
import, and the Worker can reuse Prague's pure modules without a swap. But the plan cannot be
dispatched as written:

- **C1** makes success criterion M1 impossible to meet as defined. The guard would fail on its
  first run. Our own spec/plan commit already changes Prague's build output.
- **H1–H5** are defects that a Sonnet implementer following the task text literally would build
  in, or would get stuck on.

Fold C1 and H1–H5 into the spec/plan **before** dispatching T1–T7. MEDIUM items can be fixed
during review of the task diffs.

Note: the worktree is **not** "main as of today". `mesta/design` branches from `1802816`, while
`main` is 11 commits ahead (`889d50f`). Those commits change `vitest.config.js` (now includes
`scripts/**/*.test.js`) and the comment line of `cloudflare/wrangler.jsonc`. They also add the
probe in `docs/analysis/mesta-registry-extract/{analyze,load,report}.py,*.tsv`. Rebase the design
docs onto `main` before creating `mesta/main`.

---

## CRITICAL

### C1 — M1 "byte-identical Prague build" is unattainable; Tailwind v4 scans the whole repo (spec §1 M1, §3.1 guard; plan T5 step 5, T8)

**What is wrong.** `src/index.css:1` is `@import "tailwindcss";`. It has no `source(...)` and no
`@source not`, so Tailwind 4.3.3 uses automatic source detection. That scans every file in the
repo that is not gitignored: docs, JSON, scripts and `src/mesta/**`. Any new class-like token
anywhere in the repo adds a CSS rule to **Prague's** `index-*.css`. The CSS hash then changes the
hashes of the JS chunks that import it, and `index.html` with them.

**Evidence (verified).**
1. Building Prague twice from the same tree gives identical `dist/` (vite is deterministic).
2. `1802816` → `b309e34` changes **docs only** (spec + plan). Prague `dist/` differs in 7 files:
   `index-*.css`, `index-*.js`, `CouncilApp-*.js`, `ElectionHeader-*.js`, `Landing-*.js`,
   `ResultsMap-*.js`, `index.html`. The design commit alone already fails the proposed guard.
3. Each of these changes Prague `dist/` when added on its own:
   - `src/mesta/X.jsx` with one new arbitrary class → the rule appears in Prague's CSS;
   - a `.md` file under `docs/` with a new token;
   - a JSON file under `public-mesta/data/`;
   - a `.js` file under `scripts/`.
4. Untracked files that are not gitignored (for example `dist-mesta/` before T5 adds it to
   `.gitignore`) are scanned too. So a guard that builds HEAD in the working tree is flaky.
5. This review file is a `docs/` file and will change Prague CSS on this branch as well.

**Consequences.**
- `check:prague` fails on every merge, which tempts someone to weaken it under time pressure.
- Once `mesta/main` reaches `main`, any Prague redeploy from `main` ships different CSS and chunk
  hashes. That is functionally harmless (extra unused utilities), but it breaks the owner's
  "not a byte" constraint.

**Smallest fix.** Replace M1 and the guard with this definition: **"Prague build inputs are
unchanged and the Prague build from those inputs is byte-identical."**

1. **T5: do not edit root `package.json`.** Run the mesta build as `npx vite build -c
   vite.mesta.config.js` from `cloudflare/package.json` scripts or the runbook. Root
   `package.json` is scanned by Tailwind and is a Prague build input.
2. **Path check in `scripts/check-prague-unchanged.sh`.** Fail unless every path in
   `git diff --name-only "$base" HEAD` matches this allow-list:
   ```
   ^(src/mesta/|public-mesta/|docs/|scripts/mesta-|scripts/build-data\.js$|vite\.mesta\.config\.js$|cloudflare/(mesta|wrangler\.mesta)|cloudflare/package\.json$|\.github/workflows/mesta\.yml$|\.gitignore$|eslint\.config\.js$|CLAUDE\.md$)
   ```
   An allow-list is safer than the forbidden-list regex.
3. **Byte check in the same script.** For `rev` in `base` and `HEAD`:
   - export the tree into a fresh `mktemp -d` with `git archive "$rev" | tar -x -C "$dir"`. This
     builds from a clean tree, not the working tree.
   - in **both** exports, delete the non-Prague paths:
     `rm -rf docs src/mesta public-mesta scripts/mesta-* vite.mesta.config.js cloudflare/mesta* cloudflare/wrangler.mesta.jsonc`
     and every `*.md` outside `src/`.
   - run `npm ci`, `npx vite build`, then in `cloudflare/`: `npm ci` and
     `WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir`.
   - compare the `sha256` lists of `dist/` and of the dry-run directory.
4. **Spec §9 and plan T8.9:** "Do not merge `mesta/main` into `main` before the election night
   ends. Prague redeploys tonight come from `main` without mesta." Add one line to the runbook:
   any repo file, docs included, changes Prague's Tailwind CSS.

The alternative would be `@source not "./mesta"` in `src/index.css`. That edits a Prague file and
does not cover `docs/`, so it is rejected.

---

## HIGH

### H1 — The publish gate leaks; hidden towns still show their attribution, and `reviewedAt` un-hides Codex blockers (spec §5 "Publish gate", §6.2 triage; plan T2, T9 step 2)

**What is wrong.**
- The gate hides low-confidence towns only from the index, search and featured block. The town
  page still uses `council.pirates`, which drives:
  - the Hemicycle highlight (`CouncilApp.jsx:416`);
  - the tab title "Piráti x %" (`CouncilApp.jsx:246`);
  - `model.ours` and the "Pirátská kandidátka" label (`Councilors.jsx:144`);
  - the CoalitionHero.
- The swapped `ElectionHeader` menu lists every council in `COUNCILS`, hidden towns included
  (`ElectionHeader.jsx:158` `COUNCILS.filter((c) => c.pirates)`, `:178` for type c). So a hidden
  town is one tap away, with the doubted attribution fully rendered.
- `shownOnIndex` turns true for **all** towns once `overrides.reviewedAt` is set (spec §5, plan T2
  test). T9 neutralizes Codex blockers with override `confidence:'low'`. A single global
  `reviewedAt` therefore publishes the very towns Codex flagged, even though nobody fixed them.

**Fix.**
- **(a)** In `buildCouncils`, when `!shownOnIndex`, set `pirates: null` and
  `pirateCandidates: []`. The page then shows neutral results plus the "ověřujeme" banner.
- **(b)** `src/mesta/councils.js` exports `COUNCILS` as shown towns only (this drives the menu and
  the UI) and `ALL_COUNCILS` for the Worker, `SHARDS` and the data build.
- **(c)** Use this rule:
  ```
  shownOnIndex = o.confidence === 'low'
      ? o.reviewed === true
      : (confidence !== 'low' || !!overrides.reviewedAt || o.reviewed === true)
  ```
  An override-level low (a Codex finding) then needs a per-town `reviewed: true`. Add T2 tests for
  all three cases, and a T6 test that a hidden town is absent from the featured rows.

### H2 — Changing a shard's composition leaves stale towns in its DO forever (spec §3.3 shards, §4.3 overrides; plan T1 `assignShards`, T4)

**What is wrong.** `mergeOverview` copies every summary that is in the good snapshot but missing
from the candidate (`src/volby/validate.js:41-49`: `if (!c || …) { councils[z] = g; copied++ }`).
This applies after 14:00, once `baselineApplies` holds.

Shards are near-equal chunks of the towns sorted by name (`assignShards`). Adding or removing one
town therefore moves the chunk boundaries for the rest of its region, and that happens tonight in
several ways:
- the owner includes some of the 8 pending borderline towns;
- `include:false` for a town without `lists.json` (spec §7);
- generator fixes after Codex.

After such a change, the old DO `kraj?s=21-1` keeps serving frozen summaries of towns it no longer
fetches. The featured towns are also in two shards, so the UI can show the older copy.

**Fix.**
- **(a)** Name the DO after the composition: `doName = 'kraj?s=<id>&h=<first 8 hex of sha1(sorted zastups)>'`
  in `mestaWiring.feedTarget`. The edge cache path `/api/kraj?s=<id>` stays the same; its TTL is
  only 1–5 s. A re-shard then starts a fresh DO, which the cron warms.
- **(b)** `ShardFeed` keeps only `snapshot.councils[z]` for `z ∈ SHARDS[id].zastups`.
- **(c)** `indexModel.pickSummary(a, b)` takes the newer `parseCsuTime(generated)`. Use it for
  the towns that are both featured and in a region shard.
- Add tests for (a) and (c).

### H3 — Open tabs never pick up a mesta redeploy; version and changelog are Prague's (spec §3.1; plan T5)

**What is wrong.**
- `useUpdateCheck.js:22` reloads only when `/version.json` differs from `APP_VERSION`. Both come
  from Prague's `src/changelog.js` (`vite.config.js` `versionJson`). A mesta redeploy never changes
  them.
- Any redeploy tonight (owner review un-hiding towns, hiding a mis-attributed town, a re-shard, a
  patch fix) never reaches open tabs. Those tabs keep the old town list and gate state all night,
  and keep polling removed shard ids (→ 400 → backoff).
- Mesta users also get Prague's "Co je nové" changelog (`ElectionHeader` → `openChangelog`).

**Fix, in `vite.mesta.config.js`:**
- `swapModules` also redirects `src/changelog.js` to `src/mesta/changelog.js`. That file exports
  `APP_VERSION = 'mesta-' + <short sha of towns/specifics/overrides JSON + git HEAD>`, injected
  through `define`, plus a one-entry `CHANGELOG`.
- Drop the base plugin: `plugins: base.plugins.filter((p) => p?.name !== 'version-json')`. Emit
  your own `version.json` carrying that same `APP_VERSION`. Without the filter, `mergeConfig`
  keeps both emitters.
- Add a test that the version is in the built `dist-mesta/version.json` and in the bundle.

### H4 — Two Vite plugin-order defects in T5; following the plan literally fails the build (plan T5 step 3)

**Evidence (verified in the scratch clone).**
- **`mestaPatches.transform` without `enforce: 'pre'`** sees `CouncilApp.jsx` *after* the
  esbuild/oxc JSX transform. The anchor `{!council.pirates && <PirateCandidates model={model} />}`
  is then found **0** times, and the "match exactly once" rule throws. With `enforce: 'pre'` it is
  found 1 time.
- **`transformIndexHtml` with the default order** runs after Vite has parsed the entry script. The
  build then bundles **Prague's `src/main.jsx` and `Landing`**, still with swapped councils, and the
  `/src/main.jsx` replacement matches nothing. With `order: 'pre'` only `src/mesta/main.jsx` is
  bundled and the `Landing` chunk is gone.

**Replacement text for T5 step 3:**
> `mestaPatches()` returns `{ name: 'mesta-patches', enforce: 'pre', transform(code, id) {…}, transformIndexHtml: { order: 'pre', handler(html) {…} } }`.

What already works:
- `swapModules` with `enforce: 'pre'` plus `this.resolve(…, { skipSelf: true })` catches **all 12
  importers** of `src/councils.js`, including both spellings (`'../councils'` and
  `'../councils.js'`) and `src/volby/{feed,overview,model,council}.js`.
- `dist-mesta/assets` has no `appdata/kv2026`. (verified)
- Prague's 58-council registry is still bundled as dead code through `src/mesta/councils.js`
  re-exporting from `'../councils.js'` (LOW, L1).

### H5 — The CI change runs on every branch and compares against the wrong base (plan T5 ci.yml; spec §3.1)

**What is wrong.**
- `.github/workflows/ci.yml:3-7` runs on all pull requests and on pushes to every branch except
  `main`. Adding `npm run build:mesta` and `check-prague-unchanged.sh origin/main` to it means:
  - every legitimate Prague hotfix branch fails the guard by design;
  - every branch without `src/mesta` fails `build:mesta`.
- Passing `origin/main` compares HEAD with **main's tip**, not the merge-base. `main` already
  differs (for example `cloudflare/wrangler.jsonc`, 11 commits).
- The job's `timeout-minutes: 15` is tight once the guard adds its own `npm ci` and builds on top
  of CI's.

**Fix.**
- Leave `ci.yml` untouched.
- Add `.github/workflows/mesta.yml`:
  - triggers: `on: push: branches: ['mesta/**']` and `pull_request` filtered with
    `if: startsWith(github.head_ref, 'mesta/')`;
  - checkout with `fetch-depth: 0`, and `timeout-minutes: 30`;
  - steps: build mesta, grep `dist-mesta`, then
    `bash scripts/check-prague-unchanged.sh "$(git merge-base HEAD origin/main)"`.

---

## MEDIUM

### M1 — The T5 patch test contradicts the patch list (plan T5 step 1 vs spec §5 Patches)

Spec §5 replaces only the condition `{!council.pirates && !council.pirateCandidates.length && (`
with `{false && (`. The sentence "V této městské části Piráti letos nekandidují…"
(`CouncilApp.jsx:388`, unique) stays in the code. The T5 test "patched CouncilApp contains … no
`V této městské části`" therefore fails.

**Fix:** add the patch `V této městské části Piráti letos nekandidují` →
`Piráti tu letos nekandidují`, or change the test to assert that the condition anchor is gone.
All other anchors were verified to occur exactly once:
- CouncilApp: 5 anchors;
- WelcomeGuide: 2 anchors;
- ElectionHeader: 1 anchor;
- `index.html`: `/src/main.jsx` and `<title>`.

For later Prague edits, R3 holds: the build throws on an anchor miss, which is the right
behaviour.

### M2 — Coalition lists labelled "Piráti" in the shared UI (spec §5 Town page; §6)

- `CouncilApp.jsx:246` sets the tab title to `· Piráti ${fmtPct(model.ours.share)}` for any
  `council.pirates` list. For Brno ("Piráti a Fakt Brno TU!") and HK (PIRÁTI a STAROSTOVÉ) that
  attributes coalition votes to "Piráti". Spec §5 says the opposite: "Hlasy a mandáty se počítají
  za celou kandidátku".
- `Councilors.jsx:144` says "Pirátská kandidátka — prvních 10" for coalition and association lists.

**Fix:** two patches.
- Title: `` ` · Piráti ${fmtPct(model.ours.share)}` `` → `` ` · ${partyMeta(council.pirates).tiny} ${fmtPct(model.ours.share)}` ``.
- `Councilors.jsx`: `Pirátská kandidátka — prvních 10.` → `Kandidátka s Piráty — prvních 10.`.
  Add `src/components/Councilors.jsx` to the patched files in spec §3.1 and in T5.

### M3 — Decision on estimates (asked in the brief) — keep them on town pages, state it in the spec

**Decision: acceptable.**
- Town pages keep Prague's estimates as they are. They are always labelled "odhad"
  (`CouncilApp.jsx:422`, the menu footer at `ElectionHeader.jsx:240`, the banner's "má mandát ·
  odhad"). They are per-town, never aggregated.
- The owner's "no estimates" stance concerns national or regional sums, and the index already
  shows seats only when `official` (spec §5 Row; T6 `seatsOfficial`).
- The shard payload does contain `composeOverview` sums (`precincts`, `official`). That is harmless
  as long as the UI never renders them; add a T6 assertion.

**One wording fix.** The footer says the calculation was "ověřený na výsledcích 2022", but it was
validated on Prague data only. Patch the sentence
`výpočet ověřený na výsledcích 2022` → `výpočet ověřený na pražských výsledcích 2022`
(unique anchor in `CouncilApp.jsx:422-423`).

**Add to spec §5:** "Town pages show the existing labelled estimates (seats, last seat,
possible coalitions); index rows show seats only when official; no sums anywhere."

### M4 — One malformed town blocks its whole shard (spec §1 M5, §3.5, §7)

**What is wrong.** `structuralReason` rejects an overview when **any** council has empty
`parties` (`validate.js:127` → `council-parties-empty`). The same happens when any council's
`counted > total` (`:128`). These are absolute checks: never quarantined (`refresh.js:38-40`), and
they apply on a cold start as well. One small town whose `vysled` file has empty `vysledky`
therefore keeps up to 7 other towns at 503 or stale. That contradicts M5.

**Fix (mesta code only).** In `mestaWiring.buildFeed`, wrap the overview feed's `build()`:
- drop summaries with `!parties?.length` or `counted > total`;
- add their count to `missing`;
- throw only if nothing remains.
Then `mergeOverview` fills the dropped towns from good. Add a test with one bad town in a fixture
shard.

### M5 — Borderline auto-inclusion vs the owner's "7–9.9k by judgement" (spec §4.1; plan T1 step 6)

**What is wrong.**
- `okres-seat`, `senate-seat-2026` and `pirates-2022` publish 7–9.9k towns **automatically**.
- The probe on `main` (`qualifying-nationwide.tsv`) computes neither `pirates-2022` nor real
  `senate_seat`/`okres_seat` values; those columns are blank for all 9 borderline rows. So
  "79 published, 8 borderline-excluded" is not established.
- T1's fixture (pop 7823, 11,68 %, 2 seats) has Rychvald's population. If that is real data, the
  set is 80 and shards shift.

**Fix:** towns that are `borderline-included` only through an **automatic** reason get
`confidence: 'low'` (hidden until reviewed). Alternatively publish only `owner-list` and manual
`borderlineReason`, and list automatic reasons as proposals in the verification report. T1 step 6
must report the real counts and not assert 79.

### M6 — `population-band-differs` is underspecified (spec §2 vs §4.1)

**What is wrong.**
- Spec §2 says such a town "is treated as borderline". Spec §4.1 still makes it `auto` when
  `POCOBYV ≥ 10 000`.
- `decideInclusion(town, { type, reasons, override })` receives no flags.
- §6 rule 5 also hides these towns (low confidence) for a population nuance, not an attribution
  doubt.

**Fix:** "Inclusion uses the `POCOBYV` band only; `population-band-differs` is a flag (→ low
confidence) and adds no reason." Add a T1 test for a town at 10 050 (2026) and 9 980 (2025).

### M7 — Generator output directory collides with the committed probe; `/tmp` path (plan T1 step 6, spec §2, §4.2, §6.2)

**What is wrong.**
- On `main`, `docs/analysis/mesta-registry-extract/` already holds the Haiku probe (`analyze.py`,
  `load.py`, `report.py`, `qualifying-nationwide.tsv`, `specifics-table.tsv`).
- T1 writes its extract into the same directory. Codex's input
  `docs/analysis/mesta-registry-extract/**` would then mix the probe's derived TSVs with the raw
  extract, and it would no longer be independent evidence.
- T1 step 6 diffs against `/tmp/claude-1000/mesta-registry/qualifying-nationwide.tsv`, which does
  not exist in the implementers' worktrees.

**Fix:**
- Generator output goes to `docs/analysis/mesta-extract/`.
- Keep the probe where it is and diff against the committed
  `docs/analysis/mesta-registry-extract/qualifying-nationwide.tsv`.
- Exclude the probe from the Codex inputs.

### M8 — The guard's cost and flakiness, and T8's merge cadence (spec §3.1; plan T8 step 1)

**What is wrong.**
- Each guard run does 2× root `npm ci` (sharp, maplibre), 2× `vite build` (about 8 s each,
  measured), 2× `cloudflare npm ci` and 2× `wrangler` dry-run. That is about 4–6 min, run after
  each of 7 merges: 30–40 min of controller time on a 3–4 h day.
- Wrangler dry-run determinism is unverified (I did not run wrangler, to avoid network use).

**Fix:**
- Cache the base side once per base sha in `.cache/prague-base-<sha>.sha256`.
- Set `WRANGLER_SEND_METRICS=false`.
- In T5, run the dry-run twice on one tree and require identical hashes.
- Use `mktemp -d` and a trap that only removes paths under that temp directory.

### M9 — Index task interfaces that cannot run in parallel as written (plan T6)

- **Imports.** `indexModel.js` must not import `./councils.js`, because it needs T1's JSON, which
  is absent on T6's branch. Make every function take `councils`, `SHARDS` and `REGIONS` as
  arguments. `MestaIndex.jsx` is the only importer.
- **`now` parameter.** `rowView` needs a `now` parameter. The 'waiting' test says "after 14:00",
  and the planned signature has no clock.
- **Lazy-polling model.** `useLiveResults` is single-source per hook instance
  (`useLiveResults.js:169`). The plan's `ShardFeed`-per-shard design is correct: a remount within
  `nextAt` reuses the `sessionStorage` snapshot (`readCached`, `:130-138`), so scroll in and out
  does not refetch.
  - The parent must keep the last summaries per shard after unmount, so collapsed regions do not
    flash skeletons.
  - Add a pure `initialMounted({ width })` → `['top-1','top-2']` below 1024 px, and test it. This
    is the only automatable part of M6.
  - Add `pickSummary` (H2c) and a hidden-town filter test (H1).

### M10 — `mesta-worker.js` is untested, and its copied glue will drift (spec §3.1 Worker; plan T4 step 3)

**What is wrong.** `mesta-worker.js` imports `cloudflare:workers`, as `worker.js` does, so Vitest
cannot load it. The routing in it is therefore untested:
- the 400/404 bodies;
- `/api/*` other than volby/kraj;
- query-string normalization (`?z=554791&x=1` must hit the same cache key);
- HEAD requests;
- the 405 response.

**Fix:**
- Move `route(url, method) → { kind:'api'|'app'|'notfound'|'bad', key?, status?, body? }` into
  `mestaWiring.js` and test it.
- Add `cloudflare/mestaWorker.drift.test.js`. It reads `worker.js` and `mesta-worker.js` as text,
  extracts `sMaxAge`, `reply`, `lastResort` and `withTimeout` usage by regex, and fails on
  difference. A Prague hotfix to `lastResort` tonight must not silently skip mesta.
- Assert in a test that `mesta-worker.js` does **not** import `buildFeed`/`feedKind` from
  `feedWiring.js` or `feedTarget` from `warmup.js`. Those resolve Prague's registry: verified
  `feedWiring.js:3,42`, `warmup.js:2,8`.

### M11 — Deploy footgun in `cloudflare/` (spec §9; plan T4, T8)

**What is wrong.** The default config in `cloudflare/` is Prague's `wrangler.jsonc`. Tonight
operators will type many wrangler commands there. One `npx wrangler deploy` without
`-c wrangler.mesta.jsonc`, run on the mesta branch, deploys **Prague production** with mesta-branch
`dist/`, whose Tailwind CSS changed (C1).

**Fix:**
- The mesta npm scripts are the only entry points (`deploy:mesta:staging`, `deploy:mesta`), each
  starting with `grep -q '"name": "pirati-mesta"' wrangler.mesta.jsonc &&`.
- Runbook and `CLAUDE.md`: never run raw `wrangler deploy` in `cloudflare/` from a `mesta/*`
  branch.
- Also verify on staging that "deploy without the route" (§9.6 emergency stop) really detaches the
  custom domain. Wrangler may leave an existing custom domain attached. If it does not detach, the
  emergency stop is the dashboard's custom-domain removal (reversible).

### M12 — T1 is the critical path and too big for its slot (plan Parallelism; timeline 12:30–13:30)

**What is wrong.** T1 covers:
- the generator, 10 pure functions and the xlsx reader;
- jmsez fetching (79 s minimum);
- three reports and a 12-file extract;
- the tests.
In practice that is 2–3 h with review. T2/T3/T9 and the owner review wait on its JSON.

**Fix:** split T1.
- **T1a** (core + `towns.generated.json` + `specifics.generated.json`, merge first) unblocks
  T2/T3/T9.
- **T1b** (reports + extract + jmsez cross-check + xlsx) can land while T3 runs.
- The 2025 xlsx cross-check only feeds one flag (M6). It can drop to "manual note" if late.

---

## LOW

- **L1** — `src/mesta/councils.js` re-exports constants from Prague's `councils.js`. Both bundles
  therefore carry Prague's 58-council registry as dead code (verified: `praha-dolni` string in
  `dist-mesta/assets/index-*.js`). This is harmless. T4's
  `grep -c "pirati-volby-zaloha" /tmp/mesta-dry/*.js → 0` proves nothing, because that string is in
  no `.js` file. Replace it with `grep -c 'pirati-mesta/1.0'` ≥ 1.
- **L2** — The Worker needs no module swap; this was verified by reading:
  - `createKvFeed`/`createOverviewFeed`/`summarizeCouncil` use only the passed council objects
    (`feed.js:16,232-250`, `overview.js:30-37,94-148`);
  - `composeOverview`'s `councilByZastup(s.z)?.magistrat` (`overview.js:72`) returns null for town
    codes, which is harmless;
  - `POLLS_CLOSE` and `KV_BASE_URL` are the same values for both products;
  - `refresh.js` and `edge.js` are pure.
  The spec's "esbuild cannot alias relative imports" rationale is therefore moot, but the approach
  is sound.
- **L3** — The plan says Vitest does not see `scripts/`. On `main` it does
  (`vitest.config.js` includes `scripts/**/*.test.js`). Update the Global constraints line.
- **L4** — `title` from kvdruhz `NAZDRUHZAS` is unverified. The T2 test expects
  'Zastupitelstvo statutárního města Plzeň'. Use a fixed map
  `{1:'Zastupitelstvo obce',2:'Zastupitelstvo města',3:'Zastupitelstvo statutárního města',6:'Zastupitelstvo městyse'}`.
- **L5** — Duplicate published slugs make the generator exit 1 with no recovery rule. Add
  "append `-<okres name slug>`" and record it as a flag. Reserved slugs are fine for
  `isAppPath` (`[a-z0-9-]`).
- **L6** — An override `pirates` without a matching `list` makes the banner and the Hemicycle
  disagree. The test should require `list.id === pirates` or derive `pirates` from `list`.
- **L7** — T1 and T3 run in different worktrees with separate `.cache/`. jmsez and the registry
  zips are therefore downloaded twice on election day. Point `CACHE_DIR` at a shared path via env,
  or copy `.cache`.
- **L8** — `scripts/build-data.js` Prague mode has no regression check, because "do not run Prague
  mode". Review rule for T3: the diff is additive only, and every change sits behind
  `if (MESTA)`. The hard-coded `'public/data'`/`'public/media'` (`build-data.js:100,130,136,137`)
  become `OUT` only in mesta mode.
- **L9** — The workers.dev staging is publicly reachable before the gate. That is acceptable once
  H1 is fixed, because hidden towns then carry no attribution.
- **L10** — Fan-in arithmetic checked:
  - N region-shard files + 12 featured + 12 × 2 warm towns + (N − 12) × 2 on-demand
    = 3N + 12 = 267 at N = 85;
  - warm-up is 16 + 2 + 12 = 30 keys;
  - a cold start takes at most 4 waves × ~13 s ≈ 52 s at concurrency 8, inside 60 s;
  - KRAJ code order 2100…8100 is the standard ČSÚ region order;
  - 304 handling needs an entry first (`feed.js:200`). That is fine, because no
    `If-None-Match` is sent without one.

---

## Test gaps vs success criteria

| Criterion | Gap | Add |
|---|---|---|
| M1 | Guard as specified fails by construction (C1) | Allow-list path check + archive-based byte check; dry-run determinism check |
| M2 | Only a bundle grep; no test that the shard feed fetches each town file once per window | T4: shard `buildFeed` called twice within 20 s → second build makes 0 fetches (fake clock) |
| M3 | No UI-level test of the gate | T2/T6 tests for H1 (menu `COUNCILS`, featured, page `pirates:null`) |
| M4 | Manual only (OK); §8 lacks a type-c/forced town | Add one forced or `others` town if any is published |
| M5 | No test for a bad town inside a shard; no test for the data-build per-town try/catch | M4 wrapper test; T3: fake `buildCouncil` throwing for one slug → exit 0, summary line |
| M6 | No automatable check | `initialMounted({width:375})` → 2 shards; row height and tap-target classes asserted in a render-free view model |
| Swap/patches | — | T5: build:mesta output contains no `Landing-` chunk and no `Záložní kopie originálu` string in JS |
