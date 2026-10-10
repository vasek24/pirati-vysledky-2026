# cloudflare-senat — výsledky voleb do Senátu 2026 (`senat.dg12.cz`)

Záložní kopie živých výsledků senátních voleb (kolo 1: 9.–10. 10. 2026, kolo 2: 16.–17. 10. 2026).
Samostatný Cloudflare Worker `pirati-senat-zaloha`; s pražským Workerem (`cloudflare/`, `pirati-volby-zaloha`)
nesdílí kód, Durable Object, ani konfiguraci. Spec: `docs/superpowers/specs/2026-10-10-senate-results-design.md`,
plán: `docs/superpowers/plans/2026-10-10-senate-results.md`.

## What runs where

| | Worker | URL |
|---|---|---|
| staging | `pirati-senat-zaloha-staging` | `https://pirati-senat-zaloha-staging.<subdomain>.workers.dev` (the account subdomain is printed by `wrangler deploy`; see its output) |
| production | `pirati-senat-zaloha` | `https://senat.dg12.cz` (custom domain) and `https://pirati-senat-zaloha.<subdomain>.workers.dev` |

- Account `741febb7a315a409b83e5a9a1b62954d`. No KV, no analytics, no secrets, no vars.
- `/api/senat` — JSON snapshot (`v: 1`), Cache API in front (TTL ≤ 5 s while counting, 300 s idle, 600 s final), one Durable Object `SenatFeed` (`idFromName('senat')`) refreshes from ČSÚ with a conditional GET.
- `/healthz` — constant `ok`, never touches the Durable Object (uptime checks).
- everything else — static assets from `../senat/dist` (the SPA has the single route `/`, unknown paths are 404).
- Cron `* * * * *` (production only) calls the Durable Object like a viewer; the DO itself decides whether a refresh is due.
- Optional env: `CSU_BASE` (default `https://volby.gov.cz/appdata/senat/20261009`), `POLLS_CLOSE_R2` (ISO date, default `2026-10-17T14:00:00+02:00`; set it if the runoff slips to 23.–24. 10.). A bad date makes the Durable Object throw at startup (viewers then get the last-resort copy or `503`).

## Deploy order (Czech: nasazení)

**Deviation note — please amend the repo `CLAUDE.md`.** This Worker is deployed from `cloudflare-senat/` under the owner's explicit instruction for the Senate workstream, whereas the repo `CLAUDE.md` ("Deploy rules") allows `wrangler deploy` only from `cloudflare/` for the Prague Worker. The owner (Václav Vislous) should add `cloudflare-senat/` (names `pirati-senat-zaloha`, `pirati-senat-zaloha-staging`) to that rule. Until then, do not deploy without his explicit go-ahead in the session.

All commands from `cloudflare-senat/`. Never `wrangler login` / `wrangler secret`, never set `GITHUB_TOKEN`.

1. Green gate from the repo root: `npm run test:senat`, `npm run lint`, `npm test`, `npm run build`, `npm run build:senat` (the last one creates `senat/dist`, which the `assets` binding needs).
2. Record the previous version: `npx wrangler deployments list` (on the very first deploy it prints nothing or an error: record **none**; for `--env staging` add the flag).
3. Staging: `npx wrangler deploy --env staging`.
4. Staging checks (below). Fix and repeat step 3 until they pass.
5. Production + custom domain `senat.dg12.cz`: `npx wrangler deploy` **only on the owner's explicit confirmation in the session.** The first production deploy creates the custom-domain route.

Dry run (no upload, allowed any time): `npx wrangler deploy --dry-run --outdir /tmp/senat-dry` (add `--env staging` for staging); `npm run dryrun` does the same.

## Checks

```sh
BASE=https://pirati-senat-zaloha-staging.<subdomain>.workers.dev   # or https://senat.dg12.cz
curl -sI $BASE/api/senat     # 200, x-cache: MISS (first), x-server-now: <ms>, cache-control: public, max-age=0, s-maxage=<=5
curl -sI $BASE/api/senat     # x-cache: HIT within the edge TTL (per datacentre)
curl -s  $BASE/api/senat | head -c 300   # "stale":false,"phase":"waiting"|"counting"|"idle"|"final","v":1
curl -s  $BASE/healthz       # ok
curl -sI $BASE/nonexistent   # 404
curl -si -X POST $BASE/api/senat   # 405
```

A `x-cache: LASTRESORT` reply (body `"stale":true`) means the Durable Object failed or timed out and the 20 min copy was served; `UNAVAILABLE` (`503 {"error":"unavailable"}`) means there was no copy either. Logs: `npx wrangler tail [--env staging]` (JSON lines: `not-modified`, `rejected`, `build-failed`, `quarantine-accepted`, `cron`, …).

Local run against the real feed: `npm run build:senat` (root), then `npx wrangler dev --local --port 8799`. Before the polls close (2026-10-10 14:00 CEST) all numbers are forced to zero, even if ČSÚ publishes test data. In the `waiting` phase the upstream is re-checked once per minute (the first fetch is unconditional, later ones conditional and answered `304`).

## Rollback

`npx wrangler deployments list` (previous version id) → `npx wrangler rollback <version-id>` (add `--env staging` for staging). Rollback of the code does not delete the stored snapshot; the Durable Object discards it by itself when the schema/`CODE_REV` or `CSU_BASE` differ.

## Kill switch

- Stop polling ČSÚ: remove the cron (`"triggers": { "crons": [] }`) and redeploy; viewers still get snapshots from the Durable Object, which refreshes on demand — to stop that too, roll back to a version without the Worker route, or remove the custom domain in the dashboard (owner's decision).
- Changing `CSU_BASE` to an empty fixture host is allowed **only under `wrangler dev`** (or on a `-drill` script), never on the production or staging scripts.

## Drills

Anything with a fake `CSU_BASE` (mock upstream, counting progression, runoff transition) runs only under `wrangler dev` or on a separate `pirati-senat-zaloha-drill` script (own name, no custom domain, no cron). Never against the production or staging Workers.

## Guards

- Never `git push` to `upstream`, never open PRs/issues against `jsemfast/pirati-vysledky-2026`; only `origin` (`vasek24/...`).
- Prefix every `gh` command with `GH_TOKEN=$(gh auth token --user vasek24)` and pass `--repo vasek24/pirati-vysledky-2026`; never `gh auth switch`.
- No secrets in git; the browser never requests `volby.gov.cz` (CI greps `senat/dist/assets` for `appdata`).
- Do not edit anything under `cloudflare/` (Prague) from this workstream.

## Maintainer

Václav Vislous, +420 777 954 389. He manages this fork and its modifications; he is not the author of the original tracker.
