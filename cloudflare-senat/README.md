# cloudflare-senat — výsledky voleb do Senátu 2026 (`senat.dg12.cz`)

Záložní kopie živých výsledků senátních voleb (kolo 1: 9.–10. 10. 2026, kolo 2: 16.–17. 10. 2026).
Samostatný Cloudflare Worker `pirati-senat-zaloha`; s pražským Workerem (`cloudflare/`, `pirati-volby-zaloha`)
nesdílí kód, Durable Object, ani konfiguraci. Spec: `docs/superpowers/specs/2026-10-10-senate-results-design.md`,
plán: `docs/superpowers/plans/2026-10-10-senate-results.md`.

## What runs where

| | Worker | URL |
|---|---|---|
| staging | `pirati-senat-zaloha-staging` | `https://pirati-senat-zaloha-staging.<subdomain>.workers.dev` (the account subdomain is printed by `wrangler deploy`; see its output) |
| production | `pirati-senat-zaloha` | `https://senat.dg12.cz` (custom domain only; `workers_dev: false`, see below) |

- Account `741febb7a315a409b83e5a9a1b62954d`. No KV, no analytics, no secrets; `vars` are empty unless an override is needed (see `POLLS_CLOSE_R2` below).
- The Cache API (`x-cache: HIT` / `LASTRESORT`) does not operate on `*.workers.dev`: every request there goes to the Durable Object (`x-cache: MISS`). That is why production has `workers_dev: false` (viewers must not land on an uncached URL) and staging, which keeps `workers_dev: true`, can only check the uncached path.
- `/api/senat` — JSON snapshot (`v: 1`), Cache API in front (TTL ≤ 5 s while counting, 300 s idle, 600 s final), one Durable Object `SenatFeed` (`idFromName('senat')`) refreshes from ČSÚ with a conditional GET.
- `/healthz` — constant `ok`, never touches the Durable Object (uptime checks).
- everything else — static assets from `../senat/dist` (the SPA has the single route `/`, unknown paths are 404).
- Cron `* * * * *` (production only) calls the Durable Object like a viewer; the DO itself decides whether a refresh is due.
- Optional env: `CSU_BASE` (default `https://volby.gov.cz/appdata/senat/20261009`), `POLLS_CLOSE_R2` (default `2026-10-17T14:00:00+02:00`). It is an override set **only** as a `vars` entry in the env block of `wrangler.jsonc` (a commented example sits there) and deployed through the normal staging-first flow, **never** as a dashboard setting (the next `wrangler deploy` would delete it and the gate would silently revert to 17. 10.). Accepted format: `YYYY-MM-DDTHH:mm[:ss]±HH:mm` (date with time and offset), later than the round-1 close and less than 30 days after it; a date only, a time without offset, or anything else makes the Durable Object throw at startup (viewers then get the last-resort copy or `503`).

## Deploy order (Czech: nasazení)

**Deviation note — please amend the repo `CLAUDE.md`.** This Worker is deployed from `cloudflare-senat/` under the owner's explicit instruction for the Senate workstream, whereas the repo `CLAUDE.md` ("Deploy rules") allows `wrangler deploy` only from `cloudflare/` for the Prague Worker. The owner (Václav Vislous) should add `cloudflare-senat/` (names `pirati-senat-zaloha`, `pirati-senat-zaloha-staging`) to that rule. Until then, do not deploy without his explicit go-ahead in the session.

All commands from `cloudflare-senat/`. Never `wrangler login` / `wrangler secret`, never set `GITHUB_TOKEN`.

1. Green gate from the repo root: `npm run test:senat`, `npm run lint`, `npm test`, `npm run build`, `npm run build:senat` (the last one creates `senat/dist`, which the `assets` binding needs).
2. Record the previous version: `npx wrangler deployments list` (on the very first deploy it prints nothing or an error: record **none**; for `--env staging` add the flag).
3. Staging: `npx wrangler deploy --env staging`.
4. Staging checks (below). If one fails, stop and report; do not redeploy in a loop. A redeploy is a new decision (with the owner), not an automatic retry.
5. Production + custom domain `senat.dg12.cz`: `npx wrangler deploy --env=""` **only on the owner's explicit confirmation in the session.** The explicit empty `--env=""` is what selects the production (top-level) config without the "multiple environments" warning. The first production deploy creates the custom-domain route. `x-cache: HIT` and `LASTRESORT` can be verified only there (see Checks).

Dry run (no upload, allowed any time): `npx wrangler deploy --dry-run --env="" --outdir /tmp/senat-dry-prod` (production), `npx wrangler deploy --dry-run --env staging --outdir /tmp/senat-dry` (staging); `npm run dryrun` does the bare form and prints the warning.

## Checks

```sh
BASE=https://pirati-senat-zaloha-staging.<subdomain>.workers.dev   # staging; production is https://senat.dg12.cz
curl -sI $BASE/api/senat     # 200, x-server-now: <ms>, cache-control: public, max-age=0, s-maxage=<=5; x-cache: MISS
curl -sI $BASE/api/senat     # staging (workers.dev): x-cache: MISS again, EVERY time. Production (senat.dg12.cz): HIT within the edge TTL (per datacentre)
curl -s  $BASE/api/senat | head -c 300   # "stale":false,"phase":"waiting"|"counting"|"idle"|"final","v":1
curl -s  $BASE/healthz       # ok
curl -sI $BASE/nonexistent   # 404
curl -si -X POST $BASE/api/senat   # 405
```

**Staging pass criterion:** every `/api/senat` request answers `200` with `x-cache: MISS` and a valid body (`"stale":false`, `"v":1`), `/healthz` `ok`, unknown path `404`, `POST` `405`. `HIT` and `LASTRESORT` can **not** appear on `*.workers.dev`; they are verified only on `senat.dg12.cz`, after the owner has approved the production deploy: first the `MISS` → `HIT` pair above, and `LASTRESORT` only by its code path (unit tests), never by breaking production.

A `x-cache: LASTRESORT` reply (body `"stale":true`) means the Durable Object failed or timed out and the 20 min copy was served; `UNAVAILABLE` (`503 {"error":"unavailable"}`) means there was no copy either. Logs: `npx wrangler tail [--env staging]` (JSON lines: `not-modified`, `rejected`, `build-failed`, `quarantine-accepted`, `cron`, …).

Local run against the real feed: `npm run build:senat` (root), then `npx wrangler dev --local --port 8799`. Before the polls close (2026-10-10 14:00 CEST) all numbers are forced to zero, even if ČSÚ publishes test data. In the `waiting` phase the upstream is re-checked once per minute (the first fetch is unconditional, later ones conditional and answered `304`).

## Rollback

`npx wrangler deployments list` (previous version id) → `npx wrangler rollback <version-id>` (add `--env staging` for staging). Rollback of the code does not delete the stored snapshot; the Durable Object discards it by itself when the schema/`CODE_REV` or `CSU_BASE` differ. **So a rollback to a version with another `CODE_REV` (any change to `xml`/`time`/`normalize`/`derive`/`manifest`) throws the stored snapshot away:** the next request is a cold start (waits up to 12 s for ČSÚ, then `503` or the last-resort copy if ČSÚ is slow) and the regression baseline for the next file is lost (the first valid file is accepted without comparison). Roll back only when the broken version does more harm than that.

## Kill switch

- Stop polling ČSÚ: remove the cron (`"triggers": { "crons": [] }`) and redeploy; viewers still get snapshots from the Durable Object, which refreshes on demand — to stop that too, roll back to a version without the Worker route, or remove the custom domain in the dashboard (owner's decision).
- Changing `CSU_BASE` to an empty fixture host is allowed **only under `wrangler dev`** (or on a `-drill` script), never on the production or staging scripts.

## Drills

Anything with a fake `CSU_BASE` (mock upstream, counting progression, runoff transition) runs only under `wrangler dev` or on a separate `pirati-senat-zaloha-drill` script (own name, no custom domain, no cron). Never against the production or staging Workers.

## Guards

- Never `git push` to `upstream`, never open PRs/issues against `jsemfast/pirati-vysledky-2026`; only `origin` (`vasek24/...`).
- Prefix every `gh` command with `GH_TOKEN=$(gh auth token --user vasek24)` and pass `--repo vasek24/pirati-vysledky-2026`; never `gh auth switch`.
- No secrets in git; the browser never requests `volby.gov.cz`. CI does not check `senat/dist` (its grep covers only the Prague `dist/assets` for `appdata/kv2026`), so this is a local gate before every deploy: `npm run build:senat && ! grep -rE "volby\.gov\.cz/appdata|appdata/senat" senat/dist/assets` (run from the repo root).
- Do not edit anything under `cloudflare/` (Prague) from this workstream.

## Maintainer

Václav Vislous, +420 777 954 389. He manages this fork and its modifications; he is not the author of the original tracker.
