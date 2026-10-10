# Wiring the precinct map backend (separate commit, after the production launch)

State: `src/okrsky*.js`, `scripts/build-okrsky-geo.mjs`, `fixtures/okrsky-2024-*.xml` and `geo/okrsky-*.geojson` are in the repo but **not wired**: `worker.js` does not import them, `wrangler.jsonc` has no binding, nothing is under `senat/public`. Production behaviour is unchanged until the steps below. Do them on a branch (`senate/okrsky-map`) with its own staging deploy and the usual review.

## 0. Contract of the endpoint (for the client)

`GET|HEAD /api/senat-okrsky?obvod=30[&round=1|2]` (obvody 18, 30, 75, derived from `manifest.js` `PIRATE_BACKED` relation `ticket`; any other value: `400 {"error":"bad-obvod"}`, bad round `400 {"error":"bad-round"}`, other methods `405`).

```
{ v:1, obvod, round, refreshedAt, nextRefreshAt, servedAt, stale, phase,       // phase: waiting | counting | idle
  generated, generatedMs,          // DATUM_CAS_GENEROVANI of the newest applied batch of that round (zone-less Prague time + epoch ms)
  batches: {1, 2},                 // last batch number consumed per round (test batches included)
  cands: [ballot numbers from the manifest, ascending], pirateNo,
  counted,                         // precincts of this obvod that have reported in `round`
  precincts: [[obec, okrsek, voters, valid, ...votes aligned with cands]] }
```

- `voters` = `ZAPSANI_VOLICI` (registered), `valid` = `PLATNE_HLASY`. Pirate share = `votes[cands.indexOf(pirateNo)] / valid` (undefined when `valid` is 0). A candidate with 0 votes is absent in the ČSÚ batch; the backend returns 0 for it.
- `round` defaults to 2 as soon as round-2 rows exist for that obvod, else 1. In round 2 the Pirate candidate may not be in the runoff: all her votes are then 0 here. The client must take "is she in the runoff" from `/api/senat` (or request `round=1`). Round 2 shows only after the round-2 close and the first K2 batch.
- Join polygon to row: `(properties.obec, properties.okrsek)` of `data/okrsky-<obvod>.geojson` = `(row[0], row[1])`.
- "x of N counted": N = 150 (30), 268 (18), 105 (75) from the secoco/`OKRSKY_CELKEM`; the polygon files hold a few extra polygons that never report (see `docs/analysis/senate-okrsky-geo-report.md`).
- Same edge behaviour as `/api/senat`: Cache API (key = validated query only, TTL `edgeTtl()`: 5 s while waiting/counting, 300 s idle), 20 min last-resort copy (`x-cache: LASTRESORT`, `"stale":true`), `503 {"error":"unavailable"}` when there is nothing, `x-server-now`, `x-content-type-options: nosniff`, no CORS header. A map failure never touches `/api/senat`: own Durable Object (`idFromName('okrsky')`), own cache keys, own storage.

## 1. `src/worker.js` (3 additions; do not change anything else)

```js
// next to the other imports
import { handleOkrskyRequest, warmOkrsky } from './okrsky-worker.js'
// after the SenatFeed class (wrangler needs the class exported from the main module)
export { OkrskyFeed } from './okrsky-worker.js'
```

In `export default { async fetch(...) { ... } }`, directly after the `/api/senat` line:

```js
    if (url.pathname === '/api/senat-okrsky') return handleOkrskyRequest(request, env, ctx)
```

At the end of `scheduled(event, env)`, after the existing `try { ... } catch { ... }` (its own try/catch; `warmOkrsky` already never throws, the wrapper is belt and braces):

```js
    try {
      await warmOkrsky(env)
    } catch { /* the map must never break the snapshot cron */ }
```

`CODE_REV` does not change (it hashes only `xml/time/normalize/derive/manifest`), so the stored `/api/senat` snapshot is **not** discarded by this deploy. The `OkrskyFeed` constructor reads `CSU_BASE` and `POLLS_CLOSE_R2` itself (`readOkrskyConfig`, same rules as `readConfig`); an invalid `POLLS_CLOSE_R2` makes only the map fail.

## 2. `wrangler.jsonc` (top level AND `env.staging`; staging repeats everything on purpose)

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "SENAT_FEED", "class_name": "SenatFeed" },
    { "name": "OKRSKY_FEED", "class_name": "OkrskyFeed" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["SenatFeed"] },
  { "tag": "v2", "new_sqlite_classes": ["OkrskyFeed"] }
]
```

Keep `v1` exactly as is (migrations are an append-only history). No new vars, no secrets, no KV. `npx wrangler deploy --dry-run --env staging --outdir /tmp/senat-dry` and `--env=""` must both succeed before any deploy.

## 3. Static geometry

```sh
mkdir -p senat/public/data
cp cloudflare-senat/geo/okrsky-*.geojson senat/public/data/
```

(served as `/data/okrsky-30.geojson`, built into `senat/dist` by `npm run build:senat`; sizes 84 KB / 145 KB / 38 KB raw, 17 / 31 / 6 KB gzip). Regenerate with `node cloudflare-senat/scripts/build-okrsky-geo.mjs <secoco.json>` (cached download in `/tmp/senat-geo-cache`, one request). Check the sizes with `ls -l`, keep each at most 150 KB.

## 4. `README.md` additions (Worker table and checks)

- Under "What runs where": `/api/senat-okrsky?obvod=30` — precinct results of the constituencies with a direct Pirate ticket (30, 18, 75), own Durable Object `OkrskyFeed` (`idFromName('okrsky')`, binding `OKRSKY_FEED`), fetches `odata/okrsky/K{1,2}/vysledky_okrsky_NNNNN.xml` incrementally from batch 1 (404 = end), at most 40 batches and 12 s per run, 60 s cadence while waiting/counting, 10 min after 30 min without a new batch; nothing is fetched before the round-1 close, K2 only from the round-2 close; batches generated before the round's close are test data (consumed, never applied). Cron warms it in its own try/catch.
- Under "Checks": `curl -sI $BASE/api/senat-okrsky?obvod=30` (200, `x-cache: MISS` on staging, `x-content-type-options: nosniff`, `x-server-now`), `curl -s '$BASE/api/senat-okrsky?obvod=21'` (400 `bad-obvod`), `curl -s $BASE/api/senat-okrsky?obvod=30 | head -c 400` (`"stale":false`, `"phase":"waiting"` before the close, `"counted":0`). Staging pass criterion as for `/api/senat`; `HIT` and `LASTRESORT` only on `senat.dg12.cz`.
- Logs (`wrangler tail`): `okrsky-run`, `okrsky-fetch-failed`, `okrsky-batch-unusable`, `okrsky-batch-number`, `okrsky-rehydrated`, `okrsky-rehydrate-discarded`, `okrsky-storage-put-failed`, `okrsky-feed-failed`, `okrsky-cron`, `okrsky-cron-failed`.
- Kill switch for the map only: remove the route line in `worker.js` (the path then answers 404 from the assets) and redeploy; the Durable Object and its storage stay (do not add `deleted_classes`: destructive and not needed). Reset of the stored batches: bump `OKRSKY.SCHEMA` in `okrsky-feed.js` (the next run discards the state and walks the batches again from 00001, 40 per run).

## 5. Tests and gates for the wiring commit

- `TZ=UTC npm run test:senat`, `npx eslint .`, `npm run build:senat`, dry runs for both environments.
- Add one assertion to `worker.test.js` (the file mocks `cloudflare:workers` already, which also covers `okrsky-worker.js`): `/api/senat-okrsky?obvod=21` answers 400 and `/api/senat-okrsky` with `POST` answers 405, both with `x-server-now`.
- On staging before the polls close (2026-10-10 14:00 CEST) every request must show `phase: waiting`, `counted: 0` and no upstream request to `odata/okrsky` (nothing is fetched before the close); after the close the first real batch is validated with `--check-batch` (see the geometry report).

## 6. Residual risks (decide, do not assume)

- Numbering: the 2025 polygons may not match 2026 precincts (report). The first batch decides.
- If ČSÚ restarts the batch numbering from 00001 after having published pre-close test batches, the consumed (gated) test batches hide the new ones. Detect: `batches` in the response stays > 0 while `counted` stays 0 well after 14:30. Fix: bump `OKRSKY.SCHEMA` and redeploy.
- A precinct re-sent with a **lower** `PORADI_ZPRAC` than the stored one is ignored by design (running sequence, highest wins).
- A down upstream for hours keeps serving the last data with `stale: true`; the client should surface the stale flag as it does for `/api/senat`.
