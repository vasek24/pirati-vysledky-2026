# Mapy okrsků ve městech: zátěž a chování Workeru

Stav: T10, 2026-10-10. Platí pro 12 měst s mapou (`featured`: České Budějovice, Plzeň, Liberec, Brno, Olomouc, Ostrava, Kladno, Most, Ústí nad Labem, Hradec Králové, Pardubice, Zlín). Ostatní města jsou beze změny (2 soubory ČSÚ na obnovu).

## Co nového Worker stahuje
Navíc proti lehkému režimu: `vysled/okrsek/<okres>/<zastup>_<okrsek>.json` pro každý **nově sečtený** okrsek (nebo okrsek s jinou řádkou v `ucast`), přes limiter 6 souběžných dotazů na město (`createKvFeed`, `concurrency: 6`). Obnova pořád bere 2 podmíněné soubory (`ucast`, `vysled`).

## Odhad zátěže na volby.gov.cz za večer
Velikost okrskového souboru ≈ 42 B × počet kandidátů + 2 KB (u Prahy-Magistrátu naměřeno ~45 KB pro 1 060 kandidátů, `docs/MAGISTRAT.md`). Počty kandidátů z `lists.json`.

| Město | okrsků | kandidátů | ~KB/soubor | ~MB za večer |
|---|---|---|---|---|
| Brno | 353 | 828 | 37 | 13 |
| Ostrava | 246 | 715 | 32 | 7,9 |
| Plzeň | 174 | 549 | 25 | 4,4 |
| Olomouc | 96 | 472 | 22 | 2,1 |
| České Budějovice | 90 | 405 | 19 | 1,7 |
| Liberec | 87 | 361 | 17 | 1,5 |
| Hradec Králové | 85 | 369 | 17 | 1,5 |
| Pardubice | 92 | 351 | 17 | 1,5 |
| Ústí nad Labem | 97 | 296 | 14 | 1,4 |
| Zlín | 74 | 369 | 17 | 1,3 |
| Most | 60 | 322 | 16 | 0,9 |
| Kladno | 57 | 293 | 14 | 0,8 |
| **Celkem** | **1 511** | | | **~38 MB** |

- **Ustálený stav** (DO zůstává v paměti): každý okrsek se stáhne jednou, tj. ~1 511 souborů a ~38 MB za celý večer pro všech 12 měst, k tomu ~24 podmíněných souborů za 20–60 s (většinou 304). Pro srovnání: lehký režim je ~24 požadavků / min.
- **Špička souběžnosti**: 12 DO × 6 = nejvýš **72** souběžných dotazů (jen když by se současně sčítala všechna města; za studeného startu Brna je to 6, protože limiter je na město).
- **Za sčítání** přicházejí okrsky postupně (Brno 353 okrsků za ~2–4 h) → v průměru jednotky souborů za minutu na město.
- **Riziko: vyhození DO z paměti.** Feed si hlasy po okrscích drží jen v paměti. Po vyhození z paměti nová instance stáhne okrskové soubory VŠECH už sečtených okrsků znovu (test `cloudflare/mestaMaps.test.js`: 212 sečtených = 212 stažení), i když má v úložišti poslední snapshot. Při opakovaném vyhazování každou obnovu by to u Brna bylo až ~13 MB/obnovu v pozdní fázi. DO s požadavky každých 20–60 s by v paměti zůstat měl (zahřívání cronem pro `featured`), ale je to jediné místo, kde zátěž může vzrůst násobně — sledovat `wrangler tail` (počet `okrsek` dotazů) a v případě potřeby vypnout mapu jednoho města (`overrides.js` → `map: false`).

## Co se stane na studeném DO uprostřed sčítání (zkoušeno testem, Brno 353 okrsků, 212 sečtených, 0,4 s/soubor)
`cloudflare/mestaMaps.test.js`:
1. **Studený start bez uloženého snapshotu**: `get()` čeká `precinctWaitMs` = 3 s (ne 35 s ani celou 12s lhůtu), pak publikuje snapshot: souhrn města (strany, mandáty, `precincts.counted`) je úplný, `okrsky[id]` mají hlasy jen u okrsků, které se stihly (zhruba 6 souběžných / 0,4 s × 3 s ≈ 45), **ostatní sečtené okrsky mají `votes: null`** (nikdy nuly). Zbytek se dotahuje na pozadí a je hotový za ~14 s.
2. **Stránka**: okrsek `votes: null` je „sečteno, hlasy se dotahují“ — žlutooranžový čárkovaný polygon s vysvětlením v legendě a v tooltipu, NE šedý „čeká na sečtení“ (patch `ResultsMap`). Hlavička (sečteno X z N) je z ČSÚ souhrnu, takže správná.
3. **Další obnovy** (≥ 20 s): odpověď je okamžitě poslední dobrý snapshot (`refreshing: true`), nová verze se publikuje po dokončení; po jednom až dvou cyklech mají hlasy všechny okrsky; počty okrsků s hlasy jen rostou, souhrn se kvůli okrskům nemění.
4. **Vyhození DO**: nová instance obslouží uložený snapshot hned (bez čekání na build), `mergeCandidate` doplní hlasy z uloženého snapshotu (stejná řádka účasti), takže po obnově nikdy nemá méně okrsků s hlasy; neúplný kandidát (okrsek, který hlasy měl a teď je nemá a nejdou doplnit) se nepublikuje (`incomplete`, viz `refresh.test.js`, `validate.test.js`).
5. **Okrskové soubory ČSÚ padají (500)**: souhrn i počty sečtených okrsků se publikují dál, hlasy po okrscích jsou `null` (žlutooranžové polygony), po obnovení ČSÚ se doplní.
6. **Velikost**: Brno 353/353 okrsků s hlasy = ~79 KB snapshot (bez preferenčních hlasů, které jsou v souhrnu a přidají ~40 KB); limit pro uložení je 1,5 MB (`REFRESH.MAX_BYTES`), tj. rezerva > 10×.

„Částečný snapshot publikovaný jako úplný“ zde znamená jen chybějící hlasy po okrscích; to je v datech vždy `null` a UI to tak ukazuje. Hlavní čísla (strany, mandáty, sečteno X/N) částečná nikdy nejsou.

## Velikost dat
- `okrsky.geojson` 12 měst: celkem 527 KB (Brno 117 KB, Ostrava 84 KB, Plzeň 57 KB, České Budějovice 43 KB, Ústí 37 KB, Olomouc 34 KB, Pardubice 31 KB, Liberec 31 KB, Hradec Králové 29 KB, Zlín 25 KB, Most 20 KB, Kladno 20 KB). Stahuje se jen na stránce města s mapou. Index (`MestaIndex`) a shardy se nemění.
