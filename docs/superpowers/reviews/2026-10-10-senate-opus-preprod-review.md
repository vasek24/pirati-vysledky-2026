# Senate — Opus pre-production review (GO/NO-GO), HEAD 6ab238f + working tree

Scope: `cloudflare-senat/{wrangler.jsonc,README.md,package.json,src/**}` (without `okrsky*`), all of `senat/`. Review started 13:36 CEST, 10 Oct.

**Gates I ran:**
- `TZ=UTC npm run test:senat`: 483/483. The count includes untracked test files.
- `npm test` (Prague): 337/337.
- `npx eslint .`: clean.
- `npm run build:senat`: OK, 250 KB JS / 79 KB gzip.
- `wrangler deploy --dry-run`: OK for both `--env=""` and `--env staging`.
- Diff scope: only `cloudflare-senat/`, `senat/`, `docs/`, `package.json`, `eslint.config.js`. Both root edits are additive.

**Bundle and page:**
- The bundle contains no `appdata`. Its only hosts are `volby.dg12.cz`, `volby.gov.cz` (a plain link) and `react.dev` (an error string).
- The page loads only `fonts.googleapis.com`/`gstatic` besides its own origin. There is no `innerHTML`, no secrets and no `target=_blank`.

**Staging in the Browser pane, 375 px and 1280 px:**
- No horizontal overflow at either width.
- Every `a`/`button`/`select` is at least 44 px.
- The jump row is sticky on mobile and hidden on desktop.
- The countdown reads "za 20 min" at 13:40.

**Earlier fixes, checked and still holding:**
- r2-H1: the non-finalist keeps its round-1 numbers (`view.js` `roundOf`, render tests 135/153).
- M2: the `POLLS_CLOSE_R2` regex and bounds in `readConfig`.
- M3: the waiting pill while round 2 has no counted precinct.
- M4: `workers_dev:false` in production, and the README states that staging only ever shows MISS.
- The README L1 and L3 points.
- L5: a persistent `older` turns stale.
- L6: `suppressedByClock`.
- L7: `requireManifestSet`.
- L8: ties have their own tile.
- Gates use both `now` and `generated` and fail closed.
- The `storageDirty` guard (M1).

**Gender-neutral copy:** every string in `text.js`, `index.html` and `public/*.txt`, plus every rendered state, was checked against the spec deny-list. I also checked by hand for `druhý`, `poslední`, `jeho/její`, `vítěz`, `který` and `získal` used of a person. All clean. The only masculine form is "nikdo nezískal", which is grammatical agreement with the pronoun and part of the spec-approved status wording.

---

## HIGH

### H1 — The card share rounds ČSÚ's truncated `HLASY_PROC` to one decimal, so 49.96 % is shown as "50,0 %" next to "pod 50 %"

**Where:**
- `senat/src/components/Cards.jsx:35` — `pc(pct)`, 1 decimal.
- `senat/src/outlook.js:44` and `:47` — `whyMandate` and `whyAdvLead` use `pc(c.pct1)`.

**Evidence:**
- ČSÚ truncates (research §2). In the 2024 fixture, e.g. 5043/21611 = 23.3353 is published as `23.33`.
- `pc(49.96)` = `"50,0 %"`, and `pc(49.95)` = `"50,0 %"`.
- Probe `$SCRATCH/probe-pct.mjs`: obvod 30, votes 4996/3000/2004, 150 of 200 precincts counted. `derive` + `outlookView` give:
  - card `50,0 %` (ČSÚ shows `49.96`);
  - chip `Předběžně: postup do 2. kola`;
  - reason line **"Vede s 50,0 %, pod 50 %: do 2. kola jdou dvě kandidatury…"**.
- The same happens at 200/200 ("Sečteno: …").
- In round 2 two finalists at 49.96 / 50.04 both show "50,0 %", one marked "Vede" and the other "Zaostává".
- This hits exactly the races people watch. The detail row (`pc(pct, 2)`) is correct, so the card and the detail disagree.

**Fix:**
- Show ČSÚ's value verbatim with 2 decimals: `pc(pct, 2)` in Cards.jsx:35 and in outlook.js:44/47. Change the zero placeholder to `'0,00 %'`.
- If one decimal must stay, truncate instead: `Math.floor(x*10)/10`. But "50,0 %, nad 50 %" for 50.04 would still read oddly, so 2 decimals is better.
- Also change `senat/src/fixtures/scenarios.js:24` from `Math.round` to `Math.floor` so the fixtures behave like ČSÚ.
- Add a render test: `pct1 = 49.96` must never render "50,0".

### H2 — Precinct progress rounds up: "sečteno 199 z 200 okrsků (100 %)" while the chip still says "Předběžně"

**Where:**
- `senat/src/components/Cards.jsx:13`
- `components/Strip.jsx:7`
- `components/Detail.jsx:56` (`pc(progressOf(r), 0)`)

**Evidence:**
- `Math.round(100*199/200)` = 100, and `Math.round(100*239/240)` = 100.
- In any obvod with ≥ 200 precincts, the last missing precinct is displayed as 100 %. That is the slowest and most-watched minute of every count, often tens of minutes. ČSÚ publishes `OKRSKY_ZPRAC_PROC` (e.g. `99.50`) and would never say 100.

**Fix:** use `Math.floor(progressOf(r))` in all three places. In Detail use `` `${Math.floor(progressOf(r))} %` ``. Add a test with 199/200 → "99 %".

---

## MEDIUM

### M1 — The round-2 countdown can never appear in production; its test passes on an impossible snapshot

**Where:** `senat/src/components/Header.jsx:8` (`closingModel(snapshot?.round, …)`), `render.test.js:271-274`.

**Evidence:**
- `normalize` drops all round-2 data until `POLLS_CLOSE_R2`, so `snapshot.round === 1` for the whole week and the runoff weekend.
- `closingModel(1, t > R1)` returns `null`. On 16–17 Oct the header shows no countdown and says "SČÍTÁNÍ UKONČENO · 1. KOLO".
- The test uses the `runoff()` fixture (`round: 2`) at R1+1 h, a state the server cannot produce then.

**Fix:**
- Choose the round from the clock and the data: before R1, use round 1; otherwise use round 2 when `serverNow < POLLS_CLOSE[2]` and some obvod `state` starts with `runoff`.
- Rewrite the test with the `waiting()`-derived "all obvody runoff, round:1" snapshot.

Not a blocker for tonight.

### M2 — Security headers are missing on the deployed staging; `senat/public/_headers` is untracked

**Evidence:** GETs against staging at 13:37:
- `/` and `/assets/index-CD-3fcsd.js` → only `content-type` and `cache-control: public, max-age=0, must-revalidate`. There is no `X-Content-Type-Options`, no CSP, no `frame-ancestors`/`X-Frame-Options`, and no long cache on hashed assets.
- `/api/senat` → no `nosniff`.

`git status` shows `senat/public/_headers` as `??`. `wrangler deploy` ships whatever is in `senat/dist`, so production would get headers that are not in git. A deploy from a clean checkout would get none.

**Fix:**
1. Commit `_headers`.
2. Add `'X-Content-Type-Options': 'nosniff'` in `reply()` (`worker.js:99`).
3. Rebuild, redeploy staging, and check that the console shows no CSP violation.
   - React sets `style` props through the CSSOM, which `style-src 'self'` allows.
   - The only inline `style` is in the `<noscript>` block, and blocking it is harmless.
4. Check `/assets/*` → `immutable`.

### M3 — The `--faint` colour (#a3a3a3) is 2.52:1 on white and carries real information

**Where:**
- `styles.css:129` `.snt-rk2`: the rank numeral in every detail row, faint even when ranked.
- `:57` `.snt-tile.snt-zero b`: "0" counts.
- `:104` `.snt-unranked`.

**Evidence:** relative luminance of #a3a3a3 is 0.366, so (1.05)/(0.416) = 2.52. That fails AA even for large text (3:1).

For comparison, the other text colours pass:

| Text | Background | Ratio |
|---|---|---|
| `--ink-3` #6b6b6b | white | 5.3 |
| `--ink-3` #6b6b6b | page | 4.8 |
| `--out` | `--out-bg` | 4.8 |
| `--warn` | `--warn-bg` | 4.9 |
| white | live red #dc2626 | 6.3 |
| white | banner #c2410c | 5.2 |
| white 55 % (header subtitle) | black | 6.2 |
| black | yellow | ≈13.6 |

**Fix:**
- `.snt-rk2{color:var(--ink-2)}` when ranked; keep faint only for "–".
- Zero tiles: `color:var(--ink-3)` (5.3:1).

### M4 — The deploy log has no entry for the last staging deploys, so the rollback id is unknown

**Where:** `docs/ops/senat-deployments.md`.

**Evidence:**
- Staging serves `index-CD-3fcsd.js`, which is byte-identical to a build of the current tree (94074a5 / 6ab238f re-skin).
- The log ends at `3a744ce0`, "back-link", and that row is also out of time order (13:00 after 13:05).
- CLAUDE.md requires recording the previous version id before every deploy.

**Fix:** run `wrangler deployments list --env staging` now and add the missing rows. Do the same immediately before the production deploy.

---

## LOW

- **L1 — "dvě kandidatury" is wrong when three advance.** Where: `text.js:121`, `:130`. `whyAdvancing` and `whyAdvLead` say "postupují/jdou dvě kandidatury", but a tie for 2nd sends ≥ 3. The Guide already says "(při shodě i více)". *Fix:* "postupují kandidatury s nejvíce hlasy (obvykle dvě)", or count the `advancing` candidacies in the obvod.
- **L2 — "předvolební stav" stays on screen after polls close.** Where: `text.js:51` (`agoWaiting`). The text "předvolební stav, sčítání ještě nezačalo" stays from 14:00 until the first precinct, typically 20–40 min. *Fix:* when `serverNow ≥ POLLS_CLOSE[1]`, show "místnosti jsou zavřené, čeká se na první sečtené okrsky".
- **L3 — Number agreement in the tile labels.** "1 obvodů jde do 2. kola" and "1 … postupuje" read awkwardly in the secondary tiles. The main tiles ("X z 27 obvodů", "X z 18 kandidatur") are fine.
- **L4 — Google Fonts exposes every visitor's IP to Google on a Pirate Party page.** This is GDPR-sensitive (LG München 3 O 17493/20) and an easy story for critics. *Fix (after tonight):* self-host the three woff2 families, then drop `fonts.googleapis.com`/`gstatic` from the CSP.
- **L5 — The whole board re-renders every second.** `App` calls `useNow(1000)`, so `Board` (27 cells, 18 cards, detail) re-renders each second just for the header countdown. The cost is measurable but small on a phone. *Fix:* move `useNow` into `Header` and wrap `Board` in `memo`.
- **L6 — The client trusts `votes2 != null`; the server ranks only flagged finalists.** Where: `view.js:12` (`roundOf`) versus `derive.js:12`, which restricts round 2 to `st1 === '2.KOLO'`. If ČSÚ emitted `HLASY_2KOLO="0"` for non-finalists, the card would show "0 · 2. kolo" for an eliminated Pirate. The 2024 data does not do this. *Fix:* `c.votes2 != null && (c.st1 === '2.KOLO' || !o.candidates.some(x => x.st1 === '2.KOLO'))`.
- **L7 — Strip cells fall below 44 px at 320 px.** At 320 px they are ≈ 40 px wide (7 columns); at 360 px and above they are fine.
- **L8 — Two tests pass for the wrong reason.** `scenarios.js` computes `pct` by rounding, so no test can catch H1. The round-2 countdown test is the one in M1.

---

## Worker and ops (checked, no finding)

**Config:**
- Production: name `pirati-senat-zaloha`, the account id from the brief, custom domain only at top level, cron `* * * * *`, `workers_dev:false`.
- Staging: `-staging`, `routes: []`, `crons: []`, its own DO binding, migrations and assets.
- `vars` are explicit in both.

**14:00 transition:**
- The frozen file (`generated` 08.10.) stays zeroed (`preR1`, because `generated < close`) and the phase stays `waiting` at a 60 s cadence.
- The first post-close file replaces it without a baseline, and the regression baseline starts from there.
- The idle → round-2 cadence switches to 60 s at R2 − 5 min.

**Deploys and failure handling:**
- `CODE_REV` covers xml/time/normalize/derive/manifest, and a deploy discards the stored snapshot (cold start ≤ 12 s, documented).
- The last-resort copy (1200 s) and the 503 path are correct. `x-server-now` is on every Worker reply.

**Ops note:** production is **not yet deployed**. The first deploy creates the `senat.dg12.cz` custom domain, and its certificate can take minutes. Deploy production well before ~14:30, not at 15:00, then check `MISS`→`HIT` there.

---

## GO / NO-GO

**NO-GO as the tree stands.** It becomes **GO** once these two minimal blockers are fixed:

1. **H1:** card share and reason lines at 2 decimals (ČSÚ verbatim). Cards.jsx:35, outlook.js:44/47.
2. **H2:** precinct progress with `Math.floor`. Cards.jsx:13, Strip.jsx:7, Detail.jsx:56.

Both are display-only edits in the client and do not change `CODE_REV` or the server. After them: `npm run test:senat && npx eslint . && npm run build:senat`, a staging redeploy with a recorded version id (M4), and production on the owner's explicit confirmation.

M2 (commit `_headers` and redeploy) is strongly recommended in the same staging deploy but is not a blocker. M1, M3 and everything LOW can follow after tonight.

VERDICT: 0 CRITICAL, 2 HIGH
