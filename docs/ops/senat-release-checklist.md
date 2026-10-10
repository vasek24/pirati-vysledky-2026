# Senát 2026 — kontrolní seznam nasazení (staging → produkce)

Go/no-go list for `pirati-senat-zaloha-staging` → `pirati-senat-zaloha` (`senat.dg12.cz`). Do it top to bottom; a failed box is a **no-go**, not a "fix it later". Every `wrangler` command runs from `cloudflare-senat/`, never `wrangler login` / `secret`, never a `GITHUB_TOKEN`. Production needs the owner's explicit "yes" in the session (step 8); a past approval does not carry over.

Maintainer / who to call: **Václav Vislous, +420 777 954 389** (manages this fork and its modifications; not the author of the original tracker).
Plan and background: `docs/ops/senat-qa-plan.md`. Version log to update at the end: `docs/ops/senat-deployments.md`.

Record while you go (paste into the log at the end):

| Item | Value |
|---|---|
| Commit (`git rev-parse --short HEAD`) | |
| Previous staging version id | |
| Previous production version id (`none` on the first deploy) | |
| New staging version id | |
| New production version id | |
| Time of production deploy (CEST) | |

## 1. Brána v repu (Gates, local, repo root)

- [ ] `git status` shows only intended changes; HEAD is the commit you will describe in the log. Nothing under `cloudflare/`, `src/`, `public/`, `api/`, `.github/` changed.
- [ ] `TZ=UTC npm run test:senat` green.
- [ ] `npm run lint` green.
- [ ] `npm test` green (Prague suite, proves nothing there moved).
- [ ] `npm run build` green (Prague build).
- [ ] `npm run build:senat` green, **rebuilt after the last source change** (`senat/dist` must contain `_headers`).
- [ ] `node cloudflare-senat/scripts/qa-gates.mjs` (or `npm run qa:senat`): every row PASS. It covers: dist files incl. `security.txt` (tel + Expires in the future), browser never requests `volby.gov.cz/appdata`, no `pirati.cz`/`jsemfast`/`GITHUB_TOKEN`, bundle budget, `_headers` + CSP versus `index.html`, `wrangler.jsonc` invariants (names, account, `senat.dg12.cz` custom domain, staging routes `[]`, staging crons `[]`, no KV/secrets), Prague untouched vs `main`, and `wrangler deploy --dry-run` for production and staging.
- [ ] Mock drill passed once on the **current** code (`docs/ops/senat-qa-plan.md` §4; after 14:00 only; ~20 min). Skip only with the owner's agreement and write down why.
- [ ] Open items from the last QA report (contrast, label mismatch, Worker headers) are fixed or consciously accepted by the owner.

## 2. Dry runs (included in the gate; rerun by hand if in doubt)

```sh
cd cloudflare-senat
npx wrangler deploy --dry-run --env="" --outdir /tmp/senat-dry-prod
npx wrangler deploy --dry-run --env staging --outdir /tmp/senat-dry-staging
```
- [ ] Both exit 0, end with "--dry-run: exiting now", no warning about multiple environments.

## 3. Předchozí verze (previous version id, before every deploy)

```sh
npx wrangler deployments list --env staging     # note the newest version id (or "none")
npx wrangler deployments list                   # production; "none"/error on the very first deploy
```
- [ ] Both ids written in the table above.

## 4. Staging

```sh
npx wrangler deploy --env staging               # worker pirati-senat-zaloha-staging, workers.dev only, no cron, no route
```
- [ ] Output names `pirati-senat-zaloha-staging` and the URL `https://pirati-senat-zaloha-staging.vasek24.workers.dev`; **no** custom domain or schedule line. New version id recorded.
- [ ] Wait ~30 s (propagation), then, with `BASE=https://pirati-senat-zaloha-staging.vasek24.workers.dev`:

| Check | Command | Expect |
|---|---|---|
| health | `curl -s $BASE/healthz` | `ok` |
| API | `curl -sI $BASE/api/senat` | 200, `cache-control: public, max-age=0, s-maxage=<=5`, `x-server-now`, `x-cache: MISS` (always MISS on workers.dev) |
| body | `curl -s $BASE/api/senat \| head -c 300` | `"stale":false`, `"v":1`, a `phase` |
| unknown path | `curl -sI $BASE/nonexistent` | 404 |
| method | `curl -si -X POST $BASE/api/senat` | 405 |
| page | `curl -sI $BASE/` | 200, `content-security-policy`, `x-content-type-options: nosniff`, `cache-control: no-cache` |
| asset | `curl -sI $BASE/assets/<file from index.html>` | `cache-control: public, max-age=31536000, immutable` |
| contact | `curl -s $BASE/.well-known/security.txt $BASE/humans.txt $BASE/kontakt.txt` | phone present, Expires in the future |

- [ ] Browser at 375 px on the staging URL: page renders, **console empty** (no CSP violation), back-link goes to `volby.dg12.cz`, no request to `volby.gov.cz` in the network tab.
- [ ] `node cloudflare-senat/scripts/verify-against-csu.mjs $BASE` (needs real counted data to mean much; before counting it only proves the mapping and zero-state): no `fail` row.
- [ ] Burst, staging only: `node cloudflare-senat/scripts/burst.mjs $BASE --concurrency 20 --seconds 20 --max-rps 100` → PASS.
- [ ] `npx wrangler tail --env staging --format json` for 2 minutes: `cron` is absent (staging has no cron), no `feed-failed`, no `rejected`, no `attribution-mismatch`.
- [ ] **Rollback rehearsal (once per release train, on staging):** `npx wrangler rollback <previous staging version id> --env staging` (skip if there is none), check `/healthz` and `/api/senat`, then redeploy the new version with step 4. Note that a rollback to another `CODE_REV` discards the stored snapshot and the next request is a cold start (up to 12 s).

## 5. Rozhodnutí (go / no-go)

GO only if **all** are true; otherwise stop and call the maintainer.

- [ ] Sections 1–4 fully ticked.
- [ ] No unexplained `fail` or persistent `lag` in the latest `verify-against-csu` run.
- [ ] Previous production version id recorded (or "none: first deploy" written down, and the owner knows the rollback is then "remove the custom domain / disable", see section 9).
- [ ] The owner has said "deploy production" in this session, after seeing the staging results.
- [ ] Not in the middle of a ČSÚ-side problem you are chasing (if numbers look wrong, fix understanding first).

## 6. Produkce (production + custom domain)

```sh
cd cloudflare-senat
npx wrangler deploy --env=""        # explicit empty env = the top-level (production) config
```
- [ ] Output names `pirati-senat-zaloha`, the route `senat.dg12.cz (custom domain)` and the schedule `* * * * *`; **not** `-staging`. New version id recorded.
- [ ] Never edit `wrangler.jsonc` vars in the dashboard (the next deploy deletes them); overrides only in the file, through this same flow.
- [ ] If this deploy changes the shape of the Durable Object's `run()` answer, remember the Prague lesson (`docs/ops/runbook.md`, Phase 1b): old isolates may call the new DO for ~1 s; change the shape backwards compatibly (add fields, never remove).

## 7. Doména (custom domain attach check)

```sh
curl -I https://senat.dg12.cz/healthz        # expect HTTP/2 200
dig +short senat.dg12.cz                      # resolves (Cloudflare proxy addresses)
```
- [ ] 200 from `senat.dg12.cz`. A TLS error or 52x in the first minutes after the first deploy is normal while the certificate is issued: retry every 30 s for up to ~5 minutes. Still failing after 10 minutes: no-go for announcing the URL; check the dashboard (Workers → `pirati-senat-zaloha` → Settings → Domains & Routes) with the owner. `volby.dg12.cz` (Prague) must be untouched: `curl -sI https://volby.dg12.cz/version.json` still 200.

## 8. Produkční smoke test

With `BASE=https://senat.dg12.cz`:

- [ ] `curl -sI $BASE/api/senat` → 200, `x-cache: MISS`; the **second** call → `x-cache: HIT` (this is the only place HIT/LASTRESORT can be verified; LASTRESORT only by its code path, never by breaking production).
- [ ] `curl -s $BASE/api/senat | head -c 300` → `"stale":false`, `"v":1`; `phase` fits the time of day.
- [ ] `curl -sI -X POST $BASE/api/senat` → 405; `curl -sI $BASE/nonexistent` → 404; `curl -s $BASE/healthz` → `ok`.
- [ ] `curl -sI $BASE/` → CSP, nosniff, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `cache-control: no-cache`.
- [ ] `/.well-known/security.txt`, `/humans.txt`, `/kontakt.txt` → 200 with the maintainer phone.
- [ ] Browser, phone width: page loads, LIVE pill and "další kontrola" countdown move, console empty, a card expands, back-link works.
- [ ] `node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz` once → no `fail` row.
- [ ] Record the production version id and time; add the row to `docs/ops/senat-deployments.md`.

## 9. Sledování 15 minut (15-minute watch)

`npx wrangler tail pirati-senat-zaloha --format json` in one terminal, `/healthz` and `/api/senat` in another.

| Minute | Look at | Expect |
|---|---|---|
| 0–2 | `cron` lines | one per minute, `stale:false`; first request cold start ≤ 12 s |
| 5 | `/api/senat` | `stale:false`, `generated` moves with ČSÚ, HIT on repeat |
| 10 | log | no `rejected`, no `feed-failed`, no `attribution-mismatch`, no repeated `build-failed` |
| 15 | `verify-against-csu` again | no `fail`; our lag ≤ 120 s |

Any red line: do not redeploy in a loop. Decide with the owner: fix forward only for a one-line config problem; otherwise roll back.

## 10. Rollback

```sh
cd cloudflare-senat
npx wrangler deployments list                       # confirm the id recorded in step 3
npx wrangler rollback <previous-production-version-id>
curl -s https://senat.dg12.cz/healthz && curl -sI https://senat.dg12.cz/api/senat
```
- Roll back when the page serves wrong numbers, or is down, or `stale:true` persists > 5 minutes with ČSÚ healthy. Do **not** roll back for a cosmetic issue.
- A rollback to a version with another `CODE_REV` (any change to `xml`, `time`, `normalize`, `derive`, `manifest`) discards the stored snapshot: next request is a cold start, and the regression baseline is lost (first valid file accepted without comparison). Say so before you do it.
- First production deploy has no previous version: the "rollback" is the kill switch from `cloudflare-senat/README.md`: remove the cron and redeploy, or (owner's decision) remove the custom domain in the dashboard so `senat.dg12.cz` stops answering. Prague stays up either way.
- Staging rollback: same command with `--env staging`.
- After any rollback: write what happened in `docs/ops/senat-deployments.md`.

## 11. Kdo volat (who to call)

- Václav Vislous, **+420 777 954 389**: owner and maintainer, decides on production, rollback and the kill switch.
- ČSÚ numbers look wrong and our page matches the ČSÚ XML: not our bug; compare with the public app `https://volby.gov.cz/app/senat/20261009/cs/home` and tell the owner before anyone else.
- Cloudflare incident: https://www.cloudflarestatus.com/ ; the Prague backup (`volby.dg12.cz`) is independent of this Worker.
