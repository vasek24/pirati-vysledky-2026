# Senate election night — handover (2026-10-10 ~14:20 CEST)

Owner decision: the real-data check is done by the **other session** (Prague/Města line); the Senate session closes.
Production is live: `https://senat.dg12.cz` (Worker `pirati-senat-zaloha`, version `b7911dad-2427-4171-bc6c-13a908578f30`). Front door `volby.dg12.cz` is owned by main's line.

## What to check (read-only, nothing here needs a deploy)
1. From ~15:00 ČSÚ results flow. `curl -s https://senat.dg12.cz/api/senat | python3 -m json.tool | head -40` → `phase` goes `waiting` → `counting`, `stale:false`, `warnings` empty (a `sum-mismatch:*` or `attribution-mismatch:*` warning = look).
2. Truth check against ČSÚ (own User-Agent, polite, conditional GET): from a checkout of branch `senate/results`:
   `node cloudflare-senat/scripts/verify-against-csu.mjs https://senat.dg12.cz/api/senat` (all 27 obvody; `--obvod 30` for one). It compares our API with ČSÚ's `odata/vysledky.xml` and the independent JSON (`vysled/obvod/N.json`, `mapa_vitez.json`). Exit 1 = mismatch. Run every ~10 min for the first 2 h.
   Also eyeball Kladno (30), Příbram (18), Karviná (75) — the 3 Pirate-ticket candidacies — against https://volby.gov.cz/app/senat/20261009/cs/home.
3. Page: https://senat.dg12.cz on a phone: status chip, % (2 decimals, ČSÚ truncation), rank, "Předběžně…" vs official "Mandát získán / Postup do 2. kola".
4. Logs: `cd cloudflare-senat && npx wrangler tail pirati-senat-zaloha --format json` — expect one `not-modified`/install per minute, no `refresh-failed` bursts.

## If something is wrong
- Wrong number/status shown → emergency fix path: fix on `senate/results`, `TZ=UTC npm run test:senat && npx eslint . && npm run build:senat`, `cd cloudflare-senat && npx wrangler deploy --env staging`, check, then `npx wrangler deploy --env=""` (production). Rollback: `npx wrangler rollback <version-id> --env=""` (ids in `docs/ops/senat-deployments.md`; first prod deploy has no predecessor — to take the page down remove the custom domain in the dashboard).
- Page down / stale: `/healthz`, `wrangler tail`; ČSÚ unreachable → page keeps last-good with the stale banner (by design).

## Known non-blocking items (Codex final pass, fix later)
- round-2 votes without a round-2 summary row → derive treats it as `runoff`/idle (not expected from real ČSÚ data);
- missing `HLASY_PROC_2KOLO` shown as 0,00 %;
- country precinct totals are not range-checked;
- client round-2 countdown is hard-coded to 17. 10. (ignores a `POLLS_CLOSE_R2` override);
- production `workers_dev` is false by design.
Not wired: precinct-map add-on (`cloudflare-senat/src/okrsky*.js`, `geo/`, `WIRING-okrsky.md`) — parked.
Repo rule exception: this Worker deploys from `cloudflare-senat/` (see its README); CLAUDE.md still says `cloudflare/` only — owner to amend.
