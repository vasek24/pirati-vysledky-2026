# Runbook — záložní kopie volebních výsledků (volby.dg12.cz)

Správce kopie: Václav Vislous, tel. +420 777 954 389 (spravuje tuto fork a její úpravy; není autorem originálu).
Maintainer: Václav Vislous manages this fork and its modifications. Phone +420 777 954 389.

## Kde co běží
| Prostředí | Worker | URL | Pozn. |
|---|---|---|---|
| produkce | `pirati-volby-zaloha` | https://pirati-volby-zaloha.vasek24.workers.dev (a po připojení https://volby.dg12.cz) | cron `* * * * *` zahřívá 11 radnic + přehled |
| staging | `pirati-volby-zaloha-staging` | https://pirati-volby-zaloha-staging.vasek24.workers.dev | bez cronu, vlastní KV a Durable Object |

Cloudflare účet: vasek24@protonmail.com (`account_id` 741febb7a315a409b83e5a9a1b62954d). GitHub fork: vasek24/pirati-vysledky-2026 (upstream jsemfast/pirati-vysledky-2026 — nikdy nepushovat).

## Nasazení (vždy staging první)
```sh
cd cloudflare && npm ci && npm run build
npx wrangler deploy --env staging            # 1) staging
# zkontroluj staging (viz Kontroly), pak:
npx wrangler deployments list                # 2) poznamenej předchozí verzi
npx wrangler deploy                          # 3) produkce
```
Před nasazením musí projít `npm test && npm run lint && npm run build` a `! grep -rl "appdata/kv2026" dist/assets`.
Nikdy nenasazovat zkušební/falešný `CSU_BASE` na `pirati-volby-zaloha`; drily jen na staging nebo `wrangler dev`.

## Rollback
```sh
cd cloudflare && npx wrangler deployments list
npx wrangler rollback <version-id>
```
Verze: produkce Phase 1a bez domény `a6495d68-e972-4127-b1d3-9826817d18c9`; produkce Phase 1a + doména volby.dg12.cz (2026-10-10 ~10:14) `15a89382-4b67-468d-9c7c-fcb90ffec3a3`; staging `5e68248d-52ea-4c2b-b7c8-7f018648ce00`.

## Kontroly po nasazení
- `curl -s -o /dev/null -w "%{http_code}\n" <URL>/version.json` → 200
- `curl -s <URL>/api/prehled | head -c 200` a `/api/volby?z=500216` (Praha 9), `/api/volby?z=554782` (Magistrát) → 200 JSON
- `/humans.txt`, `/kontakt.txt`, `/.well-known/security.txt` → 200
- logy: `npx wrangler tail pirati-volby-zaloha --format json` — v každé minutě `warmup-ok` pro všech 12 klíčů (11 zastup kódů + `prehled`); `warmup-failed` je potřeba řešit.

## Poznámky
- První dotazy do minuty po prvním nasazení nového Workeru mohou vrátit 404/503 (propagace); opakuj po ~30 s.
- Změna cron triggeru se může propagovat až 15 minut.
- Hlášení chyb je vypnuté: na Workeru nesmí být nastaven `GITHUB_TOKEN`.

## Poznámky z nasazení Phase 1b (2026-10-10 ~11:35)
- **Nasazení mění RPC kontrakt DO a Worker se nenasazují atomicky na všech izolátech**: v ~1 s okně po `wrangler deploy` volaly staré izoláty Workeru (verze `15a89382`) už nový DO a spadly na `Cannot read properties of undefined (reading 'cache-control')` → 3 požadavky dostaly 500. Nová verze (`d57c0296`) pak obsloužila vše. Pravidlo: změny tvaru odpovědi `run()` dělat zpětně kompatibilně (přidávat pole, nemazat), nebo nasazovat mimo špičku.
- Verze: produkce Phase 1b `d57c0296-c5dd-417a-a93a-64be647efc17` (předchozí `15a89382-4b67-468d-9c7c-fcb90ffec3a3`); staging `7ea8f9ed-949b-43b7-a6d3-b5e6b01e8368`.
- Po nasazení ověřit: `wrangler tail` ukáže `warmup-ok` pro všech 12 klíčů; `x-cache: HIT` při druhém dotazu; `x-server-now` v odpovědi.
