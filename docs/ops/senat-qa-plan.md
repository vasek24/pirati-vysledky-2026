# Senát 2026 — plán zajištění kvality (QA plan)

Správce kopie: Václav Vislous, tel. +420 777 954 389 (spravuje tuto fork a její úpravy; není autorem originálu).
Scope: Worker `pirati-senat-zaloha` (`cloudflare-senat/`) + SPA `senat/` → `senat.dg12.cz`. Prague (`cloudflare/`, `src/`) is out of scope and must stay untouched.
Companion: `docs/ops/senat-release-checklist.md` (go/no-go), `docs/ops/senat-deployments.md` (version log), `cloudflare-senat/README.md` (deploy and rollback).

## 1. Co může uškodit (risk model)

| # | Failure | Worst case | Layers that catch it |
|---|---|---|---|
| R1 | A wrong number or wrong status shown as fact | misinformation on election night | unit, fixtures, invariants, drill, data truth |
| R2 | A stale number shown as current | same, silently | drill (stale), monitoring, data truth (timing) |
| R3 | Outage or slow page under election-night load | no results | burst, edge cache, drill, monitoring |
| R4 | Wrong Pirate attribution (wrong candidate labelled) | reputational | manifest tests, `attribution-mismatch` warning, data truth |
| R5 | Our traffic hurts ČSÚ (volby.gov.cz) | ban / bad press | gates (browser never requests ČSÚ), drill cadence, polite verify script |
| R6 | We touch the Prague deployment | breaks the main backup | gate `prague-untouched`, separate Worker name/domain |
| R7 | Secret or personal data leaks | security incident | secrets scan, `GITHUB_TOKEN` gate, no KV/vars |
| R8 | Bad deploy cannot be undone quickly | long outage | staging first, rollback rehearsal, previous version id recorded |
| R9 | Page unusable on a phone or for assistive tech | audience cannot read it | E2E matrix, axe-core, keyboard walk |

## 2. Layers

"Today" = state when this plan was written (2026-10-10 about 13:50 CEST). Commands run from the repo root unless noted.

| Layer | What it proves | How to run | Exit criterion | Today |
|---|---|---|---|---|
| **Unit** | pure modules (xml, time, normalize, derive, validate, refresh, edge, manifest, client helpers) | `TZ=UTC npm run test:senat` | all green, nothing skipped | 662 tests green |
| **Integration on real fixtures** | parser → normalise → derive → validate on the frozen 2026 file and the final 2024 file (round 2 included) | `cloudflare-senat/src/pipeline.test.js` (part of the above) | 27 obvody, 18 Pirate-backed, `warnings: []` | green |
| **Contract / schema** | API body `v:1` shape; ČSÚ JSON column mapping (`vysled/obvod/<n>.json`) equals the XML | `verify-against-csu.test.js` (mapping verified on obvod 5 **and** 17), `drill.mjs` `checkStage` | every field of spec §3 present; columns verified | green |
| **Property / invariant** | for every mock stage: Σ votes = PLATNE_HLASY, precincts only grow, flags never disappear, consecutive stages pass the validator, an independent re-implementation of the §3.1 rules equals `derive.js` (8 stages × 2 seeds + 2024 final) | `mock-upstream.test.js`, `verify-against-csu.test.js` | all green | green |
| **Fault-injection drill** | last-good served with `stale:true` within one refresh for upstream 500 / HTML / truncated XML / slow; recovery clears stale; polling cadence and 304s; viewer fan-out does not reach ČSÚ | `drill.mjs` (section 4) | every row PASS | tools written; first run after 14:00 |
| **Browser E2E matrix** | renders and behaves at 360 / 375 / 414 / 1280 in every phase | section 3 | no horizontal scroll, no console error, no CSP violation, axe 0 serious | partly run, see baseline |
| **Accessibility** | axe-core, keyboard-only walk, contrast, reduced motion | section 3 | axe: 0 serious/critical; whole page operable by keyboard; contrast AA | 2 findings |
| **Performance** | bundle budget; Lighthouse mobile; load burst on staging | `qa-gates.mjs` (budget), `burst.mjs`, Lighthouse | JS ≤ 120 KB gzip, CSS ≤ 20 KB; Lighthouse perf ≥ 90 mobile; burst p95 ≤ 1.5 s, errors ≤ 1 % | budget green (JS 77 KB, CSS 4 KB gzip); Lighthouse and burst not run |
| **Security** | headers, CSP, dependency audit, secrets scan, separation from Prague | `qa-gates.mjs`, section 5 | all gates PASS; `npm audit --omit=dev` 0 high/critical | gates green; audit 0 vulnerabilities |
| **Data truth** | our numbers equal ČSÚ's independent sources | `verify-against-csu.mjs` (section 6) | exit 0 at every scheduled run; no `fail` row | after 15:00 |
| **Release** | staging→production is a checklist, not memory; rollback works | `senat-release-checklist.md`, rollback rehearsal on staging | every box ticked; rollback rehearsed once | not yet |
| **Monitoring** | we notice problems before viewers do | section 7 | the "good" patterns, none of the "bad" | after deploy |

Order of cheapness: gates and unit (seconds) → drill (20 min, local) → staging checks → data truth (continuous).

## 3. Browser, accessibility, performance procedures

### 3.1 E2E matrix

Serve a build with the mock upstream: `mock-upstream.mjs` + `wrangler dev` as in `drill.mjs`'s header, open the Worker URL (not Vite) so the production headers apply. Switch the mock with `curl -X POST localhost:8797/stage/<name>`. Each cell: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), no console error, no `securitypolicyviolation`, text readable, tap targets ≥ 44 px.

| Phase (mock stage) | 360 | 375 | 414 | 1280 |
|---|---|---|---|---|
| waiting (`frozen`) | ✔ run 10 Oct | ✔ | ✔ | ✔ |
| counting (`counting-25`, `counting-60`) | todo (needs ≥ 14:00) | todo | todo | todo |
| awaiting official (`counted-awaiting-flags`) | todo | todo | todo | todo |
| runoff / counting round 2 (`official-r1`, `runoff-counting`) | todo | todo | todo | todo |
| final with a tie (`official-r2`) | todo | todo | todo | todo |
| stale banner (`/fault/500` for ≥ 60 s) | todo | todo | todo | todo |

Also: tab in the background for 5 minutes, then foreground (polling resumes, no burst); `sessionStorage` blocked (private window) still renders; offline → last snapshot stays, banner shown; throttled "Slow 4G" first load < 3 s to useful content.

### 3.2 axe-core (throwaway install, nothing enters the repo)

```sh
mkdir -p /tmp/axe && cd /tmp/axe && npm init -y && npm install axe-core
# serve senat/dist WITHOUT the CSP (the CSP forbids loading axe), proxy /api to the local Worker, e.g. a 15-line node server
# open the page, inject /axe.min.js, then in the console:
await axe.run(document, { resultTypes: ['violations', 'incomplete'] })
```
Run it per phase and at 360 and 1280 px. axe finds roughly a third of WCAG problems; the rest is the manual walk below.

### 3.3 Keyboard-only walk, contrast, reduced motion

1. Reload, press Tab only. Order must follow the visual order: back-link → section navigation → obvod tiles → cards. Every control shows a visible focus ring; no keyboard trap; Enter/Space opens and closes a detail; Escape closes it if it is a dialog.
2. Zoom 200 % and 400 % (reflow, no clipped text). Browser font size "very large".
3. Contrast: axe `color-contrast` plus a manual look at the Pirate yellow on white and any grey placeholder. Large text needs 3:1, normal 4.5:1.
4. DevTools → Rendering → "prefers-reduced-motion: reduce": the LIVE dot and any transition stop (CSS has a reduce rule for the dot).
5. Colour is never the only cue: switch to greyscale; statuses must still read from text/icon.
6. Screen reader smoke (VoiceOver or NVDA, 10 minutes): landmarks, headings order (one `h1`), status chips announced, live region does not shout on every poll.

### 3.4 Lighthouse and load

- Lighthouse (not installed here; needs Chrome): `npx lighthouse@12 http://localhost:8799/ --form-factor=mobile --only-categories=performance,accessibility,best-practices --chrome-flags="--headless"`. Target performance ≥ 90, accessibility ≥ 95, best practices ≥ 95. Google Fonts are the one third-party request.
- Load: **staging only** (`burst.mjs` refuses anything but `*.workers.dev`, never volby.gov.cz, hard cap 200 req/s):
  `node cloudflare-senat/scripts/burst.mjs https://pirati-senat-zaloha-staging.vasek24.workers.dev --concurrency 20 --seconds 20 --max-rps 100`.
  Staging has no Cache API, so every request reaches the Durable Object: this is the worst case, production is cheaper. 20 s at 100 req/s is 2,000 requests; check the account's Workers plan quota before going bigger. Pass: p95 ≤ 1.5 s, error rate ≤ 1 %, the Durable Object makes no more upstream fetches than before the burst (look at `wrangler tail --env staging`: still one `not-modified` or fetch per ≥ 20 s).

## 4. Fault-injection drill

Commands (three terminals, repo root; the exact Worker flags matter):

```sh
npm run build:senat                                              # assets for the Worker
node cloudflare-senat/scripts/mock-upstream.mjs --port 8797      # A: fake ČSÚ
cd cloudflare-senat && npx wrangler dev --local --port 8799 --persist-to "$(mktemp -d)" \
  --var CSU_BASE:http://127.0.0.1:8797 --var POLLS_CLOSE_R2:2026-10-10T14:00:01+02:00   # B: Worker, fresh state
node cloudflare-senat/scripts/drill.mjs                          # C: walks 8 stages, 4 faults; ~20 min
```

Rules: (1) **works only after 14:00 Prague time today**: the close-of-polls gate compares with the real clock and zeroes any file generated or fetched before 14:00 (R1 is a constant); (2) round-2 data passes only after `POLLS_CLOSE_R2` (valid: ISO with offset, > R1, < R1 + 30 d), hence `14:00:01` for drills; with `14:30` the round-2 stages would wait until 14:30 and the idle cadence would be 5 minutes; (3) never against production or staging (`drill.mjs` refuses non-local hosts; the fake `CSU_BASE` runs only under `wrangler dev` or a separate `-drill` script); (4) fresh `--persist-to` every run: going back to `frozen` after counted data is, correctly, rejected as a regression.

What it asserts per stage: HTTP 200, `stale:false`, `phase`, `round`, summary counts, all 27 obvod states, Pirate tally (official buckets + provisional rest), `warnings: []`, Σ votes = PLATNE_HLASY, monotone vs previous stage, `cache-control` `public, max-age=0, s-maxage ≤ cap(phase)`, `x-server-now` near the local clock, `x-cache` MISS|HIT, pickup time ≤ 90 s. Plus: after every stage the `verify-against-csu` check runs against the mock's own ČSÚ side files (`/vysled/obvod/<n>.json`, `/mapa_vitez.json`, `/navig/obvody.json`) and must report 0 fail / 0 lag rows (a rehearsal of the election-night procedure); 150 viewer requests cause ≤ 1 upstream fetch; poll cadence in a counting window (≥ 18 s apart, ≤ 75 s, all 304 for an unchanged file); final phase polls ≤ 1× in 130 s; Worker User-Agent equals ours; Worker requested nothing but `odata/vysledky.xml`; each fault: `stale:true` ≤ 90 s with the last-good data and 200, response time ≤ 1.5 s while upstream is broken or slow, retry spacing ≥ 18 s, recovery ≤ 90 s.

Manual extras on the mock: `curl -X POST localhost:8797/regen` (new stamp, same content: Worker must install, not reject); `/fault/500?count=3` (self-clearing). Not automated: kill and restart `wrangler dev` mid-stage (state rehydrates from storage; `rehydrated` in the log).

## 5. Security

| Check | Command / evidence | Pass |
|---|---|---|
| Headers on static files | `senat/public/_headers` (nosniff, Referrer-Policy, X-Frame-Options DENY + `frame-ancestors 'none'`, Permissions-Policy, CSP) | `curl -sI <url>/` shows all five; gate `headers-csp` |
| CSP matches the app | `default-src 'none'; script-src 'self'; style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri/form-action/object-src 'none'`. No `unsafe-inline`: tested in a browser against the current build with 48 clicks, no violation; control test proved violations are logged | console clean after a full click-through in every phase |
| Cache rules | `/assets/*` immutable 1 y; `/` and `/index.html` `no-cache`; `/.well-known/*`, `humans.txt`, `kontakt.txt` 1 h. No `Cache-Control` under `/*` (Cloudflare joins same-name headers from all matching rules with commas) | `curl -sI` per path |
| Worker responses | `/api/senat`, `/healthz`, 405, 503 are not covered by `_headers` | see gap list in the QA report: add `X-Content-Type-Options: nosniff` in `worker.js` |
| Dependencies | `npm audit --omit=dev` at the repo root (react and the shared runtime deps; `senat/` has no package.json of its own) and in `cloudflare-senat/` (runtime deps: none, wrangler is a devDependency) | 0 high/critical; on 2026-10-10 13:46 both reported 0 vulnerabilities |
| Secrets | gate `secrets-scan` (token patterns), gate `forbidden-strings` (`GITHUB_TOKEN`, `pirati.cz`, `jsemfast`), gate `wrangler-config` (no KV/secrets/token-like vars) | PASS |
| Separation from Prague | gate `prague-untouched` (diff vs `main`: nothing under `cloudflare/`, `src/`, `public/`, `api/`, `index.html`, `vitest.config.js`, `.github/`; root edits only `package.json`, `eslint.config.js`); own Worker names, own Durable Object, only `senat.dg12.cz` route | PASS |
| Browser never calls ČSÚ | gate `no-volby-requests` | PASS |
| Privacy | no cookies, no analytics, no third-party except Google Fonts (IP reaches Google; accepted, mention in the page footer if the owner wants) | observed |

## 6. Data truth (election night)

`verify-against-csu.mjs` compares our `/api/senat` with ČSÚ's `odata/vysledky.xml` (project parser), the separately produced `vysled/obvod/<n>.json`, `mapa_vitez.json`, `navig/obvody.json`, for all 27 obvody: votes, percentages (ČSÚ truncates to 2 decimals), precincts counted, official flags vs `postupuje`/`zvoleny`, our `state`/`status`/`outlook`/`majority` against an independent re-implementation of the rules, Σ votes = valid votes, and the timing (our `generated` vs ČSÚ's, our lag).

```sh
node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz            # all 27 obvody, 31 polite requests
node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz --obvod 30 # one obvod (Kladno)
node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz --json     # machine-readable
```
Severities: `fail` = real difference (same generation stamp on both sides, or a broken invariant); `lag` = stamps differ, so it may be timing (re-run in a minute, it must vanish); `note` = semantics not fully verified (`stavZvolen`, `ukonceno`). Exit 1 on any `fail` (`--strict`: also `lag`); 2 on usage or our API down.

Schedule: first run right after the first counted precincts (about 15:00) as a mapping sanity check (the real counting-time XML has never been seen, see section 8); then **every 10 minutes for the first 2 hours of counting, hourly after that**, until all obvody are final; once more after the round-2 results (17 Oct evening). One run costs ČSÚ 31 requests with conditional GET; never run it in a loop faster than 10 minutes. Any `fail` row: stop and look at the row before anyone is told the page is right; a `lag` that persists for two consecutive runs is a fail.

## 7. Monitoring (`npx wrangler tail pirati-senat-zaloha --format json`; staging: add `--env staging`)

| Event (JSON `event`) | Good | Investigate |
|---|---|---|
| `cron` | one per minute, `stale:false`, `phase` follows the night (waiting → counting → idle → final) | missing for > 3 minutes; `cron-failed` |
| `not-modified` | most polls while ČSÚ is quiet | none for > 2 minutes during counting |
| install of new data (`rehydrated` only at cold start) | `generated` advances | `generated` frozen > 5 minutes while ČSÚ moves (run verify) |
| `build-failed` | single, followed by recovery | 3 in a row, or `stale:true` > 2 minutes |
| `rejected` | never | any: read `reason`; `quarantine-accepted` means a human must confirm the file is real |
| `older`, `older-persistent` | rare `older` (lagging ČSÚ replica) | `older-persistent` (> 10 min) |
| `attribution-mismatch` | never | any: a Pirate label was dropped, check the manifest |
| `feed-failed` | never (rate-limited to 1 per 10 s) | repeated: Durable Object failing, viewers get `x-cache: LASTRESORT` |
| `storage-put-failed`, `rehydrate-failed`, `size-guard`, `refresh-error`, `unexpected-not-modified` | never | any |

What "good" looks like from outside: `/api/senat` 200, `stale:false`, `x-cache` HIT from the second request, `s-maxage` ≤ 5 while counting (≤ 300 idle, ≤ 600 final), `x-server-now` present, `/healthz` `ok`, page footer time within a minute of ČSÚ's. Uptime check: `/healthz` every minute from outside.

## 8. Not covered (honest list)

- **The real XML during counting has never been seen** (only the frozen file and the 2024 final). Mock stages are modelled on both; the first real counted file is checked by hand at about 15:00 with `verify-against-csu`. Soft checks in `normalize` stay warnings until then.
- ČSÚ behaviour under election-night load or throttling; whether it ever serves a lagging replica for long.
- Cloudflare edge reality: `x-cache: HIT` / `LASTRESORT` across datacentres exist only on `senat.dg12.cz`; local `wrangler dev` emulates the Cache API in one process. Custom-domain DNS/certificate issuance is observed once, at the first production deploy.
- Real devices and browsers: iOS Safari, Samsung Internet, old Android, slow networks; only Chromium emulation was used. Screen readers are a manual smoke test, not a certification; no WCAG audit by a specialist.
- Czech copy proof-reading and the gender-neutral wording rule beyond the deny-list test over `senat/src/text.js` and the built strings.
- The legal reading of the poll-publication moratorium for round 2 (13–17 Oct): flagged in `docs/analysis/senate-research.md`, not a test.
- Soak: the week between rounds (Durable Object eviction, idle cadence), the round-2 transition in real data, daylight-saving (not until 25 Oct), Cloudflare incidents, dependency supply chain beyond `npm audit`.
- No CI runs for `senat/` or `cloudflare-senat/`: the gates are local and manual.

## 9. Baseline findings (2026-10-10, 13:50-14:05)

- axe-core 4.14. Build of 13:36 (`index-CD-3fcsd.js`), waiting phase: `color-contrast` (serious, 18 nodes: grey placeholder number `#a3a3a3` on white, 2.52:1; large text needs 3:1) and `label-content-name-mismatch` (serious, 27 tiles). Build of about 13:55, counting phase at 375 and 1280: contrast violations gone (16 / 11 nodes left in axe's "incomplete" list = need a human look), **`label-content-name-mismatch` remains** (27 obvod tiles `button[title="3 Cheb · Sčítá se"]`: the visible text is not part of the accessible name; WCAG 2.5.3 Label in Name).
- No horizontal overflow at 360, 375, 414, 1280; `lang="cs"`, one `h1`, header/nav/main/footer landmarks; reduced-motion rule present; focus-visible styles present; smallest tap target 44 px.
- CSP: no violation after 48 programmatic clicks over the waiting-phase page and again over the counting-60 page (build of about 13:55, served with the real `_headers` block); Google Fonts (Bebas Neue, Roboto, Roboto Condensed) load under the policy. A control test (inline script, inline style attribute, `fetch` to another origin) logged all three violations, so the console check is not blind.
- Worker responses are not covered by `_headers` (see section 5).
