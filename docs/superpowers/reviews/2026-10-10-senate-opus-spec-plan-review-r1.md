# Senate spec + plan — Opus adversarial review r1

Scope: `docs/analysis/senate-research.md`, `specs/2026-10-10-senate-results-design.md` (spec), `plans/2026-10-10-senate-results.md` (plan), checked against `cloudflare/*`, `src/volby/validate.js`, `src/hooks/schedule.js`, root configs and the static ČSÚ samples in scratch (`python3 -I`, no network).

Confirmed correct on the data (no action): 27 obvody / 154 candidates in the frozen 2026 file; the registry joins the XML 154/154 on (obvod, number) with identical surnames; all 18 owner names resolve uniquely; NSTRANA 720 = exactly Luftová, Šípová, Szyja. On the 2024 final file, Σ`HLASY_nKOLO` == `PLATNE_HLASY` in every obvod and round; `ZVOLEN_1KOLO=ZVOLEN` ⇔ 2·votes > valid; 5 obvody decided in round 1, 22 in round 2, exactly 2 finalists each; round-2 attributes appear only on finalists.

## HIGH

**H1 — Candidate-status rule order is wrong for a round-2 tie, and round-2 provisional states are missing.** Spec §3.1. The rule "`2.KOLO` and obvod not decided → `advancing`" runs before the `st2` checks. A tie obvod (`NEZVOLEN_SHODA_HLASU`) is not `elected`, so both tied finalists come out as `advancing` instead of `runoffTie`. During round-2 counting every finalist is `official:true advancing`, so `leading/second` and `majority` never apply. The Pirate tally then says "postupuje" all runoff night, even when the numbers show the candidate losing. There is also no state for "round 2 fully counted, `ZVOLEN_2KOLO` not yet published" (the doc says this lag exists for round 2 too). `counted`/`awaitingOfficial` cover round 1 only.
*Fix:* order the checks as st2 flags → st1 `ZVOLEN`/`NEZVOLEN` → (rd=2, no st2) provisional by `votes2` → `2.KOLO` with Z2=0 → `advancing`. Add `runoff-counted` (Z2=C2, no st2) to `awaitingOfficial`. Add finalist statuses `runoffLeading/runoffBehind` (`official:false`). Add tests for each case.

**H2 — Test or pre-close data can be published as real, and `older` can freeze the page on it.** Spec §4 and plan Task 3. In Prague, `baselineApplies` also requires `good.generated ≥ pollsClose` (`src/volby/validate.js:93`). The spec only checks "refreshed after 14:00", and a 304 keeps moving `refreshedAt` forward, so a frozen or test snapshot fetched at 13:59 becomes the baseline at 14:01. The plan's own test ("reset to zero accepted immediately") then fails. The spec's `older` rule is unconditional, so test data stamped later than the real file would block real data indefinitely, with `stale:false`. There is no round-2 close: ČSÚ reuses the same URL, so any round-2 test data before **17 Oct 14:00** would go out live during the poll moratorium.
*Fix:* port both baseline conditions and apply `older` only when the baseline applies. Add `POLLS_CLOSE_R2 = 2026-10-17T14:00+02:00`, overridable per obvod for a slip to 23–24 Oct. Before it, drop round-2 votes and Z2 from the published snapshot and log a warning. Before `POLLS_CLOSE`, publish nothing beyond zeros and `waiting`. Add tests for both.

**H3 — Who owns the conditional-GET validators is underspecified, and the wrong choice hides new data behind a 304.** Plan Task 3 says to store validators in `meta`, and also that `feed.invalidate()` clears the stored validators. Those are two different owners. If an implementer saves the ETag of a *rejected* or *older* response, the next poll gets a 304 and the refresher treats it as "good, unchanged" (`stale=false`). Quarantine also never advances, because no new 200 arrives. `fetchId` is never defined either. If it is the ETag, quarantine can never reach 3 distinct fetches when the corrected file is stable (for example a late precinct resend; the doc says resent precincts may differ).
*Fix:* validators live only in `good.meta` and are written only by `install()`. A rejected or older response never touches them. `fetchId` = a counter of HTTP 200s, as in Prague `src/volby/feed.js:329`. A 304 also resets `stale/failures`. Add a test: "rejected 200, then 304, stays stale and re-fetches unconditionally".

**H4 — After a code fix is deployed, a 304 keeps serving the old derived output.** Spec §2 and §3: the stored body already contains derived `state/status/pirate` fields. After a deploy, the DO reloads that body, `schema` still matches, and the stored ETag produces 304s. Between rounds (about 6 days of an unchanged file), a fixed `derive.js`/`manifest.js` would never take effect.
*Fix:* make `meta.schema` = `SCHEMA + hash(derive.js + manifest)` (or a build id) so a code change discards the stored snapshot on reload. Alternatively, store the raw XML and re-derive on reload.

**H5 — The repo `CLAUDE.md` forbids this deploy as written.** CLAUDE.md "Deploy rules": `wrangler deploy` only from `cloudflare/`, with name `pirati-volby-zaloha`. Spec §7 and plan Task 4 deploy `pirati-senat-zaloha` from `cloudflare-senat/`. An implementer who follows the rules will refuse; one who deploys anyway breaks a written rule.
*Fix:* the owner explicitly approves a CLAUDE.md amendment (new dir, names `pirati-senat-zaloha[-staging|-drill]`, custom domain `senat.dg12.cz`) before Task 4.

## MEDIUM

**M1 — The schedule polls every 20 s for a week.** Spec §2. Between rounds `G` is days old, so `clamp(G+60, r+20, r+60)` always gives r+20 s. That is about 26k requests until 16 Oct, which contradicts "one file per minute". A tie obvod is never `decided`, so the phase never reaches `final`. *Fix:* add an `idle` phase (every obvod is terminal or a runoff with Z2=0) at 5 min until `POLLS_CLOSE_R2`. `final` = all obvody `elected|tie`.

**M2 — Rejections that can never clear.** Spec §4. "Fewer obvody", "candidate count below good" and "unknown status values" are rejected every time and cannot go through quarantine. Any unexpected change from ČSÚ on the night (a new enum value, a withdrawn candidate) would leave the page stale until a redeploy. *Fix:* allow these to pass quarantine like Prague's `parties-fewer`. Map an unknown status to `null` plus a warning.

**M3 — Attribution understates Pirate involvement.** Spec §5. The official ballot labels (`NAZEV_VS`) for Padevět (27), Dvořák (45), Grulich (48) and Třetina (54) name a coalition that includes Česká pirátská strana. The spec would show only "navrhla: STAN/TOP 09". *Fix:* show `NAZEV_VS` too, and have the owner decide whether to use a `coalition` relation. Gotcha: `cns.json`/`cpp.json` use the key `položky`, while `serk.json` uses `polozky`.

**M4 — Pirate summary buckets are incomplete.** Spec §3: `summary.pirates` has no `runoffLost`, `runoffTie` or `awaiting` bucket, so after round 2 the buckets no longer add up to `total`. `total: 18` is hard-coded although verification can drop entries. *Fix:* one bucket per status, and `total` = number of verified entries.

**M5 — `majority` is computed from truncated percentages and shown on partial counts.** `HLASY_PROC` is truncated (XSD), so 50.004 % reads as "50.00" and fails `pct > 50`. *Fix:* use `2·votes > PLATNE_HLASY`. Show it only when Z=C, with the caveat.

**M6 — Ranking and withdrawal are undefined.** "Rank in the current round" gives non-finalists `votes2=null`. With ≥3 `2.KOLO` and only some carrying `HLASY_2KOLO` (a withdrawn finalist), the rank is undefined. A legitimate `NEZVOLEN→2.KOLO` change after a withdrawal is treated as a regression. `navig/obvody.json odvolaniKandidati` is ignored. *Fix:* in round 2, rank only candidates that have `votes2`; give others `rank: null`. Add a withdrawal test case and document that quarantine accepts the change.

**M7 — Lint breaks after `build:senat`.** `eslint.config.js` `globalIgnores(['dist', …])` covers only the root `dist`. `senat/dist/assets/*.js` will be linted (`**/.wrangler` shows the any-level form is needed). *Fix:* add `'senat/dist'` explicitly. The plan only says "extend if needed".

**M8 — Senate tests would block Prague deploys.** Plan "Root edits". `deploy.yml` (Prague) runs `npm test` and `npm run lint`. Adding Senate globs to the root vitest means a red Senate test blocks an emergency Prague deploy on election night. *Fix:* use a separate `cloudflare-senat/vitest.config.js` and `npm run test:senat`, and leave root `vitest.config.js` untouched.

**M9 — Plan feasibility.** Task 3 bundles validator, refresher, feed, edge and a port of a 1185-line test file; that is too big for one Sonnet pass, so split it into 3a validate / 3b refresh+feed / 3c edge. Task 4's `--dry-run` and `wrangler dev` fail while `../senat/dist` does not exist (Task 5 builds it): add a stub build step. No task owns the `vitest.config.js` edit, yet Task 1's tests depend on it. Tasks running in parallel in one uncommitted worktree all edit root `package.json`: assign one owner. `node_modules` is absent in this worktree (and `cloudflare-senat` needs its own lockfile and `npm ci`): add an install step. There is no time-box or cut line, although counting starts at 14:00: define a minimal path (Tasks 1, 2, a minimal 3/4, a plain client) and defer the screenshots and mock-upstream drill.

## LOW

- L1: the spec §3 example `generatedMs: 1760105112000` is 2025-10-10. The correct value is 1791641112000.
- L2: the 2024 fixture's `DATUM_CAS_GENEROVANI` is 2026-09-14 (regenerated), and its obvod set differs from the manifest. The "exact manifest set" rule rejects it in refresher tests, and `normalize` must take names from the XML `NAZEV`, not from `OBVODY`.
- L3: `security.txt` needs `Contact: tel:+420777954389` and an `Expires:` field (RFC 9116).
- L4: Tailwind v4 automatically scans the whole repo, so `senat/**/*.jsx` class names leak into the Prague CSS. Use non-utility class names such as `snt-…`; do not edit `src/index.css`.
- L5: `wrangler deployments list` fails for a script that has never been deployed; the runbook should say "none (first deploy)".
- L6: spec §6 says "CI step" for the `senat/dist` grep, but the plan adds no CI change. Either add a separate workflow job or call it a local gate.
- L7: move `scripts/senat-build-manifest.mjs` into `cloudflare-senat/scripts/` to keep the separation. `.mjs` files do not get node globals in `eslint.config.js`.
- L8: `phase` is listed in the published meta, but Prague's `respond()` does not put it in the body. Decide one way, and keep `"stale":` within the first 300 chars for `markStale`.

VERDICT: 0 CRITICAL, 5 HIGH
