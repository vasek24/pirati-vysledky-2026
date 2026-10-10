# Runbook — Města (mesta.dg12.cz)

Správce: Václav Vislous, tel. +420 777 954 389 (spravuje tento fork a jeho úpravy; není autorem originálu).
Maintainer: Václav Vislous manages this fork and its modifications. Phone +420 777 954 389.

## Kde co běží
| Prostředí | Worker | URL | Pozn. |
|---|---|---|---|
| produkce | `pirati-mesta` | https://mesta.dg12.cz (až po bráně, viz níže), vždy též https://pirati-mesta.vasek24.workers.dev | cron `* * * * *` zahřívá feedy první třídy (30 klíčů: 12 největších měst + shardy) |
| staging | `pirati-mesta-staging` | https://pirati-mesta-staging.vasek24.workers.dev | bez cronu a bez domény, vlastní Durable Object |

Cloudflare účet `741febb7a315a409b83e5a9a1b62954d` (vasek24@protonmail.com). Větev **`mesta/main`** (integrační; do `main` se tuto noc nemerguje). Mesta nesdílí s Prahou žádný DO/KV/cron.

## Nasazení — JEN přes `scripts/mesta.sh`
```sh
bash scripts/mesta.sh deploy-staging   # build + kontrola buildu a dat + záznam verze + wrangler deploy --env staging
bash scripts/mesta.sh deploy-prod      # totéž pro produkci (prázdné --env=); jen z větve mesta/main, jen z čistého stromu
```
- **Nikdy** holé `wrangler deploy` ve složce `cloudflare/` na větvi `mesta/*` (výchozí konfigurace tam je pražská) a **nikdy** `deploy.yml` dispatch na `mesta/*` refu.
- Před nasazením: `npm test && npm run lint`, `bash scripts/mesta.sh build` (kontrola buildu + `scripts/mesta-data-check.mjs`: každé publikované město má data), a **`bash scripts/check-prague-unchanged.sh` bez `GUARD_SKIP_WORKER`** (výstup `PRAGUE UNCHANGED`; exit 4 `PARTIAL` není průchod).
- Předchozí verzi zapisuje skript do `.cache/mesta-deployments-<čas>-<cíl>.txt`; rollback: `cd cloudflare && npx wrangler rollback <version-id> -c wrangler.mesta.jsonc [--env staging]`.
- Doména se připojuje až po ověření a po bráně: do `wrangler.mesta.jsonc` přidat `"routes": [{ "pattern": "mesta.dg12.cz", "custom_domain": true }]` (jen na nejvyšší úrovni), znovu `deploy-prod`.

## Brána před zveřejněním měst (spec §9.3)
1. Codex nad specifiky: `docs/analysis/mesta-specifics-codex.md` (PASS, nálezy opraveny).
2. Vlastník prochází `docs/analysis/mesta-specifics.md` + `mesta-list-verification.md` a rozhoduje „K rozhodnutí vlastníka“.
3. Města s nízkou jistotou (Mikulov, Rychvald a případné další) jsou na indexu **skrytá**, dokud vlastník v `src/mesta/overrides.js` nenastaví `reviewed: true` u města (a/nebo globální `reviewedAt`), pak build + deploy-prod.

## Kontroly po nasazení
- **Hned po `deploy-prod` a před připojením domény:** `node scripts/mesta-smoke.mjs https://pirati-mesta.vasek24.workers.dev` — projde všech 81 měst (zahřeje i feedy, které cron nezahřívá; první dotaz na studený feed může vrátit 503, další už ne) a musí skončit `PASS`.
`<URL>` = produkce nebo staging.
- `/`, `/brno`, `/klatovy`, `/neexistuje` → index/stránka 200; `/version.json` 200 (`mesta-…`); `/humans.txt`, `/kontakt.txt` 200.
- `/api/volby?z=582786` (Brno) 200 JSON; `/api/volby?z=1` 400; `/api/kraj?s=top-1`, `/api/kraj?s=top-2` 200; `/api/kraj?s=nic` 400.
- Index na 375 px: první načtení ≤ 3 požadavky na `/api/kraj`; konzole bez chyb.
- Logy: `npx wrangler tail pirati-mesta --format json` — každou minutu `warmup-ok` pro všech klíčů první třídy do 2 min po nasazení.
- Ověření proti ČSÚ po začátku sčítání (spec §8): Brno, Plzeň, Hradec Králové, Jablonec nad Nisou, Klatovy + Moravskoslezský kraj (2 shardy): stejné `generated`, počet sečtených okrsků, účast, hlasy a % prvních 5 kandidátek a pirátské kandidátky. Rozdíl jen při jiném `generated`; za minutu zopakovat. Karta na indexu bere čas a počet okrsků jen z výsledkového souboru, stránka města i z účasti — o minutu starší čas na kartě není chyba.

## Mapa okrsků (12 největších měst)
- Mapu a okrskové soubory ČSÚ mají jen zobrazená města s `featured` (`buildCouncils`: `map` = `precinctFiles`); ostatní jsou v lehkém režimu.
- **Vypínač (kill switch) jednoho města:** `overrides.js` → `towns['<KODZASTUP>'] = { name, map: false }`, pak `node scripts/build-data.js --product=mesta --maps-only` (vyprázdní `okrsky.geojson` města; data check do té doby jen varuje), `bash scripts/mesta.sh build`, nasazení. Worker pak přestane stahovat okrskové soubory, stránka ukáže jen panely.
- Hranice: `bash scripts/mesta.sh data --maps-only [slug…]` přegeneruje jen `okrsky.geojson` z `.cache/84a3c42833510b20.geojson` (celostátní vrstva ČSÚ 2025) a registru z `.cache`. Městská část, ve které je zaniklý polygon nebo okrsek 2026 bez polygonu, se z mapy vynechá celá (Plzeň 1, Ostrava-Jih, Brno-Medlánky); seznam je v `droppedDistricts` v geojsonu a stránka z něj složí větu. Výstup uvádí zahozené polygony a městské části. „Sečteno X z N“ se tím nemění (součty ČSÚ).
- **Pravidlo pro nasazení: žádné produkční nasazení mezi 15:00 a vyhlášením výsledků, pokud to není kritické.** Nasazení restartuje všechny Durable Objecty a každý DO si znovu stáhne okrskové soubory všech sečtených okrsků (Brno až 353 × ~37 KB; souběžnost je omezená na 3 na město, tedy ≤ 36 dotazů naráz).
- Sledování: `npx wrangler tail pirati-mesta --format json` a hledat `incomplete-persistent` (okrsek, kterému ČSÚ změnil řádek a jehož soubor je ještě starý, drží poslední dobrý snapshot; po 5 min se loguje jako error). Spustí-li se u města s mapou, použít vypínač výše. Zátěž a chování Workeru: `docs/analysis/mesta-maps-load.md`.
- Náhled bez sítě: `bash scripts/mesta.sh build && node tools/mesta-map-mock.mjs --port=4173`, pak `http://127.0.0.1:4173/brno` (`--counted=0.3 --pending=0.1 --geo=empty|missing`).
- Podkladové dlaždice mapy jdou z externího hostitele `tiles.openfreemap.org` (beze změny proti Praze).

## Poznámky
- Města první třídy (feedy zahřívané cronem) jsou 12 největších (`featured`); ostatní se obnovují jen když je někdo otevře (shard feedy po krajích, max. 8 měst).
- ČSÚ `generated` je pražský čas bez zóny — vždy přes `parseCsuTime`.
- První dotazy do minuty po prvním nasazení nového Workeru mohou vrátit 404/503 (propagace).
- Změna tvaru RPC mezi Workerem a DO: aditivně, nebo nasazovat mimo špičku (viz `runbook.md`, Phase 1b).
- Hlášení chyb je vypnuté: na Workeru nesmí být nastaven `GITHUB_TOKEN`.
- Rozcestník (`volby.dg12.cz`, Worker `pirati-rozcestnik`): karta Města se zapíná až po zveřejnění (`placeholder/index.html` + `src/rozcestnik.test.js`).
