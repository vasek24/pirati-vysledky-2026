# Mapy okrsků ve městech: zátěž a chování Workeru

Stav: T10, 2026-10-10. Platí pro 12 měst s mapou (`featured`: České Budějovice, Plzeň, Liberec, Brno, Olomouc, Ostrava, Kladno, Most, Ústí nad Labem, Hradec Králové, Pardubice, Zlín). Ostatní města jsou beze změny (2 soubory ČSÚ na obnovu).

## Co nového Worker stahuje
Navíc proti lehkému režimu: `vysled/okrsek/<okres>/<zastup>_<okrsek>.json` pro každý **nově sečtený** okrsek (nebo okrsek s jinou řádkou v `ucast`), přes limiter 3 souběžných dotazů na město (`mestaWiring.buildFeed`: `concurrency: 3`; výchozí `createKvFeed` je 6). Obnova pořád bere 2 podmíněné soubory (`ucast`, `vysled`).

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
- **Špička souběžnosti**: 12 DO × 3 = nejvýš **36** souběžných dotazů (po nasazení nebo vyhození všech DO najednou; za studeného startu jednoho města 3).
- **Za sčítání** přicházejí okrsky postupně → v průměru jednotky souborů za minutu na město (odhad).
- **Riziko: vyhození DO z paměti.** Feed si hlasy po okrscích drží jen v paměti. Po vyhození z paměti nová instance stáhne okrskové soubory VŠECH už sečtených okrsků znovu (test `tools/__tests__/mesta-maps-worker.test.js`: 212 sečtených = až 212 stažení), i když má v úložišti poslední snapshot. Při opakovaném vyhazování každou obnovu by to u Brna bylo až ~13 MB/obnovu v pozdní fázi. DO s požadavky každých 20–60 s by v paměti zůstat měl (zahřívání cronem pro `featured`), ale je to jediné místo, kde zátěž může vzrůst násobně — sledovat `wrangler tail` (počet `okrsek` dotazů) a v případě potřeby vypnout mapu jednoho města (`overrides.js` → `map: false`).

## Co se stane na studeném DO uprostřed sčítání (zkoušeno testem, Brno 353 okrsků, 212 sečtených, 0,4 s/soubor, souběžnost 3)
`tools/__tests__/mesta-maps-worker.test.js`:
1. **Studený start bez uloženého snapshotu**: `get()` čeká `precinctWaitMs` = 3 s (ne 35 s ani celou 12s lhůtu), pak publikuje snapshot: souhrn města (strany, mandáty, `precincts.counted`) je úplný, `okrsky[id]` mají hlasy jen u okrsků, které se stihly (zhruba 6 souběžných / 0,4 s × 3 s ≈ 45), **ostatní sečtené okrsky mají `votes: null`** (nikdy nuly). Zbytek se dotahuje na pozadí (3 souběžné) a je hotový za ~28 s, tj. do dvou obnov.
2. **Stránka**: okrsek `votes: null` je „sečteno, hlasy se dotahují“ — žlutooranžový čárkovaný polygon s vysvětlením v legendě a v tooltipu, NE šedý „čeká na sečtení“ (patch `ResultsMap`). Hlavička (sečteno X z N) je z ČSÚ souhrnu, takže správná.
3. **Další obnovy** (≥ 20 s): odpověď je okamžitě poslední dobrý snapshot (`refreshing: true`), nová verze se publikuje po dokončení; po jednom až dvou cyklech mají hlasy všechny okrsky; počty okrsků s hlasy jen rostou, souhrn se kvůli okrskům nemění.
4. **Vyhození DO**: nová instance obslouží uložený snapshot hned (bez čekání na build), `mergeCandidate` doplní hlasy z uloženého snapshotu (stejná řádka účasti), takže po obnově nikdy nemá méně okrsků s hlasy; neúplný kandidát (okrsek, který hlasy měl a teď je nemá a nejdou doplnit) se nepublikuje (`incomplete`, viz `refresh.test.js`, `validate.test.js`).
5. **Okrskové soubory ČSÚ padají (500)**: souhrn i počty sečtených okrsků se publikují dál, hlasy po okrscích jsou `null` (žlutooranžové polygony), po obnovení ČSÚ se doplní.
6. **Velikost**: Brno 353/353 okrsků s hlasy = ~79 KB snapshot (bez preferenčních hlasů, které jsou v souhrnu a přidají ~40 KB); limit pro uložení je 1,5 MB (`REFRESH.MAX_BYTES`), tj. rezerva > 10×.

„Částečný snapshot publikovaný jako úplný“ zde znamená jen chybějící hlasy po okrscích; to je v datech vždy `null` a UI to tak ukazuje. Hlavní čísla (strany, mandáty, sečteno X/N) částečná nikdy nejsou.

## Velikost dat
- `okrsky.geojson` 12 měst: celkem 527 KB (Brno 117 KB, Ostrava 84 KB, Plzeň 57 KB, České Budějovice 43 KB, Ústí 37 KB, Olomouc 34 KB, Pardubice 31 KB, Liberec 31 KB, Hradec Králové 29 KB, Zlín 25 KB, Most 20 KB, Kladno 20 KB). Stahuje se jen na stránce města s mapou. Index (`MestaIndex`) a shardy se nemění.

## Změněné okrsky a „zamrznutí“ (I3)
Když ČSÚ pošle sečtený okrsek znovu s jiným řádkem a jeho okrskový soubor je ještě ve staré verzi (součet hlasů ≠ řádek), feed soubor nepřijme. Kandidát má pro okrsek `votes: null`, `mergeCandidate` ho nemůže doplnit z uloženého snapshotu (řádek se liší) a refresher proto novou verzi **nepublikuje** (`incomplete`, odpovídá se posledním dobrým snapshotem, ten je `stale:false`) — včetně souhrnu města, dokud se soubor okrsku neaktualizuje. Test (`I3` v `mesta-maps-worker.test.js`) ukazuje: 16 obnov se starým souborem drží poslední dobrý snapshot, po 5 min se loguje `incomplete-persistent`, po aktualizaci souboru se nová verze publikuje. Je to stávající chování `validate.js` (nezměněno); u měst s mapou je zdrojem zpoždění jediný zpožděný okrskový soubor. Reakce: `wrangler tail`, při trvání vypínač mapy města.

## Okrsky vynechané z mapy (po městských částech)
Plzeň: 128 z 174 polygonů (vynechán Plzeň 1: zaniklé okrsky 1047–1056). Ostrava: 173 z 246 (Ostrava-Jih: 22 zaniklých polygonů). Brno: 348 z 353 (Brno-Medlánky: okrsek 16005 nemá polygon). Ostatních 9 měst je kompletních.
